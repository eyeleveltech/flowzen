import { prisma } from '../lib/prisma.js';
import { NotificationService } from './notifications.js';
import { logActivity, ActivityType } from './activity.service.js';
import { logger } from '../utils/logger.js';

// Module F — daily scanners: follow-up due/overdue, stale leads, and the morning digest.

const DEFAULT_STALE: Record<string, number> = { OUTREACH: 5, MEETING: 7, PROPOSAL: 7, NEGOTIATION: 5, CONTRACT: 3 };
const ACTIVE_STAGES = ['OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT'];
// Renewal alert brackets (days before end). We fire the current bracket a lead has crossed
// into (smallest threshold >= days-remaining), so a missed cron day still alerts — once per bracket.
const RENEWAL_MILESTONES: { d: number; label: string }[] = [{ d: 60, label: '60d' }, { d: 30, label: '30d' }, { d: 7, label: '7d' }, { d: 0, label: 'day' }];

// Day boundaries are computed in IST (the business timezone the cron runs on), independent
// of the server's local timezone — otherwise a UTC VPS shifts every "due today" boundary by 5h30m.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const istDayIndex = (d: Date) => Math.floor((d.getTime() + IST_OFFSET_MS) / 86400000);
const startOfDay = (d = new Date()) => new Date(istDayIndex(d) * 86400000 - IST_OFFSET_MS);
const endOfDay = (d = new Date()) => new Date((istDayIndex(d) + 1) * 86400000 - IST_OFFSET_MS - 1);
const daysBetween = (a: Date, b: Date) => istDayIndex(a) - istDayIndex(b);
const prefOn = (user: any, key: string) => ((user?.settings as any)?.notifications?.[key]) !== false;
const leadName = (l: any) => l.companyName || l.contactName || 'Lead';

// Activities that count as actually contacting the lead (for "already followed up").
const CONTACT_ACTIVITY_TYPES = ['CALL_LOGGED', 'EMAIL_LOGGED', 'MEETING_LOGGED', 'MESSAGE_SENT'];

// Most-recent activity timestamp per lead. Pass `types` to restrict to specific activity types.
async function lastActivityMap(leadIds: string[], types?: string[]): Promise<Map<string, Date>> {
  if (!leadIds.length) return new Map();
  const where: any = { leadId: { in: leadIds } };
  if (types) where.type = { in: types };
  const rows = await prisma.activity.groupBy({ by: ['leadId'], where, _max: { createdAt: true } });
  const m = new Map<string, Date>();
  for (const r of rows) if (r.leadId && r._max.createdAt) m.set(r.leadId, r._max.createdAt);
  return m;
}

async function orgThresholdsMap(orgIds: string[]): Promise<Map<string, Record<string, number>>> {
  const orgs = await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, settings: true } });
  const m = new Map<string, Record<string, number>>();
  for (const o of orgs) {
    const custom = ((o.settings as any)?.staleThresholds) || {};
    m.set(o.id, { ...DEFAULT_STALE, ...custom });
  }
  return m;
}

// ── Cron 1: follow-up due / overdue ─────────────────────────────────────────
export async function runFollowUpScan(): Promise<number> {
  const today = new Date();
  const leads = await prisma.lead.findMany({
    where: { followUpDate: { lte: endOfDay(today) }, stage: { not: 'CHURNED' }, assignedToId: { not: null } },
    select: { id: true, followUpDate: true, assignedToId: true, organizationId: true, companyName: true, contactName: true, stage: true },
  });
  if (!leads.length) return 0;

  const lastAct = await lastActivityMap(leads.map((l) => l.id), CONTACT_ACTIVITY_TYPES);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(leads.map((l) => l.assignedToId!))] } }, select: { id: true, settings: true } });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Dedup against notifications already created today.
  const todays = await prisma.notification.findMany({ where: { type: { in: ['FOLLOW_UP_DUE', 'FOLLOW_UP_OVERDUE'] }, createdAt: { gte: startOfDay(today) } }, select: { userId: true, type: true, metadata: true } });
  const seen = new Set(todays.map((n) => `${n.userId}:${(n.metadata as any)?.leadId}:${n.type}`));

  let sent = 0;
  for (const l of leads) {
    if (!l.followUpDate) continue;
    const la = lastAct.get(l.id);
    if (la && la > l.followUpDate) continue; // already followed up

    const overdueDays = daysBetween(today, l.followUpDate);
    const type = overdueDays > 0 ? 'FOLLOW_UP_OVERDUE' : 'FOLLOW_UP_DUE';
    const user = userMap.get(l.assignedToId!);
    if (!prefOn(user, 'followUpDue')) continue;

    const lastTxt = la ? `Last contacted ${daysBetween(today, la)} days ago.` : 'Not contacted yet.';
    const base = `${leadName(l)} — ${l.stage.replace(/_/g, ' ')}. ${lastTxt}`;
    const msg = type === 'FOLLOW_UP_DUE' ? `Follow-up due today: ${base}` : `Follow-up overdue by ${overdueDays} day(s): ${base}`;

    // In-app alert goes to the assigned salesperson only. Admin/founder oversight is delivered
    // via the daily business CRM email (settings.crmNotificationEmail), not individual bells.
    const key = `${l.assignedToId}:${l.id}:${type}`;
    if (!seen.has(key)) { await NotificationService.send({ userId: l.assignedToId!, type: type as any, message: msg, metadata: { leadId: l.id } }); seen.add(key); sent++; }
  }
  if (sent) logger.info(`[Scanner] follow-up notifications sent: ${sent}`);
  return sent;
}

