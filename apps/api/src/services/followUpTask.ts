/**
 * A follow-up task — chasing a client — and what finishing one means.
 *
 * Follow-ups are tasks filed on a company and on nothing else: no project, no
 * month card, no internal project. They come from "Schedule a follow-up" on
 * the company page, a logged meeting, the lead form, a promoted lead's next
 * step, and the hourly scanner when a sent proposal goes quiet.
 *
 * Marking one done used to change the task and nothing else. The deal it was
 * about still read "no contact for 9 days", so the scanner — which only knows
 * what the DEAL says — raised the alert again and, before 6 Nov, made the
 * task again the next morning: Done turned into "To do, tomorrow". Doing the
 * follow-up IS following up, so finishing the task now records a touch on the
 * client's open deals, exactly as "Log a touch" on the deal does.
 */

import { TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ACTIVE_DEAL_WHERE } from './activeDeal.js';
import { ACTIVE_OUTREACH } from './salesFollowUp.js';

/** Every follow-up is sales work, whichever path made it. */
export const FOLLOW_UP_TASK_TYPE = TaskType.BUSINESS_DEVELOPMENT;

/**
 * The scanner's own follow-up for one proposal is found again by this key, in
 * `workId`. It used to live in `notes`, where it showed on the company page as
 * "proposal_followup:cm…" and was lost the moment somebody wrote a note.
 */
export const proposalFollowUpKey = (proposalId: string) => `proposal_followup:${proposalId}`;
const PROPOSAL_KEY = /^proposal_followup:(\S+)$/;

type FollowUpShape = {
  organizationId: string;
  companyId: string | null;
  projectId: string | null;
  monthCardId: string | null;
  retainerProjectId: string | null;
  internalProjectId: string | null;
};

/** Filed on a client and on nothing else — what the company page lists as Follow-ups. */
export function isFollowUpTask(t: FollowUpShape): boolean {
  return Boolean(t.companyId) && !t.projectId && !t.monthCardId && !t.retainerProjectId && !t.internalProjectId;
}

/** The proposal a scanner follow-up is about, from its key — or from its notes, on one made before the key moved. */
export function followUpProposalId(t: { workId: string | null; notes: string | null }): string | null {
  const m = PROPOSAL_KEY.exec(t.workId ?? '') ?? PROPOSAL_KEY.exec((t.notes ?? '').trim());
  return m ? m[1] : null;
}

/**
 * A follow-up was just marked done: the client was contacted. Each of their
 * open deals — or only the one a scanner follow-up names — has its last touch
 * moved to now, with a "touch logged" line on its history saying it came from
 * the task; and their lead, if one is still being worked.
 *
 * Returns how many deals were touched. Anything else, a task that is not a
 * follow-up, is left alone.
 */
export async function recordFollowUpDone(
  task: FollowUpShape & { id: string; title: string; workId: string | null; notes: string | null },
  actorId: string,
): Promise<number> {
  if (!isFollowUpTask(task)) return 0;
  const proposalId = followUpProposalId(task);
  const now = new Date();

  const deals = await prisma.proposal.findMany({
    where: {
      organizationId: task.organizationId,
      ...ACTIVE_DEAL_WHERE,
      ...(proposalId ? { id: proposalId } : { companyId: task.companyId! }),
    },
    select: { id: true, company: { select: { name: true } } },
  });

  for (const d of deals) {
    await prisma.proposal.update({ where: { id: d.id }, data: { lastTouchedAt: now } });
    await prisma.activity.create({
      data: {
        organizationId: task.organizationId,
        entityType: 'Proposal',
        entityId: d.id,
        actorId,
        verb: 'touch_logged',
        // TASK is not one of the channels a person picks; it reads "Follow-up"
        // on screen and says which task it was.
        payload: { companyName: d.company.name, channel: 'TASK', note: `“${task.title}” marked done`, taskId: task.id },
      },
    });
  }

  // A lead still being worked, for a client that was one.
  await prisma.outreachEntry.updateMany({
    where: { organizationId: task.organizationId, promotedCompanyId: task.companyId!, status: { in: ACTIVE_OUTREACH } },
    data: { lastTouchedAt: now },
  });

  return deals.length;
}
