import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../utils/logger.js';
import { AssistantFailed, httpFailure, unreachable } from './errors.js';
import type { AiProvider, AiReply, AiRequest, AiStop, AiStream, AiTurn, AiUsage } from './types.js';

/**
 * Anthropic's Messages API, through the official SDK.
 *
 * Content is a list of typed blocks rather than a string, which is the one
 * thing to hold on to: a turn that thinks, says something and asks for two
 * functions is four blocks in one message, and a tool result is a block inside
 * a USER message rather than a role of its own.
 *
 * This was a hand-written `fetch`, and it broke on the models people now pick:
 *
 *   - **Sampling.** It always sent `temperature`. Current Claude models refuse
 *     it with a 400, so Zen failed outright on Opus 5.5 and Sonnet 5.5. It is
 *     never sent now. What a model does take — adaptive thinking, an effort
 *     level — is asked of the Models API, not guessed from the name.
 *   - **Thinking.** Claude thinks before it asks for a lookup, and those blocks
 *     must go back unchanged on the next request of the same question. The
 *     whole content comes back as `raw` and is replayed as it was.
 *   - **Caching.** One question is up to five requests. The tools and the fixed
 *     rules are marked for caching, and the conversation tail is cached
 *     automatically, so rounds two to five read what round one wrote.
 *   - **Retries.** The SDK retries 429, 529 and 5xx twice before anything is
 *     shown, which a raw `fetch` never did.
 *
 * Two rules the API enforces that the others do not, still respected below:
 * the first message must be from the user, and no message may be empty.
 */

const LABEL = 'Anthropic';

/** Within a request. The SDK's own retries sit inside it, per attempt. */
const TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

/*
 * The refusal fallback.
 *
 * These models run safety classifiers that can decline an ordinary business
 * question. With `fallbacks: "default"` the API re-runs a declined request on
 * the model Anthropic recommends for that kind of decline, inside the same
 * call. Only against Anthropic itself: a custom base URL is a proxy or a
 * gateway that may not know the parameter.
 */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const fallsBack = (req: AiRequest) => FALLBACK_MODELS.has(req.model) && !req.baseUrl;

/*
 * Per request, because the key and the address come from the organisation's
 * settings and can change between two questions. `authToken: null` so a stray
 * ANTHROPIC_AUTH_TOKEN on the server is never sent alongside their key.
 */
const clientFor = (apiKey: string, baseUrl?: string) =>
  new Anthropic({
    apiKey,
    authToken: null,
    baseURL: baseUrl || undefined,
    maxRetries: MAX_RETRIES,
    timeout: TIMEOUT_MS,
  });

/* ─── What the model takes ─────────────────────────────────────────────── */

type Capabilities = { adaptiveThinking: boolean; mediumEffort: boolean };
const NOTHING: Capabilities = { adaptiveThinking: false, mediumEffort: false };
const KEEP_MS = 24 * 60 * 60 * 1000;
/** A failed lookup is remembered this long, so one that keeps failing is not paid every round. */
const RETRY_FAILED_AFTER_MS = 5 * 60 * 1000;
const known = new Map<string, { at: number; keepMs: number; caps: Capabilities }>();

/** For tests: forget what every model was found to take. */
export const forgetCapabilities = () => known.clear();

/**
 * Whether this model takes adaptive thinking and a medium effort, from the
 * Models API, held for a day.
 *
 * Asked rather than listed: a list of model names goes stale every release,
 * and the model is whatever the person picked in Settings. If the lookup fails
 * — a proxy without /v1/models, a blip — neither field is sent and the question
 * still gets an answer.
 */
async function capabilitiesFor(client: Anthropic, model: string, baseUrl?: string): Promise<Capabilities> {
  const key = `${baseUrl ?? ''}|${model}`;
  const hit = known.get(key);
  if (hit && Date.now() - hit.at < hit.keepMs) return hit.caps;
  try {
    const info = await client.models.retrieve(model, null, { timeout: 15_000, maxRetries: 1 });
    const caps: Capabilities = {
      adaptiveThinking: Boolean(info.capabilities?.thinking?.types?.adaptive?.supported),
      mediumEffort: Boolean(info.capabilities?.effort?.medium?.supported),
    };
    known.set(key, { at: Date.now(), keepMs: KEEP_MS, caps });
    return caps;
  } catch (e) {
    logger.warn(`${LABEL}: could not read what ${model} supports, so thinking and effort are left out: ${e instanceof Error ? e.message : e}`);
    // A refused key says nothing about the model — the next key may be fine.
    const keyProblem = e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError;
    if (!keyProblem) known.set(key, { at: Date.now(), keepMs: RETRY_FAILED_AFTER_MS, caps: NOTHING });
    return NOTHING;
  }
}