// ── Cron 2: stale leads ─────────────────────────────────────────────────────
export async function runStaleLeadScan(): Promise<number> {
  const today = new Date();
  const leads = await prisma.lead.findMany({
    where: { stage: { in: ACTIVE_STAGES as any }, assignedToId: { not: null } },
    select: { id: true, assignedToId: true, organizationId: true, companyName: true, contactName: true, stage: true, updatedAt: true, createdAt: true },
  });
  if (!leads.length) return 0;

  const lastAct = await lastActivityMap(leads.map((l) => l.id));
  const thresholds = await orgThresholdsMap([...new Set(leads.map((l) => l.organizationId))]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(leads.map((l) => l.assignedToId!))] } }, select: { id: true, settings: true } });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const todays = await prisma.notification.findMany({ where: { type: 'STALE_LEAD', createdAt: { gte: startOfDay(today) } }, select: { userId: true, metadata: true } });
  const seen = new Set(todays.map((n) => `${n.userId}:${(n.metadata as any)?.leadId}`));

  let sent = 0;
  for (const l of leads) {
    const ref = lastAct.get(l.id) || l.createdAt;
    const idle = daysBetween(today, ref);
    const limit = (thresholds.get(l.organizationId) || DEFAULT_STALE)[l.stage] ?? 7;
    if (idle <= limit) continue;

    const user = userMap.get(l.assignedToId!);
    if (!prefOn(user, 'staleLead')) continue;

    const key = `${l.assignedToId}:${l.id}`;
    if (seen.has(key)) continue;
    await NotificationService.send({ userId: l.assignedToId!, type: 'STALE_LEAD' as any, message: `No activity on ${leadName(l)} for ${idle} days. Still in ${l.stage.replace(/_/g, ' ')}. Action needed.`, metadata: { leadId: l.id } });
    seen.add(key); sent++;
  }
  if (sent) logger.info(`[Scanner] stale-lead notifications sent: ${sent}`);
  return sent;
}

