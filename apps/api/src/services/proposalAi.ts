/**
 * Writing a proposal with the AI (AI Proposal Builder, phase 2).
 *
 * A conversation on the Document tab: "write the first draft", "shorter
 * intro", "more premium tone", "add a section on reporting". The AI answers
 * in a sentence or two and SUGGESTS changes; nothing it writes reaches the
 * document until somebody presses Accept. Same rule Zen keeps for tasks
 * (zenDraft.ts): a person reads it before it becomes real, which is also what
 * a prompt hidden in a client's notes cannot get past.
 *
 * What it may not do, enforced here rather than hoped for in the prompt:
 *   - **Prices.** It is never shown a rate, a total or a past deal's value,
 *     so it has none to repeat. A suggested section with a rupee amount in it
 *     is refused and the model is told to write "see Investment" instead.
 *     For Management only, it may STAGE priced lines for the Pricing tab —
 *     at a rate the person typed in this conversation, or the service list's
 *     standard rate, never one it made up.
 *   - **Inventing facts.** Anything it does not know goes in as
 *     "[[Needs input: …]]", which prints as a yellow chip and stops Finalise.
 *   - **The house style.** No em dashes (removed), none of the stock phrases
 *     below (refused), never "made with AI".
 *
 * The provider, key and model are Zen's (Settings → Zen): one AI setup for
 * the studio, not two.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { orgToday } from '../utils/moneyDates.js';
import { AssistantFailed, settingsFor } from './moneyAssistant.js';
import type { AiTool, AiTurn } from './ai/index.js';
import { amountsInText } from './proposalPricing.js';
import { parseSections, type ProposalSection, type SectionType } from './proposalDocument.js';

// ── The thread ──────────────────────────────────────────────────────────────

export type ChangeStatus = 'PENDING' | 'ACCEPTED' | 'DISCARDED';

/** One suggested change to one section. `sectionId` null means a new section. */
export interface AiChange {
  id: string;
  sectionId: string | null;
  type: SectionType;
  title: string;
  before: string | null;
  after: string;
  status: ChangeStatus;
}

/** Priced lines the AI staged for the Pricing tab (Management only). */
export interface StagedLine {
  catalogItemId: string | null;
  name: string;
  description: string | null;
  billing: 'MONTHLY' | 'ONE_TIME';
  qty: number;
  unit: string | null;
  unitRate: number;
  /** Where the rate came from: typed by the person, or the service list. Null when there was none. */
  rateFrom: 'YOU' | 'SERVICE_LIST' | null;
}

export type ThreadEntry =
  | { id: string; from: 'you'; text: string; at: string; by: string }
  | {
      id: string;
      from: 'ai';
      text: string;
      at: string;
      changes: AiChange[];
      lines?: { items: StagedLine[]; status: ChangeStatus };
    };

export function parseThread(raw: unknown): ThreadEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is ThreadEntry =>
      Boolean(e) && typeof e === 'object' && typeof (e as ThreadEntry).id === 'string' && ((e as ThreadEntry).from === 'you' || (e as ThreadEntry).from === 'ai'),
  );
}

/** Long enough to scroll back through a proposal's history; short enough that a row stays small. */
const THREAD_CAP = 80;

// ── House style ─────────────────────────────────────────────────────────────

/** Stock phrases a client has read in every agency deck. Refused, so the model rewrites. */
export const BANNED_PHRASES = [
  'leverage',
  'synergy',
  'synergies',
  'cutting-edge',
  'cutting edge',
  'seamless',
  'seamlessly',
  'unlock',
  'game-changer',
  'game changer',
  'delve',
  'robust',
  'holistic',
  'world-class',
  'best-in-class',
  'revolutionise',
  'revolutionize',
  "in today's fast-paced",
  'next level',
  'supercharge',
  'tapestry',
  'paradigm',
];

/** Dashes out: a spaced dash becomes a comma, a bare one a hyphen. */
export const tidyDashes = (s: string): string => s.replace(/\s+[—–]\s+/g, ', ').replace(/[—–]/g, '-');

