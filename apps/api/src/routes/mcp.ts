import express, { Router, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { apiKeyAuth, apiRateLimit, apiRequestLog, type ApiRequest } from '../middleware/apiKey.js';
import { buildMcpServer } from '../services/publicApi/mcpTools.js';
import { contextOf, apiErrorHandler } from './apiV1.js';
import { logger } from '../utils/logger.js';

/**
 * /api/mcp — Flowzen as an MCP server, for AI agents (API Plan 1, decision 5).
 *
 * Streamable HTTP, stateless: every POST builds a server holding only the
 * tools this key's scopes allow, answers, and is thrown away. No session is
 * kept, so there is nothing to time out, resume or leak between keys, and a
 * GET (the optional server-to-client stream) is refused — stateless servers
 * have nothing to send on it.
 *
 * The same Bearer key, rate limit and request log as /api/v1. Answers are
 * plain JSON rather than an event stream, which nothing between here and the
 * agent can hold back.
 */

export const mcpRouter = Router();

mcpRouter.use(express.json({ limit: '1mb' }));

/**
 * What the request log says: the JSON-RPC method, and for a tool call the
 * tool's name — "/mcp tools/call create_task". Never its arguments.
 */
mcpRouter.use((req: ApiRequest, _res, next) => {
  const body = req.body as { method?: unknown; params?: { name?: unknown } } | unknown[] | undefined;
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\w/.-]/g, '').slice(0, 60) : '');
  if (Array.isArray(body)) req.apiRoute = '/mcp batch';
  else if (body && typeof body === 'object' && 'method' in body) {
    const method = clean(body.method);
    const tool = method === 'tools/call' ? clean(body.params?.name) : '';
    req.apiRoute = `/mcp ${method}${tool ? ` ${tool}` : ''}`;
  } else req.apiRoute = '/mcp';
  next();
});
mcpRouter.use(apiKeyAuth, apiRequestLog, apiRateLimit);

const rpcError = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

mcpRouter.post('/', async (req: ApiRequest, res: Response) => {
  const server = buildMcpServer(contextOf(req));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    logger.error(`MCP request failed: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
    if (!res.headersSent) rpcError(res, 500, -32603, 'Internal error');
  }
});

// Stateless: no stream to open, no session to end.
mcpRouter.get('/', (_req, res) => {
  rpcError(res, 405, -32000, 'Method not allowed. Send MCP requests as POST.');
});
mcpRouter.delete('/', (_req, res) => {
  rpcError(res, 405, -32000, 'Method not allowed. This server keeps no sessions.');
});

mcpRouter.use(apiErrorHandler);
