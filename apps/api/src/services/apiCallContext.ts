import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which API key, if any, the current request is running under.
 *
 * Every write made through a key must say so in its history — "Harish (via
 * API: n8n) created task …" (API Plan 1, decision 6). There are over a hundred
 * places that write an Activity row, and threading a key through each of them
 * would be a hundred chances to forget one. So the key middleware opens this
 * context for the length of the request, and the Prisma client (lib/prisma.ts)
 * adds `via` to any Activity row created inside it. A write that is not made
 * through a key never sees a context, and is untouched.
 *
 * Imports nothing of the app's: lib/prisma.ts loads it, and anything it pulled
 * in would load before the client exists.
 */
export type ApiCall = { keyId: string; keyName: string };

export const apiCall = new AsyncLocalStorage<ApiCall>();

/** "API key: n8n" — what an Activity row written through a key records as `via`. */
export const viaLabel = (keyName: string): string => `API key: ${keyName}`;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** One Activity row's data, with `via` added to its payload when a key is behind it. */
export function stampVia<T>(data: T, call: ApiCall | undefined = apiCall.getStore()): T {
  if (!call || !isPlainObject(data)) return data;
  const payload = isPlainObject(data.payload) ? data.payload : {};
  return { ...data, payload: { ...payload, via: viaLabel(call.keyName), apiKeyId: call.keyId } };
}

/** The words a history line adds after the person: "via API: n8n". Null when no key was behind it. */
export function viaWords(payload: unknown): string | null {
  if (!isPlainObject(payload) || typeof payload.via !== 'string') return null;
  return payload.via.startsWith('API key: ') ? `via API: ${payload.via.slice('API key: '.length)}` : `via ${payload.via}`;
}
