import { httpFailure, sseLines, unreachable } from './errors.js';
import type { AiProvider, AiReply, AiRequest, AiStream, AiToolCall, AiTurn } from './types.js';

/**
 * Google Gemini.
 *
 * The odd one of the three: the model's turn is called `model` rather than
 * `assistant`, the system prompt is its own field, tool results are paired to
 * their call by NAME rather than by an id, and the key goes in a header of
 * Google's own (`x-goog-api-key`) — never a query string, where it would end up
 * in access logs and proxy caches.
 */

const LABEL = 'Gemini';

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: unknown } };
};

/** The conversation, as Gemini reads one. */
function contentsFrom(turns: AiTurn[]) {
  return turns.map((turn) => {
    if (turn.role === 'user') return { role: 'user', parts: [{ text: turn.text }] };
    if (turn.role === 'tool') {
      /*
       * A tool result is a USER turn here, which reads oddly but is what the
       * API wants: the function's output is something being handed TO the
       * model, and Gemini has no third role for it.
       */
      return {
        role: 'user',
        parts: turn.results.map((r) => ({
          functionResponse: { name: r.name, response: { result: r.result } },
        })),
      };
    }
    const parts: GeminiPart[] = [];
    if (turn.text) parts.push({ text: turn.text });
    for (const call of turn.calls ?? []) parts.push({ functionCall: { name: call.name, args: call.args } });
    return { role: 'model', parts };
  });
}

const bodyFor = (req: AiRequest) => ({
  systemInstruction: { parts: [{ text: req.system }] },
  contents: contentsFrom(req.turns),
  ...(req.tools.length ? { tools: [{ functionDeclarations: req.tools }] } : {}),
  generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxOutputTokens },
});

const base = (req: AiRequest) => req.baseUrl || gemini.defaultBaseUrl;

const partsOf = (data: unknown): GeminiPart[] =>
  (data as { candidates?: { content?: { parts?: GeminiPart[] } }[] })?.candidates?.[0]?.content?.parts ?? [];

const callOf = (part: GeminiPart): AiToolCall => ({
  name: part.functionCall!.name,
  args: part.functionCall!.args ?? {},
});

export const gemini: AiProvider = {
  id: 'GEMINI',
  label: LABEL,
  defaultModel: 'gemini-2.5-flash',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',

  async listModels(apiKey, baseUrl) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl || gemini.defaultBaseUrl}/models`, {
        headers: { 'x-goog-api-key': apiKey },
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
    const data = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };
    return (data.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      /*
       * Text models only, and only the families this is built for.
       *
       * `generateContent` is also offered by image, speech and music models,
       * and by research agents that take minutes to answer — all of which would
       * show up in a Settings dropdown as plausible choices that then do
       * nothing useful with a table of margins.
       */
      .filter((n) => /^(gemini|gemma)-/.test(n))
      .filter((n) => !/-(tts|image|transcribe|embedding|computer-use|robotics)/.test(n))
      .sort();
  },

  async complete(req): Promise<AiReply> {
    let res: Response;
    try {
      res = await fetch(`${base(req)}/models/${encodeURIComponent(req.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
        body: JSON.stringify(bodyFor(req)),
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
        organizationId: 'ask',
      });
    }
    const parts = partsOf(await res.json());
    return {
      text: parts.map((p) => p.text ?? '').join('').trim(),
      calls: parts.filter((p) => p.functionCall).map(callOf),
    };
  },

  stream(req): AiStream {
    return (async function* () {
      let res: Response;
      try {
        res = await fetch(
          `${base(req)}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
            body: JSON.stringify(bodyFor(req)),
          },
        );
      } catch {
        throw unreachable(LABEL);
      }
      if (!res.ok || !res.body) {
        throw httpFailure({
          label: LABEL,
          status: res.status,
          body: await res.text().catch(() => ''),
          model: req.model,
          organizationId: 'stream',
        });
      }

      const calls: AiToolCall[] = [];
      for await (const payload of sseLines(res.body)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          // A partial object at a chunk edge. `sseLines` should prevent it;
          // skipping beats failing the whole answer.
          continue;
        }
        for (const part of partsOf(parsed)) {
          if (part.functionCall) calls.push(callOf(part));
          else if (part.text) yield { text: part.text };
        }
      }
      return calls;
    })();
  },
};
