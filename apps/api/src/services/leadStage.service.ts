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
    if (newStatus) {
      await tx.client.update({ where: { id: clientId }, data: { status: newStatus } });
    }

    // 4. Revenue automation — IDEMPOTENT per lead (keyed on sourceLeadId), so a deal that leaves
    //    and re-enters an Active stage never creates a second subscription/contract.
    //    CONTRACT alone creates NOTHING: winning ("Won & Closed") just marks the deal won; the
    //    money record appears when the engagement actually goes Active, where retainer-vs-project
    //    is known.
    const dealValue = params.dealValue ?? lead.dealValue ?? 0;
    const startDate = params.contractStartDate ? new Date(params.contractStartDate) : new Date();

    if (toStage === 'ACTIVE_RETAINER') {
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
