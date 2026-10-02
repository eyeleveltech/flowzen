import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { sendMail } from '../utils/mailer.js';
import { hasPermission } from '../middleware/auth.js';
import { composeMondayBrief, type AlertRow, type MondayBrief } from '../routes/brief.js';
import { generateBriefSummary } from '../services/briefSummary.js';
import { weekdayOf } from '../utils/workCalendar.js';
import { dayStartUtc, localDayAndTime } from '../utils/zonedTime.js';
import type { RolePreset, PermissionKey } from '@flowzen/shared';

/** The first hourly tick at or after this, on a Monday in the studio's timezone, sends it (§13). */
const SEND_FROM = '07:00';
/** Needs action rows in the email; the rest are counted and left to the app. */
const EMAIL_ROWS = 10;

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "4 Oct" — spelled out, because en-GB's short September is "Sept". */
const shortDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

/** ▲ 12% / ▼ 5% / no change — against the week before, with a percentage only when that week had something. */
function change(last: number, before: number): string {
  if (last === before) return '<span style="color:#888">no change</span>';
  const up = last > before;
  const pct = before > 0 ? ` ${Math.round((Math.abs(last - before) / before) * 100)}%` : '';
  return `<span style="color:${up ? '#2f7a56' : '#a8402e'}">${up ? '▲' : '▼'}${pct}</span>`;
}

const minutesLabel = (m: number | null) =>
  m === null ? '—' : m < 60 ? `${m} min` : m < 60 * 8 ? `${Math.round((m / 60) * 10) / 10} h` : `${Math.round((m / 480) * 10) / 10} working days`;

/** The email: the same sections as the screen, every row a link into the app. */
export function renderBriefHtml(orgName: string, brief: MondayBrief, appUrl: string): string {
  const money = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: brief.currency, maximumFractionDigits: 0 }).format(n);
  const linked = (text: string, link: string | null) =>
    link ? `<a href="${esc(appUrl + link)}" style="color:#163027">${text}</a>` : text;
  const h3 = (t: string) => `<h3 style="margin:24px 0 8px;font-size:15px;color:#163027">${esc(t)}</h3>`;
  const muted = (t: string) => `<p style="color:#666;margin:4px 0">${t}</p>`;
  const s = brief.scoreboard;

  const tile = (label: string, value: string, delta: string, note = '') =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555">${esc(label)}</td><td style="padding:4px 12px 4px 0"><b>${value}</b>${note}</td><td style="padding:4px 0">${delta}</td></tr>`;
  const onTimePct = (t: { count: number; onTime: number }) => (t.count ? ` <span style="color:#666">(${Math.round((t.onTime / t.count) * 100)}% on time)</span>` : '');

  const scoreboard = `<table style="border-collapse:collapse;font-size:14px">
    ${tile('Cash collected', money(s.cashCollected.last), change(s.cashCollected.last, s.cashCollected.before))}
    ${tile('Invoiced', `${money(s.invoiced.last.amount)} · ${s.invoiced.last.count}`, change(s.invoiced.last.amount, s.invoiced.before.amount))}
    ${tile('Deals won', `${s.dealsWon.last.count} · ${money(s.dealsWon.last.value)}`, change(s.dealsWon.last.value, s.dealsWon.before.value))}
    ${tile('Proposals sent (incl. revisions)', String(s.proposalsSent.last), change(s.proposalsSent.last, s.proposalsSent.before))}
    ${tile('Tasks done', String(s.tasksDone.last.count), change(s.tasksDone.last.count, s.tasksDone.before.count), onTimePct(s.tasksDone.last))}
    ${s.approvals
      .map((a) =>
        tile(
          `Approvals · ${a.group}`,
          `typical ${minutesLabel(a.last.medianDecisionMinutes)} · ${a.last.escalated} escalated`,
          a.before ? change(a.last.decided, a.before.decided) : '',
          ` <span style="color:#666">(${a.last.decided} decided)</span>`,
        ),
      )
      .join('')}
  </table>`;

  const rowLine = (r: AlertRow) =>
    `<li style="margin:4px 0">${linked(`<b>${esc(r.clientName ?? '—')}</b> — ${esc(r.title)}`, r.link)}${
      r.amount !== undefined ? ` · ${money(r.amount)}` : ''
    }${r.ownerName ? ` · ${esc(r.ownerName)}` : ''} <span style="color:#888">· flagged ${r.flaggedDaysAgo === 0 ? 'today' : `${r.flaggedDaysAgo} d ago`}</span></li>`;

  // Needs action: the first ten rows, in their groups, then a count of the rest.
  let shown = 0;
  const total = brief.needsAction.reduce((n, g) => n + g.items.length, 0);
  const needsAction = total
    ? brief.needsAction
        .map((g) => {
          const room = Math.max(0, EMAIL_ROWS - shown);
          const rows = g.items.slice(0, room);
          shown += rows.length;
          return rows.length ? `<p style="margin:12px 0 4px;color:#555"><b>${esc(g.group)}</b></p><ul style="margin:0;padding-left:18px">${rows.map(rowLine).join('')}</ul>` : '';
        })
        .join('') + (total > shown ? muted(linked(`and ${total - shown} more in Flowzen`, '/brief')) : '')
    : muted('Nothing waiting on you.');

  const c = brief.comingUp;
  const list = (items: string[]) => `<ul style="margin:0;padding-left:18px">${items.map((i) => `<li style="margin:4px 0">${i}</li>`).join('')}</ul>`;
  const comingParts = [
    c.events.length
      ? `<p style="margin:12px 0 4px;color:#555"><b>Shoots and meetings</b></p>` +
        list(
          c.events.map((e) =>
            linked(
              esc([e.kind === 'SHOOT' ? 'Shoot' : 'Meeting', e.clientName ?? e.title, e.when, e.location, e.people.join(', ')].filter(Boolean).join(' · ')),
              e.link,
            ),
          ),
        )
      : '',
    c.invoicesDue.length
      ? `<p style="margin:12px 0 4px;color:#555"><b>Invoices due</b></p>` +
        list(c.invoicesDue.map((i) => linked(esc(`${i.clientName} · ${i.number} · ${money(i.balance)} · due ${shortDay(i.dueAt)}`), i.link)))
      : '',
    c.projectsEnding.length
      ? `<p style="margin:12px 0 4px;color:#555"><b>Projects ending</b></p>` +
        list(c.projectsEnding.map((p) => linked(esc(`${p.name} · ${p.clientName} · ends ${shortDay(p.endDate)} · ${p.ownerName}`), p.link)))
      : '',
    c.renewals.length
      ? `<p style="margin:12px 0 4px;color:#555"><b>Renewals</b></p>` +
        list(
          c.renewals.map((r) =>
            linked(
              esc(`${r.clientName} · renews ${r.renewalDate ? shortDay(r.renewalDate) : '—'} · ${money(r.monthlyValue)}/month${r.ownerName ? ` · ${r.ownerName}` : ''}`),
              r.link,
            ),
          ),
        )
      : '',
  ].join('');

  const risks = brief.risks.length
    ? brief.risks
        .map((g) => `<p style="margin:12px 0 4px;color:#555"><b>${esc(g.group)}</b></p><ul style="margin:0;padding-left:18px">${g.items.map(rowLine).join('')}</ul>`)
        .join('')
    : muted('No risks flagged.');

  const team = brief.team.length
    ? list(
        brief.team.map(
          (t) =>
            `<b>${esc(t.dept)}</b>: ${[
              `<span style="color:${t.overdue ? '#8a6117' : 'inherit'}">${t.overdue} overdue</span>`,
              `${t.active} active`,
              `${t.dueThisWeek} due this week`,
              `${t.doneLastWeek} done last week`,
              t.inReview ? `${t.inReview} in review` : '',
              t.waitingOnClient ? `${t.waitingOnClient} waiting on client` : '',
              t.overAllocatedPeople ? `${t.overAllocatedPeople} over-allocated` : '',
            ]
              .filter(Boolean)
              .join(', ')}`,
        ),
      )
    : muted('No open work.');

  return `
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;color:#1e4034;font-size:14px;line-height:1.5">
      <h2 style="margin:0 0 4px;color:#163027">${esc(orgName)} — Monday brief</h2>
      ${muted(`Week of ${esc(shortDay(brief.weeks.last.from))} – ${esc(shortDay(brief.weeks.last.to))}`)}
      ${brief.summary ? `<p style="margin:16px 0;padding:12px 14px;background:#f5f8f6;border-radius:8px">${esc(brief.summary.text)}</p>` : ''}
      ${h3('How last week went')}
      ${scoreboard}
      ${h3('Needs your action')}
      ${needsAction}
      ${h3('Coming up this week')}
      ${comingParts || muted('Nothing booked or due in the next seven days.')}
      ${h3('Risks')}
      ${risks}
      ${h3('Team by department')}
      ${team}
      ${brief.notUsingFlowzen ? `${h3(brief.notUsingFlowzen.title)}<p>${esc(brief.notUsingFlowzen.line)}</p>` : ''}
      <p style="color:#999;font-size:12px;margin-top:24px">Computed straight from Flowzen — ${linked('open the brief', '/brief')} for the live numbers.</p>
    </div>
  `;
}

