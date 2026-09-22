import { Router, Response } from 'express';
import { authenticate, AuthRequest } from './middleware/auth.js';

export const sseRouter = Router();

interface Client {
  id: string;
  userId: string;
  organizationId: string;
  res: Response;
  cleanup: () => void;
}

const MAX_CONNECTIONS_PER_USER = 5;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Map of userId -> Set of Client connections
const clients = new Map<string, Set<Client>>();

// SSE endpoint
sseRouter.get('/', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.user!.organizationId;

  // Set headers for SSE
  const headers = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'Access-Control-Allow-Credentials': 'true'
  };

  res.writeHead(200, headers);
  res.flushHeaders();

  const clientId = `${Date.now()}-${Math.random()}`;

  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    clearInterval(heartbeatId);
    clearTimeout(idleTimeoutId);

    const userSet = clients.get(userId);
    if (userSet) {
      userSet.delete(newClient);
      if (userSet.size === 0) {
        clients.delete(userId);
      }
    }
  };

  const newClient: Client = {
    id: clientId,
    userId,
    organizationId,
    res,
    cleanup,
  };

  // Enforce per-user connection cap
  let userSet = clients.get(userId);
  if (!userSet) {
    userSet = new Set<Client>();
    clients.set(userId, userSet);
  } else if (userSet.size >= MAX_CONNECTIONS_PER_USER) {
    const oldestClient = userSet.values().next().value;
    if (oldestClient) {
      try {
        oldestClient.res.end();
      } catch (e) {
        /* ignore */
      }
      oldestClient.cleanup();
    }
  }

  userSet.add(newClient);

  // Initial connection heartbeat
  res.write(`data: ${JSON.stringify({ event: 'connected', data: { message: 'SSE connection established' } })}\n\n`);

  // Periodic heartbeat to keep connection alive
  const heartbeatId = setInterval(() => {
    try {
      res.write(':\n\n'); // SSE comment to keep connection alive
    } catch (e) {
      cleanup();
    }
  }, 15000);

  // Stale connection idle timeout (30 minutes)
  const idleTimeoutId = setTimeout(() => {
    try {
      res.end();
    } catch (e) {
      /* ignore */
    }
    cleanup();
  }, IDLE_TIMEOUT_MS);

  // Clean up on client disconnect or response finish
  req.on('close', cleanup);
  res.on('finish', cleanup);
});

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
