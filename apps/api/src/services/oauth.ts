import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hasPermission, sessionOf, type UserSession } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { appUrl } from './publicApi/core.js';
import { SCOPE_KEYS, base62, hashKey, isScope, sameHash, scopesFor, type ApiScope } from './apiKeys.js';

/**
 * "Sign in with Flowzen" (API Plan 2): Flowzen as an OAuth 2.1 authorization
 * server, for the MCP endpoint only.
 *
 * Claude.ai, Claude Desktop, Claude mobile and ChatGPT connect to a remote MCP
 * server through OAuth: the person signs in, a consent screen asks what the
 * app may do, and the app gets tokens. This file is that server — discovery
 * metadata, who the client is, the consent, the code, the tokens — and nothing
 * past the sign-in, which is API Plan 1's: a token acts as the person who
 * consented, narrowed to the scopes they ticked, re-checked against their
 * permissions on every call.
 *
 * What the apps need, from their published requirements (checked 2026-11-05):
 * PKCE S256 on every sign-in; a client identified either by its own metadata
 * document (CIMD — "Use Claude's published identity") or registered here (DCR);
 * public clients, so the token endpoint takes no secret; refresh tokens that
 * rotate; `invalid_grant` when one is dead; and discovery at the well-known
 * paths with `resource` exactly the MCP URL as typed into the app.
 *
 * Tokens are stored as HMACs with the same pepper as API keys, so the
 * database alone cannot be turned into working tokens.
 */

// ── Where things are ─────────────────────────────────────────────────────────

/** The authorization server's issuer: the app's own origin. */
export const issuer = (): string => appUrl();

/**
 * Where the public API answers from outside: `${app}/api` behind Apache (and
 * through the Next proxy in development). PUBLIC_API_URL overrides it for a
 * deployment that serves the API from another address.
 */
export const publicApiUrl = (): string => (process.env.PUBLIC_API_URL || `${appUrl()}/api`).replace(/\/+$/, '');

/** The protected resource: the MCP endpoint, exactly as a person types it into Claude. */
export const mcpUrl = (): string => `${publicApiUrl()}/mcp`;

/** Where the 401 points: served under /api, which the proxy already routes. */
export const protectedResourceMetadataUrl = (): string => `${publicApiUrl()}/.well-known/oauth-protected-resource`;

export function authorizationServerMetadata() {
  const iss = issuer();
  const api = publicApiUrl();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${api}/oauth/token`,
    registration_endpoint: `${api}/oauth/register`,
    revocation_endpoint: `${api}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [...SCOPE_KEYS],
    service_documentation: `${iss}/settings?tab=api`,
  };
}

export function protectedResourceMetadata() {
  return {
    resource: mcpUrl(),
    authorization_servers: [issuer()],
    scopes_supported: [...SCOPE_KEYS],
    bearer_methods_supported: ['header'],
    resource_name: 'Flowzen',
    resource_documentation: `${issuer()}/settings?tab=api`,
  };
}

/** A message as a header allows it: printable ASCII, no quotes. "Settings → API" becomes "Settings -> API". */
const headerText = (s: string): string =>
  s
    .replace(/→/g, '->')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '');

