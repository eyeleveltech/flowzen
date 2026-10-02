import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { AssistantNotConfigured } from './ai/index.js';
import { settingsFor } from './moneyAssistant.js';
import type { MondayBrief } from '../routes/brief.js';

/**
 * The Monday brief's opening paragraph, written by the same AI connection Zen
 * uses, and only from the brief's own numbers.
 *
 * Stored once per organisation per week (WeeklyBrief) so the screen does not
 * call the model on every load, and so the email and the screen say the same
 * thing. It is shown to EVERY reader of the brief — which is why what it is
 * written from never holds a member of staff's name: no owners, nobody on a
 * shoot, and never the Management-only "Not using Flowzen" block. Clients are
 * named; employees are not.
 */

const SYSTEM = [
  "You write the opening paragraph of a creative agency's Monday brief, read by its management.",
  'You are given last week\'s numbers, the week before\'s, what is waiting on them, what is coming up and the team by department.',
  '',
  'Rules:',
  '- Plain English, 3 to 5 sentences, at most about 120 words.',
  '- Lead with the most important thing.',
  '- Use only numbers that appear in the input. Do no maths beyond saying a figure went up or down against the week before.',
  '- Never invent facts, reasons or causes.',
  '- Name clients where it helps. Never name employees.',
  '- No greeting and no sign-off. Plain text: no headings, bullet points, bold or other markdown.',
  '',
  "In the team block the counts overlap — an overdue task can also be active or waiting on the client — so never call one count part, or all, of another.",
].join(String.fromCharCode(10));

/**
 * What the summary is written from, and what is saved beside it.
 *
 * Built field by field rather than by trimming the brief, so nothing new added
 * to the brief can reach the model by accident. No owner names, no people on
 * events, no usage block: counts, clients and amounts only.
 */
export function summaryInputFrom(brief: MondayBrief) {
  const s = brief.scoreboard;
  const top = (groups: MondayBrief['needsAction']) =>
    groups.map((g) => ({
      group: g.group,
      count: g.items.length,
      top: g.items.slice(0, 3).map((i) => ({ client: i.clientName, ...(i.amount !== undefined ? { amount: i.amount } : {}) })),
    }));
  const events = brief.comingUp.events;
  return {
    currency: brief.currency,
    lastWeek: brief.weeks.last,
    weekBefore: brief.weeks.before,
    scoreboard: {
      cashCollected: { lastWeek: s.cashCollected.last, weekBefore: s.cashCollected.before },
      invoiced: { lastWeek: s.invoiced.last, weekBefore: s.invoiced.before },
      dealsWon: { lastWeek: s.dealsWon.last, weekBefore: s.dealsWon.before },
      proposalVersionsSent: { lastWeek: s.proposalsSent.last, weekBefore: s.proposalsSent.before },
      tasksDone: { lastWeek: s.tasksDone.last, weekBefore: s.tasksDone.before },
      approvals: s.approvals.map((a) => ({ group: a.group, lastWeek: a.last, weekBefore: a.before })),
    },
    needsAction: top(brief.needsAction),
    risks: top(brief.risks),
    comingUp: {
      invoicesDue: {
        count: brief.comingUp.invoicesDue.length,
        total: brief.comingUp.invoicesDue.reduce((sum, i) => sum + i.balance, 0),
      },
      projectsEnding: brief.comingUp.projectsEnding.length,
      renewals: brief.comingUp.renewals.length,
      shoots: events.filter((e) => e.kind === 'SHOOT').length,
      meetings: events.filter((e) => e.kind === 'MEETING').length,
    },
    // The counts per department; the bar's split of them is for the screen.
    team: brief.team.map(({ segments: _segments, ...counts }) => counts),
  };
}

/** "2026-09-29" → the UTC midnight a `@db.Date` column stores it at. */
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * Write this week's summary and save it. Null — logged, never thrown — when AI
 * is not set up or the call fails: the brief and the email go out without one.
 */
export async function generateBriefSummary(
  orgId: string,
  brief: MondayBrief,
): Promise<{ text: string; generatedAt: Date; model: string } | null> {
  try {
    const { provider, apiKey, model, baseUrl } = await settingsFor(orgId);
    const input = summaryInputFrom(brief);
    const reply = await provider.complete({
      apiKey,
      baseUrl,
      model,
      system: SYSTEM,
      turns: [{ role: 'user', text: JSON.stringify(input) }],
      tools: [],
      temperature: 0.2,
      maxOutputTokens: 16_000,
    });
    if (reply.stop === 'refusal' || !reply.text.trim()) {
      logger.warn(`Monday brief summary for org ${orgId}: the model ${reply.stop === 'refusal' ? 'declined' : 'wrote nothing'}.`);
      return null;
    }
    // Plain text on the screen and in the email: any markdown emphasis the model added goes.
    const text = reply.text.replace(/\*\*|__/g, '').trim();
    const generatedAt = new Date();
    const weekStart = asDate(brief.weeks.weekStart);
    await prisma.weeklyBrief.upsert({
      where: { organizationId_weekStart: { organizationId: orgId, weekStart } },
      create: { organizationId: orgId, weekStart, summary: text, summaryModel: model, summaryInput: input, generatedAt },
      update: { summary: text, summaryModel: model, summaryInput: input, generatedAt },
    });
    return { text, generatedAt, model };
  } catch (e) {
    if (e instanceof AssistantNotConfigured) {
      logger.info(`Monday brief summary for org ${orgId}: skipped, no AI key is set.`);
    } else {
      logger.warn(`Monday brief summary for org ${orgId} failed: ${e instanceof Error ? e.message : e}`);
    }
    return null;
  }
}
