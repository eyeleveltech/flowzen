/**
 * Flowzen v2 — demo data
 *
 * The other half of the seed. `seed.ts` gives an organisation the CONFIGURATION it
 * needs to function; this fills one with a plausible agency so every screen opens
 * with something in it.
 *
 * It is also the honest test of the schema (master plan §6.4): if a real agency —
 * retainers and projects, a client on hold, one that churned, invoices in every
 * state, work that is late — cannot be expressed in it, that is worth discovering
 * on day one rather than in month three.
 *
 *   npx tsx prisma/seed-demo.ts --org "Eyelevel"
 *   npx tsx prisma/seed-demo.ts --org "Eyelevel" --reset
 *
 * `--org` takes a name or an id, and is REQUIRED when more than one organisation
 * exists. Filling the wrong one is not something you can undo cleanly, so it will
 * not guess.
 *
 * Not idempotent, deliberately: "one more Blinkit every time you run it" is worse
 * than refusing. It stops if the organisation already has clients; `--reset` clears
 * what it made first.
 *
 * ── Two rules it keeps ──────────────────────────────────────────────────────────
 *
 * Every figure goes through the SAME code the application uses — `computeTaxSplit`,
 * `computeQuoteTotals`, `generateDocumentNumber`, `syncCompanyStatus`,
 * `raiseInvoiceForEngagement`, `recordPayment`. Demo data that is computed a second
 * way is demo data that disagrees with the app, and you find out by staring at a
 * total that is off by a rupee.
 *
 * `--reset` never touches `doc_counters`. A counter only ever moves forward (§3.13),
 * so clearing demo documents leaves a gap in the sequence — which costs nothing —
 * while resetting the counter would hand out a number that has already been used.
 */

import '../src/lib/env.js';

import { Prisma, Role } from '@prisma/client';
import type { ContractType, BillingFrequency, PaymentTerms } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { prisma } from '../src/lib/prisma.js';
import { bootstrapOrganization } from '../src/lib/orgDefaults.js';
import { syncCompanyStatus } from '../src/services/companyStatus.js';
import { computeQuoteTotals } from '../src/services/quote.service.js';
import { computeTaxSplit } from '../src/utils/tax.js';
import { generateDocumentNumber } from '../src/utils/documentNumber.js';
import { raiseInvoiceForEngagement, recordPayment } from '../src/services/invoice.service.js';
import { addMonths } from '../src/services/deal.service.js';

const D = Prisma.Decimal;

const TAX_RATE = 18;
const DEMO_PASSWORD = 'ChangeMe123!';

// ── Dates ─────────────────────────────────────────────────────────────────────
//
// Everything is relative to today, so the data still tells the same story in six
// months: the overdue invoice is still overdue, the quiet deal is still quiet.

const TODAY = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
})();

/** n days from today. Negative is the past. */
const day = (n: number): Date => new Date(TODAY.getTime() + n * 86_400_000);
/** n months from today, clamped to the end of a short month. */
const month = (n: number): Date => addMonths(TODAY, n);

// ── Arguments ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const RESET = argv.includes('--reset');
const orgArg = (() => {
  const i = argv.indexOf('--org');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith('--org='));
  return inline ? inline.slice('--org='.length) : null;
})();

// ──────────────────────────────────────────────────────────────────────────────
// THE AGENCY
//
// Written out rather than generated. Random data produces an app that LOOKS full
// and answers no question — nine identical clients each with one deal tell you
// nothing about whether the screens work. Every record below exists to put one
// specific state on screen, and the comment says which.
// ──────────────────────────────────────────────────────────────────────────────

type Person = {
  key: string;
  name: string;
  email: string;
  role: Role;
  designation: string;
};

const TEAM: Person[] = [
  { key: 'priya',  name: 'Priya Raman', email: 'priya@demo.eyelevel.local',  role: Role.ADMIN,   designation: 'Account Director' },
  { key: 'arjun',  name: 'Arjun Nair',  email: 'arjun@demo.eyelevel.local',  role: Role.MANAGER, designation: 'Delivery Lead' },
  { key: 'sneha',  name: 'Sneha Iyer',  email: 'sneha@demo.eyelevel.local',  role: Role.SALES,   designation: 'Business Development' },
  { key: 'vikram', name: 'Vikram Das',  email: 'vikram@demo.eyelevel.local', role: Role.MEMBER,  designation: 'Senior Designer' },
];

type CompanySpec = {
  key: string;
  name: string;
  industry: string;
  city: string;
  /** With the organisation's state this decides CGST+SGST versus IGST (§3.11). */
  state: string;
  website: string;
  source: string;
  owner: string;
  contacts: {
    name: string;
    designation: string;
    email: string;
    phone: string;
    role: 'DECISION_MAKER' | 'CHAMPION' | 'INFLUENCER' | 'GATEKEEPER';
    isPrimary?: boolean;
  }[];
};