/** The `WWW-Authenticate` header on a 401 from /api/mcp — how an app finds the sign-in. */
export function wwwAuthenticate(error?: string, description?: string): string {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl()}"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${headerText(description)}"`);
  parts.push(`scope="${SCOPE_KEYS.join(' ')}"`);
  return `Bearer ${parts.join(', ')}`;
}

// ── Tokens ───────────────────────────────────────────────────────────────────

export const ACCESS_PREFIX = 'fz_at_';
export const REFRESH_PREFIX = 'fz_rt_';
const CODE_PREFIX = 'fz_ac_';
const DCR_CLIENT_PREFIX = 'fzc_';

export const ACCESS_TOKEN_MINUTES = 60;
export const REFRESH_TOKEN_DAYS = 90;
export const CODE_MINUTES = 10;
/** How long a client's metadata document is trusted before it is read again. */
const CIMD_FRESH_HOURS = 24;

const secret = () => base62(randomBytes(32));
export const TOKEN_PATTERN = /^fz_(at|rt|ac)_[0-9A-Za-z]{43}$/;

/** `invalid_grant`, `invalid_request`… — a refusal in the shape OAuth clients read. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
    this.name = 'OAuthError';
  }
}

/** PKCE: whether `code_verifier` is the one behind `code_challenge` (S256). */
export function pkceOk(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Redirect URIs ────────────────────────────────────────────────────────────

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether an address may be registered: HTTPS, or plain HTTP only back to this machine. */
export function redirectUriValid(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && LOOPBACK.has(u.hostname);
}

/**
 * Whether a sign-in may be sent back to `uri`: exactly one the client
 * registered, except that a loopback address matches on any port — Claude
 * Code listens on a port it picks per session (RFC 8252 §7.3).
 */
export function redirectAllowed(registered: readonly string[], uri: string): boolean {
  if (!redirectUriValid(uri)) return false;
  if (registered.includes(uri)) return true;
  const asked = new URL(uri);
  if (!LOOPBACK.has(asked.hostname)) return false;
  return registered.some((r) => {
    try {
      const reg = new URL(r);
      return reg.protocol === asked.protocol && reg.hostname === asked.hostname && reg.pathname === asked.pathname;
    } catch {
      return false;
    }
  });
}

/** The address to send the browser back to, with the answer in its query. */
export function redirectTo(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

// ── Clients ──────────────────────────────────────────────────────────────────

export type ClientRow = { id: string; clientId: string; kind: string; name: string; redirectUris: string[]; clientUri: string | null };

const CLIENT_SELECT = { id: true, clientId: true, kind: true, name: true, redirectUris: true, clientUri: true } as const;

const redirectUrisSchema = z.array(z.string().max(2000).refine(redirectUriValid, 'Each redirect_uri must be HTTPS, or HTTP to localhost')).min(1).max(10);

/** What a client says about itself — by DCR (RFC 7591) or in its metadata document. */
const clientMetadataSchema = z.object({
  redirect_uris: redirectUrisSchema,
  client_name: z.string().trim().max(100).optional(),
  client_uri: z.string().url().max(2000).optional(),
  token_endpoint_auth_method: z.string().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

/** Whether a client can sign in the only way this server offers: as a public client. */
const publicClientOk = (m: z.infer<typeof clientMetadataSchema>): boolean => {
  if (m.token_endpoint_auth_methods_supported?.length) return m.token_endpoint_auth_methods_supported.includes('none');
  return !m.token_endpoint_auth_method || m.token_endpoint_auth_method === 'none';
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/** A name worth showing on the consent screen: what the app calls itself, else its host. */
const nameFor = (m: { client_name?: string }, fallbackUrl: string): string => m.client_name?.trim() || hostOf(fallbackUrl);

/** Register a client that cannot or does not publish a metadata document (DCR). */
export async function registerClient(body: unknown): Promise<ClientRow & { createdAt: Date }> {
  const parsed = clientMetadataSchema.safeParse(body);
  if (!parsed.success) {
    throw new OAuthError('invalid_client_metadata', parsed.error.issues[0]?.message ?? 'The client metadata is not valid.');
  }
  const m = parsed.data;
  if (!publicClientOk(m)) {
    throw new OAuthError('invalid_client_metadata', 'Only public clients are supported: token_endpoint_auth_method must be "none".');
  }
  if (m.grant_types?.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
    throw new OAuthError('invalid_client_metadata', 'Only the authorization_code and refresh_token grants are supported.');
  }
  if (m.response_types?.some((r) => r !== 'code')) {
    throw new OAuthError('invalid_client_metadata', 'Only the "code" response type is supported.');
  }
  return prisma.oAuthClient.create({
    data: {
      clientId: `${DCR_CLIENT_PREFIX}${secret()}`,
      kind: 'DCR',
      name: nameFor(m, m.redirect_uris[0]),
      redirectUris: m.redirect_uris,
      clientUri: m.client_uri ?? null,
    },
    select: { ...CLIENT_SELECT, createdAt: true },
  });
}

/** A private or local address, which a metadata document is never fetched from in production. */
const privateHost = (hostname: string): boolean =>
  LOOPBACK.has(hostname) ||
  hostname.endsWith('.local') ||
  hostname.endsWith('.internal') ||
  /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\.|^0\./.test(hostname) ||
  /^\[?(fc|fd|fe80)/i.test(hostname);

/** Whether a client_id is the kind that is a document: an HTTPS URL with a path. */
export const isCimdId = (clientId: string): boolean => {
  try {
    const u = new URL(clientId);
    return u.protocol === 'https:' && u.pathname !== '/' && !u.hash && !u.username && !u.password && !u.search;
  } catch {
    return false;
  }
};

/** Reads a Client ID Metadata Document. Null when it cannot be read or does not describe `clientId`. */
async function fetchCimd(clientId: string): Promise<z.infer<typeof clientMetadataSchema> | null> {
  const host = new URL(clientId).hostname;
  if (process.env.NODE_ENV === 'production' && privateHost(host)) return null;
  try {
    const res = await fetch(clientId, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 64 * 1024) return null;
    const json = JSON.parse(text) as Record<string, unknown>;
    // The document must name itself — otherwise any JSON file could claim any client.
    if (json.client_id !== clientId) return null;
    const parsed = clientMetadataSchema.safeParse(json);
    if (!parsed.success || !publicClientOk(parsed.data)) return null;
    return parsed.data;
  } catch (e) {
    logger.warn(`OAuth: could not read the client metadata document ${clientId}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Who `client_id` is. A metadata URL is fetched the first time and once a day
 * after that; a registered id is looked up. Null for anything unknown.
 */
