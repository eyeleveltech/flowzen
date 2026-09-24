import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';
import { emitToOrganization } from '../sse.js';

// Only the two emitters are replaced. A whole-module mock would take
// `sseRouter` with it, and index.ts mounts that at /api/stream.
vi.mock('../sse.js', async () => {
  const actual = await vi.importActual<typeof import('../sse.js')>('../sse.js');
  return { ...actual, emitToOrganization: vi.fn(), emitToUser: vi.fn() };
});

/**
 * Adding a company, and the four things the form asks for.
 *
 * ─── What this used to do with them ─────────────────────────────────────────
 *
 * The form's own header calls its fields "either free or load-bearing":
 * contact and phone, city, source, and a follow-up date it describes as "the
 * reason the lead ever gets called again". Three of the four were accepted by
 * the validator, destructured by the handler, and then never written.
 *
 *   phone          only survived if a contact NAME was typed too, because
 *                  contact details live on Person and no Person was created
 *   sourceId       nothing read it, so every company was stored as OUTREACH
 *                  whatever was picked
 *   followUpDate   there is no such column anywhere in the schema
 *
 * The field that exists to stop a lead being forgotten guaranteed it.
 *
 * ─── And the duplicate override ─────────────────────────────────────────────
 *
 * `force` was destructured and never read, and the refusal came back as a bare
 * sentence rather than the `{ action, matches, canForce }` the client reads —
 * so a near-name warning could not be got past, and the modal could not say
 * what it had clashed with.
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

/** Captures what the transaction wrote, without a database. */
let written: { company?: any; person?: any; proposal?: any; task?: any };

beforeEach(() => {
  written = {};
  (prisma.user.findUnique as any).mockResolvedValue({
    id: BD.id,
    organizationId: 'org-1',
    name: 'Naif',
    email: 'bd@eyelevel.local',
    preset: BD.preset,
    permissions: [...BD.permissions],
    active: true,
    sessionsValidFrom: null,
  });

  // No existing companies, and no exact-name clash, unless a test says so.
  (prisma.company.findMany as any).mockResolvedValue([]);
  (prisma.company.findUnique as any).mockResolvedValue(null);
  (prisma.activity.create as any).mockResolvedValue({});

  (prisma.$transaction as any).mockImplementation(async (fn: any) =>
    fn({
      company: {
        create: vi.fn(async ({ data }: any) => {
          written.company = data;
          return { id: 'co-new', ...data };
        }),
      },
      person: {
        create: vi.fn(async ({ data }: any) => {
          written.person = data;
          return { id: 'per-new', ...data };
        }),
      },
      proposal: {
        create: vi.fn(async ({ data }: any) => {
          written.proposal = data;
          return { id: 'prop-new', ...data };
        }),
      },
      task: {
        create: vi.fn(async ({ data }: any) => {
          written.task = data;
          return { id: 'task-new', ...data };
        }),
      },
    }),
  );
});

const create = (body: Record<string, unknown>) =>
  request(app)
    .post('/api/companies')
    .set(...auth())
    .send({ name: 'Acme Foods', vertical: 'D2C', ...body });

