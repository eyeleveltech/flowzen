import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which API key — or which connected app — the current request is running
 * under.
 *
 * Every write made through a key must say so in its history — "Harish (via
 * API: n8n) created task …" (API Plan 1, decision 6). There are over a hundred
 * places that write an Activity row, and threading a key through each of them
 * would be a hundred chances to forget one. So the key middleware opens this
 * context for the length of the request, and the Prisma client (lib/prisma.ts)
 * adds `via` to any Activity row created inside it. A write that is not made
 * through a key never sees a context, and is untouched.
 *
 * A connected app (API Plan 2 — Claude.ai signed in with Flowzen) runs the same
 * way, and its rows read "via Claude connector".
 *
 * Imports nothing of the app's: lib/prisma.ts loads it, and anything it pulled
 * in would load before the client exists.
 */
export type ApiCall = { kind: 'key' | 'connector'; keyId: string; keyName: string };

export const apiCall = new AsyncLocalStorage<ApiCall>();

/** "API key: n8n", or "Claude connector" — what an Activity row records as `via`. */
export const viaLabel = (call: Pick<ApiCall, 'kind' | 'keyName'>): string =>
  call.kind === 'connector' ? `${call.keyName} connector` : `API key: ${call.keyName}`;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** One Activity row's data, with `via` added to its payload when a key or app is behind it. */
export function stampVia<T>(data: T, call: ApiCall | undefined = apiCall.getStore()): T {
  if (!call || !isPlainObject(data)) return data;
  const payload = isPlainObject(data.payload) ? data.payload : {};
  const by = call.kind === 'connector' ? { oauthGrantId: call.keyId } : { apiKeyId: call.keyId };
  return { ...data, payload: { ...payload, via: viaLabel(call), ...by } };
}

/** The words a history line adds after the person: "via API: n8n", "via Claude connector". Null when nothing was behind it. */
export function viaWords(payload: unknown): string | null {
  if (!isPlainObject(payload) || typeof payload.via !== 'string') return null;
  return payload.via.startsWith('API key: ') ? `via API: ${payload.via.slice('API key: '.length)}` : `via ${payload.via}`;
}
