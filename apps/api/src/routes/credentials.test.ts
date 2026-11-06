import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { resolvePermissions } from '../middleware/auth.js';
import { CredentialKeyMismatch, decryptWith, encryptWith, keyMatchesCheck, makeKeyCheck, generatePassword, parseKey } from '../utils/credentialCrypto.js';
import { REVEAL_LIMIT, checkUnusualActivity, guessMapping, managementAccessLost, purgeDeletedCredentials, resetRevealLimits } from '../services/credentials.js';
import { alertClausesFor } from './notifications.js';
import { API_SCOPES } from '../services/apiKeys.js';
import { ENDPOINTS } from '../services/publicApi/endpoints.js';
import { TOOLS } from '../services/publicApi/mcpTools.js';
import { ZEN_TOOLS } from '../services/zenTools.js';

/**
 * Logins (Credentials plan): the key, the door, the reveal and its log, the
 * import, the purge — and that nothing else in Flowzen can see them.
 */

type Who = 'boss' | 'adminHead' | 'bd' | 'accounts' | 'employee';
const PEOPLE: Record<Who, { id: string; name: string; preset: RolePreset; permissions?: string[] }> = {
  boss: { id: 'usr-boss', name: 'Harish', preset: RolePreset.MANAGEMENT },
  // A Head handed setup.admin: runs Settings, is not Management.
  adminHead: { id: 'usr-head', name: 'Dilshad', preset: RolePreset.HEAD, permissions: ['setup.admin', 'money.figures', 'reports.read'] },
  bd: { id: 'usr-bd', name: 'Varsha', preset: RolePreset.BD },
  accounts: { id: 'usr-acc', name: 'Meera', preset: RolePreset.ACCOUNTS },
  employee: { id: 'usr-emp', name: 'Sneha', preset: RolePreset.EMPLOYEE },
};

const sessionOf = (who: Who) => {
  const p = PEOPLE[who];
  return { userId: p.id, organizationId: 'org-1', preset: p.preset, permissions: resolvePermissions(p.preset, (p.permissions ?? []) as never[]), email: `${p.id}@eyelevel.local`, name: p.name, active: true };
};
const as = (who: Who) => {
  const p = PEOPLE[who];
  (prisma.user.findUnique as any).mockResolvedValue({ id: p.id, organizationId: 'org-1', email: `${p.id}@eyelevel.local`, name: p.name, preset: p.preset, permissions: p.permissions ?? [], active: true, sessionsValidFrom: null });
  return ['Authorization', `Bearer ${signJwt(sessionOf(who) as any)}`] as const;
};

const KEY_B64 = randomBytes(32).toString('base64');
const KEY = parseKey(KEY_B64)!;
const OTHER_KEY = parseKey(randomBytes(32).toString('base64'))!;

const withKey = () => {
  process.env.CREDENTIALS_KEY = KEY_B64;
};
const withoutKey = () => {
  delete process.env.CREDENTIALS_KEY;
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'cred-1',
  organizationId: 'org-1',
  scope: 'INTERNAL',
  companyId: null,
  company: null,
  name: 'Hostinger',
  website: 'https://hpanel.hostinger.com',
  username: 'ops@eyelevel.in',
  passwordEnc: encryptWith(KEY, 'hunter2!', 'cred-1'),
  notesEnc: encryptWith(KEY, '2FA on Harish’s phone', 'cred-1'),
  passwordChangedAt: new Date('2026-11-01T00:00:00Z'),
  createdById: 'usr-boss',
  updatedById: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  deletedAt: null,
  deletedById: null,
  ...over,
});