const bannedIn = (text: string): string[] => {
  const lower = text.toLowerCase();
  return BANNED_PHRASES.filter((p) => {
    const at = lower.indexOf(p);
    if (at < 0) return false;
    const before = at === 0 ? ' ' : lower[at - 1];
    const after = lower[at + p.length] ?? ' ';
    return !/[a-z]/.test(before) && !/[a-z]/.test(after);
  });
};

/** Why a suggested section cannot be offered as it is, or null when it can. */
export function refusalFor(type: SectionType, body: string): string | null {
  if (type === 'COMMERCIAL') return 'The Investment section is built from the Pricing tab. It has no text to write.';
  const amounts = amountsInText(body);
  if (amounts.length) {
    return `It names ${amounts.map((a) => a.text).join(', ')}. Prices never go in the text: write "see Investment" instead.`;
  }
  const banned = bannedIn(body);
  if (banned.length) return `It uses ${banned.map((b) => `"${b}"`).join(', ')}. Rewrite without them.`;
  if (type === 'COVER' && body.length > 300) return 'The cover line is one short sentence under the title.';
  return null;
}

// ── The instructions ────────────────────────────────────────────────────────

const SYSTEM = `You help write client proposals for a marketing, social media and production studio in India. The studio, the client, the deal and the current document are described at the start of each message.

How you work:
- You change the document only by calling propose_sections. The person then accepts or discards each change. Never paste section text into your reply.
- Your reply is one or two short sentences: what you suggested, or the one or two things you need to know. Ask at most two questions at a time, and only for what the context and get_past_proposals do not tell you. Never ask for the client's city, industry, state, GSTIN or contacts.
- Keep the section ids you are given. To add a section, use type CUSTOM with no id. Only send the sections you are changing.
- Section text is plain: a blank line between paragraphs, bullets start with "- ". No headings, no bold, no emoji, no markdown.

Facts and prices:
- Never write a price, fee, rate, discount, total or any rupee amount in any section. The Investment section is built from the Pricing tab. Where the text needs to point at the price, write "see Investment".
- Do not invent facts: no results, statistics, client names, dates, deliverable counts or percentages that the person did not give and the context does not have. Where the text needs something you do not know, write [[Needs input: what is needed]] in its place.
- If the person states a price (for example "make social ₹90,000 a month"): when the context says they set prices, call stage_line_items with that service and rate; otherwise tell them Management sets prices on the Pricing tab. Never put the price in the text.

House rules:
- One priced option per proposal. Ad spend is paid by the client directly and is never part of the studio's fee.
- For a retainer, the standard terms are a minimum of 6 months, the first month in advance, then payment between the 1st and 10th of each month. Include them when you write the Terms for a retainer, unless the terms already say so.
- Never describe the studio's work as made with AI, and do not mention AI tools.

Writing:
- Indian English. Plain, specific and warm. Short sentences, active voice, "we" for the studio and "you" for the client.
- No em dashes or en dashes.
- Never use: leverage, synergy, cutting-edge, seamless, unlock, game-changer, delve, robust, holistic, world-class, best-in-class, revolutionise, next level, supercharge, "in today's fast-paced".
- Lengths: the cover line is one short sentence; About is 2 to 4 sentences; What we heard is 1 or 2 short paragraphs in the client's terms; Scope is bullets grouped by service; Timeline is short phases; Next steps is 3 bullets.`;

const PROPOSE_TOOL: AiTool = {
  name: 'propose_sections',
  description:
    'Suggest new text for one or more sections. Each change is shown to the person to accept or discard; nothing is saved by this call. Send only the sections you are changing.',
  parameters: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The section id from the context. Leave out for a new section.' },
            type: {
              type: 'string',
              enum: ['COVER', 'INTRO', 'UNDERSTANDING', 'SCOPE', 'TIMELINE', 'TERMS', 'NEXT_STEPS', 'CUSTOM'],
            },
            title: { type: 'string', description: 'The section heading.' },
            body: { type: 'string', description: 'The full new text of the section, plain text.' },
          },
          required: ['type', 'title', 'body'],
        },
      },
    },
    required: ['changes'],
  },
};

