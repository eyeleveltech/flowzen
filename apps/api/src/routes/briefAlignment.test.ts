import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';
import { calculateWorkingMinutes } from '../utils/workingHours.js';
import { hashPassword } from '../utils/password.js';
import { stageProbabilities, proposalProbability, BRIEF_STAGE_PROBABILITIES } from '../utils/stageProbability.js';
import { alertsForUser, sendAlertDigests } from '../workers/alertDigest.cron.js';

/**
 * Five things PROJECT_BRIEF.md specifies that the code did differently.
 *
 * They have one thing in common: each was wrong in a way nothing could notice.
 * A weighted figure computed off an unauthorised percentage still looks like a
 * number; a "days in stage" reset by an unrelated edit still counts days; a
 * status change with no audit row still changes the status. Nothing errors, so
 * only a test that knows what the brief says can hold them.
 */

const ADMIN = {
  id: 'usr-admin',
  preset: RolePreset.MANAGEMENT,
  permissions: ['work.own', 'work.all', 'money.status', 'money.figures', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write', 'reports.read', 'setup.admin'],
};

const auth = () =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: ADMIN.id,
      organizationId: 'org-1',
      email: 'admin@eyelevel.local',
      preset: ADMIN.preset,
      permissions: [...ADMIN.permissions],
    })}`,
  ] as const;

let written: { activity?: any; org?: any };

beforeEach(() => {
  written = {};
  (prisma.user.findUnique as any).mockResolvedValue({
    id: ADMIN.id,
    organizationId: 'org-1',
    name: 'Akmal',
    email: 'admin@eyelevel.local',
    preset: ADMIN.preset,
    permissions: [...ADMIN.permissions],
    active: true,
    sessionsValidFrom: null,
  });
  (prisma.activity.create as any).mockImplementation(async ({ data }: any) => {
    written.activity = data;
    return {};
  });
});

// ── §14 · Stage probabilities are a setting, with the brief's defaults ──────

describe('the stage probabilities', () => {
  it('uses the brief’s figures when no organisation is to hand', () => {
    // §14: Proposal sent 30, In negotiation 60, Proforma issued 85, Verbal yes 90.
    const p = stageProbabilities(null);
    expect(p.PROPOSAL_SENT).toBe(30);
    expect(p.IN_NEGOTIATION).toBe(60);
    expect(p.PROFORMA_ISSUED).toBe(85);
    expect(p.VERBAL_YES).toBe(90);
  });

  it('is none of the three tables the code used to carry', () => {
    // proposals.ts said 40/60/80/95 and forecast.ts said 30/60/80/90; the two
    // screens weighted the same deal differently.
    const p = stageProbabilities(null);
    expect(p.PROPOSAL_SENT).not.toBe(40);
    expect(p.PROFORMA_ISSUED).not.toBe(80);
    expect(p.VERBAL_YES).not.toBe(95);
  });

  it('reads the organisation’s own figures when it has them', () => {
    const p = stageProbabilities({
      stageProbProposalSent: 35,
      stageProbInNegotiation: 55,
      stageProbProformaIssued: 80,
      stageProbVerbalYes: 95,
    });
    expect(p.PROPOSAL_SENT).toBe(35);
    expect(p.VERBAL_YES).toBe(95);
  });

  it('prices won at 100 and lost at nothing, whatever the setting says', () => {
    const p = stageProbabilities(null);
    expect(p.WON).toBe(100);
    expect(p.LOST).toBe(0);
    expect(p.EXPIRED).toBe(0);
  });

  it('lets an explicit override beat the stage default', () => {
    // §8: `probabilityOverride ?? stageDefault`.
    expect(proposalProbability({ stage: 'PROPOSAL_SENT', probabilityOverride: 75 } as any, null)).toBe(75);
    expect(proposalProbability({ stage: 'PROPOSAL_SENT', probabilityOverride: null } as any, null)).toBe(
      BRIEF_STAGE_PROBABILITIES.stageProbProposalSent,
    );
  });

  it('starts the board at the first stage the brief prices', () => {
    // There is no stage in front of Proposal sent any more, and nothing may
    // reintroduce one silently: §14 prices the board from here.
    const p = stageProbabilities(null);
    expect(Object.keys(p)).not.toContain('TALKING');
    expect(p.PROPOSAL_SENT).toBe(BRIEF_STAGE_PROBABILITIES.stageProbProposalSent);
  });
});

// ── §14 · Sundays AND public holidays excluded ──────────────────────────────

describe('the working calendar', () => {
  // Wed 2026-09-16 10:00 IST → Thu 2026-09-17 19:00 IST: two full 9h days.
  const from = new Date('2026-09-16T04:30:00.000Z');
  const to = new Date('2026-09-17T13:30:00.000Z');

  it('counts two ordinary working days', () => {
    expect(calculateWorkingMinutes(from, to, 0, 10, 19, [1, 2, 3, 4, 5, 6]).totalMinutes).toBe(1080);
  });

  it('drops a day the office is shut', () => {
    // §14: "Sundays and public holidays excluded." Nothing excluded holidays,
    // so every elapsed figure counted them and read high.
    const withHoliday = calculateWorkingMinutes(from, to, 0, 10, 19, [1, 2, 3, 4, 5, 6], ['2026-09-17']);
    expect(withHoliday.totalMinutes).toBe(540);
  });

  it('ignores a holiday that falls on a day already not worked', () => {
    const sundayOff = calculateWorkingMinutes(from, to, 0, 10, 19, [1, 2, 3, 4, 5, 6], ['2026-09-20']);
    expect(sundayOff.totalMinutes).toBe(1080);
  });

  it('honours the organisation’s own hours', () => {
    // These columns have been on the organisation since the first schema and
    // every caller passed the function's defaults instead.
    expect(calculateWorkingMinutes(from, to, 0, 10, 14, [1, 2, 3, 4, 5, 6]).totalMinutes).toBe(480);
  });
});

// ── §16 · Every status change writes an Activity row. No exceptions ─────────

describe('the audit trail', () => {
  it('records losing a proposal, not only winning one', async () => {
    (prisma.proposal.findFirst as any).mockResolvedValue({
      id: 'prop-1',
      stage: 'IN_NEGOTIATION',
      company: { name: 'Carlton Hotels' },
    });
    (prisma.proposal.update as any).mockResolvedValue({ id: 'prop-1' });

    const res = await request(app)
      .post('/api/proposals/prop-1/lose')
      .set(...auth())
      .send({ lostReason: 'Went with an in-house team' });

    expect(res.status).toBe(200);
    expect(written.activity?.verb).toBe('proposal_lost');
    // LOST overwrites `stage`, so where the deal died is only recoverable if
    // this row keeps it.
    expect(written.activity?.payload.lostFromStage).toBe('IN_NEGOTIATION');
  });

  it('records a password change, which retires every session', async () => {
    /*
     * The route reads the account through the same findUnique the auth
     * middleware does, so the mock has to satisfy both — and it needs a real
     * hash, or the current-password check refuses before anything is written
     * and the test passes without ever reaching the line it is about.
     */
    const hash = await hashPassword('the-old-one');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: ADMIN.id,
      organizationId: 'org-1',
      name: 'Akmal',
      email: 'admin@eyelevel.local',
      preset: ADMIN.preset,
      permissions: [...ADMIN.permissions],
      active: true,
      sessionsValidFrom: null,
      passwordHash: hash,
    });
    (prisma.user.update as any).mockResolvedValue({ id: ADMIN.id });

    const res = await request(app)
      .post('/api/profile/password')
      .set(...auth())
      .send({ currentPassword: 'the-old-one', newPassword: 'a-new-one-entirely' });

    expect(res.status).toBe(200);
    expect(written.activity?.verb).toBe('password_changed');
    // The fact and the time are the point; the secret never goes in.
    expect(JSON.stringify(written.activity)).not.toMatch(/a-new-one-entirely/);
  });

  it('refuses, and writes nothing, when the current password is wrong', async () => {
    const hash = await hashPassword('the-old-one');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: ADMIN.id,
      organizationId: 'org-1',
      name: 'Akmal',
      email: 'admin@eyelevel.local',
      preset: ADMIN.preset,
      permissions: [...ADMIN.permissions],
      active: true,
      sessionsValidFrom: null,
      passwordHash: hash,
    });

    const res = await request(app)
      .post('/api/profile/password')
      .set(...auth())
      .send({ currentPassword: 'not-it', newPassword: 'a-new-one-entirely' });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(written.activity).toBeUndefined();
  });
});

// ── §14 · "All configurable in Setup" ───────────────────────────────────────

describe('the settings endpoint', () => {
  beforeEach(() => {
    (prisma.organization.findUnique as any).mockResolvedValue({
      id: 'org-1',
      name: 'EyeLevel Growth Studio',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      financialYearStart: 4,
      stageProbProposalSent: 30,
      stageProbInNegotiation: 60,
      stageProbProformaIssued: 85,
      stageProbVerbalYes: 90,
      workingHoursStart: '10:00',
      workingHoursEnd: '19:00',
      workingDays: [1, 2, 3, 4, 5, 6],
      holidays: ['2026-11-08'],
      sacCodes: [],
      defaultTermsAndConditions: [],
      defaultPaymentTerms: 'Immediate',
      defaultProformaValidityDays: 30,
    });
    (prisma.organization.update as any).mockImplementation(async ({ data }: any) => {
      written.org = data;
      return { id: 'org-1', ...data };
    });
  });

  it('hands the stage probabilities to anybody who can see the board', async () => {
    // BD have pipeline.read and not setup.admin, and the board prints the
    // stage default in every column header — including the empty ones.
    const res = await request(app)
      .get('/api/config')
      .set(...auth());
    expect(res.status).toBe(200);
    expect(res.body.organization.stageProbabilities.PROFORMA_ISSUED).toBe(85);
  });

  it('saves a new probability', async () => {
    const res = await request(app)
      .patch('/api/config')
      .set(...auth())
      .send({ stageProbProposalSent: 35 });
    expect(res.status).toBe(200);
    expect(written.org.stageProbProposalSent).toBe(35);
  });

  it('refuses a probability that is not a percentage', async () => {
    const res = await request(app)
      .patch('/api/config')
      .set(...auth())
      .send({ stageProbVerbalYes: 140 });
    expect(res.status).toBe(400);
  });

  it('saves holidays, de-duplicated and in order', async () => {
    const res = await request(app)
      .patch('/api/config')
      .set(...auth())
      .send({ holidays: ['2026-11-08', '2026-01-14', '2026-11-08'] });
    expect(res.status).toBe(200);
    expect(written.org.holidays).toEqual(['2026-01-14', '2026-11-08']);
  });

  it('refuses a holiday that is not a date', async () => {
    const res = await request(app)
      .patch('/api/config')
      .set(...auth())
      .send({ holidays: ['next Diwali'] });
    expect(res.status).toBe(400);
  });
});

// ── §16 · "Password reset by email" ─────────────────────────────────────────

describe('asking for a password reset', () => {
  const ask = (email: string) =>
    request(app).post('/api/auth/forgot-password').send({ email });

  it('issues a one-time token for a real, active account', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'usr-1', name: 'Ramya', email: 'ramya@eyelevel.local', active: true, organizationId: 'org-1',
    });
    let saved: any;
    (prisma.user.update as any).mockImplementation(async ({ data }: any) => { saved = data; return { id: 'usr-1' }; });

    const res = await ask('ramya@eyelevel.local');
    expect(res.status).toBe(200);
    expect(saved.resetToken).toHaveLength(64);
    expect(saved.resetTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('answers a stranger exactly as it answers a real account', async () => {
    /*
     * The endpoint is unauthenticated. If "no account with that address" read
     * any differently, it would be a way to find out who works here — so the
     * reply is byte-identical and nothing is written.
     */
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'usr-1', name: 'Ramya', email: 'ramya@eyelevel.local', active: true, organizationId: 'org-1',
    });
    (prisma.user.update as any).mockResolvedValue({ id: 'usr-1' });
    const real = await ask('ramya@eyelevel.local');

    (prisma.user.findUnique as any).mockResolvedValue(null);
    const stranger = await ask('nobody@example.com');

    expect(stranger.status).toBe(real.status);
    expect(stranger.body).toEqual(real.body);
    expect(real.body.message).toMatch(/^If that address/);
  });

  it('will not revive an account somebody switched off', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'usr-gone', name: 'Former', email: 'former@eyelevel.local', active: false, organizationId: 'org-1',
    });
    (prisma.user.update as any).mockClear();

    const res = await ask('former@eyelevel.local');
    expect(res.status).toBe(200);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('records who asked, and when', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'usr-1', name: 'Ramya', email: 'ramya@eyelevel.local', active: true, organizationId: 'org-1',
    });
    (prisma.user.update as any).mockResolvedValue({ id: 'usr-1' });
    await ask('ramya@eyelevel.local');
    expect(written.activity?.verb).toBe('password_reset_requested');
    // The token is a live credential and never belongs in the audit log.
    expect(JSON.stringify(written.activity)).not.toMatch(/resetToken/);
  });

  it('refuses something that is not an address', async () => {
    const res = await ask('not-an-email');
    expect(res.status).toBe(400);
  });
});

// ── §16 · "Email digest for alerts" ─────────────────────────────────────────

describe('the alert digest', () => {
  it('shows a person only what their own bell would show', async () => {
    /*
     * §9 applies to mail as much as to JSON. An employee has work.own and none
     * of the money or pipeline switches, so a money rule must not reach their
     * inbox — the digest and the bell scope through the same map so they
     * cannot drift apart.
     */
    (prisma.task.findMany as any).mockResolvedValue([]);
    let asked: any;
    (prisma.alert.findMany as any).mockImplementation(async (args: any) => {
      asked = args;
      return [];
    });

    await alertsForUser('org-1', { userId: 'usr-emp', preset: 'EMPLOYEE', permissions: ['work.own'] });

    const rules: string[] = asked.where.OR[0].rule.in;
    expect(rules).not.toContain('PROFORMA_UNPAID');
    expect(rules).not.toContain('INVOICE_OVERDUE');
    expect(rules).not.toContain('MONTH_CARD_NOT_INVOICED');
  });

  it('gives management the money rules', async () => {
    (prisma.task.findMany as any).mockResolvedValue([]);
    let asked: any;
    (prisma.alert.findMany as any).mockImplementation(async (args: any) => {
      asked = args;
      return [];
    });

    await alertsForUser('org-1', {
      userId: ADMIN.id,
      preset: 'MANAGEMENT',
      permissions: [...ADMIN.permissions],
    });

    expect(asked.where.OR[0].rule.in).toContain('PROFORMA_UNPAID');
  });

  it('never leaves the organisation it was asked about', async () => {
    (prisma.task.findMany as any).mockResolvedValue([]);
    let asked: any;
    (prisma.alert.findMany as any).mockImplementation(async (args: any) => {
      asked = args;
      return [];
    });
    await alertsForUser('org-1', { userId: 'usr-emp', preset: 'EMPLOYEE', permissions: ['work.own'] });
    expect(asked.where.organizationId).toBe('org-1');
    // A resolved alert is not news either.
    expect(asked.where.resolvedAt).toBeNull();
  });

  it('sends nothing at all outside the digest hour', async () => {
    (prisma.user.findMany as any).mockResolvedValue([]);
    // 03:00 UTC is 08:30 IST — past the hour, so a tick here is a no-op.
    const result = await sendAlertDigests(new Date('2026-09-20T18:00:00.000Z'));
    expect(result.sent).toBe(0);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
