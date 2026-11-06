/**
 * Times the read-only GETs behind the main screens (Perf Plan 1, decision 1).
 *
 * Read-only, so it is safe to point at production. Each address is fetched
 * RUNS times in a row (default 5) with a signed-in session; the median, the
 * fastest and the slowest run are printed with the payload size, whether the
 * answer came compressed, and the API's own Server-Timing figure.
 *
 *   # local, signing in with a seeded account
 *   FLOWZEN_EMAIL=you@example.com FLOWZEN_PASSWORD=… npx tsx scripts/perf-check.ts
 *
 *   # production, with a token from the browser (DevTools → Application → Cookies → token)
 *   FLOWZEN_API=https://project.eyelevelstudio.in/api FLOWZEN_TOKEN=… npx tsx scripts/perf-check.ts
 *
 *   # keep a run, and compare a later run against it
 *   FLOWZEN_OUT=perf-before.json …          FLOWZEN_BASELINE=perf-before.json …
 *
 * Nothing here writes to the database: a login is the only POST, and it only
 * happens when no token is given.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const API = (process.env.FLOWZEN_API ?? 'http://localhost:4000/api').replace(/\/$/, '');
const RUNS = Math.max(1, Number(process.env.FLOWZEN_RUNS ?? 5));

type Result = {
  name: string;
  path: string;
  status: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  bytes: number;
  /** What actually crossed the network — the compressed size when it came compressed. */
  wireBytes: number;
  encoding: string;
  serverTiming: string;
};

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday to Sunday of the current week, local time — what the Calendar screen asks for. */
function thisWeek(): { from: string; to: string } {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: dayKey(monday), to: dayKey(sunday) };
}

async function signIn(): Promise<string> {
  if (process.env.FLOWZEN_TOKEN) return process.env.FLOWZEN_TOKEN;
  const email = process.env.FLOWZEN_EMAIL;
  const password = process.env.FLOWZEN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set FLOWZEN_TOKEN, or FLOWZEN_EMAIL and FLOWZEN_PASSWORD, to sign in.');
  }
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(`Sign-in failed: ${body.error ?? res.status}`);
  return body.token;
}

async function timeOne(token: string, path: string): Promise<{ ms: number; status: number; bytes: number; encoding: string; serverTiming: string }> {
  const started = performance.now();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip, deflate, br' },
  });
  const text = await res.text();
  const ms = performance.now() - started;
  return {
    ms,
    status: res.status,
    bytes: Buffer.byteLength(text),
    encoding: res.headers.get('content-encoding') ?? 'none',
    serverTiming: res.headers.get('server-timing') ?? '',
  };
}

/**
 * The bytes on the wire. `fetch` unpacks a compressed answer before it can be
 * counted, so this one request reads the raw stream instead.
 */
function wireBytes(token: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API}${path}`);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      { headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip, deflate, br' } },
      (res) => {
        let n = 0;
        res.on('data', (chunk: Buffer) => {
          n += chunk.length;
        });
        res.on('end', () => resolve(n));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function measure(token: string, name: string, path: string): Promise<Result> {
  const runs: Awaited<ReturnType<typeof timeOne>>[] = [];
  for (let i = 0; i < RUNS; i++) runs.push(await timeOne(token, path));
  const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
  const last = runs[runs.length - 1];
  return {
    name,
    path,
    status: last.status,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    bytes: last.bytes,
    wireBytes: await wireBytes(token, path),
    encoding: last.encoding,
    serverTiming: last.serverTiming,
  };
}

const kb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const ms = (n: number) => `${Math.round(n)} ms`;

async function main() {
  const token = await signIn();
  const week = thisWeek();

  // My Department needs a department: the first one this person can see.
  let departmentPath: string | null = null;
  try {
    const res = await fetch(`${API}/departments`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { departments?: { id: string }[] };
    const first = body.departments?.[0]?.id;
    if (first) departmentPath = `/departments/${first}/overview`;
  } catch {
    // No departments, or no access: the row is skipped below.
  }

  const targets: [string, string][] = [
    ['My Work', '/tasks/my'],
    ['All tasks', '/tasks/all'],
    ['Monday brief', '/brief/monday'],
    ['Money summary', '/money/summary'],
    ['Money profit', '/money/profit'],
    ['Calendar (week)', `/calendar?from=${week.from}&to=${week.to}`],
    ['Team board', '/team/board'],
    ...(departmentPath ? ([['My Department', departmentPath]] as [string, string][]) : []),
    ['Notifications', '/notifications'],
    ['Search', '/search?q=a'],
  ];

  console.log(`\n${API} — ${RUNS} runs each, median shown\n`);
  const results: Result[] = [];
  for (const [name, path] of targets) {
    const r = await measure(token, name, path);
    results.push(r);
  }

  const baseline: Record<string, Result> = {};
  if (process.env.FLOWZEN_BASELINE) {
    for (const r of JSON.parse(readFileSync(process.env.FLOWZEN_BASELINE, 'utf8')) as Result[]) baseline[r.path] = r;
  }

  const rows = results.map((r) => {
    const before = baseline[r.path];
    return {
      Screen: r.name,
      Status: r.status,
      Median: before ? `${ms(before.medianMs)} → ${ms(r.medianMs)}` : ms(r.medianMs),
      Min: ms(r.minMs),
      Max: ms(r.maxMs),
      Payload: kb(r.bytes),
      'On the wire': before && before.wireBytes !== r.wireBytes ? `${kb(before.wireBytes)} → ${kb(r.wireBytes)}` : kb(r.wireBytes),
      Encoding: r.encoding,
      'Server-Timing': r.serverTiming || '—',
    };
  });
  console.table(rows);

  const refused = results.filter((r) => r.status >= 400);
  if (refused.length) {
    console.log(`Refused (${refused.map((r) => `${r.name}: ${r.status}`).join(', ')}) — this account cannot open those screens, so their rows are not timings.`);
  }

  if (process.env.FLOWZEN_OUT) {
    writeFileSync(process.env.FLOWZEN_OUT, JSON.stringify(results, null, 2));
    console.log(`Saved to ${process.env.FLOWZEN_OUT}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
