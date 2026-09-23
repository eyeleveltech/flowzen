import { httpFailure, sseLines, unreachable } from './errors.js';
import type { AiProvider, AiReply, AiRequest, AiStream, AiToolCall, AiTurn } from './types.js';

/**
 * Anthropic's Messages API.
 *
 * Content is a list of typed blocks rather than a string, which is the one
 * thing to hold on to: a turn that says something and asks for two functions is
 * three blocks in one message, and a tool result is a block inside a USER
 * message rather than a role of its own.
 *
 * Two rules this API enforces that the others do not, and that the translation
 * below has to respect:
 *
 *   - The first message must be from the user. A conversation replayed from the
 *     panel always starts that way, but a leading assistant turn would be a
 *     400 rather than something ignored, so it is dropped.
 *   - No message may have empty content. An assistant turn with neither text
 *     nor calls is nothing worth replaying, so it goes.
 *
 * Streamed tool input arrives as `input_json_delta` fragments keyed by block
 * index — the same reassembly problem as the OpenAI adapter, in a different
 * shape.
 */

const LABEL = 'Anthropic';
/* Pinned rather than floating: an API version is a contract, and being moved
   off it by a default is how a working integration breaks on a Tuesday. */
const API_VERSION = '2023-06-01';

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

const idFor = (name: string, id: string | undefined, at: number) => id ?? `toolu_${at}_${name}`;

function messagesFrom(turns: AiTurn[]) {
  const out: { role: 'user' | 'assistant'; content: Block[] }[] = [];

  turns.forEach((turn, at) => {
    if (turn.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: turn.text }] });
      return;
    }
    if (turn.role === 'tool') {
      out.push({
        role: 'user',
        content: turn.results.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: idFor(r.name, r.id, at),
          content: JSON.stringify(r.result),
        })),
      });
      return;
    }
    const content: Block[] = [];
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

const base = (req: AiRequest) => req.baseUrl || anthropic.defaultBaseUrl;

const bodyFor = (req: AiRequest, stream: boolean) => ({
  model: req.model,
  max_tokens: req.maxOutputTokens,
  temperature: req.temperature,
  system: req.system,
  messages: messagesFrom(req.turns),
  ...(req.tools.length
    ? {
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      }
    : {}),
  ...(stream ? { stream: true } : {}),
});

const headers = (apiKey: string) => ({
  'Content-Type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': API_VERSION,
});

async function post(req: AiRequest, stream: boolean): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${base(req)}/v1/messages`, {
      method: 'POST',
      headers: headers(req.apiKey),
      body: JSON.stringify(bodyFor(req, stream)),
    });
  } catch {
    throw unreachable(LABEL);
  }
  if (!res.ok) {
    throw httpFailure({
      label: LABEL,
      status: res.status,
      body: await res.text().catch(() => ''),
      model: req.model,
      organizationId: stream ? 'stream' : 'ask',
    });
  }
  return res;
}

export const anthropic: AiProvider = {
  id: 'ANTHROPIC',
  label: LABEL,
  defaultModel: 'claude-sonnet-4-5',
  defaultBaseUrl: 'https://api.anthropic.com',

  async listModels(apiKey, baseUrl) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl || anthropic.defaultBaseUrl}/v1/models?limit=100`, {
        headers: headers(apiKey),
      });
    } catch {
      throw unreachable(LABEL);
    }
    if (!res.ok) {
      throw httpFailure({
        label: LABEL,
        status: res.status,
        body: await res.text().catch(() => ''),
        model: '',
        organizationId: 'listing models',
      });
    }
    const data = (await res.json()) as { data?: { id?: string }[] };
    return (data.data ?? [])
      .map((m) => m.id ?? '')
      .filter(Boolean)
      .sort();
  },

  async complete(req): Promise<AiReply> {
    const res = await post(req, false);
    const data = (await res.json()) as { content?: Block[] };
    const blocks = data.content ?? [];
    return {
      text: blocks
        .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim(),
      calls: blocks
        .filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({ name: b.name, args: b.input ?? {}, id: b.id })),
    };
  },

  stream(req): AiStream {
    return (async function* () {
      const res = await post(req, true);
      if (!res.body) throw unreachable(LABEL);

      /*
       * Keyed by block index. A tool_use block announces its name and id up
       * front, then its arguments arrive as `partial_json` fragments — so the
       * name is known long before the input is, and only the accumulated string
       * is ever parsed.
       */
      const building = new Map<number, { id?: string; name: string; json: string }>();

      for await (const payload of sseLines(res.body)) {
        let event: {
          type?: string;
          index?: number;
          content_block?: { type?: string; id?: string; name?: string };
          delta?: { type?: string; text?: string; partial_json?: string };
        };
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }

        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          building.set(event.index ?? 0, {
            id: event.content_block.id,
            name: event.content_block.name ?? '',
            json: '',
          });
          continue;
        }

        if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            yield { text: event.delta.text };
            continue;
          }
          if (event.delta?.type === 'input_json_delta') {
            const at = event.index ?? 0;
            const held = building.get(at);
            // Appended, never replaced — a fragment is not valid JSON on its own.
            if (held) held.json += event.delta.partial_json ?? '';
          }
        }
      }

      return [...building.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, c]) => c)
        .filter((c) => c.name)
        .map<AiToolCall>((c) => {
          let args: Record<string, unknown> = {};
          try {
            const parsed = c.json.trim() ? JSON.parse(c.json) : {};
            if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
          } catch {
            // A function called with nothing beats a failed answer; the tool
            // itself reports what it was missing.
          }
          return { name: c.name, args, id: c.id };
        });
    })();
  },
};
