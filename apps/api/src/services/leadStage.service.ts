import type { Prisma } from '@prisma/client';
import { ensureClientForLead } from './clientConversion.service.js';

/**
 * The single source of truth for everything that must happen when a lead's pipeline stage
 * changes — used by BOTH the drag/drop endpoint (POST /crm/leads/:id/stage) and the lead
 * detail update (PATCH /crm/leads/:id).
 *
 * Before this existed the two endpoints each re-implemented stage side effects and had drifted
 * apart: one created revenue at CONTRACT, the other didn't; one guarded ON_HOLD status, the
 * other didn't; neither prevented a duplicate subscription/contract when a deal re-entered an
 * Active stage. Winning the same deal two different ways produced different financial records.
 * Centralising it here means there is exactly one definition of what "winning a deal" does.
 *
 * The caller owns updating the Lead row itself (its stage + any edited fields); this function
 * owns the *consequences*: stage history, conversion to a Client, client status, and revenue.
 */

type Tx = Prisma.TransactionClient;

/** Stages at which a Client account is born (find-or-create; never duplicates). */
export const CONVERSION_STAGES = ['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT'] as const;

/** Closed/terminal stages. A deal here is done — reopening it needs an explicit action. */
export const TERMINAL_STAGES = ['CHURNED', 'PROJECT_COMPLETED'] as const;

/** Pre-win funnel stages — a deal here has never been billed yet. */
const PRE_CONVERSION_STAGES = ['NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION'] as const;

/**
 * The pipeline's state-machine rules. It is otherwise free-form by design — stages can be
 * skipped, jumped, or moved backwards. Two moves need an explicit `reopen` confirmation because
 * they'd otherwise silently desync the pipeline from the client's billing state:
 *  - Leaving a CLOSED deal (CHURNED / PROJECT_COMPLETED) back into the active funnel.
 *  - Dragging an already-WON deal (CONTRACT / ACTIVE_RETAINER / ACTIVE_PROJECT) back past the
 *    win line into pre-negotiation — without this, the board would show "Negotiation" while the
 *    client's subscription/contract keeps billing untouched underneath.
 * Returns an error string to send as 409, or null when the move is allowed.
 */
export function stageTransitionError(previousStage: string, toStage: string, reopen?: boolean): string | null {
  if (previousStage === toStage) return null;
  const wasClosed = (TERMINAL_STAGES as readonly string[]).includes(previousStage);
  const reopeningIntoFunnel = wasClosed && !(TERMINAL_STAGES as readonly string[]).includes(toStage);
  if (reopeningIntoFunnel && !reopen) {
    const label = previousStage === 'CHURNED' ? 'lost (Churned)' : 'completed';
    return `This deal is closed as ${label}. Reopen it to move it back into the pipeline.`;
  }
  const wasWon = (CONVERSION_STAGES as readonly string[]).includes(previousStage);
  const unwindingPastWin = wasWon && (PRE_CONVERSION_STAGES as readonly string[]).includes(toStage);
  if (unwindingPastWin && !reopen) {
    return 'This deal has already been won and the client is being actively billed. Moving it back will pause the subscription and mark the contract inactive. Continue?';
  }
  return null;
}

export interface StageEffectParams {
  /** The lead as it was BEFORE this change (needs id, stage, clientId, identity + dealValue). */
  lead: any;
  orgId: string;
  userId: string;
  /** The stage being moved into. */
  toStage: string;
  /** The stage the lead was in before (recorded in history). */
  previousStage: string;
  notes?: string | null;
  /** Value to use for auto-created revenue; falls back to the lead's dealValue. */
  dealValue?: number | null;
  contractStartDate?: string | Date | null;
  contractEndDate?: string | Date | null;
  /** For retainers: MONTHLY | QUARTERLY | YEARLY | ONE_TIME (defaults MONTHLY). */
  billingFrequency?: string | null;
  /** Explicit intent to reopen a closed (CHURNED / PROJECT_COMPLETED) deal. */
  reopen?: boolean;
}

export interface StageEffectResult {
  /** The client after the change (existing or newly created), or null if none. */
  clientId: string | null;
  /** Set only when a brand-new client was created by this change. */
  newClientId: string | null;
}

function normalizeFrequency(f: string | null | undefined): string {
  const v = String(f || 'MONTHLY').toUpperCase();
  return ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME'].includes(v) ? v : 'MONTHLY';
}

