#!/bin/sh
# ---------------------------------------------------------------------------
# Flowzen API container entrypoint.
#
# Safe production boot sequence:
#   1. Take a pre-migration backup of the database (abort if it fails).
#   2. Apply ONLY reviewed, committed migrations via `prisma migrate deploy`.
#      (We NEVER use `prisma db push --accept-data-loss` here — that can drop
#       columns/tables with no review and is how production data gets lost.)
#   3. Start the API.
#
# Override the backup (NOT recommended) with: SKIP_PREMIGRATION_BACKUP=true
# ---------------------------------------------------------------------------
set -e

BACKUP_DIR="/backups/pre-migration"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
KEEP_LAST=20   # how many pre-migration backups to retain

if [ "$SKIP_PREMIGRATION_BACKUP" = "true" ]; then
  echo "[entrypoint] SKIP_PREMIGRATION_BACKUP=true — skipping pre-migration backup."
else
  echo "[entrypoint] Taking pre-migration backup before applying migrations..."
  mkdir -p "$BACKUP_DIR"
  if pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/pre-migration-$TIMESTAMP.sql.gz"; then
    echo "[entrypoint] Backup saved: $BACKUP_DIR/pre-migration-$TIMESTAMP.sql.gz"
  else
    echo "[entrypoint] ERROR: pre-migration backup FAILED — aborting boot to protect data."
    echo "[entrypoint] Fix the backup (check DATABASE_URL / pg_dump / /backups mount),"
    echo "[entrypoint] or set SKIP_PREMIGRATION_BACKUP=true to override (NOT recommended)."
    rm -f "$BACKUP_DIR/pre-migration-$TIMESTAMP.sql.gz"
    exit 1
  fi
  # Prune old pre-migration backups, keeping the most recent $KEEP_LAST.
  ls -1t "$BACKUP_DIR"/pre-migration-*.sql.gz 2>/dev/null | tail -n +$((KEEP_LAST + 1)) | xargs -r rm -f
fi

echo "[entrypoint] Applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

echo "[entrypoint] Starting Flowzen API..."
exec npm run start