const PAST_TOOL: AiTool = {
  name: 'get_past_proposals',
  description:
    "This client's earlier proposals: their titles and section text (no prices), and what each version sent was about. Use it before asking the person something an earlier proposal answers.",
  parameters: { type: 'object', properties: {} },
};

const STAGE_TOOL: AiTool = {
  name: 'stage_line_items',
  description:
    'Stage services for the Pricing tab, for the person to confirm there. Only when the person asked for a service to be priced or stated a price. A rate is kept only if the person typed it in this conversation or the service list has a standard rate.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            service: { type: 'string', description: 'The service name, as on the service list where it is there.' },
            billing: { type: 'string', enum: ['MONTHLY', 'ONE_TIME'] },
            qty: { type: 'number' },
            unit: { type: 'string' },
            rate: { type: 'number', description: 'Only a rate the person stated.' },
            description: { type: 'string' },
          },
          required: ['service'],
        },
      },
    },
    required: ['items'],
  },
};

// ── The context ─────────────────────────────────────────────────────────────

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** Figures a person typed into a scope summary stay out of what the AI reads. */
const withoutAmounts = (s: string) => {
  let out = s;
  for (const a of amountsInText(s)) out = out.split(a.text).join('[amount]');
  return out;
};

type DocForAi = Awaited<ReturnType<typeof loadForAi>>;

async function loadForAi(documentId: string, organizationId: string) {
  return prisma.proposalDocument.findFirst({
    where: { id: documentId, proposal: { organizationId, deletedAt: null } },
    include: {
      lineItems: { orderBy: { sortOrder: 'asc' }, select: { name: true, billing: true, qty: true, unit: true, isPassthrough: true } },
      proposal: {
        include: {
          owner: { select: { name: true } },
          company: {
            include: {
              people: { where: { active: true }, select: { name: true, role: true } },
              retainers: { where: { status: 'ACTIVE' }, select: { id: true, startDate: true } },
              projects: { where: { deletedAt: null, status: 'LIVE' }, select: { name: true } },
            },
          },
        },
      },
    },
  });
}

function contextFor(doc: NonNullable<DocForAi>, extra: { orgName: string; today: string; asker: string; setsPrices: boolean; terms: string[]; catalog: { name: string; billing: string; unit: string }[] }): string {
  const c = doc.proposal.company;
  const sections = parseSections(doc.sections);
  const state = c.stateName ? `, ${c.stateName}` : '';
  const lines = doc.lineItems.length
    ? doc.lineItems.map((l) => `${l.name} (${l.isPassthrough ? 'paid by the client directly' : l.billing === 'MONTHLY' ? 'monthly' : 'one-time'}, ${Number(l.qty)} ${l.unit ?? ''})`.replace(/ \)/, ')')).join('; ')
    : 'none yet';
  const working = [
    ...c.retainers.map(() => 'an active retainer'),
    ...c.projects.map((p) => `the project "${p.name}"`),
  ];
  return [
    `Today: ${extra.today}.`,
    `Studio: ${extra.orgName}.`,
    `Asking: ${extra.asker}. Sets prices: ${extra.setsPrices ? 'yes' : 'no'}.`,
    `Deal: ${doc.proposal.kind === 'RETAINER' ? 'a monthly retainer' : 'a one-time project'}, owned by ${doc.proposal.owner?.name ?? 'nobody'}.`,
    `Client: ${c.name}. Industry: ${c.vertical}. Based in ${c.city}${state}.${c.website ? ` Website: ${c.website}.` : ''}`,
    `Contacts: ${c.people.length ? c.people.map((p) => `${p.name} (${p.role.toLowerCase()})`).join(', ') : 'none recorded'}.`,
    `Already working with the studio: ${working.length ? working.join(', ') : 'no'}.`,
    `Document: v${doc.n}, ${doc.status === 'DRAFT' ? 'draft' : 'in review'}, titled "${doc.title ?? ''}".`,
    'Sections, in order:',
    ...sections.map(
      (s) =>
        `- id ${s.id} · ${s.type} · "${s.title}"${s.visible ? '' : ' (hidden)'}: ${
          s.type === 'COMMERCIAL' ? '(built from the Pricing tab)' : s.body.trim() ? clip(s.body.trim(), 1500) : '(empty)'
        }`,
    ),
    `Services on the Pricing tab: ${lines}. Their rates are set there and are never shown to you, so do not say whether a service has a rate.`,
    `The studio's service list: ${extra.catalog.length ? extra.catalog.map((i) => `${i.name} (${i.billing === 'MONTHLY' ? 'monthly' : 'one-time'}, per ${i.unit})`).join('; ') : 'empty'}.`,
    `The studio's standard terms: ${extra.terms.length ? extra.terms.join(' | ') : 'none set'}.`,
  ].join('\n');
}

