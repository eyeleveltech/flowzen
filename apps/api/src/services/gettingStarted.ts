import { prisma } from '../lib/prisma.js';
import { googleConfigured } from './googleCalendar.js';

/**
 * My Work's "Getting started" card (Ease Plan 2).
 *
 * Every step is worked out from data that already exists — nothing is stored
 * per step, so a step done some other way (a phone number added by an admin,
 * a task finished from Zen) is ticked all the same:
 *
 *   phone       their own phone number is on their record
 *   phoneApp    a phone or browser of theirs is subscribed to notifications
 *   firstTask   they have written a task down themselves (the scanner's
 *               follow-ups, made under the deal owner's name, do not count)
 *   finishTask  a task they are on is Done, however it got there
 *   howItWorks  they have opened How it works
 *   google      (optional) their Google Calendar is connected — only offered
 *               when this server has the Google keys
 *
 * The optional step is never counted: "3 of 5" is the five that matter.
 */

export const REQUIRED_STEPS = ['phone', 'phoneApp', 'firstTask', 'finishTask', 'howItWorks'] as const;
export type StepKey = (typeof REQUIRED_STEPS)[number] | 'google';

export type GettingStarted = {
  /** They pressed Hide. The card stays away until Profile shows it again. */
  hidden: boolean;
  steps: { key: StepKey; done: boolean; optional?: true }[];
  /** Required steps done, out of `total` (5). */
  done: number;
  total: number;
  /** Every required step is done: the card simply stops showing. */
  complete: boolean;
};

/** The same answer for several people at once, in one read per step. */
export async function gettingStartedFor(organizationId: string, userIds: string[]): Promise<Map<string, GettingStarted>> {
  const out = new Map<string, GettingStarted>();
  if (userIds.length === 0) return out;
  const google = googleConfigured();
  const inOrg = { organizationId, userId: { in: userIds } };

  const [users, push, created, finished, readGuide, connected] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, id: { in: userIds } },
      select: { id: true, phone: true, gettingStartedHiddenAt: true },
    }),
    prisma.pushSubscription.groupBy({ by: ['userId'], where: inOrg }),
    prisma.task.groupBy({
      by: ['createdById'],
      where: {
        organizationId,
        createdById: { in: userIds },
        OR: [{ workId: null }, { NOT: { workId: { startsWith: 'proposal_followup:' } } }],
      },
    }),
    prisma.taskAssignee.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, task: { organizationId, status: 'DONE', deletedAt: null } },
    }),
    prisma.usageDay.groupBy({ by: ['userId'], where: { ...inOrg, screen: 'how-it-works' } }),
    google
      ? prisma.googleCalendarConnection.findMany({ where: inOrg, select: { userId: true } })
      : Promise.resolve([] as { userId: string }[]),
  ]);

  const has = (rows: { userId?: string; createdById?: string }[], key: 'userId' | 'createdById') =>
    new Set(rows.map((r) => r[key]!));
  const subscribed = has(push, 'userId');
  const wrote = has(created, 'createdById');
  const finishedOne = has(finished, 'userId');
  const read = has(readGuide, 'userId');
  const calendar = has(connected, 'userId');

  for (const u of users) {
    const required: GettingStarted['steps'] = [
      { key: 'phone', done: Boolean(u.phone?.trim()) },
      { key: 'phoneApp', done: subscribed.has(u.id) },
      { key: 'firstTask', done: wrote.has(u.id) },
      { key: 'finishTask', done: finishedOne.has(u.id) },
      { key: 'howItWorks', done: read.has(u.id) },
    ];
    const done = required.filter((s) => s.done).length;
    out.set(u.id, {
      hidden: u.gettingStartedHiddenAt !== null,
      steps: google ? [...required, { key: 'google', done: calendar.has(u.id), optional: true }] : required,
      done,
      total: required.length,
      complete: done === required.length,
    });
  }
  return out;
}
