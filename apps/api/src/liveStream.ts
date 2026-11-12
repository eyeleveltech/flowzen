/**
 * Who is connected to the live stream, and how to tell them something.
 *
 * Apart from sse.ts (the Express route that holds the connections open) so
 * that any service can signal the open browsers without importing a router
 * and the auth middleware with it.
 */

// A type only: nothing from Express is loaded at runtime.
import type { Response } from 'express';

export interface Client {
  id: string;
  userId: string;
  organizationId: string;
  res: Response;
  cleanup: () => void;
}

/** userId → that person's open connections. */
export const clients = new Map<string, Set<Client>>();

/**
 * Push an event to one person's open tabs.
 *
 * ─── Why these existed but did nothing ──────────────────────────────────────
 *
 * Both of these were defined here and called from NOWHERE in the API. Every
 * signed-in browser held an open EventSource that received the `connected`
 * handshake, then keep-alive comments, and never a single event for the rest
 * of the session. The bell only ever changed because React Query's 60s
 * staleTime re-asked on a remount.
 *
 * The dead `io: any` first parameter is the tell: it is a leftover from a
 * socket.io API that was migrated away from. socket.io is not a dependency
 * and both bodies ignored the argument. Dropping it is what makes the call
 * sites honest.
 */
export function emitToUser(userId: string, event: string, data: unknown) {
  const userSet = clients.get(userId);
  if (!userSet || userSet.size === 0) return;

  const payload = JSON.stringify({ event, data });
  for (const client of userSet) {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (e) {
      console.error('Failed to write to SSE stream', e);
      client.cleanup();
    }
  }
}

/**
 * Push an event to everybody signed in to one organisation.
 *
 * Carry a SIGNAL, not a payload, for anything the reader is filtered on.
 * `/notifications` withholds an alert whose rule the caller has no permission
 * for -- a designer must not learn a project is over its cost estimate -- and
 * this function knows the connected user's id, not their permissions. So the
 * notification event says only "something changed"; the client re-asks, and
 * the route applies the same filter it always has.
 */
export function emitToOrganization(orgId: string, event: string, data: unknown) {
  if (clients.size === 0) return;

  const payload = JSON.stringify({ event, data });
  for (const userSet of clients.values()) {
    for (const client of userSet) {
      if (client.organizationId === orgId) {
        try {
          client.res.write(`data: ${payload}\n\n`);
        } catch (e) {
          console.error('Failed to write to SSE stream', e);
          client.cleanup();
        }
      }
    }
  }
}
