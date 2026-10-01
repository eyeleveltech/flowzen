/**
 * The approvals report — Plan 3.
 *
 * Where approvals get stuck: what is waiting right now, how long a decision
 * usually takes, how often one is on time, how often it escalates, and what
 * each approver actually did. Read-only over Plans 1 and 2's rounds; nothing
 * here writes.
 *
 * ─── What it deliberately does not count ────────────────────────────────────
 *
 * Editors. No rounds per editor, no sent-back counts per editor — Akmal has
 * turned down staff monitoring before, and this is not a way round that. The
 * one place an editor's name appears is the "Waiting now" list, so a head can
 * tell which video a row is.
 *
 * Waits and escalations are the approver GROUP's, not a person's: any one of
 * the pool can decide, so a video waiting is waiting on all of them. Per person
 * it is only what they did — approved, sent back, how fast.
 *
 * ─── How it counts ──────────────────────────────────────────────────────────
 *
 *   · Time is working time (the org's hours, days, holidays), and "typical" is
 *     the median — one video stuck over a long weekend would wreck an average.
 *   · On time is decided within the org's reminder time (Plan 2's setting).
 *   · Only task types with approvers set are reported.
 *   · Rounds on a deleted task are left out.
 *
 * Takes a date RANGE, not a day count, so the screen (last 7 or 30 days) and
 * the Monday brief (last Monday to Sunday) read the same numbers from one
 * place — the same shape as `composeMondayBrief`.
 */

