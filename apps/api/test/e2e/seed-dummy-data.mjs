/**
 * Dummy-data driver + module verification for a real organisation.
 *
 * Everything is created over the REAL HTTP API — no prisma.create anywhere. That is the point:
 * a direct database write skips validation, stage cascades, revenue automation, activity logging
 * and SSE, so data planted that way proves nothing about whether the modules work. Driving the
 * endpoints exercises exactly what the browser exercises.
 *
 * AUTH: mints a JWT with the app's own JWT_SECRET instead of POSTing a password. Same token the
 * login route issues, same middleware validates it. Prisma is used read-only, to look up user ids.
 *
 * RUN (from apps/api, with the dev server up):
 *   node test/e2e/seed-dummy-data.mjs
 *   node test/e2e/seed-dummy-data.mjs --verify-only     (skip creation, just check the modules)
 *
 * Every created id is written to test/e2e/.seed-manifest.json so the data can be removed exactly.
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

// NOT process.env.API_URL — .env sets that to the bare origin (no /api), and dotenv above would
// silently override the default, sending every request one path segment short.
const BASE = (process.env.SEED_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');
const ORG_NAME = process.env.SEED_ORG || 'Eyelevel Growth Studio';
const VERIFY_ONLY = process.argv.includes('--verify-only');
const MONEY_ONLY = process.argv.includes('--money-only');
const MANIFEST = path.join(__dirname, '.seed-manifest.json');

const prisma = new PrismaClient();
const manifest = { org: ORG_NAME, createdAt: new Date().toISOString(), users: [], leads: [], quotes: [], projects: [], tasks: [], clients: [] };

let TOKEN = '';
let pass = 0, fail = 0, warn = 0;
const problems = [];

// ── plumbing ────────────────────────────────────────────────────────────────
// Windows libuv aborts if the process exits while Prisma's handles are still closing.
const finish = async (code) => { await prisma.$disconnect().catch(() => {}); setTimeout(() => process.exit(code), 50); };

const call = async (method, p, body, token = TOKEN) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `token=${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
};

const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); problems.push(`${name}${detail ? ` — ${detail}` : ''}`); }
};
const note = (msg) => { warn++; console.log(`  NOTE  ${msg}`); problems.push(`NOTE: ${msg}`); };

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };
const ymd = (n) => day(n).slice(0, 10);

// ── data ────────────────────────────────────────────────────────────────────
const TEAM = [
  { name: 'Priya Raghavan', email: 'priya.raghavan@eyelevelstudio.in', role: 'ADMIN', designation: 'Sales Lead' },
  { name: 'Vikram Nair', email: 'vikram.nair@eyelevelstudio.in', role: 'PROJECT_MANAGER', designation: 'Delivery Manager' },
  { name: 'Ananya Shetty', email: 'ananya.shetty@eyelevelstudio.in', role: 'TEAM_MEMBER', designation: 'Content Strategist' },
  { name: 'Rahul Menon', email: 'rahul.menon@eyelevelstudio.in', role: 'TEAM_MEMBER', designation: 'Performance Marketer' },
];

const LEADS = [
  { companyName: 'Kadamba Organics',      contactName: 'Meera Iyer',      email: 'meera@kadambaorganics.in',  phone: '9845012371', industry: 'FMCG',          city: 'Bengaluru', source: 'INBOUND',       priority: 'HIGH',   dealValue: 480000,  stage: 'NEW_LEAD' },
  { companyName: 'Northline Logistics',   contactName: 'Arjun Bhat',      email: 'arjun@northlinelog.com',    phone: '9845012372', industry: 'Logistics',     city: 'Chennai',   source: 'COLD_CALL',     priority: 'MEDIUM', dealValue: 320000,  stage: 'NEW_LEAD' },
  { companyName: 'Verdant Interiors',     contactName: 'Sneha Kulkarni',  email: 'sneha@verdantint.in',       phone: '9845012373', industry: 'Interior Design', city: 'Pune',    source: 'INSTAGRAM',     priority: 'LOW',    dealValue: 150000,  stage: 'NEW_LEAD' },
  { companyName: 'Sattva Wellness',       contactName: 'Rohit Deshpande', email: 'rohit@sattvawellness.com',  phone: '9845012374', industry: 'Healthcare',    city: 'Mumbai',    source: 'REFERRAL',      priority: 'HIGH',   dealValue: 720000,  stage: 'OUTREACH' },
  { companyName: 'Corvus Fintech',        contactName: 'Divya Rajan',     email: 'divya@corvusfin.io',        phone: '9845012375', industry: 'Fintech',       city: 'Hyderabad', source: 'LINKEDIN',      priority: 'HIGH',   dealValue: 1250000, stage: 'OUTREACH' },
  { companyName: 'Bluepeak Realty',       contactName: 'Karan Malhotra',  email: 'karan@bluepeakrealty.in',   phone: '9845012376', industry: 'Real Estate',   city: 'Gurugram',  source: 'EVENT',         priority: 'MEDIUM', dealValue: 600000,  stage: 'MEETING' },
  { companyName: 'Anantha Jewellers',     contactName: 'Lakshmi Suresh',  email: 'lakshmi@ananthajewels.com', phone: '9845012377', industry: 'Retail',        city: 'Coimbatore',source: 'EXISTING_CLIENT',priority: 'HIGH',  dealValue: 950000,  stage: 'MEETING' },
  { companyName: 'Trailhead Outdoors',    contactName: 'Nikhil Verma',    email: 'nikhil@trailheadout.in',    phone: '9845012378', industry: 'E-commerce',    city: 'Bengaluru', source: 'SOCIAL_MEDIA',  priority: 'MEDIUM', dealValue: 410000,  stage: 'PROPOSAL' },
  { companyName: 'Meridian EdTech',       contactName: 'Fatima Sheikh',   email: 'fatima@meridianedu.com',    phone: '9845012379', industry: 'Education',     city: 'Delhi',     source: 'INBOUND',       priority: 'HIGH',   dealValue: 880000,  stage: 'PROPOSAL' },
  { companyName: 'Cobalt Cloudworks',     contactName: 'Sanjay Pillai',   email: 'sanjay@cobaltcloud.dev',    phone: '9845012380', industry: 'SaaS',          city: 'Bengaluru', source: 'REFERRAL',      priority: 'HIGH',   dealValue: 1600000, stage: 'NEGOTIATION' },
  { companyName: 'Rasa Foods',            contactName: 'Ishita Banerjee', email: 'ishita@rasafoods.in',       phone: '9845012381', industry: 'F&B',           city: 'Kolkata',   source: 'OUTBOUND',      priority: 'MEDIUM', dealValue: 540000,  stage: 'NEGOTIATION' },
  { companyName: 'Halcyon Resorts',       contactName: 'Aditya Rao',      email: 'aditya@halcyonresorts.com', phone: '9845012382', industry: 'Hospitality',   city: 'Goa',       source: 'EVENT',         priority: 'HIGH',   dealValue: 1100000, stage: 'ACTIVE_RETAINER' },
  { companyName: 'Ferrum Auto Parts',     contactName: 'Deepak Chauhan',  email: 'deepak@ferrumauto.in',      phone: '9845012383', industry: 'Manufacturing', city: 'Ludhiana',  source: 'COLD_CALL',     priority: 'MEDIUM', dealValue: 750000,  stage: 'ACTIVE_PROJECT' },
  { companyName: 'Willow & Co',           contactName: 'Tara Kapoor',     email: 'tara@willowandco.in',       phone: '9845012384', industry: 'Fashion',       city: 'Mumbai',    source: 'INSTAGRAM',     priority: 'LOW',    dealValue: 260000,  stage: 'CHURNED' },
];

// ── main ────────────────────────────────────────────────────────────────────
const run = async () => {
  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME }, select: { id: true, name: true } });
  if (!org) { console.log(`Organisation "${ORG_NAME}" not found.`); return finish(1); }

  const admin = await prisma.user.findFirst({
    where: { organizationId: org.id, role: 'SUPER_ADMIN', status: 'ACTIVE' },
    select: { id: true, email: true, role: true, organizationId: true, tokenVersion: true },
  });
  if (!admin) { console.log('No active SUPER_ADMIN in that organisation.'); return finish(1); }

  const mint = (u) => jwt.sign(
    { userId: u.id, email: u.email, role: u.role, organizationId: u.organizationId, tokenVersion: u.tokenVersion ?? 0 },
    process.env.JWT_SECRET, { expiresIn: '1d' },
  );
  TOKEN = mint(admin);
  manifest.orgId = org.id;

  const me = await call('GET', '/auth/me');
  if (me.status !== 200) { console.log('Token rejected:', me.status, JSON.stringify(me.data)); return finish(1); }
  console.log(`Org: ${org.name}\nActing as: ${me.data?.user?.name || admin.email} (${admin.role})`);
  console.log(`Modules: ${(me.data?.user?.enabledModules || []).join(', ') || '(none)'}\n`);

  const before = {
    leads: (await call('GET', '/crm/leads/count')).data?.count ?? 0,
    clients: (await call('GET', '/clients?limit=1')).data?.pagination?.total ?? 0,
  };
  console.log(`Starting point — leads: ${before.leads}, clients: ${before.clients}\n`);

  // A re-run that only verifies still needs the ids from the creating run, or the timeline and
  // role probes silently degrade to "nothing to check" and look like failures.
  if ((VERIFY_ONLY || MONEY_ONLY) && fs.existsSync(MANIFEST)) {
    Object.assign(manifest, JSON.parse(fs.readFileSync(MANIFEST, 'utf8')));
    console.log(`Loaded manifest: ${manifest.leads.length} leads, ${manifest.users.length} users
`);
  }

  if (MONEY_ONLY) {
    await seedMoney();
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  } else if (!VERIFY_ONLY) {
    await seedUsers();
    await seedLeads();
    await enrichLeads();
    await seedQuotes();
    await progressDeals();
    await seedDelivery();
    await seedMoney();
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest written: ${MANIFEST}`);
  }

  await verifyModules(before);
  await probePermissions(mint);

  console.log('\n==============================================');
  console.log(`  ${pass} passed, ${fail} failed, ${warn} notes`);
  console.log('==============================================');
  if (problems.length) {
    console.log('\nFindings:');
    for (const p of problems) console.log(`  • ${p}`);
  }
  return finish(fail ? 1 : 0);
};

// ── phase 1: users ──────────────────────────────────────────────────────────
async function seedUsers() {
  console.log('1. Invite team members');
  for (const t of TEAM) {
    const r = await call('POST', '/settings/users', t);
    if (r.status === 409) { console.log(`  SKIP  ${t.name} already exists`);
      const u = await prisma.user.findUnique({ where: { email: t.email }, select: { id: true } });
      if (u) manifest.users.push({ id: u.id, ...t });
      continue; }
    check(`invite ${t.role.padEnd(15)} ${t.name}`, r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    const id = r.data?.id || r.data?.user?.id;
    if (id) manifest.users.push({ id, ...t });
  }
  // Invited users land as PENDING; they cannot log in until they accept. Activate through the
  // real update endpoint (not the DB) so the permission probe below can actually mint for them.
  for (const u of manifest.users) {
    if (!u.id) continue;
    const r = await call('PUT', `/settings/users/${u.id}`, { status: 'ACTIVE' });
    if (r.status !== 200) note(`could not activate ${u.name} via PUT /settings/users/:id — ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  }
  console.log('');
}

// ── phase 2: leads ──────────────────────────────────────────────────────────
async function seedLeads() {
  console.log('2. Create leads across the funnel');
  const owners = manifest.users.filter((u) => u.role === 'ADMIN' || u.role === 'PROJECT_MANAGER').map((u) => u.id).filter(Boolean);
  let i = 0;
  for (const l of LEADS) {
    const assignedToId = owners.length ? owners[i % owners.length] : undefined;
    const body = {
      companyName: l.companyName, contactName: l.contactName, email: l.email, phone: l.phone,
      industry: l.industry, city: l.city, country: 'India', source: l.source, priority: l.priority,
      dealValue: l.dealValue,
      expectedCloseDate: day(15 + (i * 5)),
      followUpDate: day(i % 4 === 0 ? -2 : 3 + i),   // some deliberately overdue
      website: `https://www.${l.companyName.toLowerCase().replace(/[^a-z]/g, '')}.in`,
      notes: `Inbound interest in ${l.industry.toLowerCase()} growth retainer.`,
      ...(assignedToId ? { assignedToId } : {}),
    };
    const r = await call('POST', '/crm/leads', body);
    check(`lead ${l.companyName}`, r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    if (r.data?.id) manifest.leads.push({ id: r.data.id, companyName: l.companyName, targetStage: l.stage, dealValue: l.dealValue });
    i++;
  }
  console.log('');
}

// ── phase 3: contacts, activities, tasks, notes ─────────────────────────────
async function enrichLeads() {
  console.log('3. Enrich leads — contacts, activities, tasks, notes');
  const sample = manifest.leads.slice(0, 8);
  const members = manifest.users.filter((u) => u.role === 'TEAM_MEMBER').map((u) => u.id).filter(Boolean);

  for (const [n, lead] of sample.entries()) {
    // second contact on the account
    const c = await call('POST', `/crm/leads/${lead.id}/contacts`, {
      name: ['Ravi Subramanian', 'Neha Gupta', 'Imran Qureshi', 'Kavya Reddy'][n % 4],
      designation: ['CFO', 'Head of Marketing', 'Founder', 'Ops Lead'][n % 4],
      email: `second${n}@${lead.companyName.toLowerCase().replace(/[^a-z]/g, '')}.in`,
      phone: `98450199${String(10 + n).padStart(2, '0')}`,
      role: ['DECISION_MAKER', 'INFLUENCER', 'CHAMPION', 'GATEKEEPER'][n % 4],
    });
    if (n === 0) check('add a second contact to a lead', c.status === 200 || c.status === 201, `${c.status} ${JSON.stringify(c.data).slice(0, 200)}`);

    const a1 = await call('POST', `/crm/leads/${lead.id}/activity`, {
      kind: 'call', body: 'Intro call. Walked through the retainer model and case studies.',
      callDate: day(-3), duration: 25, outcome: 'Positive',
      followUpRequired: true, followUpDate: day(4),
    });
    if (n === 0) check('log a call activity', a1.status === 200 || a1.status === 201, `${a1.status} ${JSON.stringify(a1.data).slice(0, 200)}`);

    const a2 = await call('POST', `/crm/leads/${lead.id}/activity`, {
      kind: 'meeting', body: 'Scope workshop with the marketing team.',
      meetingDate: day(-1), meetingFormat: 'Google Meet', attendees: 'Founder, CMO', nextStep: 'Share proposal',
    });
    if (n === 0) check('log a meeting activity', a2.status === 200 || a2.status === 201, `${a2.status} ${JSON.stringify(a2.data).slice(0, 200)}`);

    const nt = await call('POST', `/crm/leads/${lead.id}/notes`, { content: 'Budget confirmed for the next quarter. Procurement needs a GST invoice.' });
    if (n === 0) check('add a note', nt.status === 200 || nt.status === 201, `${nt.status} ${JSON.stringify(nt.data).slice(0, 200)}`);

    const tk = await call('POST', '/tasks', {
      title: `Prepare growth audit — ${lead.companyName}`,
      description: 'Channel audit + competitor teardown ahead of the proposal.',
      leadId: lead.id, priority: n % 3 === 0 ? 'HIGH' : 'MEDIUM',
      status: n % 2 === 0 ? 'TODO' : 'IN_PROGRESS',
      dueDate: day(n % 5 === 0 ? -1 : 6),
      ...(members.length ? { assigneeId: members[n % members.length] } : {}),
    });
    if (n === 0) check('create a pre-sales task on a lead', tk.status === 200 || tk.status === 201, `${tk.status} ${JSON.stringify(tk.data).slice(0, 200)}`);
    if (tk.data?.id) manifest.tasks.push(tk.data.id);
  }
  console.log('');
}

// ── phase 4: quotations ─────────────────────────────────────────────────────
async function seedQuotes() {
  console.log('4. Quotations against leads');
  const targets = manifest.leads.filter((l) => ['PROPOSAL', 'NEGOTIATION'].includes(l.targetStage));
  for (const [n, lead] of targets.entries()) {
    const r = await call('POST', '/crm/quotes', {
      documentType: 'QUOTATION',
      documentDate: ymd(-2),
      expirationDate: ymd(20),
      leadId: lead.id,
      contactPerson: LEADS.find((l) => l.companyName === lead.companyName)?.contactName || 'Contact',
      clientEmail: LEADS.find((l) => l.companyName === lead.companyName)?.email,
      paymentTerms: '50% advance, 50% on delivery',
      termsConditions: 'Valid for 20 days. Scope changes billed separately. GST extra at 18%.',
      scope: 'Monthly growth retainer — paid media, content and analytics.',
      lineItems: [
        { description: 'Growth retainer — monthly', unit: 'month', quantity: 3, unitPrice: Math.round(lead.dealValue / 4), taxPct: 18 },
        { description: 'Creative production', unit: 'nos', quantity: 12, unitPrice: 6500, discountPct: 5, taxPct: 18 },
      ],
    });
    check(`quote for ${lead.companyName}`, r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`);
    if (r.data?.id) {
      manifest.quotes.push({ id: r.data.id, leadId: lead.id, company: lead.companyName });
      if (n === 0) {
        const s = await call('PATCH', `/crm/quotes/${r.data.id}/status`, { status: 'SENT' });
        check('move a quote to SENT', s.status === 200, `${s.status} ${JSON.stringify(s.data).slice(0, 200)}`);
      }
    }
  }
  console.log('');
}

// ── phase 5: drag deals through the pipeline ────────────────────────────────
async function progressDeals() {
  console.log('5. Move deals through the pipeline');
  for (const lead of manifest.leads) {
    if (lead.targetStage === 'NEW_LEAD') continue;
    const path = stagePath(lead.targetStage);
    let ok = true, detail = '';
    for (const stage of path) {
      const body = { stage, fields: {} };
      if (stage === 'ACTIVE_RETAINER') { body.contractStartDate = day(-5); body.contractEndDate = day(300); body.billingFrequency = 'MONTHLY'; }
      if (stage === 'ACTIVE_PROJECT') { body.contractStartDate = day(-5); body.contractEndDate = day(120); }
      if (stage === 'CHURNED') { body.lostReason = 'BUDGET'; body.notes = 'Budget pulled for the financial year.'; }
      const r = await call('POST', `/crm/leads/${lead.id}/stage`, body);
      if (r.status !== 200) { ok = false; detail = `${stage} → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`; break; }
    }
    check(`${lead.companyName} → ${lead.targetStage}`, ok, detail);
  }
  console.log('');
}

function stagePath(target) {
  const funnel = ['OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION'];
  if (funnel.includes(target)) return funnel.slice(0, funnel.indexOf(target) + 1);
  if (target === 'CHURNED') return ['OUTREACH', 'MEETING', 'CHURNED'];
  if (target === 'ACTIVE_RETAINER') return [...funnel, 'CONTRACT', 'ACTIVE_RETAINER'];
  if (target === 'ACTIVE_PROJECT') return [...funnel, 'CONTRACT', 'ACTIVE_PROJECT'];
  return [];
}

// ── phase 6: delivery ───────────────────────────────────────────────────────
async function seedDelivery() {
  console.log('6. Delivery — projects and tasks on won accounts');
  const clients = (await call('GET', '/clients?limit=100')).data?.clients || [];
  const fresh = clients.filter((c) => LEADS.some((l) => l.companyName === c.name || l.companyName === c.company));
  const pm = manifest.users.find((u) => u.role === 'PROJECT_MANAGER');
  const members = manifest.users.filter((u) => u.role === 'TEAM_MEMBER').map((u) => u.id).filter(Boolean);
  const ownerId = pm?.id;

  if (!fresh.length) { note('no new client accounts found after winning deals — delivery phase skipped'); return; }
  if (!ownerId) { note('no PROJECT_MANAGER available to own a project — delivery phase skipped'); return; }

  for (const [n, c] of fresh.entries()) {
    const isRetainer = n % 2 === 0;
    const r = await call('POST', '/projects', {
      name: `${c.company || c.name} — ${isRetainer ? 'Growth Retainer' : 'Website Revamp'}`,
      description: 'Auto-created for module verification.',
      type: isRetainer ? 'RETAINER' : 'ONE_TIME',
      clientId: c.id, ownerId,
      startDate: ymd(-5),
      endDate: isRetainer ? ymd(300) : ymd(90),
      priority: 'HIGH', status: 'IN_PROGRESS',
      budget: 400000,
      ...(members.length ? { memberIds: members } : {}),
    });
    check(`project for ${c.company || c.name}`, r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`);
    if (!r.data?.id) continue;
    manifest.projects.push(r.data.id);

    for (const [m, title] of ['Channel audit', 'Content calendar — month 1', 'Landing page build', 'Reporting dashboard'].entries()) {
      const t = await call('POST', '/tasks', {
        title, projectId: r.data.id,
        type: ['STRATEGY', 'CONTENT', 'DEVELOPMENT', 'DIGITAL_MARKETING'][m],
        priority: ['HIGH', 'MEDIUM', 'HIGH', 'LOW'][m],
        status: ['COMPLETED', 'IN_PROGRESS', 'TODO', 'BACKLOG'][m],
        dueDate: day(m === 0 ? -3 : 5 + m * 7),
        estimatedHours: [8, 16, 24, 6][m],
        ...(members.length ? { assigneeId: members[m % members.length] } : {}),
      });
      if (n === 0 && m === 0) check('create a delivery task', t.status === 200 || t.status === 201, `${t.status} ${JSON.stringify(t.data).slice(0, 200)}`);
      if (t.data?.id) manifest.tasks.push(t.data.id);
    }
  }
  console.log('');
}


// ── phase 6b: money — payments and expenses against the won accounts ────────
async function seedMoney() {
  console.log('6b. Revenue — payments and expenses');
  const clients = (await call('GET', '/clients?limit=100')).data?.clients || [];
  const won = clients.filter((c) => LEADS.some((l) => l.companyName === c.name || l.companyName === c.company));
  if (!won.length) { note('no won accounts to bill — money phase skipped'); return; }

  for (const [n, c] of won.entries()) {
    const pay = await call('POST', '/revenue/payments', {
      clientId: c.id,
      amount: [125000, 250000][n % 2],
      paidOn: ymd(-(n + 1) * 3),
      method: ['BANK_TRANSFER', 'UPI'][n % 2],
      status: 'PAID',
      reference: `TXN-${1000 + n}`,
      notes: 'Advance against the first invoice.',
    });
    check(`payment for ${c.company || c.name}`, pay.status === 200 || pay.status === 201, `${pay.status} ${JSON.stringify(pay.data).slice(0, 220)}`);

    const exp = await call('POST', '/revenue/expenses', {
      category: ['MARKETING', 'VENDOR'][n % 2],
      amount: [45000, 12000][n % 2],
      date: ymd(-(n + 2) * 2),
      vendor: 'Meta Ads',
      description: 'Media spend for the retainer.',
      clientId: c.id,
    });
    if (n === 0) check('log an expense', exp.status === 200 || exp.status === 201, `${exp.status} ${JSON.stringify(exp.data).slice(0, 220)}`);
  }
  console.log('');
}

// ── phase 7: verify every module reads back ─────────────────────────────────
async function verifyModules(before) {
  console.log('7. Verify each module returns the data');

  const probes = [
    ['CRM  · lead count',        'GET', '/crm/leads/count',            (d) => d?.count > before.leads],
    ['CRM  · lead list',         'GET', '/crm/leads?limit=100',        (d) => Array.isArray(d) && d.length > 0],
    ['CRM  · search',            'GET', '/crm/leads?search=Corvus',    (d) => Array.isArray(d) && d.length >= 1],
    ['CRM  · forecast',          'GET', '/crm/forecast',               (d) => d != null],
    ['CRM  · renewals',          'GET', '/crm/renewals',               (d) => d != null],
    ['CRM  · renewals summary',  'GET', '/crm/renewals/summary',       (d) => d != null],
    ['CRM  · quotes',            'GET', '/crm/quotes?limit=50',        (d) => (d?.quotes || d)?.length > 0],
    ['PM   · clients',           'GET', '/clients?limit=100',          (d) => (d?.clients || []).length > before.clients],
    ['PM   · projects',          'GET', '/projects?limit=100',         (d) => (d?.projects || d)?.length > 0],
    ['PM   · tasks',             'GET', '/tasks?limit=100',            (d) => (d?.tasks || d)?.length > 0],
    ['PM   · dashboard stats',   'GET', '/dashboard/stats',            (d) => d != null],
    ['PM   · project health',    'GET', '/dashboard/project-health',    (d) => d != null],
    ['PM   · client health',     'GET', '/dashboard/client-health',     (d) => d != null],
    ['PM   · team workload',     'GET', '/dashboard/team-workload',     (d) => d != null],
    ['PM   · report · projects', 'GET', '/reports/projects',            (d) => d != null],
    ['PM   · report · clients',  'GET', '/reports/clients',             (d) => d != null],
    ['PM   · report · executive','GET', '/reports/executive',           (d) => d != null],
    ['REV  · subscriptions',     'GET', '/revenue/subscriptions',       (d) => (d?.subscriptions || d)?.length > 0],
    ['REV  · contracts',         'GET', '/revenue/contracts',           (d) => (d?.contracts || d)?.length > 0],
    ['REV  · overview',          'GET', '/revenue/overview',            (d) => d != null],
    ['REV  · P&L',               'GET', '/revenue/pnl',                 (d) => d != null],
    ['REV  · invoice drafts',    'GET', '/revenue/invoice-drafts',      (d) => d != null],
    ['REV  · payments',          'GET', '/revenue/payments',            (d) => (d?.payments || d)?.length > 0],
    ['REV  · receivables',       'GET', '/revenue/receivables',         (d) => d != null],
    ['REV  · expenses',          'GET', '/revenue/expenses',            (d) => (d?.expenses || d)?.length > 0],
    ['CORE · team',              'GET', '/team',                       (d) => (d?.members || d)?.length >= 3],
    ['CORE · notifications',     'GET', '/notifications',              (d) => d != null],
  ];

  for (const [name, method, p, ok] of probes) {
    const r = await call(method, p);
    if (r.status !== 200) { check(name, false, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 140)}`); continue; }
    check(name, ok(r.data), `200 but shape/emptiness unexpected: ${JSON.stringify(r.data).slice(0, 140)}`);
  }

  // Cross-module consistency — the things that break quietly.
  console.log('\n   Cross-module consistency');
  const leads = (await call('GET', '/crm/leads?limit=100')).data || [];
  const won = leads.filter((l) => ['ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(l.stage));
  check('every won deal has a client account', won.length > 0 && won.every((l) => l.clientId), `${won.filter((l) => !l.clientId).length} of ${won.length} missing`);

  const subs = (await call('GET', '/revenue/subscriptions')).data;
  const subList = subs?.subscriptions || subs || [];
  const retainers = leads.filter((l) => l.stage === 'ACTIVE_RETAINER');
  check('each active retainer produced a subscription',
    retainers.every((l) => subList.some((s) => s.sourceLeadId === l.id)),
    `${retainers.length} retainers, ${subList.length} subscriptions`);

  const cons = (await call('GET', '/revenue/contracts')).data;
  const conList = cons?.contracts || cons || [];
  const projects = leads.filter((l) => l.stage === 'ACTIVE_PROJECT');
  check('each active project produced a contract',
    projects.every((l) => conList.some((c) => c.sourceLeadId === l.id)),
    `${projects.length} project deals, ${conList.length} contracts`);

  const churned = leads.filter((l) => l.stage === 'CHURNED' && l.clientId);
  if (churned.length) {
    const cl = (await call('GET', `/clients/${churned[0].clientId}`)).data;
    check('churned deal left its account CHURNED', cl?.status === 'CHURNED', `status=${cl?.status}`);
  }

  const dash = (await call('GET', '/dashboard')).data;
  const clientsTotal = (await call('GET', '/clients?limit=1&status=ACTIVE')).data?.pagination?.total;
  const dashActive = dash?.stats?.activeClients ?? dash?.activeClients;
  check('dashboard Active Clients matches the client list',
    dashActive === undefined || dashActive === clientsTotal,
    `dashboard=${dashActive} list=${clientsTotal}`);

  const tl = (await call('GET', `/crm/leads/${manifest.leads[0]?.id}/activity`)).data;
  const items = tl?.activities || tl?.items || tl;
  check('lead timeline records the activities', Array.isArray(items) && items.length >= 3, `${Array.isArray(items) ? items.length : 'n/a'} entries`);
  console.log('');
}

// ── phase 8: what the other roles can actually do ───────────────────────────
async function probePermissions(mint) {
  console.log('8. Role probe — what each invited user can reach');
  const rows = [];
  for (const u of manifest.users) {
    if (!u.id) continue;
    const live = await prisma.user.findUnique({ where: { id: u.id }, select: { id: true, email: true, role: true, organizationId: true, tokenVersion: true, status: true } });
    if (!live || live.status !== 'ACTIVE') { note(`${u.name} (${u.role}) is ${live?.status || 'missing'} — cannot probe`); continue; }
    const t = mint(live);
    const probe = async (p) => (await call('GET', p, undefined, t)).status;
    rows.push({
      role: live.role,
      name: u.name,
      pipeline: await probe('/crm/leads?limit=1'),
      myTasks: await probe('/tasks?limit=1'),
      projects: await probe('/projects?limit=1'),
      clients: await probe('/clients?limit=1'),
      revenue: await probe('/revenue/overview'),
    });
  }
  console.log('\n   role             pipeline  tasks  projects  clients  revenue');
  for (const r of rows) {
    console.log(`   ${r.role.padEnd(16)} ${String(r.pipeline).padEnd(9)} ${String(r.myTasks).padEnd(6)} ${String(r.projects).padEnd(9)} ${String(r.clients).padEnd(8)} ${r.revenue}`);
  }

  // The concrete contradiction: leads assigned to someone who cannot open them.
  const assignedToNonAdmin = [];
  for (const r of rows) {
    if (r.role === 'ADMIN') continue;
    if (r.pipeline === 403) assignedToNonAdmin.push(r.role);
  }
  if (assignedToNonAdmin.length) {
    note(`roles blocked from the pipeline entirely: ${[...new Set(assignedToNonAdmin)].join(', ')} — yet leads can be assigned to them and the follow-up scanner notifies them`);
  }
  console.log('');
}

run().catch(async (e) => { console.error(e); await finish(1); });