const COMPANIES: CompanySpec[] = [
  {
    key: 'suvai',
    name: 'Suvai Foods',
    industry: 'Food & Beverage',
    city: 'Chennai',
    state: 'Tamil Nadu', // same state as the agency — CGST + SGST
    website: 'https://suvaifoods.example',
    source: 'Referral',
    owner: 'sneha',
    contacts: [
      { name: 'Meera Krishnan', designation: 'Marketing Head', email: 'meera@suvaifoods.example', phone: '+91 98400 11221', role: 'DECISION_MAKER', isPrimary: true },
      { name: 'Ganesh Subramanian', designation: 'Founder', email: 'ganesh@suvaifoods.example', phone: '+91 98400 11222', role: 'CHAMPION' },
    ],
  },
  {
    key: 'nova',
    name: 'Nova Fintech',
    industry: 'Financial Services',
    city: 'Bengaluru',
    state: 'Karnataka', // different state — IGST
    website: 'https://novafintech.example',
    source: 'Inbound enquiry',
    owner: 'priya',
    contacts: [
      { name: 'Rahul Menon', designation: 'VP Growth', email: 'rahul@novafintech.example', phone: '+91 99000 44551', role: 'DECISION_MAKER', isPrimary: true },
      { name: 'Divya Shetty', designation: 'Brand Manager', email: 'divya@novafintech.example', phone: '+91 99000 44552', role: 'INFLUENCER' },
    ],
  },
  {
    key: 'kadai',
    name: 'Kadai Kitchens',
    industry: 'Retail',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    website: 'https://kadaikitchens.example',
    source: 'Existing client',
    owner: 'sneha',
    contacts: [
      { name: 'Lakshmi Venkat', designation: 'Director', email: 'lakshmi@kadaikitchens.example', phone: '+91 90030 77881', role: 'DECISION_MAKER', isPrimary: true },
    ],
  },
  {
    key: 'marina',
    name: 'Marina Realty',
    industry: 'Real Estate',
    city: 'Chennai',
    state: 'Tamil Nadu',
    website: 'https://marinarealty.example',
    source: 'Event',
    owner: 'priya',
    contacts: [
      { name: 'Anand Rajagopal', designation: 'Sales Head', email: 'anand@marinarealty.example', phone: '+91 98410 22334', role: 'DECISION_MAKER', isPrimary: true },
    ],
  },
  {
    key: 'zenith',
    name: 'Zenith Labs',
    industry: 'Healthcare',
    city: 'Mumbai',
    state: 'Maharashtra',
    website: 'https://zenithlabs.example',
    source: 'LinkedIn',
    owner: 'priya',
    contacts: [
      { name: 'Farah Qureshi', designation: 'Head of Marketing', email: 'farah@zenithlabs.example', phone: '+91 98200 55667', role: 'DECISION_MAKER', isPrimary: true },
    ],
  },
  {
    key: 'trailhead',
    name: 'Trailhead Outdoors',
    industry: 'Retail',
    city: 'Pune',
    state: 'Maharashtra',
    website: 'https://trailhead.example',
    source: 'Outbound',
    owner: 'sneha',
    contacts: [
      { name: 'Kabir Joshi', designation: 'Founder', email: 'kabir@trailhead.example', phone: '+91 98220 66778', role: 'DECISION_MAKER', isPrimary: true },
    ],
  },
  {
    key: 'aruna',
    name: 'Aruna Textiles',
    industry: 'Manufacturing',
    city: 'Madurai',
    state: 'Tamil Nadu',
    website: 'https://arunatextiles.example',
    source: 'Referral',
    owner: 'sneha',
    contacts: [
      { name: 'Selvi Murugan', designation: 'Managing Partner', email: 'selvi@arunatextiles.example', phone: '+91 94430 88991', role: 'DECISION_MAKER', isPrimary: true },
      { name: 'Ravi Kumar', designation: 'Operations', email: 'ravi@arunatextiles.example', phone: '+91 94430 88992', role: 'GATEKEEPER' },
    ],
  },
  {
    key: 'halcyon',
    name: 'Halcyon Interiors',
    industry: 'Design',
    city: 'Chennai',
    state: 'Tamil Nadu',
    website: 'https://halcyoninteriors.example',
    source: 'Instagram',
    owner: 'sneha',
    contacts: [
      { name: 'Nithya Balan', designation: 'Principal Designer', email: 'nithya@halcyoninteriors.example', phone: '+91 98404 33445', role: 'DECISION_MAKER', isPrimary: true },
    ],
  },
  {
    key: 'brightpath',
    name: 'Bright Path Academy',
    industry: 'Education',
    city: 'Hyderabad',
    state: 'Telangana',
    website: 'https://brightpath.example',
    source: 'WhatsApp',
    owner: 'sneha',
    contacts: [
      { name: 'Sridhar Reddy', designation: 'Director', email: 'sridhar@brightpath.example', phone: '+91 90100 99001', role: 'DECISION_MAKER', isPrimary: true },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Flowzen v2 — demo data\n');

  const org = await resolveOrganization();
  console.log(`  organisation      ${org.name}  (${org.id})`);

  if (!org.state) {
    throw new Error(
      `${org.name} has no state set. Every quotation and invoice needs it to work out ` +
        'CGST + SGST versus IGST — set it in Settings → Tax & numbering first.',
    );
  }

  // Idempotent, and cheap. An organisation created before a default was added is
  // missing it, and everything below assumes a pipeline exists.
  const { stagesByName } = await bootstrapOrganization(prisma, org.id);

  const existing = await prisma.company.count({ where: { organizationId: org.id } });
  if (existing > 0 && !RESET) {
    console.log(
      `\n  ${org.name} already has ${existing} client${existing === 1 ? '' : 's'}.\n` +
        '  Refusing to add a second copy of everything. Re-run with --reset to clear\n' +
        '  its business data first (configuration, users and document counters are kept).',
    );
    return;
  }

  if (RESET) await resetBusinessData(org.id);

  const stage = (name: string): string => {
    const id = stagesByName.get(name);
    if (!id) throw new Error(`Stage "${name}" is missing from the pipeline.`);
    return id;
  };

  // ── People ─────────────────────────────────────────────────────────────────
  const owner = await prisma.user.findFirstOrThrow({
    where: { organizationId: org.id, roles: { some: { role: Role.SUPER_ADMIN } } },
    select: { id: true, name: true, email: true },
  });

  const people = new Map<string, string>([['owner', owner.id]]);
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const p of TEAM) {
    // Upsert on email: the account may already exist from an earlier run, and
    // deleting people would take their ownership of everything with them.
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: { name: p.name, designation: p.designation, status: 'ACTIVE' },
      create: {
        email: p.email,
        name: p.name,
        password,
        designation: p.designation,
        status: 'ACTIVE',
        joiningDate: month(-14),
        organizationId: org.id,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_role: { userId: user.id, role: p.role } },
      update: {},
      create: { userId: user.id, organizationId: org.id, role: p.role, grantedById: owner.id },
    });
    people.set(p.key, user.id);
  }
  console.log(`  team              ${TEAM.length} added, alongside ${owner.name}`);

  // ── Clients ────────────────────────────────────────────────────────────────
  const sources = new Map(
    (await prisma.leadSource.findMany({ where: { organizationId: org.id } })).map((s) => [
      s.name,
      s.id,
    ]),
  );
  const lostReasons = new Map(
    (await prisma.lostReason.findMany({ where: { organizationId: org.id } })).map((r) => [
      r.name,
      r.id,
    ]),
  );
  const services = new Map(
    (await prisma.service.findMany({ where: { organizationId: org.id } })).map((s) => [
      s.name,
      s,
    ]),
  );

  const companies = new Map<string, { id: string; name: string; state: string }>();

  for (const c of COMPANIES) {
    const company = await prisma.company.create({
      data: {
        organizationId: org.id,
        name: c.name,
        industry: c.industry,
        website: c.website,
        email: c.contacts[0].email,
        phone: c.contacts[0].phone,
        city: c.city,
        state: c.state,
        country: 'India',
        // Status is NOT set here. It is derived from the engagements by the one
        // function allowed to write it, at the end of this script (§3.2).
        ownerId: people.get(c.owner)!,
        sourceId: sources.get(c.source) ?? null,
        createdAt: month(-12),
      },
    });
    companies.set(c.key, { id: company.id, name: company.name, state: c.state });

    for (const [i, contact] of c.contacts.entries()) {
      await prisma.contact.create({
        data: {
          companyId: company.id,
          name: contact.name,
          designation: contact.designation,
          email: contact.email,
          phone: contact.phone,
          role: contact.role,
          // Exactly one per company — Prisma cannot express the partial unique
          // index, so the shape of the data has to be right going in.
          isPrimary: contact.isPrimary ?? i === 0,
        },
      });
    }
  }
  console.log(`  clients           ${COMPANIES.length}, with ${COMPANIES.reduce((n, c) => n + c.contacts.length, 0)} contacts`);

  // ── Deals ──────────────────────────────────────────────────────────────────
  //
  // A deal is created at its FIRST stage and walked forward, writing stage history
  // as it goes — so "12 days in this stage", cycle time and stage conversion have
  // something real to read. Setting the final stage directly would leave every
  // deal looking like it arrived there this morning.

  type Walk = { stage: string; on: Date };

  const walkDeal = async (input: {
    companyKey: string;
    title: string;
    value: number;
    ownerKey: string;
    sourceName: string;
    path: Walk[];
    expectedCloseDate?: Date;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    blockedOn?: string;
    nextStepDate?: Date;
    lastContactedAt?: Date;
    contractType?: ContractType;
  }) => {
    const company = companies.get(input.companyKey)!;
    const first = input.path[0];

    const deal = await prisma.deal.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        title: input.title,
        stageId: stage(first.stage),
        value: new D(input.value),
        expectedCloseDate: input.expectedCloseDate ?? null,
        ownerId: people.get(input.ownerKey)!,
        sourceId: sources.get(input.sourceName) ?? null,
        priority: input.priority ?? 'MEDIUM',
        contractType: input.contractType ?? null,
        blockedOn: input.blockedOn ?? null,
        nextStepDate: input.nextStepDate ?? null,
        lastContactedAt: input.lastContactedAt ?? null,
        createdAt: first.on,
      },
    });

    await prisma.stageHistory.create({
      data: {
        dealId: deal.id,
        fromStageId: null,
        toStageId: stage(first.stage),
        movedById: people.get(input.ownerKey)!,
        enteredAt: first.on,
      },
    });

    for (let i = 1; i < input.path.length; i++) {
      const step = input.path[i];
      await prisma.deal.update({ where: { id: deal.id }, data: { stageId: stage(step.stage) } });
      await prisma.stageHistory.create({
        data: {
          dealId: deal.id,
          fromStageId: stage(input.path[i - 1].stage),
          toStageId: stage(step.stage),
          movedById: people.get(input.ownerKey)!,
          enteredAt: step.on,
        },
      });
    }

    return deal;
  };

  const OPEN_PATH = ['New Lead', 'Outreach', 'Meeting', 'Proposal', 'Negotiation', 'Contract'];
  /** The full run to Won, with each step dated backwards from the win. */
  const wonPath = (wonOn: Date): Walk[] => [
    ...OPEN_PATH.map((s, i) => ({ stage: s, on: day(dayOffset(wonOn) - (OPEN_PATH.length - i) * 9) })),
    { stage: 'Won', on: wonOn },
  ];

  const deals = new Map<string, { id: string; companyKey: string }>();

  // Won, and still running — the two retainers that carry the revenue screens.
  const suvaiWon = month(-5);
  const suvaiDeal = await walkDeal({
    companyKey: 'suvai',
    title: 'Social media retainer',
    value: 45_000,
    ownerKey: 'sneha',
    sourceName: 'Referral',
    path: wonPath(suvaiWon),
    expectedCloseDate: suvaiWon,
    contractType: 'RETAINER',
    lastContactedAt: day(-4),
  });
  await prisma.deal.update({ where: { id: suvaiDeal.id }, data: { wonAt: suvaiWon } });
  deals.set('suvai', { id: suvaiDeal.id, companyKey: 'suvai' });

  const novaWon = month(-8);
  const novaDeal = await walkDeal({
    companyKey: 'nova',
    title: 'Performance marketing retainer',
    value: 95_000,
    ownerKey: 'priya',
    sourceName: 'Inbound enquiry',
    path: wonPath(novaWon),
    expectedCloseDate: novaWon,
    contractType: 'RETAINER',
    priority: 'HIGH',
    lastContactedAt: day(-2),
  });
  await prisma.deal.update({ where: { id: novaDeal.id }, data: { wonAt: novaWon } });
  deals.set('nova', { id: novaDeal.id, companyKey: 'nova' });

  const kadaiWon = month(-2);
  const kadaiDeal = await walkDeal({
    companyKey: 'kadai',
    title: 'Website design & build',
    value: 250_000,
    ownerKey: 'sneha',
    sourceName: 'Existing client',
    path: wonPath(kadaiWon),
    expectedCloseDate: kadaiWon,
    contractType: 'PROJECT',
    lastContactedAt: day(-9),
  });
  await prisma.deal.update({ where: { id: kadaiDeal.id }, data: { wonAt: kadaiWon } });
  deals.set('kadai', { id: kadaiDeal.id, companyKey: 'kadai' });

  const marinaWon = month(-4);
  const marinaDeal = await walkDeal({
    companyKey: 'marina',
    title: 'Property launch retainer',
    value: 60_000,
    ownerKey: 'priya',
    sourceName: 'Event',
    path: wonPath(marinaWon),
    expectedCloseDate: marinaWon,
    contractType: 'RETAINER',
    lastContactedAt: day(-38),
  });
  await prisma.deal.update({ where: { id: marinaDeal.id }, data: { wonAt: marinaWon } });
  deals.set('marina', { id: marinaDeal.id, companyKey: 'marina' });

  const zenithWon = month(-7);
  const zenithDeal = await walkDeal({
    companyKey: 'zenith',
    title: 'Brand identity',
    value: 150_000,
    ownerKey: 'priya',
    sourceName: 'LinkedIn',
    path: wonPath(zenithWon),
    expectedCloseDate: zenithWon,
    contractType: 'PROJECT',
  });
  await prisma.deal.update({ where: { id: zenithDeal.id }, data: { wonAt: zenithWon } });
  deals.set('zenith', { id: zenithDeal.id, companyKey: 'zenith' });

  const trailheadWon = month(-6);
  const trailheadDeal = await walkDeal({
    companyKey: 'trailhead',
    title: 'Content retainer',
    value: 35_000,
    ownerKey: 'sneha',
    sourceName: 'Outbound',
    path: wonPath(trailheadWon),
    expectedCloseDate: trailheadWon,
    contractType: 'RETAINER',
  });
  await prisma.deal.update({ where: { id: trailheadDeal.id }, data: { wonAt: trailheadWon } });
  deals.set('trailhead', { id: trailheadDeal.id, companyKey: 'trailhead' });

  // Still open — the board, and the two stall signals on the dashboard.
  // Owned by whoever signs in, not by a demo account. The dashboard addresses its
  // stall signals to the deal's OWNER — a warning shown to the whole team is one
  // nobody acts on (§4.12) — so deals owned entirely by seeded users would leave
  // the real person looking at three empty cards.
  const arunaDeal = await walkDeal({
    companyKey: 'aruna',
    title: 'SEO + content retainer',
    value: 55_000,
    ownerKey: 'owner',
    sourceName: 'Referral',
    path: [
      { stage: 'New Lead', on: day(-34) },
      { stage: 'Outreach', on: day(-28) },
      { stage: 'Meeting', on: day(-19) },
      { stage: 'Proposal', on: day(-11) },
    ],
    expectedCloseDate: day(14),
    priority: 'HIGH',
    nextStepDate: day(2),
    lastContactedAt: day(-9),
  });
  deals.set('aruna', { id: arunaDeal.id, companyKey: 'aruna' });

  // Gone quiet: 24 days in a stage whose patience is 10 (§3.4), and blocked on
  // something specific — the two signals the dashboard reads.
  const halcyonDeal = await walkDeal({
    companyKey: 'halcyon',
    title: 'Instagram + reels package',
    value: 30_000,
    ownerKey: 'owner',
    sourceName: 'Instagram',
    path: [
      { stage: 'New Lead', on: day(-41) },
      { stage: 'Outreach', on: day(-33) },
      { stage: 'Meeting', on: day(-24) },
    ],
    expectedCloseDate: day(21),
    blockedOn: 'Their brand guidelines',
    lastContactedAt: day(-24),
  });
  // A follow-up that came due yesterday, so the dashboard has one to raise.
  await prisma.deal.update({
    where: { id: halcyonDeal.id },
    data: { followUpDate: day(-1) },
  });
  deals.set('halcyon', { id: halcyonDeal.id, companyKey: 'halcyon' });

  // Parked, not lost. A FLAG rather than a stage, so it keeps its position and
  // comes back exactly where it was (§3.3).
  const novaExpansion = await walkDeal({
    companyKey: 'nova',
    title: 'SEO expansion',
    value: 40_000,
    ownerKey: 'priya',
    sourceName: 'Existing client',
    path: [
      { stage: 'New Lead', on: day(-70) },
      { stage: 'Outreach', on: day(-63) },
      { stage: 'Meeting', on: day(-52) },
      { stage: 'Proposal', on: day(-44) },
      { stage: 'Negotiation', on: day(-31) },
    ],
    expectedCloseDate: day(30),
    lastContactedAt: day(-31),
  });
  await prisma.deal.update({
    where: { id: novaExpansion.id },
    data: {
      isOnHold: true,
      heldSince: day(-28),
      holdReason: 'Their budget round moved to next quarter — revisit in October.',
    },
  });
  deals.set('nova-expansion', { id: novaExpansion.id, companyKey: 'nova' });

  // Brand new, nothing done yet.
  const suvaiVideo = await walkDeal({
    companyKey: 'suvai',
    title: 'Video production add-on',
    value: 80_000,
    ownerKey: 'sneha',
    sourceName: 'Existing client',
    path: [{ stage: 'New Lead', on: day(-3) }],
    nextStepDate: day(1),
    lastContactedAt: day(-3),
  });
  deals.set('suvai-video', { id: suvaiVideo.id, companyKey: 'suvai' });

  // Lost, with a reason — the whole point of the lost list.
  const brightPathDeal = await walkDeal({
    companyKey: 'brightpath',
    title: 'Admissions campaign',
    value: 70_000,
    ownerKey: 'sneha',
    sourceName: 'WhatsApp',
    path: [
      { stage: 'New Lead', on: day(-88) },
      { stage: 'Outreach', on: day(-80) },
      { stage: 'Meeting', on: day(-71) },
      { stage: 'Proposal', on: day(-60) },
      { stage: 'Negotiation', on: day(-48) },
      { stage: 'Lost', on: day(-40) },
    ],
    expectedCloseDate: day(-35),
  });
  await prisma.deal.update({
    where: { id: brightPathDeal.id },
    data: {
      lostAt: day(-40),
      lostReasonId: lostReasons.get('Price too high') ?? null,
    },
  });
  deals.set('brightpath', { id: brightPathDeal.id, companyKey: 'brightpath' });

  console.log(`  deals             ${deals.size} across the board, with stage history`);

  // ── Quotations ─────────────────────────────────────────────────────────────
  //
  // Every total is computed by the same server code the app uses, and the tax
  // split falls out of the two states — Tamil Nadu to Tamil Nadu is CGST + SGST,
  // Tamil Nadu to Karnataka is IGST. Nobody chooses it (§3.11).

  const quote = async (input: {
    dealKey: string;
    engagementType: ContractType;
    billingFrequency: BillingFrequency;
    paymentTerms?: PaymentTerms;
    lines: { description: string; quantity: number; rate: number; discountPercent?: number; service?: string }[];
    createdAt: Date;
    status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED';
    sentOn?: Date;
    answeredOn?: Date;
    declineReason?: string;
    recordedByKey?: string;
  }) => {
    const deal = deals.get(input.dealKey)!;
    const company = companies.get(deal.companyKey)!;

    const totals = computeQuoteTotals(
      input.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        rate: l.rate,
        discountPercent: l.discountPercent ?? 0,
        serviceId: l.service ? (services.get(l.service)?.id ?? null) : null,
      })),
      TAX_RATE,
      org.state,
      company.state,
    );

    const number = await generateDocumentNumber(org.id, 'QT', undefined, input.createdAt);

    return prisma.quote.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        dealId: deal.id,
        number,
        engagementType: input.engagementType,
        billingFrequency: input.billingFrequency,
        paymentTerms: input.paymentTerms ?? null,
        lineItems: totals.lines as unknown as Prisma.InputJsonValue,
        subtotal: totals.subtotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        total: totals.total,
        currency: org.currency,
        status: input.status,
        validUntil: new Date(input.createdAt.getTime() + 30 * 86_400_000),
        createdAt: input.createdAt,
        sentAt: input.sentOn ?? null,
        sentVia: input.sentOn ? 'MANUAL_EMAIL' : null,
        sentById: input.sentOn ? people.get('sneha')! : null,
        // acceptedAt is when they SAID yes, recordedAt is when somebody typed it
        // in. Collapsing the two makes every sales-cycle figure wrong by however
        // long people take to write things up (§3.12).
        acceptedAt: input.status === 'ACCEPTED' ? input.answeredOn ?? null : null,
        acceptedVia: input.status === 'ACCEPTED' ? 'EMAIL' : null,
        declinedAt: input.status === 'DECLINED' ? input.answeredOn ?? null : null,
        declineReason: input.status === 'DECLINED' ? input.declineReason ?? null : null,
        recordedById: input.answeredOn ? people.get(input.recordedByKey ?? 'sneha')! : null,
        recordedAt: input.answeredOn ? new Date(input.answeredOn.getTime() + 86_400_000) : null,
      },
    });
  };

  const quotes: string[] = [];

  quotes.push(
    (
      await quote({
        dealKey: 'suvai',
        engagementType: 'RETAINER',
        billingFrequency: 'MONTHLY',
        paymentTerms: 'MONTHLY',
        lines: [
          { description: 'Social media management — 12 posts a month', quantity: 1, rate: 30_000, service: 'Social Media Management' },
          { description: 'Content production — 4 reels a month', quantity: 1, rate: 15_000, service: 'Content Production' },
        ],
        createdAt: new Date(suvaiWon.getTime() - 12 * 86_400_000),
        status: 'ACCEPTED',
        sentOn: new Date(suvaiWon.getTime() - 11 * 86_400_000),
        answeredOn: suvaiWon,
      })
    ).number,
  );

  quotes.push(
    (
      await quote({
        dealKey: 'nova',
        engagementType: 'RETAINER',
        billingFrequency: 'MONTHLY',
        paymentTerms: 'MONTHLY',
        lines: [
          { description: 'Paid ads management — Google & Meta', quantity: 1, rate: 60_000, service: 'Paid Ads Management' },
          { description: 'SEO retainer', quantity: 1, rate: 35_000, service: 'SEO' },
        ],
        createdAt: new Date(novaWon.getTime() - 14 * 86_400_000),
        status: 'ACCEPTED',
        sentOn: new Date(novaWon.getTime() - 13 * 86_400_000),
        answeredOn: novaWon,
        recordedByKey: 'priya',
      })
    ).number,
  );

  quotes.push(
    (
      await quote({
        dealKey: 'kadai',
        engagementType: 'PROJECT',
        billingFrequency: 'ONE_TIME',
        paymentTerms: 'SPLIT_50_50',
        lines: [
          { description: 'Website design & build — 14 pages', quantity: 1, rate: 250_000, service: 'Website Design & Build' },
        ],
        createdAt: new Date(kadaiWon.getTime() - 10 * 86_400_000),
        status: 'ACCEPTED',
        sentOn: new Date(kadaiWon.getTime() - 9 * 86_400_000),
        answeredOn: kadaiWon,
      })
    ).number,
  );

  // Sent, no answer. Accepted and declined both get recorded by somebody; silence
  // is recorded by nobody, which is why the dashboard surfaces it (§3.12).
  quotes.push(
    (
      await quote({
        dealKey: 'aruna',
        engagementType: 'RETAINER',
        billingFrequency: 'MONTHLY',
        paymentTerms: 'MONTHLY',
        lines: [
          { description: 'SEO retainer', quantity: 1, rate: 35_000, service: 'SEO' },
          { description: 'Content production', quantity: 1, rate: 25_000, discountPercent: 20, service: 'Content Production' },
        ],
        createdAt: day(-10),
        status: 'SENT',
        sentOn: day(-9),
      })
    ).number,
  );

  quotes.push(
    (
      await quote({
        dealKey: 'brightpath',
        engagementType: 'PROJECT',
        billingFrequency: 'ONE_TIME',
        paymentTerms: 'ADVANCE_100',
        lines: [
          { description: 'Admissions campaign — creative and media management', quantity: 1, rate: 70_000, service: 'Paid Ads Management' },
        ],
        createdAt: day(-56),
        status: 'DECLINED',
        sentOn: day(-55),
        answeredOn: day(-40),
        declineReason: 'Went with a cheaper freelancer.',
      })
    ).number,
  );

  quotes.push(
    (
      await quote({
        dealKey: 'halcyon',
        engagementType: 'RETAINER',
        billingFrequency: 'MONTHLY',
        paymentTerms: 'MONTHLY',
        lines: [
          { description: 'Instagram management + 8 reels', quantity: 1, rate: 30_000, service: 'Social Media Management' },
        ],
        createdAt: day(-6),
        status: 'DRAFT',
      })
    ).number,
  );

  console.log(`  quotations        ${quotes.length}  (${quotes[0]} … ${quotes[quotes.length - 1]})`);

  // ── Engagements ────────────────────────────────────────────────────────────
  //
  // One per won deal — `@@unique([dealId])`, so two clicks cannot bill a client
  // twice (§3.6). A rolling retainer has NO end date: that is the shape of the
  // agreement, not missing data.

  const engage = async (input: {
    dealKey: string;
    type: ContractType;
    amount: number;
    billingFrequency: BillingFrequency;
    paymentTerms?: PaymentTerms;
    startDate: Date;
    endDate?: Date;
    notes?: string;
  }) => {
    const deal = deals.get(input.dealKey)!;
    const company = companies.get(deal.companyKey)!;
    const tax = computeTaxSplit(input.amount, TAX_RATE, org.state, company.state);

    const engagement = await prisma.engagement.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        dealId: deal.id,
        type: input.type,
        status: 'ACTIVE',
        amount: new D(input.amount),
        currency: org.currency,
        billingFrequency: input.billingFrequency,
        paymentTerms: input.paymentTerms ?? null,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        // Billing is due from day one and only ever advances when an invoice is
        // actually raised — never on a timer (§3.8).
        nextBillingDate: input.startDate,
        reviewIntervalMonths: 6,
        nextReviewDate: addMonths(input.startDate, 6),
        notes: input.notes ?? null,
        createdAt: input.startDate,
      },
    });

    // The first revision is written WITH the engagement. Added a month later,
    // every question about the first month is unanswerable (§3.7).
    await prisma.engagementRevision.create({
      data: {
        engagementId: engagement.id,
        amount: engagement.amount,
        billingFrequency: engagement.billingFrequency,
        status: 'ACTIVE',
        effectiveFrom: input.startDate,
        reason: 'Deal won',
        changedById: people.get('owner')!,
        createdAt: input.startDate,
      },
    });

    return engagement;
  };

  const suvaiEng = await engage({
    dealKey: 'suvai',
    type: 'RETAINER',
    amount: 45_000,
    billingFrequency: 'MONTHLY',
    paymentTerms: 'MONTHLY',
    startDate: month(-5),
    notes: 'Rolling. Invoiced on the 1st.',
  });

  const novaEng = await engage({
    dealKey: 'nova',
    type: 'RETAINER',
    amount: 95_000,
    billingFrequency: 'MONTHLY',
    paymentTerms: 'MONTHLY',
    startDate: month(-8),
    notes: 'Rolling. Ad spend is billed separately by the client.',
  });

  const kadaiEng = await engage({
    dealKey: 'kadai',
    type: 'PROJECT',
    amount: 250_000,
    billingFrequency: 'ONE_TIME',
    paymentTerms: 'SPLIT_50_50',
    startDate: month(-2),
    endDate: month(2),
  });

  const marinaEng = await engage({
    dealKey: 'marina',
    type: 'RETAINER',
    amount: 60_000,
    billingFrequency: 'MONTHLY',
    paymentTerms: 'MONTHLY',
    startDate: month(-4),
  });

  const zenithEng = await engage({
    dealKey: 'zenith',
    type: 'PROJECT',
    amount: 150_000,
    billingFrequency: 'ONE_TIME',
    paymentTerms: 'ADVANCE_100',
    startDate: month(-7),
    endDate: month(-2),
  });

  const trailheadEng = await engage({
    dealKey: 'trailhead',
    type: 'RETAINER',
    amount: 35_000,
    billingFrequency: 'MONTHLY',
    paymentTerms: 'MONTHLY',
    startDate: month(-6),
  });

  // ── Invoices and payments ──────────────────────────────────────────────────
  //
  // Raised through the real service, so the billing cycle advances exactly the way
  // it does in the app: one period at a time, and only because an invoice was
  // actually created. Sending is a separate act — a DRAFT that was never sent is
  // not money anybody owes you.

  const send = (id: string, on: Date) =>
    prisma.invoice.update({ where: { id }, data: { status: 'SENT', sentAt: on } });

  /** Raise `count` consecutive invoices for an engagement, issued monthly. */
  const bill = async (
    engagementId: string,
    count: number,
    firstIssue: Date,
    opts: { dueInDays?: number } = {},
  ) => {
    const raised = [];
    for (let i = 0; i < count; i++) {
      const issueDate = addMonths(firstIssue, i);
      const invoice = await raiseInvoiceForEngagement(engagementId, people.get('owner')!, {
        issueDate,
        dueInDays: opts.dueInDays ?? 15,
        taxRatePercent: TAX_RATE,
      });
      await send(invoice.id, issueDate);
      raised.push(invoice);
    }
    return raised;
  };

  const pay = (
    invoice: { id: string; companyId: string; total: Prisma.Decimal; currency: string },
    on: Date,
    amount?: number,
    method: 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' = 'BANK_TRANSFER',
  ) =>
    recordPayment(
      {
        organizationId: org.id,
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        amount: amount ?? invoice.total,
        currency: invoice.currency,
        paidOn: on,
        method,
        reference: `NEFT/${on.toISOString().slice(0, 10).replace(/-/g, '')}`,
      },
      people.get('priya')!,
    );

  // Suvai — six months billed. Four settled; last month's is overdue and this
  // month's has just gone out, so outstanding and overdue are different numbers.
  const suvaiInvoices = await bill(suvaiEng.id, 6, month(-5));
  for (const [i, inv] of suvaiInvoices.slice(0, 4).entries()) {
    await pay(inv, addMonths(month(-5), i + 1), undefined, i % 2 === 0 ? 'BANK_TRANSFER' : 'UPI');
  }

  // Nova — seven of eight months billed, so one period is still due to raise and
  // shows on the dashboard. The latest invoice is half settled.
  const novaInvoices = await bill(novaEng.id, 7, month(-8));
  for (const [i, inv] of novaInvoices.slice(0, 6).entries()) {
    await pay(inv, addMonths(month(-8), i + 1));
  }
  await pay(novaInvoices[6], day(-6), 50_000);

  // Kadai — a project on 50/50 terms. Advance in, balance outstanding.
  const [kadaiInvoice] = await bill(kadaiEng.id, 1, month(-2), { dueInDays: 30 });
  await pay(kadaiInvoice, month(-2), 147_500, 'CHEQUE');

  // Marina — billed twice, then paused. Both settled, so nothing is owed.
  const marinaInvoices = await bill(marinaEng.id, 2, month(-4));
  for (const [i, inv] of marinaInvoices.entries()) await pay(inv, addMonths(month(-4), i + 1));

  const zenithInvoices = await bill(zenithEng.id, 1, month(-7), { dueInDays: 7 });
  await pay(zenithInvoices[0], month(-7));

  const trailheadInvoices = await bill(trailheadEng.id, 3, month(-6));
  for (const [i, inv] of trailheadInvoices.entries()) await pay(inv, addMonths(month(-6), i + 1));

  const overdueInvoice = suvaiInvoices[4];

  const invoiceCount =
    suvaiInvoices.length +
    novaInvoices.length +
    1 +
    marinaInvoices.length +
    zenithInvoices.length +
    trailheadInvoices.length;
  console.log(`  invoices          ${invoiceCount}, with payments against most of them`);

  // ── The engagements move on ────────────────────────────────────────────────
  //
  // Written directly rather than through pauseEngagement / endEngagement, because
  // those stamp today — and an engagement that ended in June has to say June or
  // every revenue figure before today is wrong.

  const revise = (
    engagementId: string,
    data: {
      amount: number;
      billingFrequency: BillingFrequency;
      status: 'ACTIVE' | 'PAUSED' | 'ENDED';
      effectiveFrom: Date;
      reason: string;
    },
  ) =>
    prisma.engagementRevision.create({
      data: {
        engagementId,
        amount: new D(data.amount),
        billingFrequency: data.billingFrequency,
        status: data.status,
        effectiveFrom: data.effectiveFrom,
        reason: data.reason,
        changedById: people.get('owner')!,
        createdAt: data.effectiveFrom,
      },
    });

  // Nova's price went up at the six-month review. The old figure is not
  // overwritten — that is what makes "what was our MRR last March?" answerable.
  const novaRaise = month(-2);
  const novaNewTax = computeTaxSplit(120_000, TAX_RATE, org.state, companies.get('nova')!.state);
  await prisma.engagement.update({
    where: { id: novaEng.id },
    data: {
      amount: new D(120_000),
      cgst: novaNewTax.cgst,
      sgst: novaNewTax.sgst,
      igst: novaNewTax.igst,
      lastReviewedAt: novaRaise,
      nextReviewDate: addMonths(novaRaise, 6),
    },
  });
  await revise(novaEng.id, {
    amount: 120_000,
    billingFrequency: 'MONTHLY',
    status: 'ACTIVE',
    effectiveFrom: novaRaise,
    reason: '6-month review — scope grew to two more channels',
  });
  await prisma.auditLog.create({
    data: {
      organizationId: org.id,
      userId: people.get('owner')!,
      action: 'ENGAGEMENT_TERMS_CHANGED',
      entityType: 'Engagement',
      entityId: novaEng.id,
      before: { amount: '95000' },
      after: { amount: '120000', reason: '6-month review' },
      createdAt: novaRaise,
    },
  });

  // Suvai is due for review — it shows up under revenue → needs attention.
  await prisma.engagement.update({
    where: { id: suvaiEng.id },
    data: { nextReviewDate: day(9) },
  });

  // Marina paused. Deliberate, by somebody — which is why it is its own state and
  // not filed as churn (§4.11).
  await prisma.engagement.update({
    where: { id: marinaEng.id },
    data: { status: 'PAUSED' },
  });
  await revise(marinaEng.id, {
    amount: 60_000,
    billingFrequency: 'MONTHLY',
    status: 'PAUSED',
    effectiveFrom: month(-2),
    reason: 'Paused — their launch slipped to the next quarter',
  });

  // Zenith delivered. A finished project is a GOOD ending, so the company lands on
  // PROJECT_COMPLETED rather than being counted as churn (§3.2).
  await prisma.engagement.update({
    where: { id: zenithEng.id },
    data: { status: 'ENDED', endedAt: month(-2), nextBillingDate: null },
  });
  await revise(zenithEng.id, {
    amount: 150_000,
    billingFrequency: 'ONE_TIME',
    status: 'ENDED',
    effectiveFrom: month(-2),
    reason: 'Delivered and signed off',
  });

  // Trailhead left. A retainer stopping is the bad ending — this is churn.
  await prisma.engagement.update({
    where: { id: trailheadEng.id },
    data: { status: 'ENDED', endedAt: month(-1), endDate: month(-1), nextBillingDate: null },
  });
  await revise(trailheadEng.id, {
    amount: 35_000,
    billingFrequency: 'MONTHLY',
    status: 'ENDED',
    effectiveFrom: month(-1),
    reason: 'Ended — brought content in-house',
  });

  // ── Company status ─────────────────────────────────────────────────────────
  //
  // Read from the engagements by the ONE function allowed to write it. Nothing
  // above set a status by hand, and nothing here decides one — that discipline is
  // what stops the dashboard and the list disagreeing (§3.2).
  const statuses: Record<string, number> = {};
  for (const company of companies.values()) {
    const { status } = await syncCompanyStatus(company.id);
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  console.log(
    `  client status     ${Object.entries(statuses).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}`,
  );

  // ── Projects and work ──────────────────────────────────────────────────────

  const project = async (input: {
    companyKey: string;
    name: string;
    description: string;
    status: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
    ownerKey: string;
    memberKeys: string[];
    startDate: Date;
    dueDate: Date;
    completedAt?: Date;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  }) => {
    const company = companies.get(input.companyKey)!;
    const created = await prisma.project.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        name: input.name,
        description: input.description,
        status: input.status,
        priority: input.priority ?? 'MEDIUM',
        startDate: input.startDate,
        dueDate: input.dueDate,
        completedAt: input.completedAt ?? null,
        ownerId: people.get(input.ownerKey)!,
        createdAt: input.startDate,
      },
    });
    for (const key of input.memberKeys) {
      await prisma.projectMember.create({
        data: { projectId: created.id, userId: people.get(key)!, addedAt: input.startDate },
      });
    }
    return created;
  };

  const suvaiProject = await project({
    companyKey: 'suvai',
    name: 'Suvai Foods — always-on social',
    description: 'The monthly retainer: 12 posts, 4 reels, community management.',
    status: 'ACTIVE',
    ownerKey: 'arjun',
    memberKeys: ['arjun', 'vikram', 'sneha'],
    startDate: month(-5),
    dueDate: month(1),
  });

  const novaProject = await project({
    companyKey: 'nova',
    name: 'Nova Fintech — Q3 acquisition push',
    description: 'Landing pages, ad creative and the SEO content calendar.',
    status: 'ACTIVE',
    ownerKey: 'arjun',
    memberKeys: ['arjun', 'vikram', 'priya'],
    startDate: month(-3),
    dueDate: day(24),
    priority: 'HIGH',
  });

  const kadaiProject = await project({
    companyKey: 'kadai',
    name: 'Kadai Kitchens — website build',
    description: '14 pages, catalogue and enquiry flow.',
    status: 'ACTIVE',
    ownerKey: 'arjun',
    memberKeys: ['arjun', 'vikram'],
    startDate: month(-2),
    dueDate: month(2),
    priority: 'HIGH',
  });

  const zenithProject = await project({
    companyKey: 'zenith',
    name: 'Zenith Labs — brand identity',
    description: 'Logo, palette, typography and a 40-page guideline document.',
    status: 'COMPLETED',
    ownerKey: 'priya',
    memberKeys: ['priya', 'vikram'],
    startDate: month(-7),
    dueDate: month(-2),
    completedAt: month(-2),
  });

  const task = (input: {
    projectId?: string;
    dealId?: string;
    title: string;
    description?: string;
    status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'BLOCKED';
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    assigneeKey: string;
    reviewerKey?: string;
    dueDate: Date;
    completedAt?: Date;
    position?: number;
  }) =>
    prisma.task.create({
      data: {
        organizationId: org.id,
        // Exactly one of these, never both — the database enforces it.
        projectId: input.projectId ?? null,
        dealId: input.dealId ?? null,
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority ?? 'MEDIUM',
        assigneeId: people.get(input.assigneeKey)!,
        reviewerId: input.reviewerKey ? people.get(input.reviewerKey)! : null,
        dueDate: input.dueDate,
        completedAt: input.completedAt ?? null,
        position: input.position ?? 0,
      },
    });

  // Suvai — a normal month, mid-flight. One item is late, one is with a reviewer.
  await task({ projectId: suvaiProject.id, title: 'August content calendar', status: 'DONE', assigneeKey: 'sneha', dueDate: day(-18), completedAt: day(-19), position: 0 });
  await task({ projectId: suvaiProject.id, title: 'Shoot 4 reels — Onam menu', status: 'DONE', assigneeKey: 'vikram', reviewerKey: 'arjun', dueDate: day(-9), completedAt: day(-10), position: 1 });
  // Overdue, and it is the owner's own — so their dashboard is not empty.
  await task({ projectId: suvaiProject.id, title: 'Approve the festive campaign artwork', description: 'Client is waiting on this before the media plan can go out.', status: 'IN_PROGRESS', priority: 'HIGH', assigneeKey: 'owner', reviewerKey: 'arjun', dueDate: day(-3), position: 2 });
  // Sitting with a reviewer: neither done nor in progress, which is why the status exists.
  await task({ projectId: suvaiProject.id, title: 'Caption set for week 3', status: 'IN_REVIEW', assigneeKey: 'vikram', reviewerKey: 'owner', dueDate: day(-1), position: 3 });
  await task({ projectId: suvaiProject.id, title: 'Community management — week 4', status: 'TODO', assigneeKey: 'sneha', dueDate: day(6), position: 4 });

  // Nova — the busiest project, and where today's work is.
  await task({ projectId: novaProject.id, title: 'Landing page A/B variants', status: 'DONE', assigneeKey: 'vikram', reviewerKey: 'arjun', dueDate: day(-22), completedAt: day(-23), position: 0 });
  await task({ projectId: novaProject.id, title: 'Rewrite the onboarding email sequence', status: 'IN_PROGRESS', assigneeKey: 'sneha', dueDate: day(0), position: 1 });
  await task({ projectId: novaProject.id, title: 'Q3 keyword gap analysis', status: 'IN_REVIEW', priority: 'HIGH', assigneeKey: 'arjun', reviewerKey: 'owner', dueDate: day(0), position: 2 });
  await task({ projectId: novaProject.id, title: 'Creative refresh — 6 static, 3 video', status: 'TODO', assigneeKey: 'vikram', reviewerKey: 'arjun', dueDate: day(9), position: 3 });
  await task({ projectId: novaProject.id, title: 'Waiting on their analytics access', description: 'Cannot report on conversions until this lands.', status: 'BLOCKED', priority: 'URGENT', assigneeKey: 'priya', dueDate: day(-6), position: 4 });

  // Kadai — a build, in order.
  await task({ projectId: kadaiProject.id, title: 'Sitemap and wireframes', status: 'DONE', assigneeKey: 'arjun', dueDate: day(-40), completedAt: day(-41), position: 0 });
  await task({ projectId: kadaiProject.id, title: 'Design — home, catalogue, product', status: 'DONE', assigneeKey: 'vikram', reviewerKey: 'arjun', dueDate: day(-14), completedAt: day(-12), position: 1 });
  await task({ projectId: kadaiProject.id, title: 'Build the catalogue templates', status: 'IN_PROGRESS', priority: 'HIGH', assigneeKey: 'vikram', reviewerKey: 'arjun', dueDate: day(11), position: 2 });
  await task({ projectId: kadaiProject.id, title: 'Content migration — 120 products', status: 'TODO', assigneeKey: 'sneha', dueDate: day(20), position: 3 });
  await task({ projectId: kadaiProject.id, title: 'Launch checklist and handover', status: 'TODO', assigneeKey: 'arjun', reviewerKey: 'owner', dueDate: day(38), position: 4 });

  await task({ projectId: zenithProject.id, title: 'Logo routes — 3 directions', status: 'DONE', assigneeKey: 'vikram', reviewerKey: 'priya', dueDate: month(-5), completedAt: month(-5), position: 0 });
  await task({ projectId: zenithProject.id, title: 'Guideline document', status: 'DONE', assigneeKey: 'vikram', reviewerKey: 'priya', dueDate: month(-2), completedAt: month(-2), position: 1 });

  // Pre-sales work hangs off the DEAL, not a project — there is no project yet.
  await task({ dealId: deals.get('aruna')!.id, title: 'Follow up on the quotation', description: 'Sent nine days ago, no reply.', status: 'TODO', priority: 'HIGH', assigneeKey: 'sneha', dueDate: day(1), position: 0 });
  await task({ dealId: deals.get('halcyon')!.id, title: 'Chase the brand guidelines', status: 'TODO', assigneeKey: 'sneha', dueDate: day(-2), position: 0 });
  await task({ dealId: deals.get('suvai-video')!.id, title: 'Discovery call — video scope', status: 'TODO', assigneeKey: 'sneha', dueDate: day(2), position: 0 });

  const taskCount = await prisma.task.count({ where: { organizationId: org.id } });
  console.log(`  projects          4, with ${taskCount} tasks`);

  // ── Timeline ───────────────────────────────────────────────────────────────
  //
  // occurredAt is when it HAPPENED. A call logged on Friday about a Tuesday
  // conversation belongs on Tuesday, or every "last contacted" figure is wrong.

  const note = (input: {
    type: 'NOTE' | 'CALL' | 'MEETING' | 'EMAIL' | 'WHATSAPP' | 'SYSTEM';
    message: string;
    body?: string;
    direction?: 'IN' | 'OUT';
    userKey: string;
    companyKey?: string;
    dealKey?: string;
    projectId?: string;
    occurredAt: Date;
  }) =>
    prisma.activity.create({
      data: {
        organizationId: org.id,
        type: input.type,
        message: input.message,
        body: input.body ?? null,
        direction: input.direction ?? null,
        userId: people.get(input.userKey)!,
        companyId: input.companyKey ? companies.get(input.companyKey)!.id : null,
        dealId: input.dealKey ? deals.get(input.dealKey)!.id : null,
        projectId: input.projectId ?? null,
        occurredAt: input.occurredAt,
        createdAt: input.occurredAt,
      },
    });

  await note({ type: 'MEETING', message: 'Kick-off call', body: 'Walked through the content pillars. They want more of the founder on camera.', userKey: 'sneha', companyKey: 'suvai', dealKey: 'suvai', occurredAt: suvaiWon });
  await note({ type: 'CALL', message: 'Monthly review', body: 'Reach is up, saves are flat. Agreed to test carousels in September.', direction: 'OUT', userKey: 'arjun', companyKey: 'suvai', occurredAt: day(-4) });
  await note({ type: 'NOTE', message: 'Interested in video production', body: 'Meera asked what a monthly video package would cost. Raised a deal for it.', userKey: 'sneha', companyKey: 'suvai', dealKey: 'suvai-video', occurredAt: day(-3) });

  await note({ type: 'MEETING', message: 'Quarterly business review', body: 'CAC is down 18% quarter on quarter. They asked us to take on two more channels — this is what the price review was about.', userKey: 'priya', companyKey: 'nova', occurredAt: novaRaise });
  await note({ type: 'EMAIL', message: 'Chased the analytics access', direction: 'OUT', userKey: 'priya', companyKey: 'nova', occurredAt: day(-6) });
  await note({ type: 'NOTE', message: 'SEO expansion parked', body: 'Budget round moved to next quarter. Rahul asked us to hold rather than drop it.', userKey: 'priya', companyKey: 'nova', dealKey: 'nova-expansion', occurredAt: day(-28) });

  await note({ type: 'MEETING', message: 'Design presentation', body: 'Approved route 2 with small changes to the product page.', userKey: 'arjun', companyKey: 'kadai', projectId: kadaiProject.id, occurredAt: day(-12) });
  await note({ type: 'WHATSAPP', message: 'Advance received', body: 'Lakshmi confirmed the cheque was couriered.', direction: 'IN', userKey: 'sneha', companyKey: 'kadai', occurredAt: month(-2) });

  await note({ type: 'CALL', message: 'Pause confirmed', body: 'Launch slipped a quarter. They will come back — asked us to keep the team warm.', direction: 'IN', userKey: 'priya', companyKey: 'marina', occurredAt: month(-2) });
  await note({ type: 'NOTE', message: 'Handover complete', body: 'Guidelines delivered and signed off. Worth a check-in call in a month.', userKey: 'priya', companyKey: 'zenith', occurredAt: month(-2) });
  await note({ type: 'CALL', message: 'Exit conversation', body: 'Hired a content person in-house. No complaints about the work — it was cost.', direction: 'IN', userKey: 'sneha', companyKey: 'trailhead', occurredAt: month(-1) });

  await note({ type: 'MEETING', message: 'Scoping meeting', body: 'They want organic-first. Selvi is the decision maker; Ravi controls the calendar.', userKey: 'sneha', companyKey: 'aruna', dealKey: 'aruna', occurredAt: day(-19) });
  await note({ type: 'EMAIL', message: 'Quotation sent', direction: 'OUT', userKey: 'sneha', companyKey: 'aruna', dealKey: 'aruna', occurredAt: day(-9) });
  await note({ type: 'NOTE', message: 'Still waiting on brand guidelines', body: 'Third ask. Nothing can be designed until they arrive.', userKey: 'sneha', companyKey: 'halcyon', dealKey: 'halcyon', occurredAt: day(-24) });
  await note({ type: 'CALL', message: 'Lost — price', body: 'Went with a freelancer at about a third of our number. Worth revisiting after their intake season.', direction: 'IN', userKey: 'sneha', companyKey: 'brightpath', dealKey: 'brightpath', occurredAt: day(-40) });

  const activityCount = await prisma.activity.count({ where: { organizationId: org.id } });
  console.log(`  timeline          ${activityCount} entries`);

  // ── Costs ──────────────────────────────────────────────────────────────────
  //
  // Pass-through media spend rebilled to a client is not the same as your own
  // software subscription. Without the distinction, margin is wrong for every
  // client you buy media for (§3.8). There are no expense routes yet, so this is
  // data waiting for a screen.

  const expenses = [
    { companyKey: 'nova', projectId: novaProject.id, amount: 45_000, category: 'MARKETING' as const, description: 'Meta ad spend — August', vendor: 'Meta', isBillable: true, date: day(-12) },
    { companyKey: 'nova', projectId: novaProject.id, amount: 28_000, category: 'MARKETING' as const, description: 'Google Ads — August', vendor: 'Google', isBillable: true, date: day(-12) },
    { companyKey: 'suvai', projectId: suvaiProject.id, amount: 12_000, category: 'VENDOR' as const, description: 'Food stylist — reel shoot', vendor: 'Anjali Rao', isBillable: false, date: day(-10) },
    { companyKey: 'kadai', projectId: kadaiProject.id, amount: 8_500, category: 'VENDOR' as const, description: 'Stock photography licence', vendor: 'Shutterstock', isBillable: false, date: day(-16) },
    { companyKey: null, projectId: null, amount: 18_000, category: 'EQUIPMENT' as const, description: 'Second monitor and colour calibrator', vendor: 'Vijay Sales', isBillable: false, date: day(-30) },
    { companyKey: null, projectId: null, amount: 6_400, category: 'MISC' as const, description: 'Design software — annual', vendor: 'Adobe', isBillable: false, date: day(-45) },
  ];

  for (const e of expenses) {
    await prisma.expense.create({
      data: {
        organizationId: org.id,
        companyId: e.companyKey ? companies.get(e.companyKey)!.id : null,
        projectId: e.projectId,
        amount: new D(e.amount),
        currency: org.currency,
        date: e.date,
        category: e.category,
        description: e.description,
        vendor: e.vendor,
        isBillable: e.isBillable,
        recordedById: people.get('priya')!,
      },
    });
  }
  console.log(`  expenses          ${expenses.length}`);

  // ── The bell ───────────────────────────────────────────────────────────────
  //
  // Written here because nothing else writes one yet — the daily scanner is not
  // built, so without these the bell is permanently empty and you cannot tell a
  // working screen from a broken one. Keyed the way the scanner will key them, so
  // it will UPDATE these rows rather than adding a second copy of each (§3.9).

  const notifications = [
    {
      type: 'INVOICE_OVERDUE',
      title: `${overdueInvoice.number} is overdue`,
      message: `Suvai Foods — ${overdueInvoice.total.toString()} was due on ${overdueInvoice.dueDate.toISOString().slice(0, 10)}.`,
      link: '/revenue',
      dedupeKey: `invoice-overdue:${overdueInvoice.id}`,
      createdAt: day(-2),
      readAt: null,
    },
    {
      type: 'QUOTE_NO_REPLY',
      title: 'Aruna Textiles has not replied',
      message: 'The quotation was sent nine days ago.',
      link: `/pipeline/${deals.get('aruna')!.id}`,
      dedupeKey: `quote-silent:${deals.get('aruna')!.id}`,
      createdAt: day(-1),
      readAt: null,
    },
    {
      type: 'DEAL_ROTTING',
      title: 'Halcyon Interiors has gone quiet',
      message: '24 days at Meeting, waiting on their brand guidelines.',
      link: `/pipeline/${deals.get('halcyon')!.id}`,
      dedupeKey: `deal-rotting:${deals.get('halcyon')!.id}`,
      createdAt: day(-1),
      readAt: null,
    },
    {
      type: 'BILLING_DUE',
      title: 'Nova Fintech is due to be invoiced',
      message: 'One period has not been raised yet.',
      link: '/revenue',
      dedupeKey: `billing-due:${novaEng.id}`,
      createdAt: day(0),
      readAt: null,
    },
    {
      type: 'PRICE_REVIEW',
      title: 'Suvai Foods is due for a price review',
      message: 'Six months since the last one.',
      link: '/revenue',
      dedupeKey: `price-review:${suvaiEng.id}`,
      createdAt: day(-5),
      readAt: day(-4), // one already read, so the unread count is not just "all of them"
    },
  ];

  for (const n of notifications) {
    await prisma.notification.upsert({
      where: { userId_dedupeKey: { userId: owner.id, dedupeKey: n.dedupeKey } },
      update: { title: n.title, message: n.message, link: n.link },
      create: { userId: owner.id, ...n },
    });
  }
  console.log(`  notifications     ${notifications.length} for ${owner.email}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n  Sign in as ${owner.email} — everything above belongs to ${org.name}.`);
  console.log(`  The team accounts use the password ${DEMO_PASSWORD}:`);
  for (const p of TEAM) console.log(`    ${p.role.padEnd(11)} ${p.email}`);
}

