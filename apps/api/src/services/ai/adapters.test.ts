import { describe, it, expect, vi, afterEach } from 'vitest';
import { gemini } from './gemini.js';
import { openai, openaiCompatible } from './openai.js';
import { anthropic } from './anthropic.js';
import { providerFor, providerChoices } from './index.js';
import type { AiRequest, AiTurn } from './types.js';

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
 *   3. **A streamed tool call is reassembled.** Both OpenAI and Anthropic send
 *      the arguments as a series of fragments that are not valid JSON on their
 *      own. Parsing them as they arrive loses most of the arguments, which
 *      looks like the model asking a vaguer question than it did.
 */

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
    const stream = gemini.stream(req());
    let text = '';
    let step = await stream.next();
    while (!step.done) {
      text += step.value.text;
      step = await stream.next();
    }
    expect(text).toBe('Da One, at 36.7%.');
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

    let step = await stream.next();
    while (!step.done) step = await stream.next();

    expect(step.value).toEqual([{ name: 'getTasks', args: { person: 'Akmal' }, id: 'call_x' }]);
  });

  it('keeps two tool calls apart by their index', async () => {
    const stream = openai.stream(req());
    capture(
      sse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"getTasks","arguments":"{\\"person\\":"}},{"index":1,"id":"b","function":{"name":"getMonth","arguments":"{\\"month\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Akmal\\"}"}},{"index":1,"function":{"arguments":"\\"2026-09\\"}"}}]}}]}\n\n',
      ]),
    );

    let step = await stream.next();
    while (!step.done) step = await stream.next();

    expect(step.value).toEqual([
      { name: 'getTasks', args: { person: 'Akmal' }, id: 'a' },
      { name: 'getMonth', args: { month: '2026-09' }, id: 'b' },
    ]);
  });
});

describe('Anthropic', () => {
  it('puts the system prompt at the top level and tool results in a user turn', async () => {
    const fetchMock = capture(json({ content: [{ type: 'text', text: 'ok' }] }));
    await anthropic.complete(req());

    const body = sentBody(fetchMock);
    expect(body.system).toBe('You are Zen.');
    // A tool_result is a block in a USER message — there is no tool role.
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'user',
    ]);
    expect(body.messages[2].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'c1',
      content: '[{"title":"Deck"}]',
    });
    expect(body.tools[0].input_schema.required).toEqual(['person']);
  });

  it('says which API version it was written against', async () => {
    // A floating version is how a working integration breaks on a Tuesday.
    const fetchMock = capture(json({ content: [{ type: 'text', text: 'ok' }] }));
    await anthropic.complete(req());
    expect(sentHeaders(fetchMock)['anthropic-version']).toBe('2023-06-01');
    expect(sentHeaders(fetchMock)['x-api-key']).toBe('secret-key');
  });

  it('refuses to open a conversation with the assistant', async () => {
    /*
     * The API rejects a first message from the assistant. It cannot happen from
     * the panel, whose history always starts with a question — but a dropped
     * leading turn is a better failure than a 400 nobody can read.
     */
    const fetchMock = capture(json({ content: [{ type: 'text', text: 'ok' }] }));
    await anthropic.complete(req({ turns: [{ role: 'assistant', text: 'hello' }, { role: 'user', text: 'hi' }] }));
    expect(sentBody(fetchMock).messages.map((m: { role: string }) => m.role)).toEqual(['user']);
  });

  it('reassembles tool input from partial_json fragments', async () => {
    const stream = anthropic.stream(req());
    capture(
      sse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"getTasks"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"per"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"son\\":\\"Akmal\\"}"}}\n\n',
        'data: {"type":"content_block_stop","index":0}\n\n',
      ]),
    );

    let step = await stream.next();
    while (!step.done) step = await stream.next();

    expect(step.value).toEqual([{ name: 'getTasks', args: { person: 'Akmal' }, id: 'toolu_1' }]);
  });

  it('streams text and a tool call from the same turn', async () => {
    const stream = anthropic.stream(req());
    capture(
      sse([
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me look. "}}\n\n',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t2","name":"getMonth"}}\n\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
      ]),
    );

    let text = '';
    let step = await stream.next();
    while (!step.done) {
      text += step.value.text;
      step = await stream.next();
    }
    expect(text).toBe('Let me look. ');
    expect(step.value).toEqual([{ name: 'getMonth', args: {}, id: 't2' }]);
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