beforeEach(() => {
  withKey();
  resetRevealLimits();
  (prisma.organization.findUnique as any).mockResolvedValue({ id: 'org-1', credentialsKeyCheck: makeKeyCheck(KEY), timezone: 'Asia/Kolkata' });
  (prisma.organization.update as any).mockResolvedValue({});
  (prisma.credentialLog.create as any).mockImplementation(async ({ data }: any) => ({ id: 'log-1', at: new Date(), ...data }));
  (prisma.credentialLog.findMany as any).mockResolvedValue([]);
  (prisma.alert.findFirst as any).mockResolvedValue(null);
  (prisma.alert.create as any).mockResolvedValue({ id: 'alert-1' });
  (prisma.company.findMany as any).mockResolvedValue([{ id: 'co-acme', name: 'Acme Hospitals' }]);
  (prisma.credential.findMany as any).mockResolvedValue([]);
});

describe('the key', () => {
  it('round-trips, refuses another key, and refuses ciphertext moved to another row', () => {
    const stored = encryptWith(KEY, 'p@ss', 'row-a');
    expect(stored).toMatch(/^c1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(decryptWith(KEY, stored, 'row-a')).toBe('p@ss');
    expect(() => decryptWith(OTHER_KEY, stored, 'row-a')).toThrow(CredentialKeyMismatch);
    expect(() => decryptWith(KEY, stored, 'row-b')).toThrow(CredentialKeyMismatch);
    expect(() => decryptWith(KEY, 'v2:deadbeef:00:00', 'row-a')).toThrow(CredentialKeyMismatch);
    // Two encryptions of the same value never look alike.
    expect(encryptWith(KEY, 'p@ss', 'row-a')).not.toBe(stored);
  });

  it('the key check tells a different key from a bad row; a generated password has every kind of character', () => {
    const check = makeKeyCheck(KEY);
    expect(keyMatchesCheck(KEY, check)).toBe(true);
    expect(keyMatchesCheck(OTHER_KEY, check)).toBe(false);
    expect(parseKey('too-short')).toBeNull();
    expect(parseKey(undefined)).toBeNull();
    const pw = generatePassword();
    expect(pw).toHaveLength(20);
    expect(pw).toMatch(/[A-Za-z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[!@#$%^&*\-_=+?]/);
  });

  it('unset: Flowzen runs, the page says "Not set up yet", and nothing can be saved', async () => {
    withoutKey();
    const status = await request(app).get('/api/credentials/status').set(...as('boss')).expect(200);
    expect(status.body).toMatchObject({ keyConfigured: false, keyMatches: null });
    expect(status.headers['cache-control']).toBe('no-store');
    const saved = await request(app).post('/api/credentials').set(...as('boss')).send({ scope: 'INTERNAL', name: 'Hostinger', password: 'x' }).expect(503);
    expect(saved.body.error).toMatch(/CREDENTIALS_KEY/);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('a different key than the saved logins were made with is said once, on the page', async () => {
    (prisma.organization.findUnique as any).mockResolvedValue({ id: 'org-1', credentialsKeyCheck: makeKeyCheck(OTHER_KEY) });
    const status = await request(app).get('/api/credentials/status').set(...as('boss')).expect(200);
    expect(status.body).toMatchObject({ keyConfigured: true, keyMatches: false });
    const saved = await request(app).post('/api/credentials').set(...as('boss')).send({ scope: 'INTERNAL', name: 'Hostinger', password: 'x' }).expect(503);
    expect(saved.body.error).toMatch(/does not match/);
  });
});

describe('the door', () => {
  it('is Management’s by preset — a setup.admin who is not Management is refused like everybody else', async () => {
    for (const who of ['adminHead', 'bd', 'accounts', 'employee'] as Who[]) {
      expect((await request(app).get('/api/credentials').set(...as(who))).status, who).toBe(403);
      expect((await request(app).get('/api/credentials/status').set(...as(who))).status, who).toBe(403);
      expect((await request(app).post('/api/credentials').set(...as(who)).send({ scope: 'INTERNAL', name: 'x', password: 'y' })).status, who).toBe(403);
      expect((await request(app).post('/api/credentials/cred-1/reveal').set(...as(who)).send({ purpose: 'show' })).status, who).toBe(403);
      expect((await request(app).get('/api/credentials/log').set(...as(who))).status, who).toBe(403);
      expect((await request(app).post('/api/credentials/import').set(...as(who)).send({ csv: 'a' })).status, who).toBe(403);
      expect((await request(app).get('/api/companies/co-acme/credentials/count').set(...as(who))).status, who).toBe(403);
    }
    (prisma.credential.count as any).mockResolvedValue(5);
    expect((await request(app).get('/api/companies/co-acme/credentials/count').set(...as('boss'))).body.count).toBe(5);
  });
});

describe('saving and listing', () => {
  it('stores only c1: ciphertext bound to the row, and the list never carries a secret', async () => {
    (prisma.organization.findUnique as any).mockResolvedValue({ id: 'org-1', credentialsKeyCheck: null });
    (prisma.credential.create as any).mockImplementation(async ({ data }: any) => ({ ...row(), ...data, company: null }));
    const res = await request(app)
      .post('/api/credentials')
      .set(...as('boss'))
      .send({ scope: 'INTERNAL', name: 'Hostinger', website: 'https://hpanel.hostinger.com', username: 'ops@eyelevel.in', password: 'hunter2!', notes: 'the 2FA phone is Harish’s' })
      .expect(201);
    // The first save stores the key check.
    expect((prisma.organization.update as any).mock.calls[0][0].data.credentialsKeyCheck).toMatch(/^c1:/);
    const data = (prisma.credential.create as any).mock.calls[0][0].data;
    expect(data.passwordEnc).toMatch(/^c1:/);
    expect(data.notesEnc).toMatch(/^c1:/);
    expect(decryptWith(KEY, data.passwordEnc, data.id)).toBe('hunter2!');
    expect(() => decryptWith(KEY, data.passwordEnc, 'another-row')).toThrow(CredentialKeyMismatch);
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|passwordEnc|notesEnc|2FA/);
    expect(res.body.credential).toMatchObject({ name: 'Hostinger', hasNotes: true });
    expect((prisma.credentialLog.create as any).mock.calls[0][0].data).toMatchObject({ action: 'CREATE', credentialName: 'Hostinger', userId: 'usr-boss' });

    (prisma.credential.findMany as any).mockResolvedValue([row()]);
    const list = await request(app).get('/api/credentials?scope=INTERNAL&q=host').set(...as('boss')).expect(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(list.body)).not.toMatch(/hunter2|passwordEnc|notesEnc|2FA/);
    expect(list.body.credentials[0]).toMatchObject({ id: 'cred-1', username: 'ops@eyelevel.in', hasNotes: true });
    expect((prisma.credential.findMany as any).mock.calls.at(-1)[0].where.OR).toHaveLength(3);
  });

  it('a client login needs a client of ours; editing without a password keeps it, with one changes it and says so', async () => {
    (prisma.company.findFirst as any).mockResolvedValue(null);
    const bad = await request(app).post('/api/credentials').set(...as('boss')).send({ scope: 'CLIENT', companyId: 'co-x', name: 'WP', password: 'p' }).expect(400);
    expect(bad.body.error).toMatch(/client/);

    (prisma.credential.findFirst as any).mockResolvedValue(row());
    (prisma.credential.update as any).mockImplementation(async ({ data }: any) => ({ ...row(), ...data, company: null }));
    await request(app).patch('/api/credentials/cred-1').set(...as('boss')).send({ name: 'Hostinger hPanel' }).expect(200);
    const kept = (prisma.credential.update as any).mock.calls[0][0].data;
    expect(kept.passwordEnc).toBeUndefined();
    expect((prisma.credentialLog.create as any).mock.calls.at(-1)[0].data.action).toBe('UPDATE');

    await request(app).patch('/api/credentials/cred-1').set(...as('boss')).send({ password: 'new-one' }).expect(200);
    const changed = (prisma.credential.update as any).mock.calls[1][0].data;
    expect(decryptWith(KEY, changed.passwordEnc, 'cred-1')).toBe('new-one');
    expect(changed.passwordChangedAt).toBeInstanceOf(Date);
    expect((prisma.credentialLog.create as any).mock.calls.at(-1)[0].data.action).toBe('PASSWORD_CHANGED');
  });

  it('delete is soft, restore brings it back, and the purge keeps the name in the log', async () => {
    (prisma.credential.findFirst as any).mockResolvedValue(row());
    (prisma.credential.update as any).mockResolvedValue({ ...row(), company: null });
    await request(app).delete('/api/credentials/cred-1').set(...as('boss')).expect(200);
    expect((prisma.credential.update as any).mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    expect(prisma.credential.delete).not.toHaveBeenCalled();
    expect((prisma.credentialLog.create as any).mock.calls.at(-1)[0].data.action).toBe('DELETE');

    (prisma.credential.findFirst as any).mockResolvedValue(row({ deletedAt: new Date() }));
    await request(app).post('/api/credentials/cred-1/restore').set(...as('boss')).expect(200);
    expect((prisma.credential.update as any).mock.calls[1][0].data).toEqual({ deletedAt: null, deletedById: null });

    (prisma.credential.findMany as any).mockResolvedValue([row({ id: 'cred-old', name: 'Old CRM', deletedAt: new Date('2026-10-01T00:00:00Z'), deletedById: 'usr-boss' })]);
    (prisma.credential.delete as any).mockResolvedValue({});
    (prisma.alert.updateMany as any).mockResolvedValue({ count: 0 });
    const purged = await purgeDeletedCredentials(new Date('2026-11-06T00:00:00Z'));
    expect(purged).toBe(1);
    expect((prisma.credential.findMany as any).mock.calls.at(-1)[0].where.deletedAt.lt).toEqual(new Date('2026-10-07T00:00:00Z'));
    expect(prisma.credential.delete).toHaveBeenCalledWith({ where: { id: 'cred-old' } });
    expect((prisma.credentialLog.create as any).mock.calls.at(-1)[0].data).toMatchObject({ action: 'PURGE', credentialName: 'Old CRM', credentialId: null });
  });
});

describe('revealing', () => {
  it('hands back the password and notes once, logged as a show or a copy with who and where from', async () => {
    (prisma.credential.findFirst as any).mockResolvedValue(row());
    const shown = await request(app).post('/api/credentials/cred-1/reveal').set(...as('boss')).send({ purpose: 'show' }).expect(200);
    expect(shown.body).toEqual({ success: true, password: 'hunter2!', notes: '2FA on Harish’s phone' });
    expect(shown.headers['cache-control']).toBe('no-store');
    expect((prisma.credentialLog.create as any).mock.calls[0][0].data).toMatchObject({ action: 'SHOW', credentialId: 'cred-1', credentialName: 'Hostinger', userId: 'usr-boss' });
    expect((prisma.credentialLog.create as any).mock.calls[0][0].data.ip).toBeTruthy();

    await request(app).post('/api/credentials/cred-1/reveal').set(...as('boss')).send({ purpose: 'copy' }).expect(200);
    expect((prisma.credentialLog.create as any).mock.calls[1][0].data.action).toBe('COPY');
    // The log never holds the password.
    expect(JSON.stringify((prisma.credentialLog.create as any).mock.calls)).not.toMatch(/hunter2/);
  });

  it('refuses the 61st reveal in ten minutes with a 429', async () => {
    (prisma.credential.findFirst as any).mockResolvedValue(row());
    for (let i = 0; i < REVEAL_LIMIT; i++) await request(app).post('/api/credentials/cred-1/reveal').set(...as('boss')).send({ purpose: 'show' }).expect(200);
    const over = await request(app).post('/api/credentials/cred-1/reveal').set(...as('boss')).send({ purpose: 'show' }).expect(429);
    expect(over.body.error).toMatch(/ten minutes/);
    expect(over.headers['retry-after']).toBeTruthy();
  });

  it('bells the other Management members after 21 different logins in ten minutes — once', async () => {
    (prisma.credentialLog.findMany as any).mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ credentialId: `cred-${i}` })));
    expect(await checkUnusualActivity('org-1', { userId: 'usr-boss', name: 'Harish' })).toBe(true);
    expect((prisma.alert.create as any).mock.calls[0][0].data).toMatchObject({ rule: 'CREDENTIAL_UNUSUAL_ACTIVITY', entityType: 'User', entityId: 'usr-boss', message: 'Harish opened 25 logins in 10 minutes.' });
    (prisma.alert.findFirst as any).mockResolvedValue({ id: 'alert-1' });
    expect(await checkUnusualActivity('org-1', { userId: 'usr-boss', name: 'Harish' })).toBe(false);
    (prisma.alert.findFirst as any).mockResolvedValue(null);
    (prisma.credentialLog.findMany as any).mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ credentialId: `cred-${i}` })));
    expect(await checkUnusualActivity('org-1', { userId: 'usr-boss', name: 'Harish' })).toBe(false);
  });

  it('somebody leaving Management bells the rest with how many logins they opened', async () => {
    (prisma.credentialLog.findMany as any).mockResolvedValue([{ credentialId: 'a' }, { credentialId: 'a' }, { credentialId: 'b' }]);
    expect(await managementAccessLost('org-1', { id: 'usr-akmal', name: 'Akmal' })).toBe(true);
    expect((prisma.alert.create as any).mock.calls[0][0].data).toMatchObject({
      rule: 'CREDENTIAL_ACCESS_LOST',
      entityId: 'usr-akmal',
      message: 'Akmal no longer has Management access. They opened 2 logins. Review which passwords to change →',
    });
    (prisma.credentialLog.findMany as any).mockResolvedValue([]);
    expect(await managementAccessLost('org-1', { id: 'usr-new', name: 'Nobody' })).toBe(false);
  });

  it('the two bells reach Management only, and never the person they are about', async () => {
    (prisma.alert.findMany as any).mockResolvedValue([]);
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.internalProject.findMany as any).mockResolvedValue([]);
    const boss = await alertClausesFor(sessionOf('boss') as any);
    const about = boss.find((c) => c.NOT) as { rule: { in: string[] }; NOT: { entityId: string } } | undefined;
    expect(about?.rule.in).toEqual(['CREDENTIAL_UNUSUAL_ACTIVITY', 'CREDENTIAL_ACCESS_LOST']);
    expect(about?.NOT.entityId).toBe('usr-boss');
    const head = await alertClausesFor(sessionOf('adminHead') as any);
    expect(JSON.stringify(head)).not.toMatch(/CREDENTIAL_/);
  });
});