// ──────────────────────────────────────────────────────────────────────────────

/** Which organisation to fill. It will not guess when there is more than one. */
async function resolveOrganization() {
  const all = await prisma.organization.findMany({
    select: { id: true, name: true, currency: true, state: true },
    orderBy: { createdAt: 'asc' },
  });

  if (all.length === 0) throw new Error('There are no organisations. Run the seed first.');

  if (!orgArg) {
    if (all.length === 1) return all[0];
    throw new Error(
      'More than one organisation exists, so --org is required:\n' +
        all.map((o) => `    --org "${o.name}"   (${o.id})`).join('\n'),
    );
  }

  const matches = all.filter((o) => o.id === orgArg || o.name.toLowerCase() === orgArg.toLowerCase());

  if (matches.length === 0) {
    throw new Error(
      `No organisation matches "${orgArg}". There is:\n` +
        all.map((o) => `    ${o.name}   (${o.id})`).join('\n'),
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `"${orgArg}" matches ${matches.length} organisations. Use the id:\n` +
        matches.map((o) => `    ${o.id}`).join('\n'),
    );
  }
  return matches[0];
}

/**
 * Clear an organisation's BUSINESS data.
 *
 * Configuration, users and document counters survive. Deleted in dependency order
 * rather than relying on cascades — Company is deliberately restricted from
 * deletion while engagements point at it, because "nothing is deleted, only
 * retired" is a database rule here, not a code review one (§3.2).
 *
 * `doc_counters` is untouched on purpose. A counter never goes backwards (§3.13):
 * a gap in the sequence costs nothing, a reused number breaks the unique index.
 */
