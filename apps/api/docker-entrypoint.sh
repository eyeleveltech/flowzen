#!/bin/sh
set -e

BACKUP_DIR="/backups/pre-migration"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
KEEP_LAST=20

if [ "$SKIP_PREMIGRATION_BACKUP" = "true" ]; then
  echo "[entrypoint] SKIP_PREMIGRATION_BACKUP=true — skipping pre-migration backup."
else
  echo "[entrypoint] Taking pre-migration backup before applying migrations..."
  mkdir -p "$BACKUP_DIR"
  # pg_dump does NOT understand Prisma's "?schema=..." param, so strip the query string.
  # Dump to a file (not `pg_dump | gzip`) so pg_dump's exit code is authoritative.
  DUMP_URL="${DATABASE_URL%%\?*}"
  RAW_DUMP="$BACKUP_DIR/pre-migration-$TIMESTAMP.sql"
  if pg_dump "$DUMP_URL" > "$RAW_DUMP"; then
    gzip -f "$RAW_DUMP"
    echo "[entrypoint] Backup saved: ${RAW_DUMP}.gz"
  else
    echo "[entrypoint] ERROR: pre-migration backup FAILED — aborting boot to protect data."
    echo "[entrypoint] Set SKIP_PREMIGRATION_BACKUP=true to override (NOT recommended)."
    rm -f "$RAW_DUMP" "${RAW_DUMP}.gz"
    exit 1
  fi
  ls -1t "$BACKUP_DIR"/pre-migration-*.sql.gz 2>/dev/null | tail -n +$((KEEP_LAST + 1)) | xargs -r rm -f
fi

echo "[entrypoint] Applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

# Fill in the invoice boilerplate, and nothing else.
#
# This runs `prisma/seed-production.ts`, NOT `prisma/seed.ts`. That distinction
# is the whole point: seed.ts is a development dataset — twenty-one companies,
# six retainers, a pipeline, invoices and a salary for every person, all of it
# invented and all of it wearing real client and staff names. The demo seed is
# deliberately unreachable from this script, so no deploy can ever put fiction
# into the live database.
#
# What the production seed does is small by design: it sets the SAC codes and
# the tax-invoice declaration when they are empty, reports which statutory and
# bank fields still need entering, and creates no business records at all. Every
# other organisation setting already has a schema default, and the organisation
# and its users come from registering through the app.
#
# Idempotent, so running it on every boot is safe — it writes nothing that is
# already set and deletes nothing. On by default for that reason; set
# RUN_PRODUCTION_SEED=0 to skip it.
if [ "${RUN_PRODUCTION_SEED:-1}" = "1" ]; then
  echo "[entrypoint] Checking organisation setup (production seed)..."
  # Not `set -e`-fatal: a setup check that declines, or fails, must not stop the
  # API from starting. The API is useful before its invoice boilerplate is
  # filled in; it is useless not running at all.
  if npx tsx prisma/seed-production.ts; then
    echo "[entrypoint] Setup check finished."
  else
    echo "[entrypoint] Setup check did not complete — starting the API anyway."
  fi
fi

echo "[entrypoint] Starting Flowzen API..."
exec npm run start