describe('the fields the form actually asks for', () => {
  it('stores the source that was picked, not the default', async () => {
    // Sent as the old enum member, stored as the name it became: the lists are
    // words now, and anything still posting `REFERRAL` has to keep working.
    const res = await create({ sourceId: 'REFERRAL' });
    expect(res.status).toBe(201);
    expect(written.company.source).toBe('Referrals');
  });

  it('still accepts a legacy value directly, for a caller that is not the form', async () => {
    const res = await create({ source: 'NETWORK' });
    expect(res.status).toBe(201);
    expect(written.company.source).toBe('Networking & Events');
  });

  it('takes a source from the current list as written', async () => {
    const res = await create({ source: 'Justdial' });
    expect(res.status).toBe(201);
    expect(written.company.source).toBe('Justdial');
  });

  it('ignores a source id that is not a real one instead of crashing', async () => {
    const res = await create({ sourceId: 'nonsense' });
    expect(res.status).toBe(201);
    expect(written.company.source).toBe('Cold Outreach');
  });

  it('keeps a phone given without a contact name', async () => {
    // The common case: somebody reads you a number. This used to vanish.
    const res = await create({ phone: '98765 43210' });
    expect(res.status).toBe(201);
    expect(written.person).toBeDefined();
    expect(written.person.phone).toBe('98765 43210');
    // Named after the company, since no person's name was given.
    expect(written.person.name).toBe('Acme Foods');
  });

  it('prefers the contact block when both are filled', async () => {
    const res = await create({ phone: '11111', contact: { name: 'Priya', phone: '22222' } });
    expect(res.status).toBe(201);
    expect(written.person.name).toBe('Priya');
    expect(written.person.phone).toBe('22222');
  });

  it('writes no person at all when neither was given', async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    expect(written.person).toBeUndefined();
  });

  it('raises the follow-up as a real task for the owner', async () => {
    const res = await create({ followUpDate: '2026-10-01' });
    expect(res.status).toBe(201);
    expect(written.task).toBeDefined();
    expect(written.task.title).toBe('Follow up — Acme Foods');
    expect(written.task.assigneeId).toBe(BD.id);
    expect(new Date(written.task.dueDate).toISOString().slice(0, 10)).toBe('2026-10-01');
    // Without the join row the task belongs to nobody and never reaches My Work.
    expect(written.task.assignees).toEqual({ create: { userId: BD.id } });
    expect(res.body.data.followUpTaskId).toBe('task-new');
  });

  it('raises no task when no date was given', async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    expect(written.task).toBeUndefined();
  });
});

describe('the duplicate override', () => {
  const SIMILAR = [{ id: 'co-1', name: 'Acme Foods Pvt Ltd', people: [] }];

  it('refuses a similar name with the verdict the client reads', async () => {
    (prisma.company.findMany as any).mockResolvedValue(SIMILAR);
    const res = await create({});
    expect(res.status).toBe(409);
    // Under `data` — the client's ApiError reads a structured body from there,
    // and spread at the top level it arrived as undefined.
    expect(res.body.data.action).toBe('WARN');
    expect(res.body.data.canForce).toBe(true);
    expect(res.body.data.matches[0].name).toBe('Acme Foods Pvt Ltd');
    expect(written.company).toBeUndefined();
  });

  it('lets that same name through once it is forced', async () => {
    (prisma.company.findMany as any).mockResolvedValue(SIMILAR);
    const res = await create({ force: true });
    expect(res.status).toBe(201);
    expect(written.company.name).toBe('Acme Foods');
  });

  it('will not let a matching phone through, forced or not', async () => {
    // Same phone is the same company. There is no arguing with it.
    (prisma.company.findMany as any).mockResolvedValue([
      { id: 'co-2', name: 'Something Else', people: [{ email: null, phone: '+91 98765 43210' }] },
    ]);
    const res = await create({ phone: '9876543210', force: true });
    expect(res.status).toBe(409);
    expect(res.body.data.action).toBe('BLOCK');
    expect(res.body.data.canForce).toBe(false);
    expect(written.company).toBeUndefined();
  });

  it('still refuses an exact repeat, and says what it clashed with', async () => {
    (prisma.company.findUnique as any).mockResolvedValue({ id: 'co-3', name: 'Acme Foods' });
    const res = await create({ force: true });
    expect(res.status).toBe(409);
    expect(res.body.data.action).toBe('BLOCK');
    expect(res.body.data.matches[0].id).toBe('co-3');
  });
});

/**
 * Adding a company does not put anything on the pipeline.
 *
 * It used to open a Proposal in a TALKING stage for EVERY company it made.
 * That proposal had no version -- no value, no scope, nothing sent -- so the
 * board, which renders proposals, carried a card that stood for nothing. It
 * could not be advanced either: the stage route refuses a manual change and
 * the board rejects any card dropped on Proposal sent. Quoting the client
 * called POST /proposals, which writes a second row, leaving the first behind
 * as a permanent empty card that had to be deleted by hand.
 *
 * TALKING is gone with it. A company reaches the board when somebody sends it
 * a number.
 */
