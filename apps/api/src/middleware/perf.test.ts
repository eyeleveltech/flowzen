import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestTiming, compressResponses, routePattern, type SlowRequest } from './perf.js';

/** Perf Plan 1 — the slow-request log, Server-Timing, and compression that leaves the stream alone. */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function appWith(onSlow: (s: SlowRequest) => void, slowMs = 40) {
  const app = express();
  app.use(requestTiming({ slowMs, onSlow }));
  app.use(compressResponses());

  const tasks = express.Router();
  tasks.get('/:id/status', async (req, res) => {
    // A pretend session, as middleware/auth would leave it.
    (req as express.Request & { user?: { preset: string } }).user = { preset: 'HEAD' };
    await sleep(60);
    res.json({ success: true, id: req.params.id });
  });
  tasks.get('/quick', (_req, res) => res.json({ success: true }));
  tasks.get('/big', (_req, res) => res.json({ rows: Array.from({ length: 400 }, (_, i) => ({ i, name: `Task number ${i}` })) }));
  app.use('/api/tasks', tasks);

  app.get('/api/stream', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('data: {"event":"connected"}\n\n');
    res.end();
  });

  app.use((_req, res) => res.status(404).json({ success: false }));
  return app;
}

describe('the slow-request log', () => {
  it('logs a request over the threshold by its route pattern, with the role and never the id', async () => {
    const slow = vi.fn();
    const res = await request(appWith(slow)).get('/api/tasks/cmh3k2x9a0001abcdefghijk1/status');
    expect(res.status).toBe(200);
    expect(slow).toHaveBeenCalledTimes(1);
    const line = slow.mock.calls[0][0] as SlowRequest;
    expect(line.route).toBe('/api/tasks/:id/status');
    expect(line.method).toBe('GET');
    expect(line.status).toBe(200);
    expect(line.role).toBe('HEAD');
    expect(line.ms).toBeGreaterThanOrEqual(50);
    expect(JSON.stringify(line)).not.toContain('cmh3k2x9a0001abcdefghijk1');
  });

  it('says nothing about a quick one', async () => {
    const slow = vi.fn();
    await request(appWith(slow)).get('/api/tasks/quick');
    expect(slow).not.toHaveBeenCalled();
  });

  it('blanks the ids on an address no route answered', () => {
    const req = {
      baseUrl: '',
      path: '/api/companies/cmh3k2x9a0001abcdefghijk1/invoices/12345',
      route: undefined,
    } as unknown as express.Request;
    expect(routePattern(req)).toBe('/api/companies/:id/invoices/:id');
  });

  it('puts the API time on every answer as Server-Timing', async () => {
    const res = await request(appWith(vi.fn())).get('/api/tasks/quick');
    expect(res.headers['server-timing']).toMatch(/^app;dur=\d+(\.\d+)?$/);
  });
});

describe('compression', () => {
  it('gzips a JSON answer over the threshold when the browser accepts it', async () => {
    const res = await request(appWith(vi.fn())).get('/api/tasks/big').set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    // supertest inflates it: the body is still the JSON.
    expect(res.body.rows).toHaveLength(400);
  });

  it('leaves a small answer as it is', async () => {
    const res = await request(appWith(vi.fn())).get('/api/tasks/quick').set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('never touches the live stream', async () => {
    const res = await request(appWith(vi.fn())).get('/api/stream').set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.text).toContain('"event":"connected"');
  });
});
