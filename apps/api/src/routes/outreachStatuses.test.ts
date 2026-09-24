import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset, OutreachStatus } from '@prisma/client';

/**
 * Outreach change request 01 — the cold list becomes a worklist.
 *
 * ─── What changed, and why it needed rules ──────────────────────────────────
 *
 * The old statuses recorded EVENTS: contacted, replied. They could say a call
 * happened and never what to do next, which is why CONTACTED was a dead end.
 * The new set describes a conversation with a next action attached, and two of
 * the five carry a date — which is what lets the screen answer "who am I
 * calling today".
 *
 * That only works if the date is actually there, so FOLLOW_UP and MEETING both
 * require one. FOLLOW_UP also requires a note: a callback with no reason is a
 * lead somebody is quietly parking.
 *
 * ─── And the history ────────────────────────────────────────────────────────
 *
 * `remarks` on the row is the latest note and nothing more. The trail lives in
 * Activity, one row per change, so a lead followed up four times keeps four
 * call notes rather than the last one having eaten the other three.
 */

const BD = {
  id: 'usr-bd',
  preset: RolePreset.BD,
  permissions: ['work.own', 'company.read', 'company.write', 'pipeline.read'],
};

const auth = () =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: BD.id,
      organizationId: 'org-1',
      email: 'bd@eyelevel.local',
      preset: BD.preset,
      permissions: [...BD.permissions],
    })}`,
  ] as const;

const lead = (over: Record<string, unknown> = {}) => ({
  id: 'lead-1',
  organizationId: 'org-1',
  name: 'Prestige Group',
  vertical: 'REAL_ESTATE',
  source: 'OUTREACH',
  ownerId: 'usr-bd',
  status: OutreachStatus.NOT_CONTACTED,
  contactPersonName: 'Rajesh Kumar',
  phone: '98400 11223',
  email: 'rajesh@prestige.example',
  remarks: null,
  nextActionDate: null,
  promotedCompanyId: null,
  ...over,
});

let written: { entry?: any; company?: any; person?: any; activity?: any };

beforeEach(() => {
  written = {};
  (prisma.user.findUnique as any).mockResolvedValue({
    id: BD.id,
    organizationId: 'org-1',
    name: 'Varsha',
    email: 'bd@eyelevel.local',
    preset: BD.preset,
    permissions: [...BD.permissions],
    active: true,
    sessionsValidFrom: null,
  });
  (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead());
  (prisma.outreachEntry.update as any).mockImplementation(async ({ data }: any) => {
    written.entry = data;
    return { ...lead(), ...data };
  });
  (prisma.activity.create as any).mockImplementation(async ({ data }: any) => {
    written.activity = data;
    return data;
  });
  (prisma.company.findMany as any).mockResolvedValue([]);
  (prisma.$transaction as any).mockImplementation(async (fn: any) =>
    fn({
      company: { create: vi.fn(async ({ data }: any) => ((written.company = data), { id: 'co-new', ...data })) },
      person: { create: vi.fn(async ({ data }: any) => ((written.person = data), { id: 'p-new', ...data })) },
      outreachEntry: { update: vi.fn(async ({ data }: any) => ((written.entry = data), { ...lead(), ...data })) },
      activity: { create: vi.fn(async ({ data }: any) => data) },
    }),
  );
});

const setStatus = (body: Record<string, unknown>) =>
  request(app).patch('/api/outreach/lead-1/status').set(...auth()).send(body);

describe('the two statuses that carry a next action', () => {
  it('refuses a follow-up with no callback date', async () => {
    const res = await setStatus({ status: 'FOLLOW_UP', remarks: 'Call back Thursday' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('When are you calling them back?');
  });

  it('refuses a follow-up with no note', async () => {
    // A callback with no reason is a lead being parked, not followed up.
    const res = await setStatus({ status: 'FOLLOW_UP', nextActionDate: '2026-09-15' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/What did they say/);
  });

  it('accepts a follow-up carrying both', async () => {
    const res = await setStatus({
      status: 'FOLLOW_UP',
      nextActionDate: '2026-09-15',
      remarks: 'Busy with a launch. Call back Thursday morning.',
    });
    expect(res.status).toBe(200);
    expect(written.entry.status).toBe('FOLLOW_UP');
    expect(written.entry.remarks).toBe('Busy with a launch. Call back Thursday morning.');
    expect(new Date(written.entry.nextActionDate).toISOString().slice(0, 10)).toBe('2026-09-15');
  });

  it('refuses a meeting with no date', async () => {
    const res = await setStatus({ status: 'MEETING' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('When is the meeting?');
  });

  it('accepts a meeting with no note, because the note is only logistics', async () => {
    const res = await setStatus({ status: 'MEETING', nextActionDate: '2026-09-20' });
    expect(res.status).toBe(200);
    expect(written.entry.status).toBe('MEETING');
  });

  it('clears the date and note when the lead moves somewhere that has neither', async () => {
    // A "call back on" date against a dead lead is a reminder for something
    // nobody intends to do. The trail keeps what was said.
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(
      lead({ status: OutreachStatus.FOLLOW_UP, remarks: 'Call Thursday', nextActionDate: new Date('2026-09-15') }),
    );
    const res = await setStatus({ status: 'DEAD' });
    expect(res.status).toBe(200);
    expect(written.entry.remarks).toBeNull();
    expect(written.entry.nextActionDate).toBeNull();
  });
});

describe('moving a meeting', () => {
  it('accepts a new date for the status the lead is already on', async () => {
    // Rescheduling is the same call with the same status and a different date.
    // Without this the only way to move a meeting was to switch the lead to
    // Follow up and back — and Follow up demands a note, so a reschedule meant
    // writing down a callback that never happened.
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(
      lead({ status: OutreachStatus.MEETING, nextActionDate: new Date('2026-09-20'), remarks: '11:30, their office' }),
    );
    const res = await setStatus({ status: 'MEETING', nextActionDate: '2026-09-27', remarks: '2pm, our office instead' });
    expect(res.status).toBe(200);
    expect(new Date(written.entry.nextActionDate).toISOString().slice(0, 10)).toBe('2026-09-27');
    expect(written.entry.remarks).toBe('2pm, our office instead');
  });

  it('records the reschedule in the history, with both dates recoverable', async () => {
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(
      lead({ status: OutreachStatus.MEETING, nextActionDate: new Date('2026-09-20') }),
    );
    await setStatus({ status: 'MEETING', nextActionDate: '2026-09-27', remarks: 'They moved it a week' });
    const a = (prisma.activity.create as any).mock.calls.at(-1)[0].data;
    // from === to is what the screen reads as "rescheduled" rather than a move.
    expect(a.payload.from).toBe('MEETING');
    expect(a.payload.to).toBe('MEETING');
    expect(a.payload.nextActionDate).toBe('2026-09-27');
    expect(a.payload.remarks).toBe('They moved it a week');
  });

  it('still refuses a reschedule with the date taken out', async () => {
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead({ status: OutreachStatus.MEETING }));
    const res = await setStatus({ status: 'MEETING' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('When is the meeting?');
  });
});

describe('the trail', () => {
  it('writes one activity row per change, naming both ends', async () => {
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead({ status: OutreachStatus.NOT_CONTACTED }));
    await setStatus({ status: 'FOLLOW_UP', nextActionDate: '2026-09-15', remarks: 'Asked for Thursday' });

    const a = (prisma.activity.create as any).mock.calls.at(-1)[0].data;
    expect(a.entityType).toBe('OutreachEntry');
    expect(a.entityId).toBe('lead-1');
    expect(a.actorId).toBe(BD.id);
    expect(a.verb).toBe('outreach_status_changed');
    expect(a.payload.from).toBe('NOT_CONTACTED');
    expect(a.payload.to).toBe('FOLLOW_UP');
    // The note as entered at that moment — this is the record, not the row.
    expect(a.payload.remarks).toBe('Asked for Thursday');
    expect(a.payload.nextActionDate).toBe('2026-09-15');
  });

  it('keeps the note on the trail even when the row clears it', async () => {
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead({ status: OutreachStatus.FOLLOW_UP }));
    await setStatus({ status: 'DEAD', remarks: 'Said they have gone with someone else' });
    const a = (prisma.activity.create as any).mock.calls.at(-1)[0].data;
    expect(a.payload.remarks).toBe('Said they have gone with someone else');
    expect(written.entry.remarks).toBeNull();
  });
});

describe('promotion', () => {
  const promote = (body: Record<string, unknown> = {}) =>
    request(app).post('/api/outreach/lead-1/promote').set(...auth()).send({ city: 'Chennai', ...body });

  it('refuses a lead that has not reached Interested', async () => {
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead({ status: OutreachStatus.MEETING }));
    const res = await promote();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only a lead marked Interested/);
    expect(written.company).toBeUndefined();
  });

  it('promotes an Interested lead and carries its details onto the contact', async () => {
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead({ status: OutreachStatus.INTERESTED }));
    const res = await promote();
    expect(res.status).toBe(201);
    expect(written.company.name).toBe('Prestige Group');
    expect(written.company.status).toBe('PROSPECT');
    // The details came off the lead; losing them here would throw away the
    // only thing the lead was ever good for.
    expect(written.person.name).toBe('Rajesh Kumar');
    expect(written.person.phone).toBe('98400 11223');
    expect(written.person.email).toBe('rajesh@prestige.example');
    expect(written.person.role).toBe('CONTACT');
    // Archived, not deleted.
    expect(written.entry.promotedCompanyId).toBe('co-new');
  });

  it('lets the person correct the vertical and the owner too', async () => {
    // Both are pre-filled from the lead and both are editable: the vertical
    // was often a guess when the name was scraped, and whoever chased a cold
    // lead is not always who ends up running the account.
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead({ status: OutreachStatus.INTERESTED }));
    const res = await promote({ vertical: 'HEALTHCARE', ownerId: 'usr-other' });
    expect(res.status).toBe(201);
    // Sent as the old enum member, stored as the industry it became.
    expect(written.company.vertical).toBe('Healthcare & Wellness');
    expect(written.company.ownerId).toBe('usr-other');
  });

  it('falls back to the lead when neither was changed', async () => {
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead({ status: OutreachStatus.INTERESTED }));
    const res = await promote();
    expect(res.status).toBe(201);
    expect(written.company.vertical).toBe('REAL_ESTATE');
    expect(written.company.ownerId).toBe('usr-bd');
  });

  it('lets the person doing it correct the name they were given', async () => {
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead({ status: OutreachStatus.INTERESTED }));
    const res = await promote({ companyName: 'Prestige Estates Pvt Ltd' });
    expect(res.status).toBe(201);
    expect(written.company.name).toBe('Prestige Estates Pvt Ltd');
  });

  it('answers a name clash with a verdict instead of a 500', async () => {
    // The unique index on (organizationId, name) used to surface as a bare
    // "Something went wrong" — P2002 carries no HTTP status.
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead({ status: OutreachStatus.INTERESTED }));
    (prisma.company.findMany as any).mockResolvedValue([
      { id: 'co-1', name: 'Prestige Group', people: [] },
    ]);
    const res = await promote();
    expect(res.status).toBe(409);
    expect(res.body.data.action).toBe('WARN');
    expect(res.body.data.canForce).toBe(true);
    expect(written.company).toBeUndefined();
  });

  it('will not let a matching phone through, forced or not', async () => {
    (prisma.outreachEntry.findFirst as any).mockResolvedValue(lead({ status: OutreachStatus.INTERESTED }));
    (prisma.company.findMany as any).mockResolvedValue([
      { id: 'co-2', name: 'Someone Else', people: [{ email: null, phone: '+91 98400 11223' }] },
    ]);
    const res = await promote({ force: true });
    expect(res.status).toBe(409);
    expect(res.body.data.action).toBe('BLOCK');
    expect(res.body.data.canForce).toBe(false);
  });
});

describe('a lead must be reachable', () => {
  const create = (body: Record<string, unknown>) =>
    request(app).post('/api/outreach').set(...auth()).send({ name: 'New Lead', vertical: 'D2C', ...body });

  beforeEach(() => {
    (prisma.outreachEntry.create as any).mockImplementation(async ({ data }: any) => ({ id: 'new', ...data }));
  });

  it('refuses a name with no phone and no email', async () => {
    const res = await create({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone number or an email/);
  });

  it('accepts a phone on its own', async () => {
    const res = await create({ phone: '98400 00000' });
    expect(res.status).toBe(201);
  });

  it('accepts an email on its own', async () => {
    const res = await create({ email: 'hello@example.com' });
    expect(res.status).toBe(201);
  });

  it('keeps the contact person it was given', async () => {
    const res = await create({ phone: '98400 00000', contactPersonName: 'Meena' });
    expect(res.status).toBe(201);
    const data = (prisma.outreachEntry.create as any).mock.calls.at(-1)[0].data;
    expect(data.contactPersonName).toBe('Meena');
    expect(data.status).toBe('NOT_CONTACTED');
  });
});
