/**
 * Top every module up to at least 5 records — over the real HTTP API, same as seed-dummy-data.mjs.
 *
 * Idempotent by count: each phase reads how many the module already has and only creates the
 * shortfall, so re-running does not pile up duplicates.
 *
 * RUN (from apps/api, dev server up):   node test/e2e/topup-modules.mjs
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const BASE = (process.env.SEED_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');
const ORG_NAME = process.env.SEED_ORG || 'Eyelevel Growth Studio';
const TARGET = 5;

const prisma = new PrismaClient();
let TOKEN = '';
let made = 0, failed = 0;
const errors = [];

const finish = async (c) => { await prisma.$disconnect().catch(() => {}); setTimeout(() => process.exit(c), 50); };

const call = async (method, p, body) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `token=${TOKEN}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
};

const ok = (r) => r.status === 200 || r.status === 201;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };
const ymd = (n) => day(n).slice(0, 10);

const create = async (label, method, p, body) => {
  const r = await call(method, p, body);
  if (ok(r)) { made++; console.log(`     + ${label}`); return r.data; }
  failed++; const msg = `${label} — ${r.status} ${JSON.stringify(r.data).slice(0, 180)}`;
  console.log(`     ! ${msg}`); errors.push(msg); return null;
};

const run = async () => {
  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME }, select: { id: true, name: true } });
  if (!org) { console.log(`Org "${ORG_NAME}" not found`); return finish(1); }
  const admin = await prisma.user.findFirst({
    where: { organizationId: org.id, role: 'SUPER_ADMIN', status: 'ACTIVE' },
    select: { id: true, email: true, role: true, organizationId: true, tokenVersion: true },
  });
  TOKEN = jwt.sign({ userId: admin.id, email: admin.email, role: admin.role, organizationId: admin.organizationId, tokenVersion: admin.tokenVersion ?? 0 }, process.env.JWT_SECRET, { expiresIn: '1d' });
  const orgId = org.id;

  const users = await prisma.user.findMany({ where: { organizationId: orgId, status: 'ACTIVE' }, select: { id: true, name: true, role: true } });
  const members = users.filter((u) => u.role === 'TEAM_MEMBER').map((u) => u.id);
  const managers = users.filter((u) => ['SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER'].includes(u.role)).map((u) => u.id);
  const clients = ((await call('GET', '/clients?limit=100')).data?.clients || []).filter((c) => c.name !== 'Internal');

  console.log(`Org: ${org.name}   target: ${TARGET} per module\n`);

  // ── teams / departments ───────────────────────────────────────────────────
  const teamNames = ['Design Studio', 'Content & Copy', 'Performance Media', 'Web Engineering', 'Brand Strategy'];
  const haveTeams = await prisma.team.count({ where: { organizationId: orgId } });
  console.log(`teams            ${haveTeams} → ${TARGET}`);
  for (let i = haveTeams; i < TARGET; i++) {
    await create(teamNames[i], 'POST', '/teams', {
      name: teamNames[i],
      description: `${teamNames[i]} pod.`,
      memberIds: members.length ? members : [admin.id],
      managerIds: managers.length ? [managers[i % managers.length]] : [admin.id],
    });
  }

  // ── projects ──────────────────────────────────────────────────────────────
  const haveProjects = await prisma.project.count({ where: { client: { organizationId: orgId } } });
  console.log(`projects         ${haveProjects} → ${TARGET}`);
  const projNames = ['Always-On Social', 'Q4 Performance Sprint', 'Brand Refresh', 'SEO Foundation', 'Marketplace Launch'];
  const ownerId = users.find((u) => u.role === 'PROJECT_MANAGER')?.id || admin.id;
  for (let i = haveProjects; i < TARGET; i++) {
    const c = clients[i % clients.length];
    if (!c) break;
    const oneTime = i % 2 === 1;
    await create(`${projNames[i % projNames.length]} · ${c.company || c.name}`, 'POST', '/projects', {
      name: `${c.company || c.name} — ${projNames[i % projNames.length]}`,
      description: 'Delivery workstream.',
      type: oneTime ? 'ONE_TIME' : 'RETAINER',
      clientId: c.id, ownerId,
      startDate: ymd(-10), endDate: ymd(oneTime ? 75 : 270),
      priority: ['HIGH', 'MEDIUM', 'CRITICAL'][i % 3],
      status: ['IN_PROGRESS', 'PLANNING', 'REVIEW'][i % 3],
      budget: 250000 + i * 75000,
      ...(members.length ? { memberIds: members } : {}),
    });
  }

  // ── subscriptions ─────────────────────────────────────────────────────────
  const haveSubs = await prisma.subscription.count({ where: { organizationId: orgId } });
  console.log(`subscriptions    ${haveSubs} → ${TARGET}`);
  for (let i = haveSubs; i < TARGET; i++) {
    const c = clients[i % clients.length];
    if (!c) break;
    await create(`${c.company || c.name} retainer`, 'POST', '/revenue/subscriptions', {
      clientId: c.id,
      amount: [65000, 90000, 120000, 45000, 150000][i % 5],
      billingFrequency: ['MONTHLY', 'MONTHLY', 'QUARTERLY', 'MONTHLY', 'YEARLY'][i % 5],
      startDate: ymd(-30 - i * 10),
      nextBillingDate: ymd(5 + i * 3),
      status: i === 4 ? 'PAUSED' : 'ACTIVE',
      notes: 'Ongoing growth retainer.',
    });
  }

  // ── contracts ─────────────────────────────────────────────────────────────
  const haveCons = await prisma.contract.count({ where: { organizationId: orgId } });
  console.log(`contracts        ${haveCons} → ${TARGET}`);
  const conTitles = ['Website Rebuild', 'Campaign Production', 'Annual Retainer Agreement', 'Brand Identity', 'Event Coverage'];
  for (let i = haveCons; i < TARGET; i++) {
    const c = clients[i % clients.length];
    if (!c) break;
    await create(`${conTitles[i % 5]} · ${c.company || c.name}`, 'POST', '/revenue/contracts', {
      clientId: c.id,
      title: `${c.company || c.name} — ${conTitles[i % 5]}`,
      value: [350000, 620000, 1450000, 280000, 190000][i % 5],
      advanceAmount: [100000, 200000, 400000, 80000, 50000][i % 5],
      billingFrequency: i % 3 === 0 ? 'ONE_TIME' : 'MILESTONE',
      startDate: ymd(-20 - i * 5),
      endDate: ymd(100 + i * 30),
      status: i === 4 ? 'DRAFT' : 'ACTIVE',
      notes: 'Signed statement of work.',
    });
  }

  // ── payments ──────────────────────────────────────────────────────────────
  const havePays = await prisma.payment.count({ where: { organizationId: orgId } });
  console.log(`payments         ${havePays} → ${TARGET}`);
  for (let i = havePays; i < TARGET; i++) {
    const c = clients[i % clients.length];
    if (!c) break;
    await create(`payment ${i + 1} · ${c.company || c.name}`, 'POST', '/revenue/payments', {
      clientId: c.id,
      amount: [75000, 180000, 320000, 55000, 240000][i % 5],
      paidOn: ymd(-(i + 1) * 4),
      method: ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'BANK_TRANSFER', 'CARD'][i % 5],
      reference: `TXN-2026-${2000 + i}`,
      status: i === 3 ? 'PARTIAL' : 'PAID',
      notes: 'Against the running invoice.',
    });
  }

  // ── expenses ──────────────────────────────────────────────────────────────
  const haveExp = await prisma.expense.count({ where: { organizationId: orgId } });
  console.log(`expenses         ${haveExp} → ${TARGET}`);
  const expRows = [
    { category: 'MARKETING', amount: 85000, vendor: 'Meta Ads', description: 'Paid social spend' },
    { category: 'VENDOR', amount: 42000, vendor: 'Freelance Editor', description: 'Video editing retainer' },
    { category: 'EQUIPMENT', amount: 128000, vendor: 'Apple India', description: 'MacBook for the design pod' },
    { category: 'TRAVEL', amount: 18500, vendor: 'IndiGo', description: 'Client pitch travel' },
    { category: 'MISC', amount: 9500, vendor: 'Canva', description: 'Team subscription' },
  ];
  for (let i = haveExp; i < TARGET; i++) {
    const e = expRows[i % 5];
    const c = clients[i % clients.length];
    await create(`${e.category} · ${e.vendor}`, 'POST', '/revenue/expenses', {
      amount: e.amount, category: e.category, date: ymd(-(i + 2) * 3),
      vendor: e.vendor, description: e.description,
      ...(c ? { clientId: c.id } : {}),
    });
  }

  // ── invoice drafts (need ACCEPTED quotes) ─────────────────────────────────
  const haveDrafts = await prisma.invoiceDraft.count({ where: { organizationId: orgId } });
  console.log(`invoice drafts   ${haveDrafts} → ${TARGET}`);
  if (haveDrafts < TARGET) {
    const need = TARGET - haveDrafts;
    let quotes = (await call('GET', '/crm/quotes?limit=100')).data;
    quotes = quotes?.quotes || quotes || [];
    const usable = quotes.filter((q) => q.status !== 'CANCELLED').slice(0, need + 4);

    for (const q of usable) {
      if (made >= 999) break;
      const drafts = await prisma.invoiceDraft.count({ where: { organizationId: orgId } });
      if (drafts >= TARGET) break;

      if (q.status !== 'ACCEPTED') {
        const acc = await call('PATCH', `/crm/quotes/${q.id}/status`, { status: 'ACCEPTED' });
        if (!ok(acc)) { console.log(`     ! accept quote ${q.documentNumber || q.id} — ${acc.status} ${JSON.stringify(acc.data).slice(0, 140)}`); continue; }
        console.log(`     · accepted quote ${q.documentNumber || q.id}`);
      }
      // Accepting a lead-quote converts the lead, so re-read to get the clientId it now carries.
      const fresh = (await call('GET', `/crm/quotes/${q.id}`)).data;
      const clientId = fresh?.clientId;
      if (!clientId) { console.log(`     ! quote ${q.documentNumber || q.id} has no client after accept — skipped`); continue; }
      await create(`draft from ${fresh.documentNumber || q.id}`, 'POST', '/revenue/invoice-drafts', {
        quoteId: q.id, clientId, clientName: fresh.clientName || fresh.contactPerson || 'Client',
        notes: 'Generated from the accepted quotation.',
      });
    }
  }

  // ── time entries ──────────────────────────────────────────────────────────
  const haveTime = await prisma.timeEntry.count({ where: { user: { organizationId: orgId } } });
  console.log(`time entries     ${haveTime} → ${TARGET}`);
  const projects = (await call('GET', '/projects?limit=100')).data?.projects || [];
  const tasks = (await call('GET', '/tasks?limit=100')).data?.tasks || [];
  for (let i = haveTime; i < TARGET; i++) {
    const t = tasks[i % Math.max(tasks.length, 1)];
    const pr = projects[i % Math.max(projects.length, 1)];
    if (!t && !pr) break;
    await create(`${[3.5, 6, 2.25, 7.5, 4][i % 5]}h on ${t?.title || pr?.name}`, 'POST', '/time-entries', {
      ...(t?.id ? { taskId: t.id } : { projectId: pr.id }),
      date: ymd(-(i + 1)),
      hours: [3.5, 6, 2.25, 7.5, 4][i % 5],
      note: ['Strategy workshop', 'Creative production', 'Client call + notes', 'Build and QA', 'Reporting'][i % 5],
      ...(members.length ? { userId: members[i % members.length] } : {}),
    });
  }

  // ── report ────────────────────────────────────────────────────────────────
  console.log(`\n${made} created, ${failed} failed`);
  if (errors.length) { console.log('\nErrors:'); for (const e of errors) console.log(`  • ${e}`); }

  console.log('\nFinal counts');
  const w = { organizationId: orgId };
  const final = {
    'leads (pipeline)': await prisma.lead.count({ where: w }),
    clients: await prisma.client.count({ where: { ...w, archivedAt: null } }),
    quotations: await prisma.quoteDocument.count({ where: w }),
    projects: await prisma.project.count({ where: { client: w } }),
    tasks: await prisma.task.count({ where: { OR: [{ lead: w }, { project: { client: w } }] } }),
    teams: await prisma.team.count({ where: w }),
    subscriptions: await prisma.subscription.count({ where: w }),
    contracts: await prisma.contract.count({ where: w }),
    payments: await prisma.payment.count({ where: w }),
    expenses: await prisma.expense.count({ where: w }),
    'invoice drafts': await prisma.invoiceDraft.count({ where: w }),
    'time entries': await prisma.timeEntry.count({ where: { user: w } }),
    users: await prisma.user.count({ where: w }),
  };
  for (const [k, v] of Object.entries(final)) console.log(`  ${k.padEnd(18)} ${String(v).padStart(3)}  ${v >= TARGET ? '✓' : '✗ short'}`);

  return finish(failed ? 1 : 0);
};

run().catch(async (e) => { console.error(e); await finish(1); });
