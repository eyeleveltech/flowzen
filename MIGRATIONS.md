# Database Migrations Runbook (Flowzen)

> **Goal:** never lose production data when the Prisma schema changes.
>
> **Golden rule:** production uses `prisma migrate deploy` on **reviewed, committed
> migration files** — it must **never** run `prisma db push` or `--accept-data-loss`.

---

## Why this exists

The old container startup ran `npx prisma db push --accept-data-loss` on every boot.
`db push` force-syncs the database to the schema and `--accept-data-loss` lets it **drop
columns/tables with no prompt**. That silently destroys data on any rename, type change,
or field removal. We've replaced it with a safe boot sequence (see
[`apps/api/docker-entrypoint.sh`](apps/api/docker-entrypoint.sh)):

1. Take a **pre-migration backup** (`pg_dump`) — abort the boot if it fails.
2. Apply only committed migrations via **`prisma migrate deploy`**.
3. Start the API.

---

## Fastest path: Docker-automated (recommended on the VPS)

Two helper scripts run everything in containers — **no local Node/Prisma or SSH tunnel
needed**. They talk to the running `postgres` service and write migration files into the
repo for you to review and commit. (Make them executable once: `chmod +x scripts/*.sh`.)

```bash
# On the VPS, from the repo root, with the stack running:

# 1) ONE TIME — adopt the existing prod DB into Prisma Migrate (DB data untouched)
./scripts/db-baseline.sh

# 2) PER CHANGE — generate a migration (live DB -> your committed schema.prisma).
#    It prints the SQL and does NOT apply it.
./scripts/db-make-migration.sh add_lead_score_field
```

Then **review the printed SQL** (the data-loss gate — see step 3 below), commit the
`apps/api/prisma/migrations/**` files, and deploy. The API entrypoint applies it
automatically: pre-migration backup → `prisma migrate deploy` → start.

> The sections below are the **manual equivalent** of these scripts — use them if you'd
> rather run Prisma yourself (e.g. from your laptop over an SSH tunnel).

---

## ONE-TIME: baseline the existing production database

Production already has data but **no migration history**, so you must "adopt" Prisma
Migrate by recording the current schema as an already-applied baseline. Do this **once**,
**before** deploying any new schema changes.

> Run these from a checkout whose `schema.prisma` matches **what is currently in
> production** — not your new local edits. The safest way is to introspect prod.

```bash
cd apps/api

# 0) Back up first, always.
#    (from the server) docker exec elitepm-db pg_dump -U elitepm -d elitepm | gzip > baseline-$(date +%F).sql.gz

# 1) Make schema.prisma reflect the LIVE production schema exactly.
DATABASE_URL="<PROD_DATABASE_URL>" npx prisma db pull

# 2) Generate the baseline migration from that state.
mkdir -p prisma/migrations/0_init
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql

# 3) Mark the baseline as already applied on production. Runs NO SQL against data —
#    it only writes a row into the _prisma_migrations bookkeeping table.
DATABASE_URL="<PROD_DATABASE_URL>" npx prisma migrate resolve --applied 0_init
```

Commit `prisma/migrations/0_init/`. Production is now baselined. From here on, every schema
change is a new migration applied with `migrate deploy`.

> After baselining, re-apply your new schema edits to `schema.prisma` and create them as a
> normal migration (next section).

---

## PER-CHANGE: the workflow for every schema change

### 1. Back up (don't trust only last night's daily backup)
```bash
# on the server
docker exec elitepm-db pg_dump -U elitepm -d elitepm | gzip > pre-change-$(date +%F-%H%M).sql.gz
```

### 2. Create the migration locally and READ the SQL
```bash
cd apps/api
npx prisma migrate dev --name describe_your_change
```
This generates `prisma/migrations/<timestamp>_describe_your_change/migration.sql`.
**Open that file and review it.** This review is where data loss is actually prevented.

### 3. Fix destructive patterns by hand

Prisma is naive about renames — it writes drop+add, which throws away the data. Rewrite it:

```sql
-- ❌ Generated for a rename (DESTRUCTIVE — loses the column's data):
ALTER TABLE "tasks" DROP COLUMN "loggedHours";
ALTER TABLE "tasks" ADD COLUMN "hoursLogged" DOUBLE PRECISION;

-- ✅ Rewrite to preserve data:
ALTER TABLE "tasks" RENAME COLUMN "loggedHours" TO "hoursLogged";
```

Other landmines:
- **Adding a required (`NOT NULL`) column to a table with rows** → add it nullable or with a
  `DEFAULT` first, backfill the data, then enforce `NOT NULL` in a follow-up step.
- **Dropping a column/table** → make sure the data is truly unused (and backed up).
- **Changing a column type** → may need a `USING` cast; verify it converts cleanly.

### 4. Test against a COPY of production data (not an empty dev DB)
```bash
# restore a recent prod dump into a scratch DB, point DATABASE_URL at it, then:
npx prisma migrate deploy
# verify the app + data look right
```

### 5. Commit the migration file to git
The `prisma/migrations/**` files are the source of truth. Never edit a migration that has
already been applied to production — create a new one to correct course.

### 6. Deploy
```bash
docker compose up -d --build api
```
On boot the entrypoint takes a pre-migration backup, runs `prisma migrate deploy`
(applies only the new pending migrations), then starts the API.

---

## Backups

- **Daily automatic:** the `db-backup` service keeps 7 daily / 4 weekly / 1 monthly dumps in
  the `postgres_backups` volume.
- **Pre-migration automatic:** the API entrypoint writes a `pg_dump` to
  `/backups/pre-migration/pre-migration-<timestamp>.sql.gz` before every `migrate deploy`
  (keeps the last 20). If this backup fails, the container **refuses to start** rather than
  risk migrating without a safety net.
- **Manual:** `docker exec elitepm-db pg_dump -U elitepm -d elitepm | gzip > backup.sql.gz`

### Test your restore (do this at least once)
An untested backup is not a backup. Restore yesterday's dump into a throwaway database and
confirm it loads:
```bash
./scripts/restore-db.sh    # interactive restore helper
```

---

## If a deploy goes wrong (rollback)

1. Stop the API container.
2. Restore the pre-migration backup that the entrypoint just took:
   ```bash
   # find it
   docker exec flowzen-db-backup ls -lh /backups/pre-migration/
   # restore (adapt to restore-db.sh, or manually):
   docker exec flowzen-db-backup sh -c "zcat /backups/pre-migration/pre-migration-<ts>.sql.gz" \
     | docker exec -i elitepm-db psql -U elitepm -d elitepm
   ```
3. Revert the bad migration in git and ship a corrected one. **Do not** delete an
   already-applied migration from history — write a new forward migration to fix it.

---

## Quick do / don't

| ✅ Do | ❌ Don't |
|------|---------|
| `prisma migrate deploy` in production | `prisma db push` in production |
| Review every generated `migration.sql` | Trust auto-generated rename SQL |
| Rewrite renames as `RENAME COLUMN` | Let Prisma drop+add a renamed column |
| Back up before each migration | Rely only on the daily backup |
| Test migrations on a prod-data copy | Test only on an empty dev DB |
| Add `NOT NULL` columns with a default/backfill | Add a required column to a populated table directly |
| Keep `prisma/migrations/**` committed in git | Use `--accept-data-loss` anywhere near production |
