import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { RolePreset } from '@prisma/client';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { resolvePermissions } from '../middleware/auth.js';
import { hashKey, scopesFor } from '../services/apiKeys.js';
import { apiCall, stampVia, viaWords } from '../services/apiCallContext.js';
import { resetRateLimits } from '../middleware/apiKey.js';
import { toolsFor } from '../services/publicApi/mcpTools.js';
import { mcpUrl, pkceOk, redirectAllowed, issuer } from '../services/oauth.js';

/**
 * "Sign in with Flowzen" (API Plan 2): discovery, the consent, the code, the
 * tokens, and a token opening /api/mcp as the person who consented.
 *
 * Mostly refusals, as with keys: a client that is not known, an address it did
 * not register, a code used twice, a refresh token that was already rotated —
 * each ends the right way. The happy path is checked once end to end.
 */

type Who = 'admin' | 'bd' | 'employee';
const PEOPLE: Record<Who, { id: string; name: string; preset: RolePreset }> = {
  admin: { id: 'usr-admin', name: 'Harish', preset: RolePreset.MANAGEMENT },
  bd: { id: 'usr-bd', name: 'Varsha', preset: RolePreset.BD },
  employee: { id: 'usr-emp', name: 'Sneha', preset: RolePreset.EMPLOYEE },
};

const session = (who: Who) => ({
  userId: PEOPLE[who].id,
  organizationId: 'org-1',
  preset: PEOPLE[who].preset,
  permissions: resolvePermissions(PEOPLE[who].preset),
  active: true,
});

/** Everyone but Management has had "Connect AI apps" ticked, unless a test says otherwise. */
const userRow = (who: Who, { connect = true } = {}) => ({
  id: PEOPLE[who].id,
  organizationId: 'org-1',
  email: `${PEOPLE[who].id}@eyelevel.local`,
  name: PEOPLE[who].name,
  preset: PEOPLE[who].preset,
  permissions: connect ? ['api.connect'] : [],
  active: true,
  sessionsValidFrom: null,
});

/** A signed-in session, as the screens have one. */
const as = (who: Who, opts: { connect?: boolean } = {}) => {
  (prisma.user.findUnique as any).mockResolvedValue(userRow(who, opts));
  return ['Authorization', `Bearer ${signJwt({ ...session(who), email: 'x@eyelevel.local' } as any)}`] as const;
};

const CLAUDE = {
  id: 'cl-1',
  clientId: 'https://claude.ai/oauth/client-metadata',
  kind: 'CIMD',
  name: 'Claude',
  redirectUris: ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback'],
  clientUri: 'https://claude.ai',
  fetchedAt: new Date(),
  createdAt: new Date('2026-11-01T00:00:00Z'),
  lastUsedAt: null,
};
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = createHash('sha256').update(verifier).digest('base64url');

const signIn = (extra: Record<string, string> = {}) => ({
  client_id: CLAUDE.clientId,
  redirect_uri: CALLBACK,
  response_type: 'code',
  state: 'st-1',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  ...extra,
});

const grantRow = (who: Who, scopes: string[], extra: Record<string, unknown> = {}) => ({
  id: 'grant-1',
  organizationId: 'org-1',
  userId: PEOPLE[who].id,
  clientId: CLAUDE.id,
  scopes,
  createdAt: new Date('2026-11-04T00:00:00Z'),
  updatedAt: new Date('2026-11-04T00:00:00Z'),
  lastUsedAt: null,
  lastUsedIp: null,
  revokedAt: null,
  revokedById: null,
  client: { id: CLAUDE.id, clientId: CLAUDE.clientId, name: CLAUDE.name },
  organization: { apiEnabled: true },
  user: userRow(who),
  ...extra,
});

