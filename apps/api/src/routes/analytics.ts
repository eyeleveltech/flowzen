import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, authorize, requireModule, AuthRequest } from '../middleware/auth.js';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'), requireModule('CRM'));

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };

// Pull churned leads enriched with churn date, stage-at-loss, competitor & reactivation (DealFields).
async function getChurnedLeads(orgId: string, q: Record<string, string>) {
  const where: any = { organizationId: orgId, stage: 'CHURNED' };
  if (q.salesperson) where.assignedToId = q.salesperson;
  if (q.industry) where.industry = q.industry;
  if (q.minValue || q.maxValue) where.dealValue = { ...(q.minValue ? { gte: Number(q.minValue) } : {}), ...(q.maxValue ? { lte: Number(q.maxValue) } : {}) };

  const leads = await prisma.lead.findMany({
    where,
    select: {
      id: true, leadId: true, companyName: true, contactName: true, lostReason: true, dealValue: true, industry: true,
      assignedToId: true, updatedAt: true,
      assignedTo: { select: { name: true } },
      dealFields: { where: { fieldKey: { in: ['competitorChosen', 'reactivationPotential'] } }, select: { fieldKey: true, fieldValue: true } },
      stageHistory: { where: { toStage: 'CHURNED' }, orderBy: { changedAt: 'desc' }, take: 1, select: { fromStage: true, changedAt: true } },
    },
  });

  const from = q.from ? new Date(q.from) : null;
  const to = q.to ? new Date(q.to + 'T23:59:59') : null;

  return leads.map((l) => {
    const df: Record<string, string | null> = {};
    for (const f of l.dealFields) df[f.fieldKey] = f.fieldValue;
    const churnDate = l.stageHistory[0]?.changedAt || l.updatedAt;
    return {
      id: l.id, leadId: l.leadId, name: l.companyName || l.contactName || 'Lead', lostReason: l.lostReason,
      value: Number(l.dealValue) || 0, industry: l.industry || null, assignedTo: l.assignedTo?.name || null, assignedToId: l.assignedToId,
      competitor: df.competitorChosen || null, reactivation: df.reactivationPotential || null,
      stageAtLoss: l.stageHistory[0]?.fromStage || null, churnDate,
    };
  }).filter((l) => (!from || l.churnDate >= from) && (!to || l.churnDate <= to) && (!q.stage || l.stageAtLoss === q.stage));
}

function reactivationWindow(churnDate: Date, reactivation: string | null): Date | null {
  if (!reactivation) return null;
  if (/3\s*month/i.test(reactivation)) return addMonths(new Date(churnDate), 3);
  if (/6\s*month/i.test(reactivation)) return addMonths(new Date(churnDate), 6);
  return null;
}