/* ─── The request ──────────────────────────────────────────────────────── */

const idFor = (name: string, id: string | undefined, at: number) => id ?? `toolu_${at}_${name}`;

function messagesFrom(turns: AiTurn[], context?: string): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  const newest = turns.map((t) => t.role).lastIndexOf('user');

  turns.forEach((turn, at) => {
    if (turn.role === 'user') {
      /*
       * The per-request context goes here, ahead of the newest question, and
       * nowhere else. It is the same on every round of one question, so the
       * prefix up to it stays identical and rounds two to five read it from
       * the cache.
       */
      const content: Anthropic.Beta.BetaTextBlockParam[] = [];
      if (at === newest && context) content.push({ type: 'text', text: context });
      content.push({ type: 'text', text: turn.text });
      out.push({ role: 'user', content });
      return;
    }
    if (turn.role === 'tool') {
      // Every result in ONE user message: split across several, Claude learns
      // to stop asking for lookups in parallel.
      const content: (Anthropic.Beta.BetaToolResultBlockParam | Anthropic.Beta.BetaTextBlockParam)[] =
        turn.results.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: idFor(r.name, r.id, at),
          content: JSON.stringify(r.result),
        }));
      // After the results, never before: the results answer the calls first.
      if (turn.followUp) content.push({ type: 'text', text: turn.followUp });
      out.push({ role: 'user', content });
      return;
    }
    /*
     * A turn this adapter produced goes back exactly as it came — thinking
     * blocks, signatures and all. Rebuilding it from text and calls drops the
     * thinking, and the model has to reason its way to the same lookup again.
     */
    if (Array.isArray(turn.raw) && turn.raw.length) {
      out.push({ role: 'assistant', content: turn.raw as Anthropic.Beta.BetaContentBlockParam[] });
      return;
    }
    // An earlier question, replayed as plain text.
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (turn.text) content.push({ type: 'text', text: turn.text });
    for (const c of turn.calls ?? []) {
      content.push({ type: 'tool_use', id: idFor(c.name, c.id, at), name: c.name, input: c.args });
    }
    // An empty assistant turn is not a turn; sending one is a 400.
    if (content.length) out.push({ role: 'assistant', content });
  });

  // The conversation has to open with the user.
  while (out.length && out[0].role === 'assistant') out.shift();
  return out;
}

/** Sorted by name, so the list is byte-identical on every request and the cache holds. */
const toolsFrom = (req: AiRequest): Anthropic.Beta.BetaTool[] =>
  [...req.tools]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: t.parameters.properties,
        ...(t.parameters.required ? { required: [...t.parameters.required] } : {}),
      },
    }));

async function paramsFor(client: Anthropic, req: AiRequest) {
  const caps = await capabilitiesFor(client, req.model, req.baseUrl);
  const tools = toolsFrom(req);
  return {
    model: req.model,
    // A ceiling, not a target: thinking counts against it.
    max_tokens: req.maxOutputTokens,
    // The fixed rules, with the one explicit breakpoint on their last block.
    // Tools render ahead of `system`, so this caches tools and rules together.
    ...(req.system
      ? { system: [{ type: 'text' as const, text: req.system, cache_control: { type: 'ephemeral' as const } }] }
      : {}),
    // And the growing conversation, automatically.
    cache_control: { type: 'ephemeral' as const },
    messages: messagesFrom(req.turns, req.context),
    ...(tools.length ? { tools, tool_choice: { type: req.toolChoice ?? ('auto' as const) } } : {}),
    // Only what this model takes. Never `temperature`.
    ...(caps.adaptiveThinking ? { thinking: { type: 'adaptive' as const } } : {}),
    // Fixed at medium: changing it between requests throws the cache away.
    ...(caps.mediumEffort ? { output_config: { effort: 'medium' as const } } : {}),
    ...(fallsBack(req) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
  };
}

/* ─── The reply ────────────────────────────────────────────────────────── */

/**
 * What can go back with the tool results.
 *
 * After a decline and a fallback mid-answer, the declined model's thinking and
 * tool calls before the switch must not be replayed; its text can be. The
 * `fallback` marker itself is dropped. Without a fallback this is the content
 * unchanged.
 */
function echoable(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary < 0) return content;
  return content.filter((b, i) => i > boundary || (i < boundary && b.type === 'text'));
}

