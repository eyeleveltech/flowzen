import type { Router } from 'express';
import { API_DISPATCH, type AuthRequest } from '../../middleware/auth.js';
import { ApiError } from './core.js';

/**
 * Runs a public API write through the app's own route, in this process.
 *
 * "No duplicated business rules" (API Plan 1, decision 4). Most of what a
 * write checks lives in its route, not in a service: who a task may be handed
 * to, which month and project it may sit on, the next-step rules on a lead,
 * the clash and gear checks on a booking. Copying that into the API would be a
 * second copy to drift; calling the route itself means a write through a key
 * is refused, validated, pushed, alerted and logged exactly as the same write
 * from the app — because it IS the same code.
 *
 * The request handed in is a child of the real one, so it keeps the caller's
 * IP, headers and the API key's async context (services/apiCallContext), with
 * its own method, path and body. `req.user` is already the key's creator, and
 * API_DISPATCH tells `authenticate` not to ask for a session — a Symbol, so
 * nothing from outside can claim it.
 */

export type Dispatched = { status: number; body: any };

export function dispatch(
  router: Router,
  req: AuthRequest,
  call: { method: 'GET' | 'POST' | 'PATCH'; url: string; body?: unknown },
): Promise<Dispatched> {
  return new Promise((resolve, reject) => {
    const inner = Object.create(req) as AuthRequest & { [API_DISPATCH]?: boolean };
    inner.method = call.method;
    inner.url = call.url;
    inner.originalUrl = call.url;
    inner.baseUrl = '';
    inner.params = {};
    inner.query = {};
    inner.body = call.body ?? {};
    inner.user = req.user;
    inner[API_DISPATCH] = true;

    let statusCode = 200;
    let settled = false;
    const headers = new Map<string, unknown>();
    const settle = (body: unknown) => {
      if (settled) return;
      settled = true;
      resolve({ status: statusCode, body });
    };

    // Just enough of a response for a JSON route to answer into.
    const res = {
      locals: {},
      get statusCode() {
        return statusCode;
      },
      set statusCode(code: number) {
        statusCode = code;
      },
      get headersSent() {
        return settled;
      },
      status(code: number) {
        statusCode = code;
        return res;
      },
      sendStatus(code: number) {
        statusCode = code;
        settle(null);
        return res;
      },
      json(body: unknown) {
        settle(body);
        return res;
      },
      send(body: unknown) {
        settle(body);
        return res;
      },
      end(body?: unknown) {
        settle(body ?? null);
        return res;
      },
      setHeader(name: string, value: unknown) {
        headers.set(name.toLowerCase(), value);
        return res;
      },
      set(name: string, value: unknown) {
        headers.set(name.toLowerCase(), value);
        return res;
      },
      header(name: string, value: unknown) {
        headers.set(name.toLowerCase(), value);
        return res;
      },
      getHeader(name: string) {
        return headers.get(name.toLowerCase());
      },
      type() {
        return res;
      },
      on() {
        return res;
      },
      once() {
        return res;
      },
      emit() {
        return false;
      },
      removeListener() {
        return res;
      },
    };

    router(inner as never, res as never, (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve({ status: 404, body: { success: false, error: 'Not found' } });
    });
  });
}

/** The app's refusal, as the public API's: same status, and its sentence as the message. */
export function refusalFrom(out: Dispatched): ApiError {
  const message =
    typeof out.body?.error === 'string' && out.body.error ? out.body.error : 'The request was refused.';
  const code =
    typeof out.body?.code === 'string'
      ? out.body.code.toLowerCase()
      : out.status === 400
        ? 'invalid_request'
        : out.status === 403
          ? 'forbidden'
          : out.status === 404
            ? 'not_found'
            : out.status === 409
              ? 'conflict'
              : 'refused';
  const details = out.body?.existingTaskId ? { existingTaskId: out.body.existingTaskId } : undefined;
  return new ApiError(out.status, code, message, details);
}

/** The body of a successful dispatch, or the refusal thrown. */
export async function dispatchOk(
  router: Router,
  req: AuthRequest,
  call: { method: 'GET' | 'POST' | 'PATCH'; url: string; body?: unknown },
): Promise<any> {
  const out = await dispatch(router, req, call);
  if (out.status >= 400) throw refusalFrom(out);
  return out.body;
}
