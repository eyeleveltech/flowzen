import { Router, Response } from 'express';
import { authenticate, AuthRequest } from './middleware/auth.js';

export const sseRouter = Router();

interface Client {
  id: string;
  userId: string;
  organizationId: string;
  res: Response;
}

let clients: Client[] = [];

// SSE endpoint
sseRouter.get('/', authenticate, (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.user!.organizationId;

  // Set headers for SSE
  const headers = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    // Fixed trusted origin (matches the global CORS policy). Never reflect the
    // request Origin while credentials are allowed — that lets any site read the stream.
    'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    'Access-Control-Allow-Credentials': 'true'
  };
  
  res.writeHead(200, headers);
  res.flushHeaders();

  const clientId = Date.now().toString() + Math.random().toString();
  const newClient: Client = {
    id: clientId,
    userId,
    organizationId,
    res
  };

  clients.push(newClient);

  // Initial connection heartbeat
  res.write(`data: ${JSON.stringify({ event: 'connected', data: { message: 'SSE connection established' } })}\n\n`);

  // Periodic heartbeat to keep connection alive
  const heartbeatId = setInterval(() => {
    res.write(':\n\n'); // SSE comment to keep alive
  }, 15000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeatId);
    clients = clients.filter(client => client.id !== clientId);
  });
});

export function emitToUser(io: any, userId: string, event: string, data: unknown) {
  const targetClients = clients.filter(c => c.userId === userId);
  const payload = JSON.stringify({ event, data });
  targetClients.forEach(c => {
    try {
      c.res.write(`data: ${payload}\n\n`);
    } catch (e) {
      console.error('Failed to write to SSE stream', e);
    }
  });
}

export function emitToOrganization(io: any, orgId: string, event: string, data: unknown) {
  const targetClients = clients.filter(c => c.organizationId === orgId);
  const payload = JSON.stringify({ event, data });
  targetClients.forEach(c => {
    try {
      c.res.write(`data: ${payload}\n\n`);
    } catch (e) {
      console.error('Failed to write to SSE stream', e);
    }
  });
}