const stopOf = (reason: string | null | undefined): AiStop =>
  reason === 'max_tokens' ? 'max_tokens' : reason === 'refusal' ? 'refusal' : 'end';

const usageOf = (u: Anthropic.Beta.BetaUsage): AiUsage => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheCreation: u.cache_creation_input_tokens ?? 0,
});

function replyFrom(message: Anthropic.Beta.BetaMessage): AiReply {
  // The stop reason first: a refusal's content is empty or a partial to throw away.
  const stop = stopOf(message.stop_reason);
  const usage = usageOf(message.usage);
  if (stop === 'refusal') return { text: '', calls: [], stop, usage };

  const content = echoable(message.content);
  const text = content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const calls =
    // A tool input cut off at the token ceiling can still parse. It is not run.
    stop === 'max_tokens'
      ? []
      : content
          .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
          .map((b) => ({ name: b.name, args: (b.input ?? {}) as Record<string, unknown>, id: b.id }));
  return { text, calls, raw: content, stop, usage };
}

/**
 * The SDK's errors, onto the sentences the panel already shows.
 *
 * By class, never by message text. The body goes to `httpFailure`, which logs
 * it and quotes only the provider's own one-line message for a 400.
 */
function failureOf(e: unknown, model: string, where: string): Error {
  if (e instanceof AssistantFailed) return e;
  // Includes a timeout, which the SDK has already retried.
  if (e instanceof Anthropic.APIConnectionError) return unreachable(LABEL);
  const http = (status: number, err: InstanceType<typeof Anthropic.APIError>) =>
    httpFailure({
      label: LABEL,
      status,
      body: err.error ? JSON.stringify(err.error) : err.message,
      model,
      organizationId: where,
    });
  if (e instanceof Anthropic.AuthenticationError) return http(401, e);
  if (e instanceof Anthropic.PermissionDeniedError) return http(403, e);
  if (e instanceof Anthropic.NotFoundError) return http(404, e);
  if (e instanceof Anthropic.RateLimitError) return http(429, e);
  // An overload or a server error mid-stream arrives without a status.
  if (e instanceof Anthropic.APIError) return http(e.status ?? 500, e);
  return e instanceof Error ? e : new AssistantFailed(`${LABEL} failed.`);
}

export const anthropic: AiProvider = {
  id: 'ANTHROPIC',
  label: LABEL,
  // Only used when somebody first switches to Anthropic; a saved model is never changed.
  defaultModel: 'claude-opus-5-5',
  defaultBaseUrl: 'https://api.anthropic.com',

  async listModels(apiKey, baseUrl) {
    const client = clientFor(apiKey, baseUrl);
    try {
      const ids: string[] = [];
      // Iterating the page fetches the next one as it goes.
      for await (const m of client.models.list({ limit: 100 })) if (m.id) ids.push(m.id);
      return ids.sort();
    } catch (e) {
      throw failureOf(e, '', 'listing models');
    }
  },

  async complete(req): Promise<AiReply> {
    const client = clientFor(req.apiKey, req.baseUrl);
    try {
      const params = await paramsFor(client, req);
      return replyFrom(await client.beta.messages.create({ ...params, stream: false }));
    } catch (e) {
      throw failureOf(e, req.model, 'ask');
    }
  },

  stream(req): AiStream {
    return (async function* () {
      const client = clientFor(req.apiKey, req.baseUrl);
      let message: Anthropic.Beta.BetaMessage;
      try {
        const params = await paramsFor(client, req);
        const stream = client.beta.messages.stream(params);
        // Text as it is written; thinking stays hidden.
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { text: event.delta.text };
          }
        }
        // The whole message: content to replay, the calls, why it stopped, usage.
        message = await stream.finalMessage();
      } catch (e) {
        throw failureOf(e, req.model, 'stream');
      }
      return replyFrom(message);
    })();
  },
};
