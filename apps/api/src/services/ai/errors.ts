import { logger } from '../../utils/logger.js';

/**
 * What goes wrong asking a model, said in a way somebody can act on.
 *
 * These live here rather than in the assistant service because every adapter
 * needs to throw them, and a service that owned them would make the adapters
 * import the thing that imports them.
 */
export class AssistantNotConfigured extends Error {
  constructor() {
    super('No AI key is set. Add one in Settings → Zen.');
    this.name = 'AssistantNotConfigured';
  }
}

export class AssistantFailed extends Error {}

/**
 * One HTTP failure, translated once for all three providers.
 *
 * They return the same handful of statuses for the same handful of reasons, and
 * the sentence a person needs is about what to do next — change the key, change
 * the model, wait — not about which vendor said no. The provider's name goes in
 * so the message is still specific.
 *
 * The body is logged and never returned: it can quote the request, and the
 * request carries client names and figures.
 */
export function httpFailure(opts: {
  label: string;
  status: number;
  body: string;
  model: string;
  organizationId: string;
}): AssistantFailed {
  const { label, status, body, model, organizationId } = opts;
  logger.error(`${label} ${status} for org ${organizationId}: ${body.slice(0, 300)}`);

  if (status === 401 || status === 403) {
    return new AssistantFailed(`${label} refused that key. Check it in Settings → Zen.`);
  }
  /*
   * 400 is the awkward one. On Gemini it usually means the key is wrong; on the
   * others it means the request is. And "the request is wrong" is most often a
   * model that will not take one of the knobs we set — a reasoning model that
   * only accepts temperature 1, or one that renamed the token cap — which the
   * person can fix by choosing a different model, but only if we say so.
   *
   * So: the provider's own `error.message` is passed through for this one
   * status. It names the parameter, not the data; the raw body never is.
   */
  if (status === 400) {
    if (/api.?key|credential|unauthor/i.test(body)) {
      return new AssistantFailed(`${label} refused that key. Check it in Settings → Zen.`);
    }
    const said = providerMessage(body);
    return new AssistantFailed(
      said
        ? `${label} rejected the request: ${said}. Try a different model in Settings.`
        : `${label} rejected the request. This is a bug, not a setting.`,
    );
  }
  if (status === 404) {
    return new AssistantFailed(`${label} has no model called "${model}". Change it in Settings.`);
  }
  if (status === 429) {
    return new AssistantFailed(`${label} is rate-limiting this key. Try again shortly.`);
  }
  if (status >= 500) {
    return new AssistantFailed(`${label} is busy at the moment. Try again in a minute.`);
  }
  return new AssistantFailed(`${label} returned ${status}.`);
}

/**
 * The one sentence a provider's error body is worth quoting.
 *
 * All three wrap it the same way — `{ error: { message } }` — and it is the
 * only part that describes what to change. Capped short: an untruncated
 * provider message can run to a paragraph of schema dump.
 */
function providerMessage(body: string): string | null {
  try {
    const said = (JSON.parse(body) as { error?: { message?: string } })?.error?.message;
    return said ? said.replace(/\s+/g, ' ').trim().slice(0, 180) : null;
  } catch {
    return null;
  }
}

/** Could not get a request out of the building at all. */
export const unreachable = (label: string) =>
  new AssistantFailed(`Could not reach ${label}. Check the server can make outbound requests.`);

/**
 * Read an SSE body a line at a time, without losing the ends of chunks.
 *
 * A chunk off the network is not a whole line, so the tail waits for the next
 * one. Splitting on every read is how a stream reader drops text at random, and
 * the symptom is a word missing from the middle of a sentence — which reads
 * like the model's mistake rather than ours. All three providers stream SSE, so
 * this is written once.
 */
export async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      yield payload;
    }
  }
  // Whatever is left when the stream ends, if it is a whole event.
  const last = buffer.trim();
  if (last.startsWith('data:')) {
    const payload = last.slice(5).trim();
    if (payload && payload !== '[DONE]') yield payload;
  }
}
