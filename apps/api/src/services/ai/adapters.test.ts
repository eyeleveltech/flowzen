import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { gemini } from './gemini.js';
import { openai, openaiCompatible } from './openai.js';
import { anthropic, forgetCapabilities } from './anthropic.js';
import { providerFor, providerChoices } from './index.js';
import type { AiReply, AiRequest, AiTurn } from './types.js';

/**
 * The adapters, which are where "use whatever API we want" is either true or a
 * promise.
 *
 * These do not ask a provider anything — they check the translation, because
 * that is the part that can be wrong in a way no amount of live testing against
 * one vendor would reveal. Three things matter and each is tested per provider:
 *
 *   1. **The request says what we meant.** The system prompt, the roles, and
 *      the tool declarations all move to a different place in each protocol,
 *      and putting the system prompt in the wrong one silently turns Zen into
 *      a general-purpose chatbot with no instructions.
 *   2. **A tool result is paired to the call that asked for it.** OpenAI and
 *      Anthropic match on an id and refuse a mismatch; Gemini matches on name.
 *   3. **A streamed tool call is reassembled.** OpenAI sends the arguments as a
 *      series of fragments that are not valid JSON on their own. Parsing them
 *      as they arrive loses most of the arguments, which looks like the model
 *      asking a vaguer question than it did.
 *
 * Anthropic goes through the official SDK, so it is the SDK client that is
 * stood in for — what it is handed is what goes on the wire.
 */

/*
 * The SDK, with its network calls replaced and everything else real — the
 * error classes in particular, so the adapter's `instanceof` checks are
 * checked against the classes the SDK actually throws.
 */