describe('importing from a sheet', () => {
  const CSV = [
    'Platform,Client,URL,Login,Password,Remarks',
    'WordPress admin,Acme Hospitals,https://acme.in/wp-admin,admin,Wp!2026,client site',
    'Hostinger,Eyelevel,https://hpanel.hostinger.com,ops@eyelevel.in,H0st!,',
    'Meta Business,Unknown Co,https://business.facebook.com,social@eyelevel.in,Meta!,',
    'Canva,,https://canva.com,design@eyelevel.in,,no password here',
    'Hostinger,Internal,hpanel.hostinger.com/,OPS@eyelevel.in,again,twice in the file',
    'GoDaddy,Us,https://godaddy.com,ops@eyelevel.in,G0!,',
  ].join('\n');

  it('guesses the columns from their headers', () => {
    expect(guessMapping(['platform', 'client', 'url', 'login', 'password', 'remarks'])).toEqual({ name: 'platform', client: 'client', website: 'url', username: 'login', password: 'password', notes: 'remarks' });
    expect(guessMapping(['name', 'company', 'website', 'email', 'pass', 'notes'])).toMatchObject({ name: 'name', client: 'company', website: 'website', username: 'email', password: 'pass', notes: 'notes' });
  });

  it('a dry run maps, matches clients, flags the unknown, skips duplicates, masks passwords and saves nothing', async () => {
    (prisma.credential.findMany as any).mockResolvedValue([{ scope: 'INTERNAL', companyId: null, website: 'https://www.godaddy.com', username: 'ops@eyelevel.in' }]);
    const res = await request(app).post('/api/credentials/import').set(...as('boss')).send({ csv: CSV, dryRun: true }).expect(200);
    expect(res.body.mapping).toEqual({ name: 'platform', client: 'client', website: 'url', username: 'login', password: 'password', notes: 'remarks' });
    const byRow = Object.fromEntries(res.body.rows.map((r: any) => [r.row, r]));
    expect(byRow[2]).toMatchObject({ name: 'WordPress admin', client: 'co-acme', clientName: 'Acme Hospitals', status: 'OK', hasPassword: true, hasNotes: true });
    expect(byRow[3]).toMatchObject({ name: 'Hostinger', client: 'INTERNAL', status: 'OK' });
    expect(byRow[4]).toMatchObject({ status: 'UNKNOWN_CLIENT', client: null, clientText: 'Unknown Co' });
    expect(byRow[5]).toMatchObject({ status: 'NO_PASSWORD' });
    expect(byRow[6]).toMatchObject({ status: 'DUPLICATE', reason: 'Twice in the file' });
    expect(byRow[7]).toMatchObject({ status: 'DUPLICATE', reason: 'Already saved' });
    expect(res.body.counts).toMatchObject({ total: 6, ok: 2, skipped: 2, problems: 2 });
    expect(JSON.stringify(res.body)).not.toMatch(/Wp!2026|H0st!|Meta!/);
    expect(prisma.credential.create).not.toHaveBeenCalled();
    expect(prisma.credentialLog.create).not.toHaveBeenCalled();
  });

  it('a picked client resolves the unknown row, and the real run saves the OK rows and logs one line', async () => {
    (prisma.credential.findMany as any).mockResolvedValue([{ scope: 'INTERNAL', companyId: null, website: 'https://www.godaddy.com', username: 'ops@eyelevel.in' }]);
    (prisma.credential.create as any).mockImplementation(async ({ data }: any) => data);
    const res = await request(app)
      .post('/api/credentials/import')
      .set(...as('boss'))
      .send({ csv: CSV, dryRun: false, clientChoices: { '4': 'co-acme' } })
      .expect(200);
    expect(res.body.imported).toBe(3);
    const saved = (prisma.credential.create as any).mock.calls.map((c: any) => c[0].data);
    expect(saved.map((s: any) => s.name)).toEqual(['WordPress admin', 'Hostinger', 'Meta Business']);
    expect(saved[0]).toMatchObject({ scope: 'CLIENT', companyId: 'co-acme' });
    expect(saved[2]).toMatchObject({ scope: 'CLIENT', companyId: 'co-acme' });
    expect(decryptWith(KEY, saved[0].passwordEnc, saved[0].id)).toBe('Wp!2026');
    expect(decryptWith(KEY, saved[0].notesEnc, saved[0].id)).toBe('client site');
    expect((prisma.credentialLog.create as any).mock.calls[0][0].data).toMatchObject({ action: 'IMPORT', detail: 'Imported 3 logins (2 skipped)' });
  });
});

describe('never anywhere else', () => {
  const words = /credential|login|password/i;
  it('no API key scope, REST endpoint, MCP tool or Zen tool names them', () => {
    for (const s of API_SCOPES) expect(`${s.key} ${s.label} ${s.description}`).not.toMatch(words);
    for (const e of ENDPOINTS) expect(`${e.path} ${e.summary}`).not.toMatch(words);
    for (const t of TOOLS) expect(`${t.name} ${t.title} ${t.description}`).not.toMatch(words);
    for (const t of ZEN_TOOLS) expect(`${t.name} ${t.description}`).not.toMatch(words);
  });

  it('global search does not read the table', () => {
    const search = readFileSync(resolve(__dirname, 'search.ts'), 'utf8');
    expect(search).not.toMatch(/credential/i);
  });
});
