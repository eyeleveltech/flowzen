import { CHASER_RULES } from '../services/alertRules.js';
import { AlertSeverity, type TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { sendMail } from '../utils/mailer.js';
import { emitToOrganization } from '../sse.js';
import { loadWorkCalendar, workingMinutesOn, type WorkCalendar } from '../utils/workCalendar.js';
import { approverIds, escalationIds, minutesLabel, TASK_TYPE_LABEL } from '../services/taskApprovals.js';
import { pushApprovalChase } from '../services/push.js';

/**
 * The approval chaser — Plan 2.
 *
 * Plan 1 made a video waiting for approval visible; approvers still forget.
 * This runs every ten minutes and, for every round still waiting, checks how
 * long it has waited in WORKING time — the org's hours, days and holidays, so
 * a video sent at 6pm is chased the next morning, not at 8pm:
 *
 *   · past the reminder time: a bell alert (MED) and an email to the task
 *     type's approvers;
 *   · past the escalation time: the reminder alert is closed, an escalated
 *     alert (HIGH) takes its place, and the approvers AND the type's
 *     escalation people are emailed. From then the escalation people can
 *     decide it too.
 *
 * Once each per round, then quiet. The escalated alert stays open in the bell
 * and in the 8am digest until someone decides; nobody is emailed again. A new
 * round (after Request changes) starts its own clock.
 *
 * ─── Never twice ────────────────────────────────────────────────────────────
 *
 * Every ping is claimed before it is sent: `updateMany where remindedAt is
 * null` (or `escalatedAt`), and only the tick that changed a row sends. Two
 * overlapping ticks, or a restart half way through, cannot double up.
 *
 * ─── Mail is best effort ────────────────────────────────────────────────────
 *
 * No mail server, or a bad address: logged and carried on. The bell alert is
 * the record and is created first; an email failure never throws out of the
 * tick.
 */

/**
 * The rules this worker owns — kept with the other workers' rules in
 * services/alertRules, which the hourly scanner reads so it leaves them alone.
 */
export { CHASER_RULES };

type OpenRound = Awaited<ReturnType<typeof loadOpenRounds>>[number];

const loadOpenRounds = () =>
  prisma.taskReview.findMany({
    where: { decision: null, task: { status: 'IN_REVIEW', deletedAt: null } },
    orderBy: { submittedAt: 'asc' },
    include: {
      submittedBy: { select: { name: true } },
      task: {
        select: {
          id: true,
          title: true,
          taskType: true,
          organizationId: true,
          assignees: { select: { userId: true } },
          monthCard: { select: { retainer: { select: { company: { select: { name: true } } } } } },
          project: { select: { name: true, company: { select: { name: true } } } },
          company: { select: { name: true } },
          internalProject: { select: { name: true } },
          retainerProject: { select: { name: true } },
        },
      },
    },
  });

/** "Carlton Wellness · Diwali campaign", or "Internal". */
const placeOf = (t: OpenRound['task']) =>
  [
    t.monthCard?.retainer.company.name || t.project?.company.name || t.company?.name || 'Internal',
    t.project?.name ?? t.retainerProject?.name ?? t.internalProject?.name ?? null,
  ]
    .filter(Boolean)
    .join(' · ');

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email: what it is, whose, what they said, and the one button. */
function mailFor(round: OpenRound, kind: 'REMINDER' | 'ESCALATED', waited: string, appUrl: string) {
  const t = round.task;
  const href = `${appUrl}/my-work?task=${t.id}`;
  const subject =
    kind === 'REMINDER' ? `Approval waiting ${waited}: ${t.title}` : `Escalated: ${t.title} waiting ${waited} for approval`;
  const lines = [
    `<p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6d7f79">${
      kind === 'REMINDER' ? 'Still waiting for approval' : 'Escalated — no answer yet'
    } · ${waited}</p>`,
    `<p style="margin:0 0 6px;font-size:18px;font-weight:600;color:#163027">${escapeHtml(t.title)}</p>`,
    `<p style="margin:0 0 12px;color:#3d5b4e">${escapeHtml(placeOf(t))}</p>`,
    `<p style="margin:0 0 4px;color:#3d5b4e">By ${escapeHtml(round.submittedBy.name)} · Round ${round.round}${
      t.taskType ? ` · ${TASK_TYPE_LABEL[t.taskType]}` : ''
    }</p>`,
    round.note ? `<p style="margin:8px 0;color:#1e4034">“${escapeHtml(round.note)}”</p>` : '',
    round.link ? `<p style="margin:8px 0"><a href="${escapeHtml(round.link)}">Open the work</a></p>` : '',
    `<p style="margin:18px 0"><a href="${href}" style="display:inline-block;background:#163027;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Open in Flowzen</a></p>`,
  ].join('');
  const text = [
    kind === 'REMINDER' ? `Still waiting for approval (${waited})` : `Escalated — waiting ${waited} with no answer`,
    t.title,
    placeOf(t),
    `By ${round.submittedBy.name} · Round ${round.round}`,
    round.note ? `"${round.note}"` : null,
    round.link,
    `Open in Flowzen: ${href}`,
  ]
    .filter(Boolean)
    .join('\n');
  return { subject, html: lines, text };
}

/** One mail per person; a failure is logged, never thrown. */
async function mailPeople(orgId: string, userIds: string[], message: { subject: string; html: string; text: string }) {
  if (userIds.length === 0) return;
  const people = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId: orgId, active: true },
    select: { email: true },
  });
  for (const p of people) {
    try {
      await sendMail(orgId, { to: p.email, ...message });
    } catch (err) {
      logger.warn(`Approval chaser: could not email ${p.email}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * One pass. Exported so a test can call it with its own clock.
 */
export async function runApprovalChaser(now = new Date()): Promise<{ reminded: number; escalated: number; resolved: number }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
  let reminded = 0;
  let escalated = 0;
  const touchedOrgs = new Set<string>();

  const rounds = await loadOpenRounds();

  // Each organisation's calendar and thresholds, once.
  const byOrg = new Map<string, OpenRound[]>();
  for (const r of rounds) byOrg.set(r.task.organizationId, [...(byOrg.get(r.task.organizationId) ?? []), r]);

  for (const [orgId, list] of byOrg) {
    try {
      const [calendar, org] = await Promise.all([
        loadWorkCalendar(orgId),
        prisma.organization.findUnique({
          where: { id: orgId },
          select: { approvalRemindMinutes: true, approvalEscalateMinutes: true },
        }),
      ]);
      const remindAfter = org?.approvalRemindMinutes ?? 120;
      const escalateAfter = org?.approvalEscalateMinutes ?? 240;

      for (const round of list) {
        const outcome = await chaseRound(orgId, round, calendar, now, remindAfter, escalateAfter, appUrl);
        if (outcome === 'REMINDED') reminded++;
        if (outcome === 'ESCALATED') escalated++;
        if (outcome) touchedOrgs.add(orgId);
      }
    } catch (err) {
      logger.error(`Approval chaser error for org ${orgId}: ${err}`);
    }
  }

  // ── Clean up: alerts whose task is no longer waiting ──────────────────────
  //
  // Approve and Request changes close their own alerts at once; this catches
  // the rest — a task cancelled while in review, or deleted.
  let resolved = 0;
  try {
    const open = await prisma.alert.findMany({
      where: { rule: { in: CHASER_RULES }, entityType: 'Task', resolvedAt: null },
      select: { id: true, entityId: true },
    });
    if (open.length > 0) {
      const tasks = await prisma.task.findMany({
        // `deletedAt: undefined` opts out of the soft-delete filter, so a
        // deleted task is found and its alert closed.
        where: { id: { in: [...new Set(open.map((a) => a.entityId))] }, deletedAt: undefined },
        select: { id: true, status: true, deletedAt: true },
      });
      const stillWaiting = new Set(tasks.filter((t) => t.status === 'IN_REVIEW' && !t.deletedAt).map((t) => t.id));
      const stale = open.filter((a) => !stillWaiting.has(a.entityId)).map((a) => a.id);
      if (stale.length > 0) {
        resolved = (await prisma.alert.updateMany({ where: { id: { in: stale } }, data: { resolvedAt: now } })).count;
      }
    }
  } catch (err) {
    logger.error(`Approval chaser cleanup error: ${err}`);
  }

  // A bare signal, as the scanner sends: the bell re-asks and applies its own scoping.
  for (const orgId of touchedOrgs) emitToOrganization(orgId, 'notification:new', null);

  return { reminded, escalated, resolved };
}

async function chaseRound(
  orgId: string,
  round: OpenRound,
  calendar: WorkCalendar,
  now: Date,
  remindAfter: number,
  escalateAfter: number,
  appUrl: string,
): Promise<'REMINDED' | 'ESCALATED' | null> {
  const mins = workingMinutesOn(calendar, round.submittedAt, now).totalMinutes;
  const t = round.task;
  const type = t.taskType as TaskType | null;
  const onIt = new Set(t.assignees.map((a) => a.userId));

  // ── Escalate (and, if the server was down past both, only escalate) ──────
  if (mins >= escalateAfter && !round.escalatedAt) {
    const claim = await prisma.taskReview.updateMany({
      where: { id: round.id, escalatedAt: null },
      data: { escalatedAt: now, ...(round.remindedAt ? {} : { remindedAt: now }) },
    });
    if (claim.count !== 1) return null;

    const waited = minutesLabel(escalateAfter);
    await prisma.alert.updateMany({
      where: { organizationId: orgId, rule: 'APPROVAL_REMINDER', entityType: 'Task', entityId: t.id, resolvedAt: null },
      data: { resolvedAt: now },
    });
    await prisma.alert.create({
      data: {
        organizationId: orgId,
        rule: 'APPROVAL_ESCALATED',
        severity: AlertSeverity.HIGH,
        entityType: 'Task',
        entityId: t.id,
        message: `"${t.title}" has waited ${waited} for approval with no answer — Round ${round.round}, by ${round.submittedBy.name}.`,
      },
    });
    // Approvers and escalation people — never whoever is on the task.
    const people = [...new Set([...(await approverIds(orgId, type)), ...(await escalationIds(orgId, type))])].filter(
      (id) => !onIt.has(id),
    );
    await mailPeople(orgId, people, mailFor(round, 'ESCALATED', waited, appUrl));
    await pushApprovalChase(orgId, people, round, 'ESCALATED', waited);
    return 'ESCALATED';
  }

  // ── Remind ───────────────────────────────────────────────────────────────
  if (mins >= remindAfter && !round.remindedAt && !round.escalatedAt) {
    const claim = await prisma.taskReview.updateMany({
      where: { id: round.id, remindedAt: null },
      data: { remindedAt: now },
    });
    if (claim.count !== 1) return null;

    const waited = minutesLabel(remindAfter);
    await prisma.alert.create({
      data: {
        organizationId: orgId,
        rule: 'APPROVAL_REMINDER',
        severity: AlertSeverity.MED,
        entityType: 'Task',
        entityId: t.id,
        message: `"${t.title}" has been waiting ${waited} for approval — Round ${round.round}, by ${round.submittedBy.name}.`,
      },
    });
    const people = (await approverIds(orgId, type)).filter((id) => !onIt.has(id));
    await mailPeople(orgId, people, mailFor(round, 'REMINDER', waited, appUrl));
    await pushApprovalChase(orgId, people, round, 'REMINDER', waited);
    return 'REMINDED';
  }

  return null;
}

/**
 * Every ten minutes: often enough that a two-hour reminder lands within ten
 * minutes of two hours, and every tick with nothing due is one query.
 */
export function startApprovalChaser(intervalMs = 10 * 60 * 1000) {
  if (process.env.NODE_ENV !== 'test') {
    runApprovalChaser().catch((e) => logger.error(`Initial approval chaser error: ${e}`));
    setInterval(() => {
      runApprovalChaser().catch((e) => logger.error(`Periodic approval chaser error: ${e}`));
    }, intervalMs);
  }
}