beforeEach(() => {
  resetRateLimits();
  (prisma.organization.findUnique as any).mockResolvedValue({ id: 'org-1', name: 'EyeLevel', timezone: 'Asia/Kolkata', apiEnabled: true });
  (prisma.activity.create as any).mockResolvedValue({ id: 'act-1' });
  (prisma.oAuthClient.findUnique as any).mockImplementation(async ({ where }: any) => (where.clientId === CLAUDE.clientId ? CLAUDE : null));
  (prisma.oAuthToken.create as any).mockImplementation(async ({ data }: any) => ({ id: data.kind === 'REFRESH' ? 'rt-new' : 'at-new', ...data }));
  (prisma.oAuthToken.update as any).mockResolvedValue({});
  (prisma.oAuthToken.updateMany as any).mockResolvedValue({ count: 1 });
  (prisma.oAuthGrant.updateMany as any).mockResolvedValue({ count: 1 });
});

describe('discovery', () => {
  it('says where the sign-in is, in the terms Claude and ChatGPT check', async () => {
    const res = await request(app).get('/.well-known/oauth-authorization-server').expect(200);
    expect(res.body.issuer).toBe(issuer());
    expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(res.body.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(res.body.client_id_metadata_document_supported).toBe(true);
    expect(res.body.registration_endpoint).toMatch(/\/api\/oauth\/register$/);
    expect(res.body.authorization_endpoint).toBe(`${issuer()}/oauth/authorize`);
    // The same document under /api, which the proxy already routes.
    expect((await request(app).get('/api/.well-known/oauth-authorization-server').expect(200)).body.issuer).toBe(issuer());
  });

  it('names the MCP endpoint as the resource, exactly', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/api/.well-known/oauth-protected-resource/api/mcp']) {
      const res = await request(app).get(path).expect(200);
      expect(res.body.resource).toBe(mcpUrl());
      expect(res.body.authorization_servers).toEqual([issuer()]);
      expect(res.body.scopes_supported).toContain('tasks:read');
    }
  });

  it('a 401 from /api/mcp points at the metadata; /api/v1 does not take a connector token', async () => {
    const bare = await request(app).post('/api/mcp').send({}).expect(401);
    expect(bare.headers['www-authenticate']).toMatch(/^Bearer resource_metadata="[^"]+\/oauth-protected-resource"/);
    expect(bare.headers['www-authenticate']).not.toMatch(/error=/);
    expect(bare.headers['www-authenticate']).toMatch(/scope="tasks:read /);

    (prisma.oAuthToken.findUnique as any).mockResolvedValue(null);
    const bad = await request(app).post('/api/mcp').set('Authorization', `Bearer fz_at_${'a'.repeat(43)}`).send({}).expect(401);
    expect(bad.body.error.code).toBe('invalid_token');
    expect(bad.headers['www-authenticate']).toMatch(/error="invalid_token"/);

    const v1 = await request(app).get('/api/v1/me').set('Authorization', `Bearer fz_at_${'a'.repeat(43)}`).expect(401);
    expect(v1.body.error.code).toBe('invalid_key');
    expect(v1.headers['www-authenticate']).toBeUndefined();
  });
});

