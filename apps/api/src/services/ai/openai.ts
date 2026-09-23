import { httpFailure, sseLines, unreachable } from './errors.js';
import type {
  AiProvider,
  AiProviderId,
  AiReply,
  AiRequest,
  AiStream,
  AiToolCall,
  AiTurn,
} from './types.js';

/**
 * The OpenAI chat-completions protocol — and, with a base URL, most of the rest.
 *
 * This adapter is built twice: once pointed at OpenAI, once as "OpenAI
 * compatible" pointed wherever the person says. That second one is what makes
 * "whatever API we want" true rather than a promise, because OpenRouter, Groq,
 * Together, DeepSeek, Mistral, Azure, vLLM and Ollama all speak this protocol.
 * One adapter, and the provider list stops being a list of integrations we had
 * time for.
 *
 * ─── The sharp edge: streamed tool calls ────────────────────────────────────
 *
 * A streamed tool call does not arrive whole. The name and id come in one
 * delta, then the arguments arrive as a series of string fragments, each
 * carrying an `index` saying which call it belongs to:
 *
 *   delta.tool_calls[0] = { index: 0, id: 'call_a', function: { name: 'getTasks', arguments: '' } }
 *   delta.tool_calls[0] = { index: 0, function: { arguments: '{"per' } }
 *   delta.tool_calls[0] = { index: 0, function: { arguments: 'son":"Akmal"}' } }
 *
 * So they are accumulated by index and parsed once at the end. Parsing a
 * fragment as it arrives gives `{"per` — invalid JSON — and the tempting fix of
 * "parse what parses" silently drops half the arguments, which looks like the
 * model asking a vaguer question than it did.
 */

type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
};

/**
 * A tool result has to name the call it answers.
 *
 * OpenAI refuses a `tool` message whose `tool_call_id` matches nothing it
 * asked for, so an id is synthesised where one is somehow missing rather than
 * sending an empty string and getting a 400 about the shape of our request.
 */
const idFor = (name: string, id: string | undefined, at: number) => id ?? `call_${at}_${name}`;

function messagesFrom(system: string, turns: AiTurn[]): Message[] {
  const out: Message[] = [{ role: 'system', content: system }];
  turns.forEach((turn, at) => {
    if (turn.role === 'user') {
      out.push({ role: 'user', content: turn.text });
      return;
    }
    if (turn.role === 'tool') {
      // One message per result, not one message with several — the protocol
      // pairs them one to one.
      for (const r of turn.results) {
        out.push({
          role: 'tool',
          tool_call_id: idFor(r.name, r.id, at),
          content: JSON.stringify(r.result),
        });
      }
      return;
    }
    out.push({
      role: 'assistant',
      content: turn.text ?? null,
      ...(turn.calls?.length
        ? {
            tool_calls: turn.calls.map((c) => ({
              id: idFor(c.name, c.id, at),
              type: 'function' as const,
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          }
        : {}),
    });
  });
  return out;
}

/** Arguments arrive as text, and a model can send text that is not JSON. */
function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function make(opts: {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  defaultBaseUrl: string;
  needsBaseUrl?: boolean;
  /**
   * Whether to hide the models that cannot hold a conversation.
   *
   * On for OpenAI, whose /models lists embeddings, image, audio and moderation
   * models beside the chat ones. Off for a compatible endpoint, where model
   * names are whatever that server calls them and a filter would hide the only
   * model it has.
   */
  filterModels: boolean;
}): AiProvider {
  const { label, defaultBaseUrl } = opts;
  const base = (req: AiRequest) => req.baseUrl || defaultBaseUrl;

  const bodyFor = (req: AiRequest, stream: boolean) => ({
    model: req.model,
    messages: messagesFrom(req.system, req.turns),
    ...(req.tools.length
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
    temperature: req.temperature,
    /*
     * `max_completion_tokens` against OpenAI, `max_tokens` against a compatible
     * server. OpenAI renamed it and its current models reject the old name;
     * most third-party implementations only ever implemented the old one.
     */
    ...(opts.id === 'OPENAI'
      ? { max_completion_tokens: req.maxOutputTokens }
      : { max_tokens: req.maxOutputTokens }),
    ...(stream ? { stream: true } : {}),
  });

  const post = async (req: AiRequest, stream: boolean) => {
    let res: Response;
    try {
      res = await fetch(`${base(req)}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}` },
        body: JSON.stringify(bodyFor(req, stream)),
      });
    } catch {
      throw unreachable(label);
    }
    if (!res.ok) {
      throw httpFailure({
        label,
        status: res.status,
        body: await res.text().catch(() => ''),
        model: req.model,
        organizationId: stream ? 'stream' : 'ask',
      });
    }
    return res;
  };

  return {
    id: opts.id,
    label,
    defaultModel: opts.defaultModel,
    defaultBaseUrl,
    ...(opts.needsBaseUrl ? { needsBaseUrl: true } : {}),

    async listModels(apiKey, baseUrl) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl || defaultBaseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      } catch {
        throw unreachable(label);
      }
      if (!res.ok) {
        throw httpFailure({
          label,
          status: res.status,
          body: await res.text().catch(() => ''),
          model: '',
          organizationId: 'listing models',
        });
      }
      const data = (await res.json()) as { data?: { id?: string }[] };
      const names = (data.data ?? []).map((m) => m.id ?? '').filter(Boolean);
      if (!opts.filterModels) return names.sort();
      return names
        .filter((n) => !/embedding|moderation|whisper|tts|audio|dall-e|image|realtime|transcribe/.test(n))
        .sort();
    },

    async complete(req): Promise<AiReply> {
      const res = await post(req, false);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: ToolCallDelta[] } }[];
      };
      const message = data.choices?.[0]?.message;
      return {
        text: (message?.content ?? '').trim(),
        calls: (message?.tool_calls ?? [])
          .filter((c) => c.function?.name)
          .map((c) => ({
            name: c.function!.name!,
            args: parseArgs(c.function!.arguments),
            id: c.id,
          })),
      };
    },

    stream(req): AiStream {
      return (async function* () {
        const res = await post(req, true);
        if (!res.body) throw unreachable(label);

        // Keyed by the `index` the protocol sends, because that is the only
        // thing tying a fragment to the call it belongs to.
        const building = new Map<number, { id?: string; name: string; args: string }>();

        for await (const payload of sseLines(res.body)) {
          let parsed: {
            choices?: { delta?: { content?: string | null; tool_calls?: ToolCallDelta[] } }[];
          };
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) yield { text: delta.content };

          for (const piece of delta.tool_calls ?? []) {
            const at = piece.index ?? 0;
            const held = building.get(at) ?? { name: '', args: '' };
            building.set(at, {
              id: piece.id ?? held.id,
              name: piece.function?.name ?? held.name,
              // Appended, never replaced. This is the whole bug this class of
              // adapter gets wrong.
              args: held.args + (piece.function?.arguments ?? ''),
            });
          }
        }

        return [...building.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, c]) => c)
          .filter((c) => c.name)
          .map<AiToolCall>((c) => ({ name: c.name, args: parseArgs(c.args), id: c.id }));
      })();
    },
  };
}

export const openai = make({
  id: 'OPENAI',
  label: 'OpenAI',
  defaultModel: 'gpt-4.1-mini',
  defaultBaseUrl: 'https://api.openai.com/v1',
  filterModels: true,
});

export const openaiCompatible = make({
  id: 'OPENAI_COMPATIBLE',
  label: 'OpenAI-compatible',
  defaultModel: '',
  // No default worth having: the point of this one is that the person says.
  defaultBaseUrl: '',
  needsBaseUrl: true,
  filterModels: false,
});