async function pastProposals(doc: NonNullable<DocForAi>, organizationId: string) {
  const [documents, versions] = await Promise.all([
    prisma.proposalDocument.findMany({
      where: { id: { not: doc.id }, proposal: { organizationId, companyId: doc.proposal.companyId, deletedAt: null } },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      select: { n: true, status: true, title: true, sections: true, revisionNote: true, updatedAt: true },
    }),
    prisma.proposalVersion.findMany({
      where: { proposal: { organizationId, companyId: doc.proposal.companyId, deletedAt: null } },
      orderBy: { sentAt: 'desc' },
      take: 6,
      select: { n: true, scopeSummary: true, sentAt: true },
    }),
  ]);
  return {
    documents: documents.map((d) => ({
      version: d.n,
      status: d.status.toLowerCase(),
      title: d.title,
      why: d.revisionNote,
      sections: parseSections(d.sections)
        .filter((s) => s.visible && s.type !== 'COMMERCIAL' && s.body.trim())
        .map((s) => ({ title: s.title, text: clip(withoutAmounts(s.body), 1200) })),
    })),
    sent: versions.map((v) => ({ version: v.n, on: v.sentAt.toISOString().slice(0, 10), about: withoutAmounts(v.scopeSummary || '') || null })),
  };
}

// ── One exchange ────────────────────────────────────────────────────────────

const MAX_ROUNDS = 4;