describe('registering a client', () => {
  it('issues an id to a public client, and refuses secrets and plain-HTTP addresses', async () => {
    (prisma.oAuthClient.create as any).mockImplementation(async ({ data }: any) => ({ id: 'cl-2', createdAt: new Date(), clientUri: null, ...data }));
    const ok = await request(app)
      .post('/api/oauth/register')
      .send({ redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], client_name: 'ChatGPT', token_endpoint_auth_method: 'none' })
      .expect(201);
    expect(ok.body.client_id).toMatch(/^fzc_/);
    expect(ok.body.token_endpoint_auth_method).toBe('none');
    expect(ok.body.client_name).toBe('ChatGPT');

    const secret = await request(app)
      .post('/api/oauth/register')
      .send({ redirect_uris: ['https://example.com/cb'], token_endpoint_auth_method: 'client_secret_post' })
      .expect(400);
    expect(secret.body.error).toBe('invalid_client_metadata');

    const http = await request(app).post('/api/oauth/register').send({ redirect_uris: ['http://example.com/cb'] }).expect(400);
    expect(http.body.error).toBe('invalid_client_metadata');
  });

  it('matches redirect addresses exactly, except loopback on any port', () => {
    const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback', 'http://127.0.0.1/callback'];
    expect(redirectAllowed(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectAllowed(registered, 'https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false);
    expect(redirectAllowed(registered, 'https://claude.ai.evil.com/api/mcp/auth_callback')).toBe(false);
    expect(redirectAllowed(registered, 'http://localhost:3118/callback')).toBe(true);
    expect(redirectAllowed(registered, 'http://127.0.0.1:52000/callback')).toBe(true);
    expect(redirectAllowed(registered, 'http://localhost:3118/other')).toBe(false);
    expect(redirectAllowed(registered, 'http://evil.com:3118/callback')).toBe(false);
  });

  it('PKCE: only the verifier behind the challenge gets through', () => {
    expect(pkceOk(verifier, challenge)).toBe(true);
    expect(pkceOk(`${verifier.slice(0, -1)}X`, challenge)).toBe(false);
    expect(pkceOk('short', challenge)).toBe(false);
    expect(pkceOk(undefined, challenge)).toBe(false);
  });
});

describe('the consent screen', () => {
  it('is Management’s to open up: without "Connect AI apps" a person is refused before anything else; Management never is', async () => {
    const res = await request(app).get('/api/oauth/authorize').query(signIn()).set(...as('employee', { connect: false })).expect(403);
    expect(res.body.error).toMatch(/Connect AI apps/);
    expect(res.body.data.fatal).toBe(true);
    expect((await request(app).post('/api/oauth/authorize').set(...as('bd', { connect: false })).send({ decision: 'allow', scopes: [], params: signIn() })).status).toBe(403);
    expect((await request(app).get('/api/oauth/authorize').query(signIn()).set(...as('admin', { connect: false }))).status).toBe(200);

    (prisma.oAuthGrant.findMany as any).mockResolvedValue([]);
    const list = await request(app).get('/api/oauth/grants').set(...as('employee', { connect: false })).expect(200);
    expect(list.body.canConnect).toBe(false);
    expect(list.body.cannotConnectWhy).toMatch(/Management/);
  });

  it('refuses an unknown app, or a known one at an address it did not register, on the page', async () => {
    const unknown = await request(app).get('/api/oauth/authorize').query(signIn({ client_id: 'fzc_nobody' })).set(...as('bd')).expect(400);
    expect(unknown.body.data.fatal).toBe(true);
    expect(unknown.body.error).toMatch(/does not recognise/);

    const wrong = await request(app).get('/api/oauth/authorize').query(signIn({ redirect_uri: 'https://evil.com/cb' })).set(...as('bd')).expect(400);
    expect(wrong.body.data.fatal).toBe(true);
    expect(wrong.body.data.redirectTo).toBeNull();
  });

  it('sends other mistakes back to the app, with the state', async () => {
    const res = await request(app).get('/api/oauth/authorize').query(signIn({ code_challenge: '' })).set(...as('bd')).expect(400);
    expect(res.body.data.fatal).toBe(false);
    const back = new URL(res.body.data.redirectTo);
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get('error')).toBe('invalid_request');
    expect(back.searchParams.get('state')).toBe('st-1');
    expect(back.searchParams.get('iss')).toBe(issuer());
  });

  it('offers only what the person can do themselves, and says what it could not give', async () => {
    const res = await request(app)
      .get('/api/oauth/authorize')
      .query(signIn({ scope: 'tasks:read work:read leads:read' }))
      .set(...as('bd'))
      .expect(200);
    expect(res.body.app).toEqual({ name: 'Claude', host: 'claude.ai', returnsTo: 'claude.ai' });
    expect(res.body.scopes.map((s: any) => s.key)).toEqual(['tasks:read', 'leads:read']);
    expect(res.body.notYours).toEqual(['work:read']);
    expect(res.body.resource).toBe(mcpUrl());
  });

  it('allowing records the consent and hands back a code; declining says so', async () => {
    (prisma.oAuthGrant.findFirst as any).mockResolvedValue(null);
    (prisma.oAuthGrant.create as any).mockResolvedValue({ id: 'grant-1' });
    (prisma.oAuthCode.create as any).mockImplementation(async ({ data }: any) => data);
    const res = await request(app)
      .post('/api/oauth/authorize')
      .set(...as('bd'))
      .send({ decision: 'allow', scopes: ['tasks:read', 'work:read', 'money:read'], params: signIn({ scope: 'tasks:read work:read' }) })
      .expect(200);
    const back = new URL(res.body.redirectTo);
    expect(back.searchParams.get('code')).toMatch(/^fz_ac_/);
    expect(back.searchParams.get('state')).toBe('st-1');
    expect(back.searchParams.get('iss')).toBe(issuer());
    // Ticked ∩ offered: money:read was never asked for, work:read is not BD's.
    const code = (prisma.oAuthCode.create as any).mock.calls[0][0].data;
    expect(code.scopes).toEqual(['tasks:read']);
    expect(code.codeChallenge).toBe(challenge);
    expect(code.redirectUri).toBe(CALLBACK);
    expect((prisma.activity.create as any).mock.calls[0][0].data).toMatchObject({ verb: 'connector_connected', entityId: 'usr-bd' });

    const no = await request(app).post('/api/oauth/authorize').set(...as('bd')).send({ decision: 'deny', scopes: [], params: signIn() }).expect(200);
    expect(new URL(no.body.redirectTo).searchParams.get('error')).toBe('access_denied');
  });
});

describe('the token endpoint', () => {
  const code = `fz_ac_${'c'.repeat(43)}`;
  const codeRow = (extra: Record<string, unknown> = {}) => ({
    id: 'code-1',
    grantId: 'grant-1',
    codeHash: hashKey(code),
    redirectUri: CALLBACK,
    codeChallenge: challenge,
    scopes: ['tasks:read', 'leads:read'],
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    createdAt: new Date(),
    grant: grantRow('bd', ['tasks:read', 'leads:read']),
    ...extra,
  });
  const exchange = (body: Record<string, string | undefined>) =>
    request(app)
      .post('/api/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code, client_id: CLAUDE.clientId, redirect_uri: CALLBACK, code_verifier: verifier, ...body });

  it('exchanges the code once, as a form, for a token pair', async () => {
    (prisma.oAuthCode.findUnique as any).mockResolvedValue(codeRow());
    (prisma.oAuthCode.updateMany as any).mockResolvedValue({ count: 1 });
    const res = await exchange({}).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.access_token).toMatch(/^fz_at_[0-9A-Za-z]{43}$/);
    expect(res.body.refresh_token).toMatch(/^fz_rt_[0-9A-Za-z]{43}$/);
    expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'tasks:read leads:read' });
    // Stored as hashes only.
    const stored = (prisma.oAuthToken.create as any).mock.calls.map((c: any) => c[0].data);
    expect(stored.map((d: any) => d.kind)).toEqual(['ACCESS', 'REFRESH']);
    expect(stored[0].tokenHash).toBe(hashKey(res.body.access_token));
    expect(stored.every((d: any) => !JSON.stringify(d).includes(res.body.access_token))).toBe(true);
  });

  it('refuses the wrong verifier, address or client with invalid_grant', async () => {
    (prisma.oAuthCode.findUnique as any).mockResolvedValue(codeRow());
    for (const bad of [{ code_verifier: `${verifier.slice(0, -1)}X` }, { redirect_uri: 'https://claude.ai/other' }, { client_id: 'fzc_other' }]) {
      const res = await exchange(bad).expect(400);
      expect(res.body.error).toBe('invalid_grant');
    }
    expect(prisma.oAuthToken.create).not.toHaveBeenCalled();
  });

  it('a code presented twice revokes the whole connection', async () => {
    (prisma.oAuthCode.findUnique as any).mockResolvedValue(codeRow({ usedAt: new Date() }));
    const res = await exchange({}).expect(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(prisma.oAuthGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'grant-1', revokedAt: null } }));
  });

  it('refreshes with rotation; a rotated token coming back revokes the connection', async () => {
    const refresh = `fz_rt_${'r'.repeat(43)}`;
    const row = {
      id: 'rt-old',
      grantId: 'grant-1',
      kind: 'REFRESH',
      tokenHash: hashKey(refresh),
      scopes: ['tasks:read', 'leads:read'],
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
      replacedById: null,
      grant: grantRow('bd', ['tasks:read', 'leads:read']),
    };
    (prisma.oAuthToken.findUnique as any).mockResolvedValue(row);
    const ok = await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: refresh, scope: 'tasks:read' }).expect(200);
    expect(ok.body.scope).toBe('tasks:read');
    expect(ok.body.refresh_token).not.toBe(refresh);
    expect(prisma.oAuthToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'rt-old', revokedAt: null } }));
    expect(prisma.oAuthToken.update).toHaveBeenCalledWith(expect.objectContaining({ data: { replacedById: 'rt-new' } }));

    (prisma.oAuthToken.findUnique as any).mockResolvedValue({ ...row, revokedAt: new Date(), replacedById: 'rt-new' });
    const stolen = await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: refresh }).expect(400);
    expect(stolen.body.error).toBe('invalid_grant');
    expect(prisma.oAuthGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'grant-1', revokedAt: null } }));
  });

  it('answers an unknown grant type in the protocol’s words', async () => {
    const res = await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'client_credentials' }).expect(400);
    expect(res.body).toEqual({ error: 'unsupported_grant_type', error_description: expect.any(String) });
  });
});