/**
 * §13: "07:00 Monday — Compose the Monday brief and mail it to users with
 * reports.read." Monday 07:00 in the studio's own timezone, not the server's:
 * it used to go on the first tick after midnight Monday in server time.
 *
 * Compose, then write the summary (a failure is fine — the email goes without
 * it), then mail. Once a week per organisation, however often it is called.
 */
export async function sendMondayBriefs(now = new Date()): Promise<{ sent: number }> {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, timezone: true } });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
  let sent = 0;

  for (const org of orgs) {
    try {
      const tz = org.timezone || 'Asia/Kolkata';
      const here = localDayAndTime(now, tz);
      if (weekdayOf(here.date) !== 1 || here.time < SEND_FROM) continue;

      const alreadySentThisWeek = await prisma.activity.findFirst({
        where: {
          organizationId: org.id,
          entityType: 'Organization',
          entityId: org.id,
          verb: 'monday_brief_mailed',
          at: { gte: dayStartUtc(here.date, tz) },
        },
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

      // Who is not using Flowzen is Management's to see: the same brief, with
      // that block for them and without it for anybody else granted the brief.
      const composed = await composeMondayBrief(org.id, { includeUsage: true, now });
      const written = await generateBriefSummary(org.id, composed);
      const brief: MondayBrief = written
        ? { ...composed, summary: { text: written.text, generatedAt: written.generatedAt.toISOString(), model: written.model } }
        : composed;
      const forManagement = renderBriefHtml(org.name, brief, appUrl);
      const forOthers = renderBriefHtml(org.name, { ...brief, notUsingFlowzen: null }, appUrl);

      let delivered = 0;
      for (const user of recipients) {
        try {
          const html = user.preset === 'MANAGEMENT' ? forManagement : forOthers;
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
          payload: { recipientCount: recipients.length, delivered, summary: Boolean(written) },
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
 * Polls hourly, like the other workers — the Monday-07:00 + once-per-week
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