export async function resolveClient(clientId: string): Promise<ClientRow | null> {
  if (!clientId || clientId.length > 2000) return null;
  if (!isCimdId(clientId)) {
    return prisma.oAuthClient.findUnique({ where: { clientId }, select: CLIENT_SELECT });
  }
  const known = await prisma.oAuthClient.findUnique({ where: { clientId }, select: { ...CLIENT_SELECT, fetchedAt: true } });
  const fresh = known?.fetchedAt && Date.now() - known.fetchedAt.getTime() < CIMD_FRESH_HOURS * 3_600_000;
  if (known && fresh) return known;
  const doc = await fetchCimd(clientId);
  if (!doc) return known ?? null;
  const data = { name: nameFor(doc, clientId), redirectUris: doc.redirect_uris, clientUri: doc.client_uri ?? null, fetchedAt: new Date() };
  return known
    ? prisma.oAuthClient.update({ where: { id: known.id }, data, select: CLIENT_SELECT })
    : prisma.oAuthClient.create({ data: { clientId, kind: 'CIMD', ...data }, select: CLIENT_SELECT });
}

// ── The sign-in request ──────────────────────────────────────────────────────

export const authorizeParamsSchema = z.object({
  client_id: z.string().min(1).max(2000),
  redirect_uri: z.string().max(2000).optional(),
  response_type: z.string().max(40).optional(),
  state: z.string().max(2000).optional(),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(20).optional(),
  scope: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
});
export type AuthorizeParams = z.infer<typeof authorizeParamsSchema>;

/** The scopes an app asked for, in words this server knows. Nothing asked means everything. */
export function requestedScopes(scope: string | undefined): ApiScope[] {
  const asked = (scope ?? '').split(/\s+/).filter(Boolean);
  if (!asked.length) return [...SCOPE_KEYS];
  return SCOPE_KEYS.filter((s) => asked.includes(s));
}

export type AuthorizeCheck =
  | { ok: true; client: ClientRow; redirectUri: string; requested: ApiScope[]; offered: ApiScope[] }
  /** Nothing can be sent back: the client or its address is wrong. */
  | { ok: false; fatal: true; message: string }
  /** The app is told why, at its own address. */
  | { ok: false; fatal: false; message: string; redirectTo: string };

/**
 * Whether this sign-in request can go ahead for this person. The client and
 * its address are checked before anything is sent to that address — a wrong
 * one gets an error on the page, never a redirect (RFC 6749 §4.1.2.1).
 */