export async function applyLeadStageEffects(tx: Tx, params: StageEffectParams): Promise<StageEffectResult> {
  const { lead, orgId, userId, toStage, previousStage } = params;

  // 1. Stage history — recorded for EVERY move, forward or backward, so the pipeline is fully
  //    auditable (this is also what makes a silent backward drag traceable after the fact).
  await tx.stageHistory.create({
    data: { leadId: lead.id, fromStage: previousStage as any, toStage: toStage as any, notes: params.notes || null, changedById: userId },
  });

  // 2. Conversion — a Client is born only at a conversion stage, and only if the lead hasn't
  //    already got one. ensureClientForLead dedups and links the lead.
  let clientId: string | null = lead.clientId ?? null;
  let newClientId: string | null = null;
  if ((CONVERSION_STAGES as readonly string[]).includes(toStage) && !clientId) {
    const res = await ensureClientForLead(tx, lead, orgId);
    clientId = res.clientId;
    if (res.created) newClientId = res.clientId;
  }

  if (clientId) {
    // 3. Client status — only ever moves the account forward. Dragging a won deal backwards
    //    must never demote a real, billed customer to PROSPECT.
    let newStatus: 'ACTIVE' | 'ONHOLD' | 'PROJECT_COMPLETED' | 'CHURNED' | null = null;
    if (['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(toStage)) newStatus = 'ACTIVE';
    else if (toStage === 'ON_HOLD') newStatus = 'ONHOLD';
    else if (toStage === 'PROJECT_COMPLETED') newStatus = 'PROJECT_COMPLETED';
    else if (toStage === 'CHURNED') newStatus = 'CHURNED';
    // Reopening a closed deal into the active funnel: bring the account back to ACTIVE so it
    // isn't left CHURNED/PROJECT_COMPLETED while its lead is being worked again.
    const reopeningIntoFunnel = (TERMINAL_STAGES as readonly string[]).includes(previousStage)
      && !(TERMINAL_STAGES as readonly string[]).includes(toStage);
    if (newStatus === null && reopeningIntoFunnel) newStatus = 'ACTIVE';
    // Unwinding a won deal (dragged back past CONTRACT into pre-negotiation, confirmed via
    // `reopen` at the route's stageTransitionError guard): pause the account like ON_HOLD rather
    // than losing it — the deal may well be re-won later.
    const isUnwind = newStatus === null
      && (CONVERSION_STAGES as readonly string[]).includes(previousStage)
      && (PRE_CONVERSION_STAGES as readonly string[]).includes(toStage);
    if (isUnwind) newStatus = 'ONHOLD';
    if (newStatus) {
      await tx.client.update({ where: { id: clientId }, data: { status: newStatus } });

      // The PM module is entirely client-scoped, but nothing previously told a client's Projects
      // that its account went CHURNED/ONHOLD — they'd sit there looking untouched indefinitely.
      // Set them to ON_HOLD too (a visible signal, easy for a PM to reverse); leave COMPLETED /
      // already-CANCELLED projects alone. This is a one-way nudge — going back to ACTIVE does NOT
      // auto-resume these, since a project may have been legitimately paused for its own reasons
      // before the client-level pause; a PM takes it off hold deliberately.
      //
      // Projects hang off the CLIENT, not the deal, so this can only run when the account has no
      // other deal still live. A repeat customer can be won more than once (Lead.clientId is
      // deliberately non-unique); without this check, parking one deal froze the delivery work of
      // a sibling deal that is still active — and nothing ever un-froze it.
      if (newStatus === 'CHURNED' || newStatus === 'ONHOLD') {
        const otherLiveDeal = await tx.lead.findFirst({
          where: {
            clientId,
            id: { not: lead.id },
            stage: { in: [...CONVERSION_STAGES] },
          },
          select: { id: true },
        });
        if (!otherLiveDeal) {
          await tx.project.updateMany({
            where: { clientId, status: { notIn: ['COMPLETED', 'CANCELLED', 'ON_HOLD'] } },
            data: { status: 'ON_HOLD' },
          });
        }
      }

      // Keep recurring revenue in step with the account's lifecycle, in the SAME transaction —
      // otherwise a CHURNED client keeps an ACTIVE subscription and MRR never drops (MRR sums
      // only status='ACTIVE' subscriptions/contracts, see revenue.ts).
      if (newStatus === 'CHURNED') {
        // The account left: stop billing. Cancellation is terminal.
        await tx.subscription.updateMany({ where: { clientId, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
        await tx.contract.updateMany({ where: { clientId, status: 'ACTIVE' }, data: { status: 'TERMINATED' } });
      } else if (newStatus === 'ONHOLD') {
        // Parked, not gone: pause billing so it's off MRR but can be resumed.
        await tx.subscription.updateMany({ where: { clientId, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
        // Unwinding specifically also un-wins the one-time project contract this lead created —
        // "won" no longer holds, so its fee shouldn't still read as active revenue. Scoped to
        // THIS lead's contract only (sourceLeadId is unique per lead), not the whole client, so a
        // sibling deal's contract is never touched.
        if (isUnwind) {
          await tx.contract.updateMany({ where: { clientId, sourceLeadId: lead.id, status: 'ACTIVE' }, data: { status: 'TERMINATED' } });
        }
      } else if (newStatus === 'ACTIVE') {
        // Resuming an account: undo what THIS cascade did, and only that.
        //
        // PAUSED is a state nothing but the ON_HOLD branch above sets, so reviving it is always
        // safe and stays symmetric with the client-wide pause.
        await tx.subscription.updateMany({ where: { clientId, status: 'PAUSED' }, data: { status: 'ACTIVE' } });

        // CANCELLED / TERMINATED are different: a human cancels and terminates too, and those
        // decisions must survive. Only reverse them when we are undoing the exact transition that
        // set them — coming back from CHURNED (which cancels + terminates), or re-winning a deal
        // that was unwound past the win line (which terminates this lead's contract). A routine
        // move between Active stages must NOT resurrect anything.
        const undoingOurChurn = previousStage === 'CHURNED';
        const reWinningAfterUnwind = (PRE_CONVERSION_STAGES as readonly string[]).includes(previousStage)
          && (CONVERSION_STAGES as readonly string[]).includes(toStage);

        if (undoingOurChurn || reWinningAfterUnwind) {
          // Scoped to this deal's own records (sourceLeadId is unique per lead), never the whole
          // client. Without the subscription half, a churned retainer that was reopened stayed
          // CANCELLED forever — and the idempotency guard below refuses to mint a replacement,
          // so its MRR never came back.
          await tx.subscription.updateMany({
            where: { clientId, sourceLeadId: lead.id, status: 'CANCELLED' },
            data: { status: 'ACTIVE' },
          });
          await tx.contract.updateMany({
            where: { clientId, sourceLeadId: lead.id, status: 'TERMINATED' },
            data: { status: 'ACTIVE' },
          });
        }
      }
    }

    // 4. Revenue automation — IDEMPOTENT per lead (keyed on sourceLeadId), so a deal that leaves
    //    and re-enters an Active stage never creates a second subscription/contract.
    //    CONTRACT alone creates NOTHING: winning ("Won & Closed") just marks the deal won; the
    //    money record appears when the engagement actually goes Active, where retainer-vs-project
    //    is known.
    const dealValue = params.dealValue ?? lead.dealValue ?? 0;
    const startDate = params.contractStartDate ? new Date(params.contractStartDate) : new Date();

    if (toStage === 'ACTIVE_RETAINER') {
      if (!lead.renewalStatus) {
        await tx.lead.update({ where: { id: lead.id }, data: { renewalStatus: 'UPCOMING' } });
      }
      const already = await tx.subscription.findFirst({ where: { sourceLeadId: lead.id }, select: { id: true } });
      if (!already) {
        await tx.subscription.create({
          data: {
            organizationId: orgId,
            clientId,
            sourceLeadId: lead.id,
            amount: dealValue,
            billingFrequency: normalizeFrequency(params.billingFrequency),
            startDate,
            nextBillingDate: startDate,
            status: 'ACTIVE',
            notes: 'Auto-created from CRM (Active retainer)',
          },
        });
      }
    } else if (toStage === 'ACTIVE_PROJECT') {
      const already = await tx.contract.findFirst({ where: { sourceLeadId: lead.id }, select: { id: true } });
      if (!already) {
        const endDate = params.contractEndDate ? new Date(params.contractEndDate) : null;
        await tx.contract.create({
          data: {
            organizationId: orgId,
            clientId,
            sourceLeadId: lead.id,
            title: `${lead.companyName || lead.contactName || 'Project'} — Project`,
            value: dealValue,
            billingFrequency: 'ONE_TIME',
            startDate,
            endDate,
            status: 'ACTIVE',
            notes: 'Auto-created from CRM (Active project)',
          },
        });
      }
    }
  }

  return { clientId, newClientId };
}
