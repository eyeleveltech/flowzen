import { z } from 'zod';
import { OutreachStatus, ProposalStage } from '@prisma/client';
import { asStoredDay, dayKey, moneyClock, orgToday } from '../utils/moneyDates.js';

/**
 * Sales follow-ups: the next step, the last touch, and "going stale"
 * (Sales next step plan). One place, so the board, the outreach list, the
 * PROPOSAL_STALLED alert, My Work and Zen can never disagree.
 *
 *   · Every open deal (no outcome) and every active lead (follow-up, meeting,
 *     interested) carries a next step and a date. A touch, a stage or status
 *     change, or an edit that leaves it open is refused without them. Closing
 *     it (won, lost, dead) needs neither.
 *   · The last touch is the last real contact: a logged touch, a version sent,
 *     a stage change, a proforma raised, an outreach status change — or a date
 *     set by hand. Owner, probability and typo edits are not contact.
 *   · Stale: the last touch is more than the org's threshold ago. With no last
 *     touch recorded, a deal counts from when it entered its stage, and a lead
 *     from when it was added.
 */

export const TOUCH_CHANNELS = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'OTHER'] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];
export const CHANNEL_LABEL: Record<TouchChannel, string> = {
  CALL: 'Call',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  OTHER: 'Other',
};

/** A lead that is being worked. Its next step is optional (2026-10-16), but shown when missing. */
export const ACTIVE_OUTREACH: OutreachStatus[] = [OutreachStatus.FOLLOW_UP, OutreachStatus.MEETING, OutreachStatus.INTERESTED];
export const isActiveOutreach = (status: OutreachStatus | string) => (ACTIVE_OUTREACH as string[]).includes(status);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The two fields, as any form sends them. Left out: unchanged. Null or blank: cleared. */
export const nextStepFields = {
  nextStep: z.string().trim().max(300, 'Keep the next step short — a few words').optional().nullable(),
  nextStepDate: z
    .string()
    .refine((v) => v === '' || DAY.test(v), 'That next step date is not a real date')
    .optional()
    .nullable(),
};

/**
 * What a touch carries: how, and what was said — both required — and,
 * optionally, what happens next. Left out, the next step stays as it was;
 * blank, it is cleared.
 */
export const touchSchema = z.object({
  channel: z.enum(TOUCH_CHANNELS, { errorMap: () => ({ message: 'Pick how you were in touch' }) }),
  note: z.string({ required_error: 'Add a short note — what was said' }).trim().min(1, 'Add a short note — what was said').max(1000),
  ...nextStepFields,
});

/** "Set last contact date": a calendar day, not in the future. */
export const lastContactSchema = z.object({
  lastTouchedAt: z.string({ required_error: 'Pick the date of the last contact' }).regex(DAY, 'Pick the date of the last contact'),
});
export const bulkLastContactSchema = lastContactSchema.extend({
  ids: z.array(z.string().min(1)).min(1, 'Select at least one row').max(500, 'At most 500 at a time'),
});

/** Today where the studio is, as "2026-10-13". */
export async function studioToday(organizationId: string, now: Date = new Date()): Promise<string> {
  return orgToday((await moneyClock(organizationId)).timezone, now);
}

/** A next step date may not already be past: a step due yesterday is not a plan. */
export function nextStepDateRefusal(date: string | null | undefined, today: string): string | null {
  if (!date) return null;
  if (date < today) return "The next step date can't be in the past.";
  return null;
}

/** A last-contact date may not be in the future. */
export function lastContactRefusal(date: string, today: string): string | null {
  if (date > today) return "The last contact date can't be in the future.";
  return null;
}

/**
 * The next step as it will stand after a save: what was sent, else what the
 * row already had. `undefined` in the request means "leave it".
 */
export function mergeNextStep(
  existing: { nextStep: string | null; date: Date | null },
  sent: { nextStep?: string | null; nextStepDate?: string | null },
): { nextStep: string | null; date: Date | null } {
  const nextStep = sent.nextStep === undefined ? existing.nextStep : sent.nextStep?.trim() || null;
  const date =
    sent.nextStepDate === undefined ? existing.date : sent.nextStepDate ? asStoredDay(sent.nextStepDate) : null;
  return { nextStep, date };
}

/** Whether a next step is complete: both the words and the date. */
export const hasNextStep = (v: { nextStep: string | null | undefined; date: Date | null | undefined }) =>
  Boolean(v.nextStep?.trim()) && Boolean(v.date);

/** Whole days from a moment to today (studio calendar). Never negative. */
export function daysSince(at: Date, today: string): number {
  const from = Date.parse(`${dayKey(at)}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * When a deal entered the stage it is in — the fallback when no touch has
 * been recorded. Taken from the records the stage itself follows.
 */
export function stageEnteredAt(
  p: {
    stage: ProposalStage | string;
    wonAt: Date | null;
    verbalYesAt: Date | null;
    createdAt: Date;
    versions: { sentAt: Date }[];
  },
  proformaRaisedAt?: Date | null,
): Date {
  if (p.stage === ProposalStage.WON && p.wonAt) return p.wonAt;
  if (p.stage === ProposalStage.VERBAL_YES && p.verbalYesAt) return p.verbalYesAt;
  if (p.stage === ProposalStage.PROFORMA_ISSUED && proformaRaisedAt) return proformaRaisedAt;
  const sorted = [...p.versions].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  if (p.stage === ProposalStage.IN_NEGOTIATION && sorted.length > 1) return sorted[sorted.length - 1].sentAt;
  if (sorted.length > 0) return sorted[0].sentAt;
  return p.createdAt;
}

/** A deal's last touch, falling back to its stage entry, and whether it has gone stale. */
export function dealStaleness(
  p: Parameters<typeof stageEnteredAt>[0] & { lastTouchedAt: Date | null; outcome: string | null },
  staleDays: number,
  today: string,
  proformaRaisedAt?: Date | null,
): { lastTouchAt: Date; daysSinceTouch: number; stale: boolean; touchRecorded: boolean } {
  const lastTouchAt = p.lastTouchedAt ?? stageEnteredAt(p, proformaRaisedAt);
  const days = daysSince(lastTouchAt, today);
  return { lastTouchAt, daysSinceTouch: days, stale: p.outcome === null && days > staleDays, touchRecorded: Boolean(p.lastTouchedAt) };
}

/** A lead's last touch, falling back to when it was added, and whether it has gone stale. */
export function leadStaleness(
  e: { lastTouchedAt: Date | null; importedAt: Date; status: OutreachStatus | string },
  staleDays: number,
  today: string,
): { lastTouchAt: Date; daysSinceTouch: number; stale: boolean } {
  const lastTouchAt = e.lastTouchedAt ?? e.importedAt;
  const days = daysSince(lastTouchAt, today);
  return { lastTouchAt, daysSinceTouch: days, stale: isActiveOutreach(e.status) && days > staleDays };
}

/** Where a next step stands on screen: missing, overdue, due today, or later. */
export function nextStepState(
  v: { nextStep: string | null; date: Date | null },
  needsOne: boolean,
  today: string,
): { missing: boolean; overdue: boolean; dueToday: boolean } {
  const missing = needsOne && !hasNextStep(v);
  const key = v.date ? dayKey(v.date) : null;
  return { missing, overdue: Boolean(needsOne && key && key < today), dueToday: Boolean(needsOne && key === today) };
}
