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

echo "[entrypoint] Starting Flowzen API..."
exec npm run start