export async function checkAuthorize(params: AuthorizeParams, user: UserSession): Promise<AuthorizeCheck> {
  const client = await resolveClient(params.client_id);
  if (!client) return { ok: false, fatal: true, message: 'Flowzen does not recognise the app asking to connect.' };

  const redirectUri = params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !redirectAllowed(client.redirectUris, redirectUri)) {
    return { ok: false, fatal: true, message: `${client.name} asked to be sent back to an address it did not register.` };
  }

  const refuse = (error: string, message: string): AuthorizeCheck => ({
    ok: false,
    fatal: false,
    message,
    redirectTo: redirectTo(redirectUri, { error, error_description: message, state: params.state, iss: issuer() }),
  });
  if (params.response_type !== 'code') return refuse('unsupported_response_type', 'Only the authorization code flow is supported.');
  if (!params.code_challenge || params.code_challenge_method !== 'S256') {
    return refuse('invalid_request', 'A PKCE code_challenge with method S256 is required.');
  }
  if (params.resource && params.resource !== mcpUrl()) {
    return refuse('invalid_target', `This sign-in is for ${mcpUrl()} only.`);
  }

  const requested = requestedScopes(params.scope);
  const allowed = scopesFor(user);
  const offered = requested.filter((s) => allowed.includes(s));
  if (!offered.length) {
    return refuse('access_denied', 'Nothing this app asks for is something you can do in Flowzen.');
  }
  return { ok: true, client, redirectUri, requested, offered };
}

/** Where a declined sign-in sends the browser. */
export const deniedRedirect = (redirectUri: string, state: string | undefined): string =>
  redirectTo(redirectUri, { error: 'access_denied', error_description: 'The person did not allow it.', state, iss: issuer() });

/**
 * The person said yes: remember the consent (one grant per person and app),
 * and hand back a code the app can exchange within minutes. The scopes are
 * what they ticked, never more than was asked or than they hold.
 */
export async function consent(
  user: UserSession,
  check: Extract<AuthorizeCheck, { ok: true }>,
  ticked: readonly string[],
  params: Pick<AuthorizeParams, 'state' | 'code_challenge'>,
): Promise<{ redirectTo: string; grantId: string; scopes: ApiScope[]; created: boolean }> {
  const scopes = check.offered.filter((s) => ticked.includes(s));
  if (!scopes.length) throw new OAuthError('invalid_scope', 'Tick at least one thing the app may do.');

  const existing = await prisma.oAuthGrant.findFirst({
    where: { userId: user.userId, clientId: check.client.id, revokedAt: null },
    select: { id: true },
  });
  const grant = existing
    ? await prisma.oAuthGrant.update({ where: { id: existing.id }, data: { scopes }, select: { id: true } })
    : await prisma.oAuthGrant.create({
        data: { organizationId: user.organizationId, userId: user.userId, clientId: check.client.id, scopes },
        select: { id: true },
      });

  const code = `${CODE_PREFIX}${secret()}`;
  await prisma.oAuthCode.create({
    data: {
      grantId: grant.id,
      codeHash: hashKey(code),
      redirectUri: check.redirectUri,
      codeChallenge: params.code_challenge!,
      scopes,
      expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
    },
  });
  return { redirectTo: redirectTo(check.redirectUri, { code, state: params.state, iss: issuer() }), grantId: grant.id, scopes, created: !existing };
}

// ── The token endpoint ───────────────────────────────────────────────────────

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

const GRANT_INCLUDE = {
  client: { select: { id: true, clientId: true, name: true } },
  organization: { select: { apiEnabled: true } },
  user: { select: { id: true, organizationId: true, email: true, name: true, preset: true, permissions: true, active: true } },
} as const;

type GrantWithPeople = NonNullable<Awaited<ReturnType<typeof grantById>>>;
const grantById = (id: string) => prisma.oAuthGrant.findUnique({ where: { id }, include: GRANT_INCLUDE });

/** What stands between a person and connecting an app, in words for the screen. Null when nothing does. */
export const CONNECT_PERMISSION = 'api.connect' as const;
export const cannotConnect = (user: UserSession): string | null =>
  hasPermission(user, CONNECT_PERMISSION)
    ? null
    : 'Connecting AI apps is switched on per person by Management (Team → Access & permissions → "Connect AI apps"). Ask them to switch it on for you.';

/**
 * Whether tokens under this grant may still be used, or why not. The person
 * must still be allowed to connect apps at all — Management can take that
 * away from the team screen, and every token they had stops with it.
 */