const sdk = vi.hoisted(() => ({
  clients: [] as Record<string, unknown>[],
  create: vi.fn(),
  stream: vi.fn(),
  retrieve: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic extends real.default {
    constructor(opts: ConstructorParameters<typeof real.default>[0]) {
      super(opts);
      sdk.clients.push(opts as Record<string, unknown>);
      Object.assign(this, {
        beta: { messages: { create: sdk.create, stream: sdk.stream } },
        models: { retrieve: sdk.retrieve, list: sdk.list },
      });
    }
  }
  return { ...real, default: FakeAnthropic };
});

afterEach(() => vi.unstubAllGlobals());

/** A JSON response, as a provider would send one. */
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/**
 * An SSE response whose bytes are split where we say.
 *
 * The splits are the point: a chunk off the network is not a whole line, and an
 * adapter that splits on every read drops text at random. These deliberately
 * cut a JSON payload in half.
 */
const sse = (chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );

const capture = (response: Response) => {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const sentBody = (fetchMock: ReturnType<typeof capture>) =>
  JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

const sentUrl = (fetchMock: ReturnType<typeof capture>) =>
  (fetchMock.mock.calls[0] as unknown as [string])[0];

const sentHeaders = (fetchMock: ReturnType<typeof capture>) =>
  ((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers ?? {}) as Record<string, string>;

/** Run a stream to the end: the text it yielded, and the reply it returned. */
async function drain(stream: AsyncGenerator<{ text: string }, AiReply, unknown>) {
  let text = '';
  let step = await stream.next();
  while (!step.done) {
    text += step.value.text;
    step = await stream.next();
  }
  return { text, reply: step.value };
}

/** A conversation that has already been round a tool loop once. */
const TURNS: AiTurn[] = [
  { role: 'user', text: 'who is late?' },
  { role: 'assistant', text: 'Let me look.', calls: [{ name: 'getTasks', args: { status: 'LATE' }, id: 'c1' }] },
  { role: 'tool', results: [{ name: 'getTasks', result: [{ title: 'Deck' }], id: 'c1' }] },
  { role: 'user', text: 'and for Akmal?' },
];

const req = (over: Partial<AiRequest> = {}): AiRequest => ({
  apiKey: 'secret-key',
  model: 'some-model',
  system: 'You are Zen.',
  turns: TURNS,
  tools: [
    {
      name: 'getTasks',
      description: 'Tasks, filtered.',
      parameters: { type: 'object', properties: { person: { type: 'string' } }, required: ['person'] },
    },
  ],
  temperature: 0.2,
  maxOutputTokens: 900,
  ...over,
});

const CONTEXT = 'Today is 2026-10-02.\nWHAT YOU ALREADY KNOW:\n{}';

describe('Gemini', () => {
  it('puts the system prompt in its own field and calls the model turn "model"', async () => {
    const fetchMock = capture(json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    await gemini.complete(req());

    const body = sentBody(fetchMock);
    expect(body.systemInstruction.parts[0].text).toBe('You are Zen.');
    // Gemini's name for the assistant. Sending 'assistant' is a 400.
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user', 'user']);
    expect(body.tools[0].functionDeclarations[0].name).toBe('getTasks');
  });

  it('sends a tool result as a functionResponse matched by name', async () => {
    // Gemini has no call ids at all — the pairing is the function's name.
    const fetchMock = capture(json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    await gemini.complete(req());

    const result = sentBody(fetchMock).contents[2].parts[0].functionResponse;
    expect(result.name).toBe('getTasks');
    expect(result.response.result).toEqual([{ title: 'Deck' }]);
  });

  it('puts the context ahead of the newest question, as its own part', async () => {
    const fetchMock = capture(json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    await gemini.complete(req({ context: CONTEXT }));

    const body = sentBody(fetchMock);
    expect(body.contents[3].parts).toEqual([{ text: CONTEXT }, { text: 'and for Akmal?' }]);
    // Not on the earlier question, and not in the system prompt.
    expect(body.contents[0].parts).toEqual([{ text: 'who is late?' }]);
    expect(body.systemInstruction.parts[0].text).toBe('You are Zen.');
  });

  it('keeps the tools but turns calling off on the last round', async () => {
    const a = capture(json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    await gemini.complete(req({ toolChoice: 'none' }));
    expect(sentBody(a).toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } });
    expect(sentBody(a).tools[0].functionDeclarations).toHaveLength(1);

    vi.unstubAllGlobals();
    const b = capture(json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    await gemini.complete(req());
    expect(sentBody(b).toolConfig).toBeUndefined();
  });

  it('sends the follow-up of the last round after the results, in the same turn', async () => {
    const fetchMock = capture(json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    await gemini.complete(req({ turns: [...TURNS.slice(0, 3).map((t) => (t.role === 'tool' ? { ...t, followUp: 'Answer now.' } : t))] }));
    expect(sentBody(fetchMock).contents[2].parts.at(-1)).toEqual({ text: 'Answer now.' });
    expect(sentBody(fetchMock).contents[2].parts[0].functionResponse.name).toBe('getTasks');
  });

  it('puts the key in a header, never the query string', async () => {
    // A key in a URL ends up in access logs and proxy caches.
    const fetchMock = capture(json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    await gemini.complete(req());

    expect(sentUrl(fetchMock)).not.toContain('secret-key');
    expect(sentHeaders(fetchMock)['x-goog-api-key']).toBe('secret-key');
  });

  it('reads a streamed answer that is split mid-payload', async () => {
    const fetchMock = capture(
      sse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Da One, "}]}}]}\n\ndata: {"candid',
        'ates":[{"content":{"parts":[{"text":"at 36.7%."}]}}]}\n\n',
      ]),
    );
    const { text, reply } = await drain(gemini.stream(req()));
    expect(text).toBe('Da One, at 36.7%.');
    // The whole reply comes back at the end, text included.
    expect(reply).toEqual({ text: 'Da One, at 36.7%.', calls: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAI', () => {
  it('puts the system prompt first as a message, and names the assistant turn', async () => {
    const fetchMock = capture(json({ choices: [{ message: { content: 'ok' } }] }));
    await openai.complete(req());

    const body = sentBody(fetchMock);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are Zen.' });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'user',
    ]);
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'getTasks',
        description: 'Tasks, filtered.',
        parameters: { type: 'object', properties: { person: { type: 'string' } }, required: ['person'] },
      },
    });
  });

  it('pairs a tool result to its call by id', async () => {
    // OpenAI refuses a `tool` message whose tool_call_id matches nothing it
    // asked for, so this is a 400 rather than a wrong answer when it breaks.
    const fetchMock = capture(json({ choices: [{ message: { content: 'ok' } }] }));
    await openai.complete(req());

    const body = sentBody(fetchMock);
    expect(body.messages[2].tool_calls[0].id).toBe('c1');
    // Arguments go as a JSON string, not an object.
    expect(body.messages[2].tool_calls[0].function.arguments).toBe('{"status":"LATE"}');
    expect(body.messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '[{"title":"Deck"}]',
    });
  });

  it('puts the context ahead of the newest question, as its own part', async () => {
    const fetchMock = capture(json({ choices: [{ message: { content: 'ok' } }] }));
    await openai.complete(req({ context: CONTEXT }));

    const body = sentBody(fetchMock);
    expect(body.messages[4]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: CONTEXT },
        { type: 'text', text: 'and for Akmal?' },
      ],
    });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'who is late?' });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are Zen.' });
  });

  it('keeps the tools but turns calling off on the last round', async () => {
    const a = capture(json({ choices: [{ message: { content: 'ok' } }] }));
    await openai.complete(req({ toolChoice: 'none' }));
    expect(sentBody(a).tool_choice).toBe('none');
    expect(sentBody(a).tools).toHaveLength(1);

    vi.unstubAllGlobals();
    const b = capture(json({ choices: [{ message: { content: 'ok' } }] }));
    await openai.complete(req());
    expect(sentBody(b).tool_choice).toBeUndefined();
  });

  it('sends the follow-up of the last round as a user line after the tool messages', async () => {
    const fetchMock = capture(json({ choices: [{ message: { content: 'ok' } }] }));
    await openai.complete(req({ turns: [...TURNS.slice(0, 3).map((t) => (t.role === 'tool' ? { ...t, followUp: 'Answer now.' } : t))] }));
    const roles = sentBody(fetchMock).messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
    expect(sentBody(fetchMock).messages[4]).toEqual({ role: 'user', content: 'Answer now.' });
  });

  it('sends the token cap under the name OpenAI now uses', async () => {
    // Current OpenAI models reject `max_tokens`; most third-party servers only
    // implement it. So the two builds of this adapter differ here.
    const a = capture(json({ choices: [{ message: { content: 'ok' } }] }));
    await openai.complete(req());
    expect(sentBody(a).max_completion_tokens).toBe(900);
    expect(sentBody(a).max_tokens).toBeUndefined();

    vi.unstubAllGlobals();
    const b = capture(json({ choices: [{ message: { content: 'ok' } }] }));
    await openaiCompatible.complete(req({ baseUrl: 'https://openrouter.ai/api/v1' }));
    expect(sentBody(b).max_tokens).toBe(900);
    expect(sentBody(b).max_completion_tokens).toBeUndefined();
  });

  it('goes wherever a compatible endpoint is pointed', async () => {
    const fetchMock = capture(json({ choices: [{ message: { content: 'ok' } }] }));
    await openaiCompatible.complete(req({ baseUrl: 'http://localhost:11434/v1' }));
    expect(sentUrl(fetchMock)).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('reassembles a tool call that arrives as fragments', async () => {
    /*
     * The whole sharp edge, as a test. The name comes in one delta and the
     * arguments in three, none of which parse as JSON alone. An adapter that
     * parses each fragment ends up calling getTasks with no arguments, which
     * reads as the model asking a vaguer question than it did.
     */
    const stream = openai.stream(req());
    capture(
      sse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","function":{"name":"getTasks","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"per"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"son\\":\\"Ak"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"mal\\"}"}}]}}]}\n\ndata: [DONE]\n\n',
      ]),
    );

    const { reply } = await drain(stream);
    expect(reply.calls).toEqual([{ name: 'getTasks', args: { person: 'Akmal' }, id: 'call_x' }]);
  });

  it('keeps two tool calls apart by their index', async () => {
    const stream = openai.stream(req());
    capture(
      sse([
        'data: {"choices":[{"delta":{"content":"Checking. ","tool_calls":[{"index":0,"id":"a","function":{"name":"getTasks","arguments":"{\\"person\\":"}},{"index":1,"id":"b","function":{"name":"getMonth","arguments":"{\\"month\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Akmal\\"}"}},{"index":1,"function":{"arguments":"\\"2026-09\\"}"}}]}}]}\n\n',
      ]),
    );

    const { reply } = await drain(stream);
    expect(reply).toEqual({
      text: 'Checking.',
      calls: [
        { name: 'getTasks', args: { person: 'Akmal' }, id: 'a' },
        { name: 'getMonth', args: { month: '2026-09' }, id: 'b' },
      ],
    });
  });
});