describe('a token at the MCP door', () => {
  const access = `fz_at_${'t'.repeat(43)}`;
  const tokenRow = (who: Who, scopes: string[], extra: Record<string, unknown> = {}) => ({
    id: 'at-1',
    grantId: 'grant-1',
    kind: 'ACCESS',
    tokenHash: hashKey(access),
    scopes,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    lastUsedAt: new Date(),
    revokedAt: null,
    replacedById: null,
    grant: grantRow(who, scopes),
    ...extra,
  });
  const tools = () =>
    request(app)
      .post('/api/mcp')
      .set('Authorization', `Bearer ${access}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

  it('opens it as the person who consented, with what they ticked — narrowed to what they still hold', async () => {
    (prisma.oAuthToken.findUnique as any).mockResolvedValue(tokenRow('employee', ['tasks:read', 'tasks:write', 'money:read']));
    const res = await tools().expect(200);
    // An employee holds no money.status, so money:read falls away however it was ticked.
    const expected = toolsFor(scopesFor(session('employee')).filter((s) => ['tasks:read', 'tasks:write', 'money:read'].includes(s)));
    expect(res.body.result.tools.map((t: any) => t.name)).toEqual(expected.map((t) => t.name));
    expect(res.body.result.tools.map((t: any) => t.name)).not.toContain('list_invoices');
  });

  it('is refused once revoked, expired, or API keys are switched off', async () => {
    const code = async () => {
      const res = await tools();
      return [res.status, res.body.error.code, /error="invalid_token"/.test(res.headers['www-authenticate'] ?? '')];
    };
    (prisma.oAuthToken.findUnique as any).mockResolvedValue(tokenRow('bd', ['tasks:read'], { revokedAt: new Date() }));
    expect(await code()).toEqual([401, 'invalid_token', true]);
    (prisma.oAuthToken.findUnique as any).mockResolvedValue(tokenRow('bd', ['tasks:read'], { expiresAt: new Date(Date.now() - 1) }));
    expect(await code()).toEqual([401, 'invalid_token', true]);
    (prisma.oAuthToken.findUnique as any).mockResolvedValue(tokenRow('bd', ['tasks:read'], { grant: grantRow('bd', ['tasks:read'], { revokedAt: new Date() }) }));
    expect(await code()).toEqual([401, 'grant_revoked', true]);
    (prisma.oAuthToken.findUnique as any).mockResolvedValue(
      tokenRow('bd', ['tasks:read'], { grant: grantRow('bd', ['tasks:read'], { organization: { apiEnabled: false } }) }),
    );
    expect(await code()).toEqual([401, 'api_disabled', true]);
    // Management took "Connect AI apps" off them: every token they had stops.
    (prisma.oAuthToken.findUnique as any).mockResolvedValue(
      tokenRow('bd', ['tasks:read'], { grant: grantRow('bd', ['tasks:read'], { user: userRow('bd', { connect: false }) }) }),
    );
    expect(await code()).toEqual([401, 'not_allowed', true]);
  });

  it('writes made through it say "via Claude connector"', () => {
    const row = { organizationId: 'org-1', entityType: 'Task', entityId: 't-1', verb: 'task_created', payload: { title: 'x' } };
    const stamped = apiCall.run({ kind: 'connector', keyId: 'grant-1', keyName: 'Claude' }, () => stampVia(row));
    expect(stamped.payload).toEqual({ title: 'x', via: 'Claude connector', oauthGrantId: 'grant-1' });
    expect(viaWords(stamped.payload)).toBe('via Claude connector');
  });
});

describe('connected apps in Settings', () => {
  const listed = (who: Who) => ({
    ...grantRow(who, ['tasks:read']),
    client: { id: CLAUDE.id, name: 'Claude', clientId: CLAUDE.clientId, clientUri: 'https://claude.ai', kind: 'CIMD' },
    user: { id: PEOPLE[who].id, name: PEOPLE[who].name, active: true },
    revokedBy: null,
  });

  it('each person sees their own; an admin sees everyone’s', async () => {
    (prisma.oAuthGrant.findMany as any).mockResolvedValue([listed('employee')]);
    const mine = await request(app).get('/api/oauth/grants').set(...as('employee')).expect(200);
    expect(mine.body.all).toBe(false);
    expect((prisma.oAuthGrant.findMany as any).mock.calls[0][0].where).toEqual({ organizationId: 'org-1', userId: 'usr-emp' });
    expect(mine.body.grants[0]).toMatchObject({ app: { name: 'Claude', host: 'claude.ai' }, status: 'active', scopes: ['tasks:read'] });

    const all = await request(app).get('/api/oauth/grants').set(...as('admin')).expect(200);
    expect(all.body.all).toBe(true);
    expect((prisma.oAuthGrant.findMany as any).mock.calls[1][0].where).toEqual({ organizationId: 'org-1' });
  });

  it('revoking is the person’s own, or an admin’s; somebody else’s is not found', async () => {
    (prisma.oAuthGrant.findFirst as any).mockResolvedValue(listed('bd'));
    expect((await request(app).post('/api/oauth/grants/grant-1/revoke').set(...as('employee'))).status).toBe(404);

    (prisma.oAuthGrant.update as any).mockResolvedValue({ ...listed('bd'), revokedAt: new Date(), revokedBy: { id: 'usr-admin', name: 'Harish' } });
    const res = await request(app).post('/api/oauth/grants/grant-1/revoke').set(...as('admin')).expect(200);
    expect(res.body.grant.status).toBe('revoked');
    expect((prisma.activity.create as any).mock.calls.at(-1)[0].data).toMatchObject({ verb: 'connector_revoked', entityId: 'usr-bd', actorId: 'usr-admin' });
  });
});
