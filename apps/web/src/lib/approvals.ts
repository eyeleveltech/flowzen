/**
 * Task approvals, on the client.
 *
 * Approval happens on WhatsApp today, so Flowzen meets people there: after a
 * task is sent for approval the editor gets a share link that opens WhatsApp
 * with the message written and a link back to the task. No phone number in it
 * — WhatsApp shows its chat picker and the editor picks the approvers' group.
 *
 * The rest is the two queries more than one screen reads: who approves each
 * type (every task form asks), and what is waiting for my approval (My Work,
 * and the count on its nav item).
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-v2';
import { useConfig } from '@/hooks/queries';

/** Who approves each task type. Every task form reads it to decide whether "Needs approval" can be ticked. */
export function useApprovers() {
  return useQuery({
    queryKey: ['approvers'],
    queryFn: async () => (await api.config.approvers()).approvers,
    staleTime: 5 * 60 * 1000,
  });
}

/** Settings → Approvals, whole: both lists per type and the two timings. */
export function useApprovalSettings() {
  return useQuery({
    queryKey: ['approvers', 'settings'],
    queryFn: () => api.config.approvers(),
    staleTime: 60 * 1000,
  });
}

/** The task types the signed-in person approves. */
export function useApproverFor(): string[] {
  const { data } = useConfig();
  return data?.me.approverFor ?? [];
}

/** The task types whose stuck approvals escalate to the signed-in person. */
export function useEscalateFor(): string[] {
  const { data } = useConfig();
  return data?.me.escalateFor ?? [];
}

export const APPROVAL_QUEUE_KEY = ['tasks', 'approvals'] as const;

/**
 * What is waiting for my approval, oldest first — and, for an escalation
 * person, what has escalated to them.
 *
 * Asked only by approvers and escalation people — the server answers
 * everybody else with an empty list, and there is no reason to spend a request
 * on every page load finding that out. Refreshed every couple of minutes so
 * the count on My Work moves without a reload.
 */
export function useApprovalQueue() {
  const approverFor = useApproverFor();
  const escalateFor = useEscalateFor();
  return useQuery({
    queryKey: APPROVAL_QUEUE_KEY,
    queryFn: async () => (await api.tasks.approvals()).items,
    enabled: approverFor.length > 0 || escalateFor.length > 0,
    refetchInterval: 2 * 60 * 1000,
    staleTime: 30 * 1000,
  });
}

/** The words a WhatsApp message is made of. */
export type ApprovalMessage = {
  taskTypeLabel: string | null;
  title: string;
  clientName: string | null;
  projectName: string | null;
  editorName: string;
  round: number;
  link: string | null;
  taskId: string;
};

/**
 * The message the approvers' group receives.
 *
 * Built here, from `window.location.origin`, so the link points at whichever
 * Flowzen the editor is using — and opens straight onto the task in the
 * approver's My Work.
 */
export function approvalMessage(m: ApprovalMessage): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const place = [m.clientName, m.projectName].filter(Boolean).join(' / ');
  return [
    `🔔 Approval needed — ${m.taskTypeLabel ?? 'Task'}`,
    m.title,
    place || null,
    `By ${m.editorName} · Round ${m.round}`,
    m.link || null,
    `Approve here: ${origin}/my-work?task=${m.taskId}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

/**
 * The nudge the editor sends the approvers' group once the reminder time has
 * passed. The same share link; the group, not Akmal — escalation reaches him
 * by bell and email.
 */
export function reminderMessage(m: {
  title: string;
  clientName: string | null;
  projectName: string | null;
  waited: string;
  taskId: string;
}): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const place = [m.clientName, m.projectName].filter(Boolean).join(' / ');
  return [
    `⏰ Reminder — still waiting for approval (${m.waited})`,
    m.title,
    place || null,
    `Approve here: ${origin}/my-work?task=${m.taskId}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

/**
 * The share link. No number: WhatsApp opens its chat picker.
 *
 * It must be a real `<a target="_blank">` the person clicks, not a
 * `window.open` after the send call returns — browsers treat the second as a
 * popup and block it.
 */
export const whatsAppHref = (message: string) => `https://wa.me/?text=${encodeURIComponent(message)}`;

/** "2:40 pm" today, "29 Sept, 2:40 pm" otherwise. */
export function whenDecided(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? time : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
}