describe('Anthropic', () => {
  /** What the Models API says a model takes. */
  const capabilities = (adaptive: boolean, medium: boolean) => ({
    thinking: { supported: adaptive, types: { adaptive: { supported: adaptive }, enabled: { supported: !adaptive } } },
    effort: {
      supported: medium,
      low: { supported: medium },
      medium: { supported: medium },
      high: { supported: medium },
      max: { supported: medium },
      xhigh: { supported: medium },
    },
  });
  const TAKES: Record<string, ReturnType<typeof capabilities>> = {
    'claude-opus-5-5': capabilities(true, true),
    'claude-sonnet-5-5': capabilities(true, true),
    'claude-haiku-4-5': capabilities(false, false),
  };

  /** A finished message, as `finalMessage()` and `create()` return one. */
  const message = (content: unknown[], stop_reason = 'end_turn') => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason,
    usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 3000, cache_creation_input_tokens: 15 },
  });

  /** What `client.beta.messages.stream()` returns: events to iterate, then the whole message. */
  const streamOf = (msg: ReturnType<typeof message>, texts: string[] = []) => ({
    async *[Symbol.asyncIterator]() {
      for (const text of texts) {
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
      }
    },
    finalMessage: async () => msg,
  });

  const OK = message([{ type: 'text', text: 'ok', citations: null }]);
  const created = (n = 0) => sdk.create.mock.calls[n][0];
  const streamed = (n = 0) => sdk.stream.mock.calls[n][0];

  beforeEach(() => {
    forgetCapabilities();
    sdk.clients.length = 0;
    sdk.create.mockReset().mockResolvedValue(OK);
    sdk.stream.mockReset().mockImplementation(() => streamOf(OK, ['ok']));
    sdk.retrieve.mockReset().mockImplementation(async (model: string) => ({
      id: model,
      capabilities: TAKES[model] ?? capabilities(false, false),
    }));
    sdk.list.mockReset();
  });

  it('builds the client with the key, two retries and a two-minute timeout', async () => {
    await anthropic.complete(req());
    expect(sdk.clients[0]).toMatchObject({ apiKey: 'secret-key', authToken: null, maxRetries: 2, timeout: 120_000 });
    expect(sdk.clients[0].baseURL).toBeUndefined();

    await anthropic.complete(req({ baseUrl: 'https://gateway.example/anthropic' }));
    expect(sdk.clients[1].baseURL).toBe('https://gateway.example/anthropic');
  });

  it('puts tool results in one user turn and opens with the user', async () => {
    await anthropic.complete(req());
    const body = created();
    // A tool_result is a block in a USER message — there is no tool role.
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user', 'user']);
    expect(body.messages[2].content).toEqual([{ type: 'tool_result', tool_use_id: 'c1', content: '[{"title":"Deck"}]' }]);
    expect(body.tools[0].input_schema.required).toEqual(['person']);

    // A leading assistant turn would be a 400, so it is dropped.
    await anthropic.complete(req({ turns: [{ role: 'assistant', text: 'hello' }, { role: 'user', text: 'hi' }] }));
    expect(created(1).messages.map((m: { role: string }) => m.role)).toEqual(['user']);
  });

  it('never sends temperature, on any model', async () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-sonnet-4-5']) {
      await anthropic.complete(req({ model }));
    }
    for (const [body] of sdk.create.mock.calls) {
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('top_p');
      expect(body).not.toHaveProperty('top_k');
    }
  });

  it('sends adaptive thinking and medium effort only to a model that takes them', async () => {
    await anthropic.complete(req({ model: 'claude-opus-5-5' }));
    expect(created(0).thinking).toEqual({ type: 'adaptive' });
    expect(created(0).output_config).toEqual({ effort: 'medium' });

    await anthropic.complete(req({ model: 'claude-haiku-4-5' }));
    expect(created(1)).not.toHaveProperty('thinking');
    expect(created(1)).not.toHaveProperty('output_config');
  });

  it('asks the Models API once a day per model, not once a request', async () => {
    await anthropic.complete(req({ model: 'claude-opus-5-5' }));
    await anthropic.complete(req({ model: 'claude-opus-5-5' }));
    await anthropic.complete(req({ model: 'claude-haiku-4-5' }));
    expect(sdk.retrieve.mock.calls.map((c) => c[0])).toEqual(['claude-opus-5-5', 'claude-haiku-4-5']);
  });

  it('still answers, with neither field, when the capability lookup fails', async () => {
    sdk.retrieve.mockRejectedValue(new Anthropic.APIConnectionError({ message: 'fetch failed' }));
    const reply = await anthropic.complete(req({ model: 'claude-opus-5-5' }));
    expect(reply.text).toBe('ok');
    expect(created()).not.toHaveProperty('thinking');
    expect(created()).not.toHaveProperty('output_config');
  });

  it('asks again after a refused key, rather than holding that against the model', async () => {
    sdk.retrieve.mockRejectedValueOnce(
      new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'bad' } }, 'bad', new Headers()),
    );
    await anthropic.complete(req({ model: 'claude-opus-5-5', apiKey: 'wrong' }));
    await anthropic.complete(req({ model: 'claude-opus-5-5' }));
    expect(sdk.retrieve).toHaveBeenCalledTimes(2);
    expect(created(1).thinking).toEqual({ type: 'adaptive' });
  });

  it('caches the fixed rules and the tools, and puts the per-request context with the question', async () => {
    await anthropic.complete(
      req({
        context: CONTEXT,
        tools: [
          { name: 'searchClients', description: 'b', parameters: { type: 'object', properties: {} } },
          { name: 'getTasks', description: 'a', parameters: { type: 'object', properties: {} } },
          { name: 'rememberThis', description: 'c', parameters: { type: 'object', properties: {} } },
        ],
      }),
    );
    const body = created();
    // One explicit breakpoint, on the last (only) block of the fixed rules.
    expect(body.system).toEqual([{ type: 'text', text: 'You are Zen.', cache_control: { type: 'ephemeral' } }]);
    // And automatic caching for the growing conversation.
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    // Sorted, so the list is byte-identical whichever order it was declared in.
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual(['getTasks', 'rememberThis', 'searchClients']);
    // The context opens the newest question and goes nowhere else.
    expect(body.messages[3].content).toEqual([
      { type: 'text', text: CONTEXT },
      { type: 'text', text: 'and for Akmal?' },
    ]);
    expect(body.messages[0].content).toEqual([{ type: 'text', text: 'who is late?' }]);
    expect(JSON.stringify(body.system)).not.toContain('2026-10-02');
  });

  it('sends the thinking from a lookup back unchanged on the next round', async () => {
    const thought = [
      { type: 'thinking', thinking: '', signature: 'EuYBCkQYAiJA-signed' },
      { type: 'text', text: 'Checking.', citations: null },
      { type: 'tool_use', id: 'toolu_9', name: 'getTasks', input: { person: 'Akmal' } },
    ];
    sdk.stream.mockImplementationOnce(() => streamOf(message(thought, 'tool_use'), ['Checking.']));
    const first = await drain(anthropic.stream(req({ model: 'claude-opus-5-5', turns: [{ role: 'user', text: 'what is late for Akmal?' }] })));
    expect(first.reply.raw).toEqual(thought);
    expect(first.reply.calls).toEqual([{ name: 'getTasks', args: { person: 'Akmal' }, id: 'toolu_9' }]);

    // The loop's next round: the reply as it came, then the results.
    await drain(
      anthropic.stream(
        req({
          model: 'claude-opus-5-5',
          turns: [
            { role: 'user', text: 'what is late for Akmal?' },
            { role: 'assistant', text: first.reply.text, calls: first.reply.calls, raw: first.reply.raw },
            { role: 'tool', results: [{ name: 'getTasks', result: [], id: 'toolu_9' }] },
          ],
        }),
      ),
    );
    const sent = streamed(1).messages[1];
    expect(sent.role).toBe('assistant');
    // Byte for byte: the signature, the empty thinking text, the order.
    expect(JSON.stringify(sent.content)).toBe(JSON.stringify(thought));
  });

  it('sends the follow-up of the last round after the tool results, in the same user turn', async () => {
    await anthropic.complete(req({ turns: [...TURNS.slice(0, 3).map((t) => (t.role === 'tool' ? { ...t, followUp: 'Answer now.' } : t))] }));
    expect(created().messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'c1', content: '[{"title":"Deck"}]' },
      { type: 'text', text: 'Answer now.' },
    ]);
  });

  it('declares the tools on the last round but says none may be called', async () => {
    await anthropic.complete(req({ toolChoice: 'none' }));
    expect(created().tool_choice).toEqual({ type: 'none' });
    expect(created().tools).toHaveLength(1);

    await anthropic.complete(req());
    expect(created(1).tool_choice).toEqual({ type: 'auto' });
  });

  it('streams text as it comes, then the calls, the stop reason and the usage', async () => {
    sdk.stream.mockImplementationOnce(() =>
      streamOf(
        message(
          [
            { type: 'text', text: 'Let me look. ', citations: null },
            { type: 'tool_use', id: 't2', name: 'getMonth', input: {} },
          ],
          'tool_use',
        ),
        ['Let me ', 'look. '],
      ),
    );
    const { text, reply } = await drain(anthropic.stream(req()));
    expect(text).toBe('Let me look. ');
    expect(reply.calls).toEqual([{ name: 'getMonth', args: {}, id: 't2' }]);
    expect(reply.stop).toBe('end');
    expect(reply.usage).toEqual({ input: 120, output: 40, cacheRead: 3000, cacheCreation: 15 });
    expect(streamed().max_tokens).toBe(900);
  });

  it('reads the stop reason before the content', async () => {
    // Cut short: what came back is kept, but a half-written tool call is not run.
    sdk.create.mockResolvedValueOnce(
      message(
        [
          { type: 'text', text: 'Da One owes', citations: null },
          { type: 'tool_use', id: 't3', name: 'getTasks', input: { person: 'Ak' } },
        ],
        'max_tokens',
      ),
    );
    const cut = await anthropic.complete(req());
    expect(cut).toMatchObject({ text: 'Da One owes', calls: [], stop: 'max_tokens' });

    // Declined: nothing it said is an answer, and nothing it asked for is run.
    sdk.create.mockResolvedValueOnce(
      message(
        [
          { type: 'text', text: 'Sure, here', citations: null },
          { type: 'tool_use', id: 't4', name: 'getTasks', input: {} },
        ],
        'refusal',
      ),
    );
    const declined = await anthropic.complete(req());
    expect(declined).toMatchObject({ text: '', calls: [], stop: 'refusal' });

    const fine = await anthropic.complete(req());
    expect(fine.stop).toBe('end');
  });

  it('opts the current models into the refusal fallback, and only against Anthropic itself', async () => {
    await anthropic.complete(req({ model: 'claude-opus-5-5' }));
    expect(created(0).betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(created(0).fallbacks).toBe('default');

    await anthropic.complete(req({ model: 'claude-sonnet-5-5' }));
    expect(created(1).fallbacks).toBe('default');

    await anthropic.complete(req({ model: 'claude-haiku-4-5' }));
    await anthropic.complete(req({ model: 'claude-opus-5-5', baseUrl: 'https://gateway.example/anthropic' }));
    for (const n of [2, 3]) {
      expect(created(n)).not.toHaveProperty('fallbacks');
      expect(created(n)).not.toHaveProperty('betas');
    }
  });

  it('after a fallback mid-answer, replays only what may go back', async () => {
    // The declined model's thinking and tool call before the switch must not
    // be replayed; its text can be. What came after the switch is the answer.
    sdk.create.mockResolvedValueOnce(
      message(
        [
          { type: 'text', text: 'Looking ', citations: null },
          { type: 'thinking', thinking: '', signature: 'declined-sig' },
          { type: 'tool_use', id: 'x1', name: 'getTasks', input: {} },
          { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } },
          { type: 'tool_use', id: 'x2', name: 'getMonth', input: {} },
        ],
        'tool_use',
      ),
    );
    const reply = await anthropic.complete(req({ model: 'claude-opus-5-5' }));
    expect(reply.raw).toEqual([
      { type: 'text', text: 'Looking ', citations: null },
      { type: 'tool_use', id: 'x2', name: 'getMonth', input: {} },
    ]);
    expect(reply.calls).toEqual([{ name: 'getMonth', args: {}, id: 'x2' }]);
  });

  it('turns the SDK errors into the sentences the panel already shows', async () => {
    const body = (type: string, msg: string) => ({ type: 'error', error: { type, message: msg } });
    const cases: [unknown, string][] = [
      [new Anthropic.AuthenticationError(401, body('authentication_error', 'invalid x-api-key'), 'invalid x-api-key', new Headers()), 'Anthropic refused that key. Check it in Settings → Zen.'],
      [new Anthropic.RateLimitError(429, body('rate_limit_error', 'slow down'), 'slow down', new Headers()), 'Anthropic is rate-limiting this key. Try again shortly.'],
      [new Anthropic.NotFoundError(404, body('not_found_error', 'model: nope'), 'model: nope', new Headers()), 'Anthropic has no model called "claude-opus-5-5". Change it in Settings.'],
      [new Anthropic.APIConnectionError({ message: 'fetch failed' }), 'Could not reach Anthropic. Check the server can make outbound requests.'],
      [new Anthropic.InternalServerError(529, body('overloaded_error', 'Overloaded'), 'Overloaded', new Headers()), 'Anthropic is busy at the moment. Try again in a minute.'],
    ];
    for (const [error, said] of cases) {
      sdk.create.mockRejectedValueOnce(error);
      await expect(anthropic.complete(req({ model: 'claude-opus-5-5' }))).rejects.toThrow(said);
    }
    // And the same on the streamed path.
    sdk.stream.mockImplementationOnce(() => {
      throw new Anthropic.AuthenticationError(401, body('authentication_error', 'bad key'), 'bad key', new Headers());
    });
    await expect(drain(anthropic.stream(req()))).rejects.toThrow('Anthropic refused that key');
  });

  it('lists every model the key can call, page by page', async () => {
    sdk.list.mockImplementation(() =>
      (async function* () {
        yield { id: 'claude-sonnet-5-5' };
        yield { id: 'claude-haiku-4-5' };
        yield { id: 'claude-opus-5-5' };
      })(),
    );
    expect(await anthropic.listModels('secret-key')).toEqual(['claude-haiku-4-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
    expect(sdk.list).toHaveBeenCalledWith({ limit: 100 });
  });

  it('starts somebody new on the current Opus', () => {
    expect(anthropic.defaultModel).toBe('claude-opus-5-5');
  });
});

