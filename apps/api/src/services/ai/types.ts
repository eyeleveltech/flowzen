/**
 * One shape of conversation, three wire formats.
 *
 * Zen was written against Gemini and it showed everywhere: the request body,
 * the `x-goog-api-key` header, the SSE parsing, the `functionCall` /
 * `functionResponse` pair, even the wording of the errors. Changing provider
 * meant rewriting the service, which is the wrong thing to have to do when a
 * free tier runs out of quota at lunchtime.
 *
 * So the service now speaks the shapes below and an adapter translates. The
 * translation is not cosmetic — the three providers disagree about real things:
 *
 *   - **Where the system prompt goes.** Gemini has `systemInstruction`,
 *     Anthropic has a top-level `system`, OpenAI has a message with
 *     `role: 'system'` at the front.
 *   - **What the model's own turn is called.** `model` for Gemini,
 *     `assistant` for the other two.
 *   - **Whether a tool result needs an id.** OpenAI and Anthropic pair a
 *     result to the call that asked for it by id, and refuse a mismatch.
 *     Gemini pairs by name and has no ids at all. So `AiToolCall.id` is
 *     optional here and each adapter uses it or ignores it.
 *   - **How a streamed tool call arrives.** Gemini sends one whole object.
 *     OpenAI sends the arguments as a series of string fragments keyed by
 *     index, and Anthropic as `input_json_delta` pieces — both have to be
 *     reassembled before they parse as JSON.
 *
 * What they agree on is the tool declaration: all three take JSON Schema, so
 * `zenTools.ts` and `zenDraft.ts` declare their functions once and no adapter
 * has to rewrite them.
 */

/** A function the model may call. JSON Schema, which all three providers take. */
export type AiTool = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    // Readonly so a tool list declared `as const` — which is how zenTools and
    // zenDraft declare theirs — satisfies this without a cast.
    required?: readonly string[];
  };
};

/**
 * The model asking for a function to be run.
 *
 * `id` is set by the providers that pair a result to its call by id, and is
 * carried back unchanged in the matching `AiToolResult`. Gemini leaves it
 * undefined and pairs by name.
 */
export type AiToolCall = {
  name: string;
  args: Record<string, unknown>;
  id?: string;
};

export type AiToolResult = {
  name: string;
  result: unknown;
  id?: string;
};

/** One turn, in the order it was said. */
export type AiTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; calls?: AiToolCall[] }
  | { role: 'tool'; results: AiToolResult[] };

export type AiRequest = {
  apiKey: string;
  /** Where to send it. Only set when the person chose a provider that needs one. */
  baseUrl?: string;
  model: string;
  system: string;
  turns: AiTurn[];
  tools: readonly AiTool[];
  temperature: number;
  maxOutputTokens: number;
};

/**
 * One turn's worth of answer.
 *
 * Text and calls together rather than one or the other, because a single turn
 * can do both — a model often says "let me check" and asks for something in
 * the same breath.
 */
export type AiReply = { text: string; calls: AiToolCall[] };

/**
 * A streamed turn: text as it arrives, then whatever it asked for.
 *
 * The generator RETURNS the calls rather than yielding them, so the caller can
 * pass the text straight through to a browser and still get the calls when the
 * turn ends.
 */
export type AiStream = AsyncGenerator<{ text: string }, AiToolCall[], unknown>;

export type AiProvider = {
  id: AiProviderId;
  /** What Settings calls it. */
  label: string;
  defaultModel: string;
  /** Where it lives, unless the person overrides it. */
  defaultBaseUrl: string;
  /**
   * Set where the provider IS the base URL — an OpenAI-compatible endpoint the
   * person is pointing at themselves. Settings then asks for one.
   */
  needsBaseUrl?: boolean;
  /** What this key can actually call, asked of the provider rather than guessed. */
  listModels(apiKey: string, baseUrl?: string): Promise<string[]>;
  complete(req: AiRequest): Promise<AiReply>;
  stream(req: AiRequest): AiStream;
};

export const AI_PROVIDER_IDS = ['GEMINI', 'OPENAI', 'ANTHROPIC', 'OPENAI_COMPATIBLE'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];
