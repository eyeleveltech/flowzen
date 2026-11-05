# Flowzen — Deploy Guide

Run everything on the VPS in /var/www/flowzen.
The deploy command never changed:  git pull && docker compose build && docker compose up -d
The API container now automatically backs up the DB -> applies migrations -> starts.

## Scenario A — Code change only (NO schema change)  <- 99% of deploys
cd /var/www/flowzen
git pull
docker compose build
docker compose up -d
docker compose logs -f api
# Log shows: "Backup saved..." then "No pending migrations to apply." then API running. Done.

## Scenario B — You changed schema.prisma
cd /var/www/flowzen
git pull
./scripts/db-make-migration.sh my_change   # generates SQL: live DB -> new schema
#   >>> READ the printed SQL (data-loss gate) <<<
#   - DROP COLUMN/TABLE you didn't intend? STOP.
#   - rename as drop+add? edit to: ALTER TABLE "x" RENAME COLUMN "old" TO "new";
#   - ADD COLUMN ... NOT NULL on a table with rows? add a DEFAULT.
docker compose build
docker compose up -d
docker compose logs -f api                  # should show: Applying migration ...
# Then commit the migration (see Sync section).

## Recovery — "I broke the database"
docker compose exec -T api sh -c 'ls -lh /backups/pre-migration/'        # list backups
docker compose stop api
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'
docker compose exec -T api sh -c 'gunzip -c /backups/pre-migration/<FILE>.sql.gz' | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose up -d api

## Rules
- NEVER run prisma db push or --accept-data-loss on production.
- Always READ the migration SQL before building (Scenario B).
- One-time only (already done): ./scripts/db-baseline.sh — never run again.
- Manual backup anytime:
  docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > ~/manual-backup-$(date +%F-%H%M).sql.gz

## Google Calendar connection (one-time setup, optional)
People can connect their own company Google Calendar from Profile. It needs a Google
Cloud project owned by the company Workspace. Personal Gmail accounts are not supported.

1. In the Workspace-owned Google Cloud console (console.cloud.google.com), create a
   project and enable the **Google Calendar API**.
2. **OAuth consent screen**:
   - User type: **Internal** (no Google app review, no 7-day token expiry)
   - App name: Flowzen
   - Scopes, exactly these three:
     - `openid` and `email`
     - `https://www.googleapis.com/auth/calendar.events.readonly`
     - `https://www.googleapis.com/auth/calendar.app.created`
3. **Credentials** → Create credentials → OAuth client ID → type **Web application**,
   with these authorised redirect URIs:
   - `https://<production domain>/api/google/callback`
   - `http://localhost:4000/api/google/callback` (or whatever the local API port is)
4. **Server env** — add to `/var/www/flowzen/.env`, then Scenario A (rebuild and restart):
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=https://<production domain>/api/google/callback
   ```
5. If the Workspace restricts third-party apps: Google Admin console → Security →
   API controls → mark the Flowzen client ID as **Trusted**.
6. In Flowzen: **Settings → Integrations** → switch **Google Calendar connection** on.
   The tab only appears once the server has all three keys.

Then each person connects from **Profile → Google Calendar**. Disconnecting there revokes
Flowzen's access, deletes what Flowzen stored, and deletes the "Flowzen" calendar from
their Google.

## Phone notifications (one-time setup, optional)
Approvals, bookings and task changes can reach people's phones as notifications
(standard Web Push — free, no third-party account). Android works in Chrome; an iPhone
works only once Flowzen is added to the Home Screen (iOS 16.4+) and opened from there.

1. Generate the keys **once**, on any machine:
   ```
   npx web-push generate-vapid-keys
   ```
2. **Server env** — add to `/var/www/flowzen/.env`, then Scenario A (rebuild and restart):
   ```
   VAPID_PUBLIC_KEY=<the public key>
   VAPID_PRIVATE_KEY=<the private key>
   VAPID_SUBJECT=mailto:<an admin email>
   ```
   **Never commit the keys.** `.env.example` lists the names with no values.
3. **Keep the same keys.** Generating new ones later silently invalidates every phone that
   has already turned notifications on; each person would have to turn them on again.
   Use the same keys locally and in production only if you accept that a local test
   device then also works against production.
4. In Flowzen: **Settings → Integrations** → switch **Phone notifications** on.
   The switch only appears once the server has all three keys.

Then each person turns them on from **Profile → Phone notifications**, per device, and
picks which kinds they want. Pushes outside working hours wait for the next working
morning.

## API keys for AI agents and automations (one-time setup, optional)
Management makes keys in **Settings → API** for Claude/ChatGPT (MCP at `/api/mcp`) and
n8n/Make/Zapier (REST at `/api/v1`, described at `/api/v1/openapi.json`).

1. **Server env** — add to `/var/www/flowzen/.env`, then Scenario A (rebuild and restart):
   ```
   API_KEY_PEPPER=<48 random bytes: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))">
   ```
   **Never change it once keys exist** — every key would stop working. Never commit it.
2. **Apache**, in the API's HTTPS (`:443`) virtual host, then `sudo systemctl reload apache2`:
   ```apache
   # Keys are only accepted over HTTPS; Express learns the request was HTTPS from this.
   RequestHeader set X-Forwarded-Proto "https"
   # MCP: pass answers straight through, uncompressed. Put these lines ABOVE the
   # existing "ProxyPass /api http://127.0.0.1:4000/api" — Apache uses the first match.
   ProxyPass        /api/mcp http://127.0.0.1:4000/api/mcp flushpackets=on
   ProxyPassReverse /api/mcp http://127.0.0.1:4000/api/mcp
   SetEnvIf Request_URI "^/api/mcp" no-gzip=1
   ```
   (`a2enmod headers` if `RequestHeader` is unknown.) Without the first line every key gets
   `403 https_required`.
3. In Flowzen: **Settings → API** → switch **Allow API keys** on, then **New key**.
4. **"Sign in with Flowzen"** (Claude.ai, Claude Desktop/mobile, ChatGPT — API Plan 2) needs
   nothing more on the server: the sign-in pages live under the app, the OAuth discovery files
   (`/.well-known/oauth-*`) are passed from the web app to the API by a Next.js rewrite, and the
   same `API_KEY_PEPPER` hashes the tokens. The **Allow API keys** switch covers these sign-ins too.
   Check after deploying: `curl -s https://project.eyelevelstudio.in/.well-known/oauth-authorization-server`
   must answer JSON with `"issuer": "https://project.eyelevelstudio.in"`. If Apache serves
   `/.well-known/` itself (an `Alias` for Let's Encrypt, say), add above it:
   ```apache
   ProxyPass        /.well-known/oauth-authorization-server http://127.0.0.1:4000/.well-known/oauth-authorization-server
   ProxyPass        /.well-known/oauth-protected-resource  http://127.0.0.1:4000/.well-known/oauth-protected-resource
   ```
   Then in Claude.ai: Customize → Connectors → Add custom connector → URL
   `https://project.eyelevelstudio.in/api/mcp` → **Sign in now** → **Use Claude's published identity**.
