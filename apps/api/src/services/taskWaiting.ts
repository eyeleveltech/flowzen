import type { WaitingOn } from '@prisma/client';

/**
 * What a task on hold is waiting on (QA19 fixes plan, F06).
 *
 * Every screen put a task on hold as `waitingOn: 'CLIENT'`, hard-coded — so an
 * internal task with no client at all ("Renew the office Wi-Fi") read "waiting
 * on the client". Putting a task on hold now asks: the client (only when the
 * task has one), someone else, or nothing — just on hold.
 */

/** Whether a task has a client: retainer month, client project, or an internal task about a company. */
export const taskHasClient = (t: { monthCardId?: string | null; projectId?: string | null; companyId?: string | null }): boolean =>
  Boolean(t.monthCardId || t.projectId || t.companyId);

/**
 * The waiting-on a screen shows. A task with no client that says it waits on
 * the client is an old hold made before the question was asked: it shows as
 * plain "On hold". A display rule only — the row itself is not rewritten.
 */
export const waitingOnShown = (t: {
  waitingOn: WaitingOn | null;
  monthCardId?: string | null;
  projectId?: string | null;
  companyId?: string | null;
}): WaitingOn | null => (t.waitingOn === 'CLIENT' && !taskHasClient(t) ? null : t.waitingOn);