export function grantUsable(g: {
  revokedAt: Date | null;
  organization: { apiEnabled: boolean };
  user: Parameters<typeof sessionOf>[0];
}): { ok: true } | { ok: false; code: string; message: string } {
  if (g.revokedAt) return { ok: false, code: 'grant_revoked', message: 'This connection was revoked in Flowzen. Connect again to continue.' };
  if (!g.organization.apiEnabled) {
    return { ok: false, code: 'api_disabled', message: 'API access is switched off for this organisation. An admin can turn it on in Settings → API.' };
  }
  if (!g.user.active) return { ok: false, code: 'creator_inactive', message: 'This person no longer has access to Flowzen.' };
  if (cannotConnect(sessionOf(g.user))) {
    return { ok: false, code: 'not_allowed', message: 'This person is no longer allowed to connect AI apps to Flowzen.' };
  }
  return { ok: true };
}

/** A new access token and a new refresh token under a grant. */
async function issueTokens(grantId: string, scopes: ApiScope[]): Promise<{ response: TokenResponse; refreshId: string }> {
  const now = Date.now();
  const access = `${ACCESS_PREFIX}${secret()}`;
  const refresh = `${REFRESH_PREFIX}${secret()}`;
  await prisma.oAuthToken.create({
    data: { grantId, kind: 'ACCESS', tokenHash: hashKey(access), scopes, expiresAt: new Date(now + ACCESS_TOKEN_MINUTES * 60_000) },
  });
  const r = await prisma.oAuthToken.create({
    data: { grantId, kind: 'REFRESH', tokenHash: hashKey(refresh), scopes, expiresAt: new Date(now + REFRESH_TOKEN_DAYS * 86_400_000) },
    select: { id: true },
  });
  return {
    refreshId: r.id,
    response: { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_MINUTES * 60, refresh_token: refresh, scope: scopes.join(' ') },
  };
}

const revokeGrant = (id: string) => prisma.oAuthGrant.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });

const invalidGrant = (why: string) => new OAuthError('invalid_grant', why);

export const tokenRequestSchema = z.object({
  grant_type: z.string().max(40).optional(),
  code: z.string().max(200).optional(),
  redirect_uri: z.string().max(2000).optional(),
  client_id: z.string().max(2000).optional(),
  code_verifier: z.string().max(200).optional(),
  refresh_token: z.string().max(200).optional(),
  scope: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
});

/** The code from the consent screen, exchanged once for tokens. */
export async function exchangeCode(body: z.infer<typeof tokenRequestSchema>): Promise<TokenResponse> {
  if (!body.code || !TOKEN_PATTERN.test(body.code)) throw invalidGrant('The code is missing or not one this server issued.');
  if (!body.client_id) throw new OAuthError('invalid_request', 'client_id is required.');
  if (body.resource && body.resource !== mcpUrl()) throw new OAuthError('invalid_target', `Tokens here are for ${mcpUrl()} only.`);

  const row = await prisma.oAuthCode.findUnique({ where: { codeHash: hashKey(body.code) }, include: { grant: { include: GRANT_INCLUDE } } });
  if (!row || !sameHash(row.codeHash, hashKey(body.code))) throw invalidGrant('The code is not recognised.');
  if (row.usedAt) {
    // A code presented twice is a code somebody else saw. Nothing under the
    // grant can be trusted (RFC 6749 §4.1.2).
    await revokeGrant(row.grantId);
    throw invalidGrant('The code was already used. The connection has been revoked; connect again.');
  }
  if (row.expiresAt.getTime() <= Date.now()) throw invalidGrant('The code has expired. Start the sign-in again.');
  if (row.grant.client.clientId !== body.client_id) throw invalidGrant('The code was issued to a different client.');
  if (body.redirect_uri !== row.redirectUri) throw invalidGrant('redirect_uri does not match the sign-in.');
  if (!pkceOk(body.code_verifier, row.codeChallenge)) throw invalidGrant('The PKCE code_verifier does not match.');
  const usable = grantUsable(row.grant);
  if (!usable.ok) throw invalidGrant(usable.message);

  const claimed = await prisma.oAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw invalidGrant('The code was already used.');

  const scopes = SCOPE_KEYS.filter((s) => row.scopes.includes(s));
  return (await issueTokens(row.grantId, scopes)).response;
}