/** The thread as turns for the model: what was said, and what became of each suggestion. */
function turnsFrom(thread: ThreadEntry[]): AiTurn[] {
  const turns: AiTurn[] = [];
  for (const e of thread.slice(-12)) {
    if (e.from === 'you') {
      turns.push({ role: 'user', text: e.text });
    } else {
      const outcome = e.changes.length
        ? ` [Suggested: ${e.changes.map((c) => `${c.title} (${c.status.toLowerCase()})`).join(', ')}]`
        : '';
      turns.push({ role: 'assistant', text: `${e.text}${outcome}` });
    }
  }
  // A thread that starts with the AI (it should not) would break the alternation.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

export async function askProposalAi(opts: {
  organizationId: string;
  userId: string;
  userName: string;
  setsPrices: boolean;
  documentId: string;
  message: string;
}): Promise<{ entry: ThreadEntry; thread: ThreadEntry[] }> {
  const doc = await loadForAi(opts.documentId, opts.organizationId);
  if (!doc) throw new AssistantFailed('That proposal document is gone.');
  const [org, catalog, settings] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: opts.organizationId },
      select: { name: true, timezone: true, defaultTermsAndConditions: true },
    }),
    prisma.serviceCatalogItem.findMany({
      where: { organizationId: opts.organizationId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, billing: true, unit: true, description: true, standardRate: true },
    }),
    settingsFor(opts.organizationId),
  ]);
  const { provider, apiKey, model, baseUrl } = settings;

  const thread = parseThread(doc.aiThread);
  const sections = parseSections(doc.sections);
  const context = contextFor(doc, {
    orgName: org.name,
    today: orgToday(org.timezone || 'Asia/Kolkata'),
    asker: opts.userName,
    setsPrices: opts.setsPrices,
    terms: org.defaultTermsAndConditions,
    catalog: catalog.map((c) => ({ name: c.name, billing: c.billing, unit: c.unit })),
  });

  // Rates the person typed in this conversation, the only ones the AI may stage.
  const typedRates = new Set(
    [...thread.filter((e) => e.from === 'you').map((e) => e.text), opts.message].flatMap((t) => amountsInText(t).map((a) => a.value)),
  );

  const turns = [...turnsFrom(thread), { role: 'user' as const, text: opts.message }];
  const tools = opts.setsPrices ? [PROPOSE_TOOL, PAST_TOOL, STAGE_TOOL] : [PROPOSE_TOOL, PAST_TOOL];
  const changes: AiChange[] = [];
  const staged: StagedLine[] = [];
  let text = '';

  for (let round = 0; round <= MAX_ROUNDS; round += 1) {
    const last = round === MAX_ROUNDS;
    const reply = await provider.complete({
      apiKey,
      baseUrl,
      model,
      system: SYSTEM,
      context,
      turns,
      tools,
      toolChoice: last ? 'none' : 'auto',
      temperature: 0.4,
      maxOutputTokens: 16_000,
    });
    if (reply.usage) {
      logger.info(`Proposal AI org ${opts.organizationId} round ${round + 1} ${model}: input ${reply.usage.input}, output ${reply.usage.output}`);
    }
    if (reply.stop === 'refusal') {
      text = 'I can’t help with that one.';
      break;
    }
    if (reply.calls.length === 0 || last) {
      text = reply.text;
      break;
    }
    turns.push({
      role: 'assistant',
      ...(reply.text ? { text: reply.text } : {}),
      calls: reply.calls,
      ...(reply.raw !== undefined ? { raw: reply.raw } : {}),
    });

    const results = await Promise.all(
      reply.calls.map(async (call) => {
        if (call.name === 'get_past_proposals') {
          return { name: call.name, id: call.id, result: await pastProposals(doc, opts.organizationId) };
        }
        if (call.name === 'propose_sections') {
          const asked = Array.isArray(call.args.changes) ? (call.args.changes as Record<string, unknown>[]) : [];
          const refused: { title: string; why: string }[] = [];
          let kept = 0;
          for (const raw of asked.slice(0, 12)) {
            const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
            const existing = id ? sections.find((s) => s.id === id) : undefined;
            const type = (existing?.type ?? (typeof raw.type === 'string' ? raw.type : 'CUSTOM')) as SectionType;
            const title = tidyDashes(String(raw.title ?? existing?.title ?? 'New section')).trim().slice(0, 120);
            const body = tidyDashes(String(raw.body ?? '')).trim();
            if (id && !existing) {
              refused.push({ title, why: `There is no section with id ${id}. Use the ids in the context, or type CUSTOM with no id for a new one.` });
              continue;
            }
            const why = refusalFor(type, body);
            if (why) {
              refused.push({ title, why });
              continue;
            }
            // A later suggestion for the same section replaces an earlier one in this answer.
            const at = changes.findIndex((c) => c.sectionId !== null && c.sectionId === (existing?.id ?? null));
            const change: AiChange = {
              id: randomUUID(),
              sectionId: existing?.id ?? null,
              type: existing ? existing.type : 'CUSTOM',
              title,
              before: existing ? existing.body : null,
              after: body,
              status: 'PENDING',
            };
            if (at >= 0) changes[at] = change;
            else changes.push(change);
            kept += 1;
          }
          return {
            name: call.name,
            id: call.id,
            result: { suggested: kept, ...(refused.length ? { refused } : {}), note: 'The person accepts or discards each suggestion.' },
          };
        }
        if (call.name === 'stage_line_items' && opts.setsPrices) {
          const asked = Array.isArray(call.args.items) ? (call.args.items as Record<string, unknown>[]) : [];
          const done: string[] = [];
          for (const raw of asked.slice(0, 20)) {
            const name = String(raw.service ?? '').trim();
            if (!name) continue;
            const lower = name.toLowerCase();
            const item =
              catalog.find((c) => c.name.toLowerCase() === lower) ??
              (() => {
                const hits = catalog.filter((c) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()));
                return hits.length === 1 ? hits[0] : undefined;
              })();
            const stated = Number(raw.rate);
            const typed = Number.isFinite(stated) && stated > 0 && typedRates.has(Math.round(stated));
            const listRate = item?.standardRate != null ? Number(item.standardRate) : null;
            const billing =
              raw.billing === 'MONTHLY' || raw.billing === 'ONE_TIME'
                ? raw.billing
                : (item?.billing ?? (doc.proposal.kind === 'RETAINER' ? 'MONTHLY' : 'ONE_TIME'));
            staged.push({
              catalogItemId: item?.id ?? null,
              name: item?.name ?? name.slice(0, 200),
              description: item?.description ?? (typeof raw.description === 'string' ? raw.description.slice(0, 2000) : null),
              billing,
              qty: Number(raw.qty) > 0 ? Number(raw.qty) : 1,
              unit: (typeof raw.unit === 'string' && raw.unit) || item?.unit || (billing === 'MONTHLY' ? 'month' : null),
              unitRate: typed ? stated : (listRate ?? 0),
              rateFrom: typed ? 'YOU' : listRate != null ? 'SERVICE_LIST' : null,
            });
            done.push(typed || listRate != null ? name : `${name} (no rate: Management sets it on the Pricing tab)`);
          }
          return { name: call.name, id: call.id, result: { staged: done, note: 'Shown on the Pricing tab for the person to confirm.' } };
        }
        return { name: call.name, id: call.id, result: { error: `There is no tool called ${call.name}.` } };
      }),
    );
    turns.push({
      role: 'tool',
      results,
      ...(round + 1 === MAX_ROUNDS ? { followUp: 'That was the last step. Reply now in a sentence or two.' } : {}),
    });
  }

  const now = new Date().toISOString();
  const entry: ThreadEntry = {
    id: randomUUID(),
    from: 'ai',
    text: tidyDashes(text.trim()) || (changes.length ? 'Here are my suggestions.' : 'I have nothing to suggest for that.'),
    at: now,
    changes,
    ...(staged.length ? { lines: { items: staged, status: 'PENDING' as const } } : {}),
  };
  const you: ThreadEntry = { id: randomUUID(), from: 'you', text: opts.message, at: now, by: opts.userName };
  const next = [...thread, you, entry].slice(-THREAD_CAP);
  await prisma.proposalDocument.update({ where: { id: doc.id }, data: { aiThread: next as unknown as object } });
  return { entry, thread: next };
}

// ── Accepting a suggestion ──────────────────────────────────────────────────

/**
 * The sections after accepting some changes: an existing section takes the new
 * title and text; a new one goes in before the Terms (or at the end).
 */
export function applyChanges(sections: ProposalSection[], changes: AiChange[]): ProposalSection[] {
  let out = [...sections];
  for (const c of changes) {
    const at = c.sectionId ? out.findIndex((s) => s.id === c.sectionId) : -1;
    if (at >= 0) {
      out[at] = { ...out[at], title: c.type === 'COVER' ? out[at].title : c.title || out[at].title, body: c.after };
      continue;
    }
    const fresh: ProposalSection = { id: `custom-${c.id.slice(0, 8)}`, type: 'CUSTOM', title: c.title || 'New section', body: c.after, visible: true };
    const before = out.findIndex((s) => s.type === 'TERMS' || s.type === 'NEXT_STEPS');
    out = before >= 0 ? [...out.slice(0, before), fresh, ...out.slice(before)] : [...out, fresh];
  }
  return out;
}