// GET /api/analytics/lost-deals — all sections.
analyticsRouter.get('/lost-deals', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const q = req.query as Record<string, string>;
    const churned = await getChurnedLeads(orgId, q);
    const total = churned.length;

    // Section 1 — loss by reason
    const byReason: Record<string, number> = {};
    for (const l of churned) { const k = l.lostReason || 'UNKNOWN'; byReason[k] = (byReason[k] || 0) + 1; }
    const lossByReason = Object.entries(byReason).map(([reason, count]) => ({ reason, count, pct: total ? Math.round((count / total) * 100) : 0 })).sort((a, b) => b.count - a.count);

    // Section 2 — loss by stage (count + avg deal value lost)
    const stageAgg: Record<string, { count: number; sum: number }> = {};
    for (const l of churned) { const k = l.stageAtLoss || 'UNKNOWN'; const a = stageAgg[k] || { count: 0, sum: 0 }; a.count++; a.sum += l.value; stageAgg[k] = a; }
    const lossByStage = Object.entries(stageAgg).map(([stage, a]) => ({ stage, count: a.count, avgValue: a.count ? Math.round(a.sum / a.count) : 0 })).sort((a, b) => b.count - a.count);

    // Section 3 — competitors
    const compAgg: Record<string, { count: number; sum: number; verticals: Set<string> }> = {};
    for (const l of churned) { if (!l.competitor) continue; const a = compAgg[l.competitor] || { count: 0, sum: 0, verticals: new Set<string>() }; a.count++; a.sum += l.value; if (l.industry) a.verticals.add(l.industry); compAgg[l.competitor] = a; }
    const competitors = Object.entries(compAgg).map(([competitor, a]) => ({ competitor, count: a.count, avgValue: a.count ? Math.round(a.sum / a.count) : 0, verticals: [...a.verticals] })).sort((a, b) => b.count - a.count);

    // Section 4 — reactivation pipeline
    const reactivation = churned
      .map((l) => ({ id: l.id, name: l.name, lostDate: l.churnDate, window: reactivationWindow(l.churnDate, l.reactivation), value: l.value, assignedTo: l.assignedTo }))
      .filter((l) => l.window)
      .sort((a, b) => +new Date(a.window!) - +new Date(b.window!));

    // Section 5 — loss vs won over time (by month)
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to + 'T23:59:59') : undefined;
    const wonRows = await prisma.stageHistory.findMany({ where: { toStage: 'CONTRACT', lead: { organizationId: orgId }, ...(from || to ? { changedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, select: { leadId: true, changedAt: true }, orderBy: { changedAt: 'asc' } });
    // Count each lead's win ONCE (first CONTRACT in range) — a lead bounced back-and-forth must not inflate wins.
    const wonFirst = new Map<string, Date>();
    for (const w of wonRows) if (!wonFirst.has(w.leadId)) wonFirst.set(w.leadId, w.changedAt);
    const trend: Record<string, { lost: number; won: number }> = {};
    for (const l of churned) { const k = monthKey(new Date(l.churnDate)); (trend[k] ||= { lost: 0, won: 0 }).lost++; }
    for (const changedAt of wonFirst.values()) { const k = monthKey(new Date(changedAt)); (trend[k] ||= { lost: 0, won: 0 }).won++; }
    const lossOverTime = Object.entries(trend).map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));

    res.json({ total, lossByReason, lossByStage, competitors, reactivation, lossOverTime });
  } catch (error) { next(error); }
});

// GET /api/analytics/lost-deals/reactivation
analyticsRouter.get('/lost-deals/reactivation', async (req: AuthRequest, res: Response, next) => {
  try {
    const churned = await getChurnedLeads(req.user!.organizationId, req.query as Record<string, string>);
    const reactivation = churned
      .map((l) => ({ id: l.id, name: l.name, lostDate: l.churnDate, window: reactivationWindow(l.churnDate, l.reactivation), value: l.value, assignedTo: l.assignedTo }))
      .filter((l) => l.window).sort((a, b) => +new Date(a.window!) - +new Date(b.window!));
    res.json(reactivation);
  } catch (error) { next(error); }
});

// GET /api/analytics/lost-deals/competitors
analyticsRouter.get('/lost-deals/competitors', async (req: AuthRequest, res: Response, next) => {
  try {
    const churned = await getChurnedLeads(req.user!.organizationId, req.query as Record<string, string>);
    const compAgg: Record<string, { count: number; sum: number; verticals: Set<string> }> = {};
    for (const l of churned) { if (!l.competitor) continue; const a = compAgg[l.competitor] || { count: 0, sum: 0, verticals: new Set<string>() }; a.count++; a.sum += l.value; if (l.industry) a.verticals.add(l.industry); compAgg[l.competitor] = a; }
    res.json(Object.entries(compAgg).map(([competitor, a]) => ({ competitor, count: a.count, avgValue: a.count ? Math.round(a.sum / a.count) : 0, verticals: [...a.verticals] })).sort((a, b) => b.count - a.count));
  } catch (error) { next(error); }
});

export default analyticsRouter;