/** A refresh token for a new pair; the old one stops working as the new one starts. */
export async function refreshTokens(body: z.infer<typeof tokenRequestSchema>): Promise<TokenResponse> {
  if (!body.refresh_token || !TOKEN_PATTERN.test(body.refresh_token) || !body.refresh_token.startsWith(REFRESH_PREFIX)) {
    throw invalidGrant('The refresh token is missing or not one this server issued.');
  }
  const hash = hashKey(body.refresh_token);
  const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: hash }, include: { grant: { include: GRANT_INCLUDE } } });
  if (!row || row.kind !== 'REFRESH' || !sameHash(row.tokenHash, hash)) throw invalidGrant('The refresh token is not recognised.');
  if (body.client_id && row.grant.client.clientId !== body.client_id) throw invalidGrant('The refresh token belongs to a different client.');
  if (row.revokedAt) {
    if (row.replacedById) {
      // Rotated tokens are single-use. One coming back after its replacement
      // was issued means two parties hold it; neither keeps the grant.
      await revokeGrant(row.grantId);
      throw invalidGrant('This refresh token was already used. The connection has been revoked; connect again.');
    }
    throw invalidGrant('This refresh token was revoked.');
  }
  if (row.expiresAt.getTime() <= Date.now()) throw invalidGrant('The refresh token has expired. Sign in again.');
  const usable = grantUsable(row.grant);
  if (!usable.ok) throw invalidGrant(usable.message);

  // Narrower on request, never wider than the sign-in.
  const have = SCOPE_KEYS.filter((s) => row.scopes.includes(s));
  const asked = body.scope ? body.scope.split(/\s+/).filter(isScope) : have;
  const scopes = have.filter((s) => asked.includes(s));
  if (!scopes.length) throw new OAuthError('invalid_scope', 'None of the scopes asked for were granted at sign-in.');

  const rotated = await prisma.oAuthToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (rotated.count !== 1) throw invalidGrant('This refresh token was already used.');
  const issued = await issueTokens(row.grantId, scopes);
  await prisma.oAuthToken.update({ where: { id: row.id }, data: { replacedById: issued.refreshId } });
  return issued.response;
}

/**
 * RFC 7009: the app says it is done with a token. A refresh token takes the
 * whole connection with it; an access token just itself. Unknown tokens are
 * ignored, as the RFC says — the answer is always "fine".
 */
export async function revokeToken(token: string | undefined): Promise<void> {
  if (!token || !TOKEN_PATTERN.test(token)) return;
  const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: hashKey(token) }, select: { id: true, kind: true, grantId: true } });
  if (!row) return;
  if (row.kind === 'REFRESH') await revokeGrant(row.grantId);
  else await prisma.oAuthToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
}

// ── The door: an access token on /api/mcp ────────────────────────────────────

export type ConnectorCaller = {
  grantId: string;
  appName: string;
  user: UserSession;
  scopes: string[];
  stale: boolean;
};

/**
 * Who an access token is: the grant it sits under and the person who
 * consented. Every reason it cannot be used has its own code, like a key's.
 */
export async function resolveAccessToken(
  token: string,
): Promise<{ ok: true; caller: ConnectorCaller } | { ok: false; code: string; message: string }> {
  if (!TOKEN_PATTERN.test(token) || !token.startsWith(ACCESS_PREFIX)) {
    return { ok: false, code: 'invalid_token', message: 'That is not a Flowzen access token.' };
  }
  const hash = hashKey(token);
  const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: hash }, include: { grant: { include: GRANT_INCLUDE } } });
  if (!row || row.kind !== 'ACCESS' || !sameHash(row.tokenHash, hash)) {
    return { ok: false, code: 'invalid_token', message: 'This access token is not recognised.' };
  }
  if (row.revokedAt) return { ok: false, code: 'invalid_token', message: 'This access token was revoked.' };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, code: 'invalid_token', message: 'This access token has expired. Refresh it.' };
  const usable = grantUsable(row.grant);
  if (!usable.ok) return { ok: false, code: usable.code, message: usable.message };
  const user = sessionOf(row.grant.user);
  return {
    ok: true,
    caller: {
      grantId: row.grantId,
      appName: row.grant.client.name,
      user,
      scopes: row.scopes,
      stale: !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000,
    },
  };
}

export type { GrantWithPeople };