async function resetBusinessData(organizationId: string) {
  const userIds = (
    await prisma.user.findMany({ where: { organizationId }, select: { id: true } })
  ).map((u) => u.id);

  await prisma.payment.deleteMany({ where: { organizationId } });
  await prisma.invoice.deleteMany({ where: { organizationId } });
  await prisma.engagementRevision.deleteMany({ where: { engagement: { organizationId } } });
  await prisma.engagement.deleteMany({ where: { organizationId } });
  await prisma.expense.deleteMany({ where: { organizationId } });
  await prisma.task.deleteMany({ where: { organizationId } });
  await prisma.projectMember.deleteMany({ where: { project: { organizationId } } });
  await prisma.activity.deleteMany({ where: { organizationId } });
  await prisma.project.deleteMany({ where: { organizationId } });
  await prisma.quote.deleteMany({ where: { organizationId } });
  await prisma.stageHistory.deleteMany({ where: { deal: { organizationId } } });
  await prisma.customFieldValue.deleteMany({ where: { field: { organizationId } } });
  await prisma.deal.deleteMany({ where: { organizationId } });
  await prisma.contact.deleteMany({ where: { company: { organizationId } } });
  await prisma.company.deleteMany({ where: { organizationId } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });

  console.log('  reset             cleared previous demo data (counters kept)');
}

/** Whole days between today and `d`. Negative is the past. */
const dayOffset = (d: Date): number => Math.round((d.getTime() - TODAY.getTime()) / 86_400_000);

main()
  .catch((e) => {
    console.error(`\nseed-demo failed: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