import { TaskStatus, TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { loadWorkCalendar, workingMinutesOn } from '../utils/workCalendar.js';

type Person = { id: string; name: string };

/** The middle value, rounded to the minute; null for none. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export async function composeApprovalsReport(orgId: string, range: { from: Date; to: Date }, now = new Date()) {
  const { from, to } = range;
  const inPeriod = (d: Date | null | undefined) => Boolean(d && d >= from && d <= to);

  const [org, calendar, approverRows, escalationRows] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { approvalRemindMinutes: true } }),
    loadWorkCalendar(orgId),
    prisma.taskApprover.findMany({
      where: { organizationId: orgId, user: { active: true } },
      select: { taskType: true, user: { select: { id: true, name: true } } },
    }),
    prisma.approvalEscalationContact.findMany({
      where: { organizationId: orgId, user: { active: true } },
      select: { taskType: true, user: { select: { id: true, name: true } } },
    }),
  ]);
  const onTimeMinutes = org?.approvalRemindMinutes ?? 120;
  const mins = (a: Date, b: Date) => workingMinutesOn(calendar, a, b).totalMinutes;

  // The pool for each type — and the types themselves: only those with approvers.
  const poolByType = new Map<TaskType, Person[]>();
  for (const r of approverRows) poolByType.set(r.taskType, [...(poolByType.get(r.taskType) ?? []), r.user]);
  const types = [...poolByType.keys()];
  for (const list of poolByType.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  if (types.length === 0) {
    return { period: { from, to }, onTimeMinutes, byType: [], byPerson: [], waitingNow: [] };
  }

  // Changes approvers added to rounds somebody else sent back, in the period.
  const added = await prisma.taskReviewNote.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      review: { organizationId: orgId, task: { deletedAt: null, taskType: { in: types } } },
    },
    select: { author: { select: { id: true, name: true } } },
  });

  const [rounds, open] = await Promise.all([
    // Anything that happened in the period: sent, decided or escalated in it.
    prisma.taskReview.findMany({
      where: {
        organizationId: orgId,
        task: { deletedAt: null, taskType: { in: types } },
        OR: [
          { submittedAt: { gte: from, lte: to } },
          { decidedAt: { gte: from, lte: to } },
          { escalatedAt: { gte: from, lte: to } },
        ],
      },
      select: {
        submittedAt: true,
        decision: true,
        decidedAt: true,
        escalatedAt: true,
        decidedBy: { select: { id: true, name: true } },
        task: { select: { taskType: true } },
      },
    }),
    // Waiting right now, whatever the period.
    prisma.taskReview.findMany({
      where: {
        organizationId: orgId,
        decision: null,
        task: { deletedAt: null, status: TaskStatus.IN_REVIEW, taskType: { in: types } },
      },
      orderBy: { submittedAt: 'asc' },
      select: {
        round: true,
        submittedAt: true,
        remindedAt: true,
        escalatedAt: true,
        // Context only — which video this is. Never counted.
        submittedBy: { select: { name: true } },
        task: {
          select: {
            id: true,
            title: true,
            taskType: true,
            monthCard: { select: { retainer: { select: { company: { select: { name: true } } } } } },
            project: { select: { company: { select: { name: true } } } },
            company: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const waitingNow = open.map((r) => ({
    taskId: r.task.id,
    title: r.task.title,
    clientName: r.task.monthCard?.retainer.company.name || r.task.project?.company.name || r.task.company?.name || 'Internal',
    taskType: r.task.taskType as TaskType,
    round: r.round,
    editorName: r.submittedBy.name,
    submittedAt: r.submittedAt,
    waitingMinutes: mins(r.submittedAt, now),
    remindedAt: r.remindedAt,
    escalatedAt: r.escalatedAt,
  }));

  /** A decided round in the period, with how long it took. */
  const decided = rounds
    .filter((r) => r.decision && r.decidedAt && inPeriod(r.decidedAt))
    .map((r) => ({
      taskType: r.task.taskType as TaskType,
      decision: r.decision!,
      by: r.decidedBy,
      minutes: mins(r.submittedAt, r.decidedAt!),
      afterEscalation: Boolean(r.escalatedAt && r.escalatedAt <= r.decidedAt!),
    }));

  /*
   * One card per approver LIST, not per type.
   *
   * Settings → Approvals now sets one list for all work, which writes the
   * same people onto every type — reported per type, that was seven identical
   * cards, six of them zeros. Types sharing a list are counted together, and
   * when that is every type the card is simply "all work" (`taskTypes` holds
   * them; `taskType` is the first, for a caller that reads one).
   */
  const groups = new Map<string, TaskType[]>();
  for (const t of types) {
    const key = (poolByType.get(t) ?? []).map((p) => p.id).sort().join(',');
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const byType = [...groups.values()]
    .map((groupTypes) => {
      const taskType = groupTypes[0];
      const inGroup = (t: TaskType | null) => Boolean(t && groupTypes.includes(t));
      const ofType = rounds.filter((r) => inGroup(r.task.taskType));
      const dec = decided.filter((d) => inGroup(d.taskType));
      const waiting = waitingNow.filter((w) => inGroup(w.taskType));
      return {
        taskType,
        taskTypes: groupTypes,
        allWork: groupTypes.length === Object.values(TaskType).length,
        approvers: poolByType.get(taskType) ?? [],
        submitted: ofType.filter((r) => inPeriod(r.submittedAt)).length,
        decided: dec.length,
        approved: dec.filter((d) => d.decision === 'APPROVED').length,
        changesRequested: dec.filter((d) => d.decision === 'CHANGES_REQUESTED').length,
        medianDecisionMinutes: median(dec.map((d) => d.minutes)),
        onTime: dec.filter((d) => d.minutes <= onTimeMinutes).length,
        escalated: ofType.filter((r) => inPeriod(r.escalatedAt)).length,
        waitingNow: waiting.length,
        oldestWaitingMinutes: waiting.length ? Math.max(...waiting.map((w) => w.waitingMinutes)) : null,
        // Any wait here has escalated — what turns the tile red.
        anyEscalated: waiting.some((w) => w.escalatedAt),
      };
    })
    .sort((a, b) => a.taskType.localeCompare(b.taskType));

  /*
   * Every current approver, decisions or not — a zero is the point, it shows
   * who never picks one up. Plus anyone else who decided something in the
   * period (an escalation contact, or an approver since removed), so the
   * people add up to the totals above.
   */
  const people = new Map<string, { user: Person; taskTypes: Set<TaskType> }>();
  const add = (user: Person, type?: TaskType) => {
    const row = people.get(user.id) ?? { user, taskTypes: new Set<TaskType>() };
    if (type) row.taskTypes.add(type);
    people.set(user.id, row);
  };
  for (const r of approverRows) add(r.user, r.taskType);
  for (const d of decided) if (d.by) add(d.by);
  for (const n of added) add(n.author);
  // An escalation contact's types, for whoever is listed.
  for (const r of escalationRows) if (people.has(r.user.id)) people.get(r.user.id)!.taskTypes.add(r.taskType);

  const byPerson = [...people.values()]
    .map(({ user, taskTypes }) => {
      const theirs = decided.filter((d) => d.by?.id === user.id);
      return {
        user,
        taskTypes: [...taskTypes].sort(),
        approved: theirs.filter((d) => d.decision === 'APPROVED').length,
        changesRequested: theirs.filter((d) => d.decision === 'CHANGES_REQUESTED').length,
        medianDecisionMinutes: median(theirs.map((d) => d.minutes)),
        afterEscalation: theirs.filter((d) => d.afterEscalation).length,
        // Changes they added to a round somebody else sent back.
        changesAdded: added.filter((n) => n.author.id === user.id).length,
      };
    })
    // Most decided first, so the zeros sink to the bottom where they show.
    .sort(
      (a, b) =>
        b.approved + b.changesRequested - (a.approved + a.changesRequested) || a.user.name.localeCompare(b.user.name),
    );

  return { period: { from, to }, onTimeMinutes, byType, byPerson, waitingNow };
}

export type ApprovalsReport = Awaited<ReturnType<typeof composeApprovalsReport>>;
