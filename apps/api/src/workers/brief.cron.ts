import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { sendMail } from '../utils/mailer.js';
import { hasPermission } from '../middleware/auth.js';
import { composeMondayBrief } from '../routes/brief.js';
import type { RolePreset, PermissionKey } from '@flowzen/shared';

const fmtINR = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

function renderBriefHtml(orgName: string, brief: Awaited<ReturnType<typeof composeMondayBrief>>): string {
  const { contractRisks, pipelineMomentum, accountsReceivable, teamCapacity } = brief.quadrants;
  const section = (title: string, lines: string[]) =>
    lines.length === 0
      ? `<h3>${title}</h3><p style="color:#666">Nothing to flag.</p>`
      : `<h3>${title}</h3><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
      <h2>${orgName} — Monday brief</h2>
      <p style="color:#666">${new Date(brief.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      ${section('Contract risk', contractRisks.items.map((r) => r.message + ` — ${r.companyName}`))}
      ${section('Pipeline — waiting on you', [...pipelineMomentum.verbalYesPending, ...pipelineMomentum.stalledProposals].map((p) => p.message + ` — ${p.companyName}`))}
      ${section('Money owed', accountsReceivable.overdue60.concat(accountsReceivable.overdue30).map((i) => `${i.number} for ${i.companyName}, ${fmtINR(i.balance)}, ${i.daysOverdue}d overdue`))}
      ${accountsReceivable.totalOverdueAmount > 0 ? `<p><b>Total overdue: ${fmtINR(accountsReceivable.totalOverdueAmount)}</b></p>` : ''}
      ${section('Team', teamCapacity.bottlenecks.map((b) => b.message))}
      <p style="color:#999;font-size:12px;margin-top:24px">Computed straight from Flowzen — open the app for the live numbers.</p>
    </div>
  `;
}

/**
 * §13: "07:00 Monday — Compose the Monday brief and mail it to users with
 * reports.read." The brief itself was already fully real and computed —
 * only on demand, when someone opened the screen. Nothing ever mailed it.
 */
export async function sendMondayBriefs(): Promise<{ sent: number }> {
  const now = new Date();
  if (now.getDay() !== 1) return { sent: 0 }; // Monday only

  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  let sent = 0;

  for (const org of orgs) {
    try {
      const alreadySentThisWeek = await prisma.activity.findFirst({
        where: { organizationId: org.id, entityType: 'Organization', entityId: org.id, verb: 'monday_brief_mailed', at: { gte: weekStart } },
      });
      if (alreadySentThisWeek) continue;

      const users = await prisma.user.findMany({
        where: { organizationId: org.id, active: true },
        select: { id: true, email: true, name: true, preset: true, permissions: true, active: true, organizationId: true },
      });
      const recipients = users.filter((u) =>
        hasPermission(
          {
            userId: u.id,
            organizationId: u.organizationId,
            email: u.email,
            name: u.name,
            preset: u.preset as RolePreset,
            permissions: u.permissions as PermissionKey[],
            active: u.active,
          },
          'reports.read',
        ),
      );
      if (recipients.length === 0) continue;

      const brief = await composeMondayBrief(org.id);
      const html = renderBriefHtml(org.name, brief);

      let delivered = 0;
      for (const user of recipients) {
        try {
          await sendMail(org.id, { to: user.email, subject: `${org.name} — Monday brief`, html });
          delivered++;
        } catch (mailErr) {
          logger.error(`Monday brief to ${user.email} failed: ${mailErr}`);
        }
      }

      await prisma.activity.create({
        data: {
          organizationId: org.id,
          entityType: 'Organization',
          entityId: org.id,
          actorId: null,
          verb: 'monday_brief_mailed',
          payload: { recipientCount: recipients.length, delivered },
        },
      });
      sent += delivered;
    } catch (err) {
      logger.error(`Monday brief error for org ${org.id}: ${err}`);
    }
  }

  return { sent };
}

/**
 * Polls hourly, like the other workers — the Monday-only + once-per-week
 * dedupe guard inside sendMondayBriefs means every other tick is a no-op.
 */
export function startMondayBriefScheduler(intervalMs = 3600000) {
  if (process.env.NODE_ENV !== 'test') {
    sendMondayBriefs().catch((e) => logger.error(`Monday brief scheduler error: ${e}`));
    setInterval(() => {
      sendMondayBriefs().catch((e) => logger.error(`Monday brief scheduler error: ${e}`));
    }, intervalMs);
  }
}
