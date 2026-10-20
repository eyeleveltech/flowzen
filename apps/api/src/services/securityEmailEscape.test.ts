import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { escapeHtml, safeHref } from '../utils/html.js';

/**
 * Security fixes plan, H3 and H4: HTML in what people type must arrive in an
 * email as text. A calendar event titled `<b>x</b><img src=x>` went out to
 * every attendee as markup — an image fetched from wherever the title said,
 * from the studio's own mail account. The morning digest did the same with
 * each alert's message.
 */

const sent: { to: string; subject: string; html: string }[] = [];
vi.mock('../utils/mailer.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/mailer.js')>()),
  sendMail: vi.fn(async (_org: string, m: { to: string; subject: string; html: string }) => {
    sent.push(m);
  }),
}));
vi.mock('./push.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./push.js')>()),
  pushCalendarChange: vi.fn(async () => undefined),
}));

const p = prisma as any;
const NASTY = '<b>x</b><img src=x>';

beforeEach(() => {
  sent.length = 0;
});

describe('the helper', () => {
  it('escapes every character that can open markup', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    expect(escapeHtml(null)).toBe('');
  });

  it('lets only http(s) links into an href', () => {
    expect(safeHref('https://drive.google.com/x?a=1&b=2')).toBe('https://drive.google.com/x?a=1&amp;b=2');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
  });
});

describe('H3: the calendar email', () => {
  it('sends an event titled with markup as plain text', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'usr-shyam', name: '<i>Shyam</i> K', email: 'shyam@x' }]);
    p.activity.create.mockResolvedValue({});
    p.alert.updateMany.mockResolvedValue({ count: 0 });
    p.alert.create.mockResolvedValue({ id: 'al-1' });
    p.alertRead.createMany?.mockResolvedValue?.({ count: 0 });
    const { afterEventSaved } = await import('./calendarEvents.js');
    await afterEventSaved({
      organizationId: 'org-1',
      actor: { id: 'usr-ramya', name: 'Ramya <script>' },
      before: null,
      after: {
        id: 'ev-1',
        title: NASTY,
        startsAt: new Date('2026-10-20T05:00:00Z'),
        endsAt: new Date('2026-10-20T06:00:00Z'),
        allDay: false,
        location: '<img src=https://evil.example/p.png>',
        createdBy: { id: 'usr-ramya', name: 'Ramya <script>' },
        attendeeIds: ['usr-shyam'],
      },
      timezone: 'Asia/Kolkata',
    });
    expect(sent).toHaveLength(1);
    const { html } = sent[0];
    expect(html).not.toMatch(/<img|<b>|<script|<i>/);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;&lt;img src=x&gt;');
    expect(html).toContain('&lt;i&gt;Shyam&lt;/i&gt;');
  });
});

describe('H4: the morning digest', () => {
  it('sends each alert’s message as plain text', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 08:00 in Chennai, when the digest goes.
    const now = new Date('2026-10-20T02:30:00Z');
    vi.setSystemTime(now);
    try {
      p.user.findMany.mockResolvedValue([
        { id: 'usr-boss', name: '<u>Akmal</u>', email: 'akmal@x', preset: 'MANAGEMENT', permissions: [], organizationId: 'org-1' },
      ]);
      p.activity.findFirst.mockResolvedValue(null);
      p.activity.create.mockResolvedValue({});
      p.alert.findMany.mockResolvedValue([{ id: 'a1', rule: 'TASK_OVERDUE', message: `Task ${NASTY} is overdue`, severity: 'HIGH', entityType: 'Task' }]);
      p.alertRead.findMany?.mockResolvedValue?.([]);
      p.department.findMany.mockResolvedValue([]);
      p.task.findMany.mockResolvedValue([]);
      p.taskApprover.findMany.mockResolvedValue([]);
      p.approvalEscalationContact.findMany.mockResolvedValue([]);
      p.taskReview.findMany?.mockResolvedValue?.([]);
      const { sendAlertDigests } = await import('../workers/alertDigest.cron.js');
      await sendAlertDigests(now);
    } finally {
      vi.useRealTimers();
    }
    expect(sent.length).toBeGreaterThan(0);
    const { html } = sent[0];
    expect(html).not.toMatch(/<img|<b>x|<u>/);
    expect(html).toContain('Task &lt;b&gt;x&lt;/b&gt;&lt;img src=x&gt; is overdue');
    expect(html).toContain('&lt;u&gt;Akmal&lt;/u&gt;');
  });
});