describe('choosing a provider', () => {
  it('offers every adapter, with somewhere to send it', () => {
    const choices = providerChoices();
    expect(choices.map((c) => c.id)).toEqual(['GEMINI', 'OPENAI', 'ANTHROPIC', 'OPENAI_COMPATIBLE']);
    // The one that exists so the list is open-ended has to ask where to go.
    expect(choices.find((c) => c.id === 'OPENAI_COMPATIBLE')?.needsBaseUrl).toBe(true);
    expect(choices.find((c) => c.id === 'GEMINI')?.needsBaseUrl).toBe(false);
  });

  it('falls back rather than failing on a value it does not know', () => {
    // The column is a string. A bad migration or a hand edit should degrade,
    // not take the assistant down with a 500.
    expect(providerFor('OPENAI').id).toBe('OPENAI');
    expect(providerFor('nonsense').id).toBe('GEMINI');
    expect(providerFor(null).id).toBe('GEMINI');
  });
});

describe('a model that no longer takes temperature', () => {
  it('is asked again without it, and never sent it after that', async () => {
    // OpenAI's reasoning models accept only the default; the first refusal
    // teaches the adapter to leave it out. (Anthropic never sends it at all.)
    const refusal = () =>
      new Response(
        JSON.stringify({ error: { type: 'invalid_request_error', message: 'Unsupported value: `temperature` does not support 0.2.' } }),
        { status: 400 },
      );
    const ok = () => json({ choices: [{ message: { content: 'ok' } }] });
    const fetchMock = vi.fn().mockResolvedValueOnce(refusal()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    const bodyOf = (call: number) => JSON.parse((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as string);

    const reply = await openai.complete(req({ model: 'o-no-temperature' }));
    expect(reply.text).toBe('ok');
    expect(bodyOf(0).temperature).toBe(0.2);
    expect(bodyOf(1)).not.toHaveProperty('temperature');

    // Remembered: the next question goes out without it, in one request.
    await openai.complete(req({ model: 'o-no-temperature' }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyOf(2)).not.toHaveProperty('temperature');
  });
});
