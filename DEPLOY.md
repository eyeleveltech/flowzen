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
