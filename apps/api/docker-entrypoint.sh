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

# Seed a brand-new deployment, and only a brand-new one.
#
# Off unless SEED_ON_FIRST_BOOT=1 is set in the environment, because the seed is
# a DEVELOPMENT dataset: it invents the figures it writes — monthly fees, ad
# spend against named vendors, and a salary for every person — against real
# client and staff names. On a database that is meant to hold the real business,
# that is fiction wearing a real face. Turn this on to stand up a demo or a
# fresh environment, not to populate the live studio.
#
# Safe on every redeploy regardless: SEED_ONLY_IF_EMPTY=1 makes the seed exit
# without touching anything once an organisation exists, so the second boot and
# every boot after it is a no-op. It cannot overwrite data it finds.
if [ "$SEED_ON_FIRST_BOOT" = "1" ]; then
  echo "[entrypoint] SEED_ON_FIRST_BOOT=1 — seeding if the database is empty..."
  # Not `set -e`-fatal: a seed that declines, or fails, must not stop the API
  # from starting. The API is useful against an empty database; it is useless
  # not running at all.
  if SEED_ONLY_IF_EMPTY=1 npx tsx prisma/seed.ts; then
    echo "[entrypoint] Seed step finished."
  else
    echo "[entrypoint] WARNING: seed step failed — starting the API anyway."
  fi
fi

echo "[entrypoint] Starting Flowzen API..."
exec npm run start