// ── Cron 3: daily digest email ──────────────────────────────────────────────
export async function sendDailyDigests(): Promise<number> {
  const today = new Date();
  const users = await prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, email: true, name: true, settings: true, organizationId: true } });
  const thresholds = await orgThresholdsMap([...new Set(users.map((u) => u.organizationId))]);
  let sent = 0;

  for (const u of users) {
    if (!prefOn(u, 'dailyDigest') || !u.email) continue;
    const myLeads = await prisma.lead.findMany({ where: { assignedToId: u.id, stage: { notIn: ['CHURNED', 'PROJECT_COMPLETED'] } }, select: { id: true, companyName: true, contactName: true, stage: true, followUpDate: true, updatedAt: true, createdAt: true } });
    if (!myLeads.length) continue;

    const dueToday: any[] = [], overdue: any[] = [];
    for (const l of myLeads) if (l.followUpDate) { const dd = daysBetween(today, l.followUpDate); if (dd === 0) dueToday.push(l); else if (dd > 0) overdue.push({ ...l, dd }); }

    const activeLeads = myLeads.filter((l) => ACTIVE_STAGES.includes(l.stage));
    const lastAct = await lastActivityMap(activeLeads.map((l) => l.id));
    const th = thresholds.get(u.organizationId) || DEFAULT_STALE;
    const stale = activeLeads.filter((l) => { const ref = lastAct.get(l.id) || l.createdAt; return daysBetween(today, ref) > (th[l.stage] ?? 7); });

    if (!dueToday.length && !overdue.length && !stale.length) continue;

    const section = (title: string, rows: string[]) => rows.length ? `<h3 style="margin:18px 0 6px;font-size:14px;color:#163027">${title}</h3><ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.7">${rows.join('')}</ul>` : '';
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
      <h2 style="color:#163027">Good morning, ${u.name.split(' ')[0]}</h2>
      <p style="color:#6B7280;font-size:13px">Here's your pipeline for ${today.toDateString()}.</p>
      ${section('Follow-ups due today', dueToday.map((l) => `<li>${leadName(l)} — ${l.stage.replace(/_/g, ' ')}</li>`))}
      ${section('Overdue follow-ups', overdue.map((l) => `<li>${leadName(l)} — overdue ${l.dd} day(s)</li>`))}
      ${section('Stale leads', stale.map((l) => `<li>${leadName(l)} — ${l.stage.replace(/_/g, ' ')}</li>`))}
      <p style="margin-top:24px"><a href="${process.env.NEXT_PUBLIC_APP_URL || ''}/pipeline" style="background:#163027;color:#E2FEA5;padding:10px 18px;text-decoration:none;border-radius:8px;font-size:13px">Open Pipeline</a></p>
    </div>`;
    await NotificationService.sendEmail({ to: u.email, subject: `Your Flowzen daily digest — ${today.toLocaleDateString('en-IN')}`, html });
    sent++;
  }
  if (sent) logger.info(`[Scanner] daily digests sent: ${sent}`);
  return sent;
}

// ── Module K: renewal alerts (60 / 30 / 7 / day-of) + auto-renew ─────────────
export async function runRenewalScan(): Promise<number> {
  const today = new Date();
  const leads = await prisma.lead.findMany({
    where: { stage: 'ACTIVE_RETAINER', contractEndDate: { not: null }, renewalStatus: { not: 'CHURNED' } },
    select: { id: true, assignedToId: true, organizationId: true, companyName: true, contactName: true, dealValue: true, contractStartDate: true, contractEndDate: true, autoRenewal: true, renewalStatus: true },
  });
  if (!leads.length) return 0;

  // Look back across the whole countdown (not just today) so each bracket fires at most once,
  // even if a daily run was skipped.
  const since = new Date(today.getTime() - 120 * 86400000);
  const prior = await prisma.notification.findMany({ where: { type: 'RENEWAL_DUE', createdAt: { gte: since } }, select: { userId: true, metadata: true } });
  const sentEver = new Set(prior.map((n) => `${n.userId}:${(n.metadata as any)?.leadId}:${(n.metadata as any)?.milestone}`));

  let sent = 0;
  for (const l of leads) {
    const end = new Date(l.contractEndDate!);
    const days = daysBetween(end, today);

    // Auto-renew: on/after end date, extend by the original term (or a 1-year default when the
    // start date is unknown — never let an auto-renew contract silently expire) and log it.
    if (l.autoRenewal) {
      if (days <= 0) {
        const dur = l.contractStartDate ? end.getTime() - new Date(l.contractStartDate).getTime() : 365 * 86400000;
        const newEnd = new Date(end.getTime() + Math.max(dur, 30 * 86400000));
        await prisma.lead.update({ where: { id: l.id }, data: { contractStartDate: end, contractEndDate: newEnd, renewalStatus: 'RENEWED' } });
        if (l.assignedToId) await logActivity({ leadId: l.id, type: ActivityType.STATUS_CHANGED, message: `auto-renewed the retainer to ${newEnd.toLocaleDateString('en-IN')}`, userId: l.assignedToId });
      }
      continue;
    }

    // Fire the current bracket the lead has crossed into (smallest threshold >= days remaining).
    const bracket = RENEWAL_MILESTONES.filter((m) => m.d >= days).sort((a, b) => a.d - b.d)[0];
    if (!bracket) continue; // more than 60 days out — too early
    const milestone = bracket.label;

    const msg = `Renewal due in ${Math.max(days, 0)} day(s): ${leadName(l)} — ₹${(Number(l.dealValue) || 0).toLocaleString('en-IN')}/mo. End date: ${end.toLocaleDateString('en-IN')}. Status: ${(l.renewalStatus || 'UPCOMING').replace(/_/g, ' ')}.`;
    // Assigned salesperson only — admins get renewals via the daily business CRM email.
    if (!l.assignedToId) continue;
    const key = `${l.assignedToId}:${l.id}:${milestone}`;
    if (sentEver.has(key)) continue;
    await NotificationService.send({ userId: l.assignedToId, type: 'RENEWAL_DUE' as any, message: msg, metadata: { leadId: l.id, milestone } });
    sentEver.add(key); sent++;
  }
  if (sent) logger.info(`[Scanner] renewal notifications sent: ${sent}`);
  return sent;
}

// ── Module L: reactivation auto-task ────────────────────────────────────────
// When a churned lead's reactivation window opens, create a task + notification for its owner.
export async function runReactivationScan(): Promise<number> {
  const today = new Date();
  const fields = await prisma.dealField.findMany({
    where: { fieldKey: 'reactivationPotential', fieldValue: { in: ['Yes - 3 months', 'Yes - 6 months'] }, lead: { stage: 'CHURNED' } },
    select: { fieldValue: true, lead: { select: { id: true, assignedToId: true, companyName: true, contactName: true, updatedAt: true, stageHistory: { where: { toStage: 'CHURNED' }, orderBy: { changedAt: 'desc' }, take: 1, select: { changedAt: true } } } } },
  });
  if (!fields.length) return 0;

  const leadIds = fields.map((f) => f.lead.id);
  const existing = await prisma.task.findMany({ where: { leadId: { in: leadIds }, title: { startsWith: 'Reactivation due' } }, select: { leadId: true } });
  const done = new Set(existing.map((t) => t.leadId));

  let created = 0;
  for (const f of fields) {
    const l = f.lead;
    if (done.has(l.id)) continue;
    const churn = l.stageHistory[0]?.changedAt || l.updatedAt;
    const months = /6/.test(f.fieldValue || '') ? 6 : 3;
    const windowDate = new Date(churn); windowDate.setMonth(windowDate.getMonth() + months);
    if (startOfDay(windowDate) > startOfDay(today)) continue; // window not open yet

    const who = l.companyName || l.contactName || 'this lead';
    await prisma.task.create({ data: { title: `Reactivation due — reach out to ${who}`, description: 'The reactivation window has opened for this previously churned lead.', leadId: l.id, assigneeId: l.assignedToId || undefined, type: 'OTHER', status: 'TODO', dueDate: today } });
    if (l.assignedToId) await NotificationService.send({ userId: l.assignedToId, type: 'REACTIVATION_DUE' as any, message: `Reactivation due — reach out to ${who}.`, metadata: { leadId: l.id } });
    done.add(l.id); created++;
  }
  if (created) logger.info(`[Scanner] reactivation tasks created: ${created}`);
  return created;
}

// ── Business email: one daily Sales & CRM summary per org to the configured address ─────────
function buildOrgDigestHtml(orgName: string, d: any, today: Date): string {
  const inr = (n: any) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
  const section = (title: string, rows: string[]) => rows.length
    ? `<h3 style="margin:18px 0 6px;font-size:14px;color:#163027">${title} (${rows.length})</h3><ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.7">${rows.join('')}</ul>`
    : '';
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
    <h2 style="color:#163027">${orgName} — Sales & CRM Daily Summary</h2>
    <p style="color:#6B7280;font-size:13px">${today.toDateString()}</p>
    ${section('Follow-ups due / overdue', d.followUps.map((l: any) => `<li>${l.name} — ${l.stage.replace(/_/g, ' ')}${l.days > 0 ? ` · overdue ${l.days}d` : ''}${l.owner ? ` · ${l.owner}` : ''}</li>`))}
    ${section('Stale leads', d.stale.map((l: any) => `<li>${l.name} — ${l.stage.replace(/_/g, ' ')} · idle ${l.idle}d${l.owner ? ` · ${l.owner}` : ''}</li>`))}
    ${section('Renewals due (≤60 days)', d.renewals.map((r: any) => `<li>${r.name} — ${r.days <= 0 ? 'due now' : `in ${r.days}d`} · ${inr(r.value)}/mo · ${String(r.status).replace(/_/g, ' ')}${r.owner ? ` · ${r.owner}` : ''}</li>`))}
    ${section('Reactivations (window open)', d.reactivations.map((r: any) => `<li>${r.name} — opened ${r.window.toLocaleDateString('en-IN')}${r.owner ? ` · ${r.owner}` : ''}</li>`))}
    <p style="margin-top:24px"><a href="${process.env.NEXT_PUBLIC_APP_URL || ''}/pipeline" style="background:#163027;color:#E2FEA5;padding:10px 18px;text-decoration:none;border-radius:8px;font-size:13px">Open Flowzen</a></p>
  </div>`;
}

export async function sendOrgCrmDigest(): Promise<number> {
  const today = new Date();
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, settings: true } });
  let sent = 0;

  for (const org of orgs) {
    const raw = String((org.settings as any)?.crmNotificationEmail || '').trim();
    if (!raw) continue;
    const recipients = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!recipients.length) continue;

    // Follow-ups due/overdue (excluding leads already followed up after the date).
    const fu = await prisma.lead.findMany({ where: { organizationId: org.id, followUpDate: { lte: endOfDay(today) }, stage: { not: 'CHURNED' } }, select: { id: true, companyName: true, contactName: true, stage: true, followUpDate: true, assignedTo: { select: { name: true } } } });
    const fuContact = await lastActivityMap(fu.map((l) => l.id), CONTACT_ACTIVITY_TYPES);
    const followUps = fu
      .filter((l) => !(fuContact.get(l.id) && l.followUpDate && fuContact.get(l.id)! > l.followUpDate))
      .map((l) => ({ name: leadName(l), stage: l.stage, owner: l.assignedTo?.name, days: daysBetween(today, l.followUpDate!) }));

    // Stale leads.
    const th = (await orgThresholdsMap([org.id])).get(org.id) || DEFAULT_STALE;
    const activeLeads = await prisma.lead.findMany({ where: { organizationId: org.id, stage: { in: ACTIVE_STAGES as any } }, select: { id: true, companyName: true, contactName: true, stage: true, createdAt: true, assignedTo: { select: { name: true } } } });
    const staleAct = await lastActivityMap(activeLeads.map((l) => l.id));
    const stale = activeLeads
      .map((l) => ({ name: leadName(l), stage: l.stage, owner: l.assignedTo?.name, idle: daysBetween(today, staleAct.get(l.id) || l.createdAt) }))
      .filter((l) => l.idle > (th[l.stage] ?? 7));

    // Renewals within 60 days.
    const ren = await prisma.lead.findMany({ where: { organizationId: org.id, stage: 'ACTIVE_RETAINER', contractEndDate: { not: null }, renewalStatus: { not: 'CHURNED' } }, select: { companyName: true, contactName: true, dealValue: true, contractEndDate: true, renewalStatus: true, assignedTo: { select: { name: true } } } });
    const renewals = ren
      .map((l) => ({ name: leadName(l), days: daysBetween(new Date(l.contractEndDate!), today), value: Number(l.dealValue) || 0, status: l.renewalStatus || 'UPCOMING', owner: l.assignedTo?.name }))
      .filter((r) => r.days <= 60).sort((a, b) => a.days - b.days);

    // Reactivations whose window has opened.
    const rfields = await prisma.dealField.findMany({
      where: { fieldKey: 'reactivationPotential', fieldValue: { in: ['Yes - 3 months', 'Yes - 6 months'] }, lead: { stage: 'CHURNED', organizationId: org.id } },
      select: { fieldValue: true, lead: { select: { id: true, companyName: true, contactName: true, updatedAt: true, assignedTo: { select: { name: true } }, stageHistory: { where: { toStage: 'CHURNED' }, orderBy: { changedAt: 'desc' }, take: 1, select: { changedAt: true } } } } },
    });
    const reactivations = rfields
      .map((f) => { const l = f.lead; const churn = l.stageHistory[0]?.changedAt || l.updatedAt; const w = new Date(churn); w.setMonth(w.getMonth() + (/6/.test(f.fieldValue || '') ? 6 : 3)); return { name: leadName(l), window: w, owner: l.assignedTo?.name }; })
      .filter((r) => startOfDay(r.window) <= startOfDay(today));

    if (!followUps.length && !stale.length && !renewals.length && !reactivations.length) continue;

    const html = buildOrgDigestHtml(org.name, { followUps, stale, renewals, reactivations }, today);
    for (const to of recipients) await NotificationService.sendEmail({ to, subject: `Sales & CRM — Daily Summary (${today.toLocaleDateString('en-IN')})`, html });
    sent++;
  }
  if (sent) logger.info(`[Scanner] org CRM digests sent: ${sent}`);
  return sent;
}

// Orchestrator — runs all daily jobs. Returns counts (handy for the manual trigger).
export async function runDailyNotificationJobs() {
  const followUps = await runFollowUpScan().catch((e) => { logger.error('[Scanner] follow-up scan failed', e); return 0; });
  const stale = await runStaleLeadScan().catch((e) => { logger.error('[Scanner] stale scan failed', e); return 0; });
  const renewals = await runRenewalScan().catch((e) => { logger.error('[Scanner] renewal scan failed', e); return 0; });
  const reactivations = await runReactivationScan().catch((e) => { logger.error('[Scanner] reactivation scan failed', e); return 0; });
  const digests = await sendDailyDigests().catch((e) => { logger.error('[Scanner] digest failed', e); return 0; });
  const orgDigests = await sendOrgCrmDigest().catch((e) => { logger.error('[Scanner] org CRM digest failed', e); return 0; });
  return { followUps, stale, renewals, reactivations, digests, orgDigests };
}