describe('adding a company', () => {
  it('writes no proposal for a new lead', async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    expect(written.proposal).toBeUndefined();
  });

  it('writes no proposal for an existing client either', async () => {
    const res = await create({ existingClient: true, status: 'CLIENT' });
    expect(res.status).toBe(201);
    expect(written.proposal).toBeUndefined();
  });

  it('does not hand back a deal id any more', async () => {
    const res = await create({});
    expect(res.body.data).not.toHaveProperty('dealId');
  });

  it('makes an existing client a CLIENT, not a prospect', async () => {
    const res = await create({ existingClient: true, status: 'CLIENT' });
    expect(res.status).toBe(201);
    expect(written.company.status).toBe('CLIENT');
  });

  it('records that they were migrated, not newly won', async () => {
    await create({ existingClient: true, status: 'CLIENT' });
    const activity = (prisma.activity.create as any).mock.calls.at(-1)[0].data;
    expect(activity.verb).toBe('company_migrated');
    expect(activity.payload.existingClient).toBe(true);
  });

  it('and records an ordinary lead as a normal creation', async () => {
    await create({});
    const activity = (prisma.activity.create as any).mock.calls.at(-1)[0].data;
    expect(activity.verb).toBe('company_created');
    expect(activity.payload.existingClient).toBeUndefined();
  });
});

/**
 * The company list on everybody else's screen.
 *
 * `emitToUser` and `emitToOrganization` were defined in sse.ts and called from
 * NOWHERE in the API -- every signed-in browser held an open EventSource that
 * received the handshake and then nothing, for the life of the session. These
 * pin the call sites so a future edit cannot quietly go back to silence.
 */
describe('what the rest of the office is told', () => {
  // The prisma mock is reset globally; this one is ours to clear.
  beforeEach(() => vi.mocked(emitToOrganization).mockClear());

  it('announces a new company on the organisation stream', async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    expect(emitToOrganization).toHaveBeenCalledWith(
      'org-1',
      'lead:updated',
      expect.objectContaining({ companyId: 'co-new' }),
    );
  });

  it('announces a migrated client the same way', async () => {
    await create({ existingClient: true, status: 'CLIENT' });
    expect(emitToOrganization).toHaveBeenCalledWith(
      'org-1',
      'lead:updated',
      expect.anything(),
    );
  });

  it('says nothing when the create is refused', async () => {
    (prisma.company.findUnique as any).mockResolvedValue({ id: 'co-old', name: 'Acme Foods' });
    const res = await create({});
    expect(res.status).toBe(409);
    expect(emitToOrganization).not.toHaveBeenCalled();
  });
});

/**
 * The address a proforma is sent to.
 *
 * `Person.email` has been in the schema all along and this form never asked,
 * so a client added here had a name and a phone and no way to be emailed.
 * `documentEmail` builds a document's recipient list from the company's
 * people, so raising a proforma offered an empty list and somebody had to add
 * the same contact a second time before anything could go out.
 */
describe('the contact email', () => {
  it('is written onto the person', async () => {
    await create({ contact: { name: 'Priya Sharma', phone: '98765 43210', email: 'priya@acme.in' } });
    expect(written.person.email).toBe('priya@acme.in');
    expect(written.person.name).toBe('Priya Sharma');
  });

  it('keeps a contact who is only an email address', async () => {
    // The guard used to be name-or-phone, so this wrote no person at all.
    await create({ contact: { name: '', email: 'accounts@acme.in' } });
    expect(written.person).toBeDefined();
    expect(written.person.email).toBe('accounts@acme.in');
  });

  it('is null rather than empty when nothing was typed', async () => {
    await create({ contact: { name: 'Priya Sharma' } });
    expect(written.person.email).toBeNull();
  });

  it('refuses something that is not an email', async () => {
    const res = await create({ contact: { name: 'Priya Sharma', email: 'priya-at-acme' } });
    expect(res.status).toBe(400);
  });
});
