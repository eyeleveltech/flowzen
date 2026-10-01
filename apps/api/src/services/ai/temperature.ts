/**
 * Models that refuse `temperature`.
 *
 * Zen asks for a low temperature so it does not get creative about figures. But
 * newer models have stopped taking the knob — Claude's latest deprecate it, and
 * OpenAI's reasoning models accept only the default — and they answer with a
 * 400 rather than ignoring it, so Zen failed on every question with "Try a
 * different model".
 *
 * Rather than a list of model names, which goes stale every release, the
 * provider's own refusal is the signal: the first 400 that names `temperature`
 * is retried once without it, and the model is remembered so every later
 * request leaves it out straight away. Held in memory, so a restart relearns it
 * with one extra round trip.
 */

const REFUSED = new Set<string>();
const key = (label: string, model: string) => `${label}:${model}`;

/** Whether to send `temperature` to this model at all. */
export const sendsTemperature = (label: string, model: string): boolean => !REFUSED.has(key(label, model));

/**
 * True once, the first time a model refuses `temperature` — the caller then
 * sends the same request again, which now leaves it out.
 */
export function refusedTemperature(label: string, model: string, status: number, body: string): boolean {
  if (status !== 400 || !/temperature/i.test(body) || REFUSED.has(key(label, model))) return false;
  REFUSED.add(key(label, model));
  return true;
}
