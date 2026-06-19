#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Generate a migration from "current production schema" -> "schema.prisma"
# (run on the VPS, after the one-time ./scripts/db-baseline.sh).
#
# It diffs the LIVE production DB against your committed schema.prisma and writes the
# resulting SQL into a new migration folder. It does NOT apply anything — you review the
# SQL, commit it, and the change is applied automatically on the next deploy (the API
# entrypoint runs `prisma migrate deploy`, which also takes a pre-migration backup first).
#
# Runs entirely in Docker — no local Node/Prisma or SSH tunnel needed.
#
# Usage (from the repo root on the VPS):
#   ./scripts/db-make-migration.sh add_lead_score_field
# ---------------------------------------------------------------------------
set -euo pipefail

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "Usage: ./scripts/db-make-migration.sh <migration_name>"
  echo "Example: ./scripts/db-make-migration.sh add_lead_score_field"
  exit 1
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [ ! -d "apps/api/prisma/migrations/0_init" ]; then
  echo "ERROR: no baseline found (apps/api/prisma/migrations/0_init missing)."
  echo "       Run ./scripts/db-baseline.sh first."
  exit 1
fi

STAMP="$(date +%Y%m%d%H%M%S)"
MIG_DIR="${STAMP}_${NAME}"

echo "==> Generating migration '$MIG_DIR' (live DB -> schema.prisma) via Docker..."

docker compose run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e MIG_DIR="$MIG_DIR" \
  -v "$REPO/apps/api/prisma:/app/apps/api/prisma" \
  --entrypoint sh api -c '
    set -e
    cd /app/apps/api
    mkdir -p "prisma/migrations/$MIG_DIR"
    npx prisma migrate diff \
      --from-url "$DATABASE_URL" \
      --to-schema-datamodel prisma/schema.prisma \
      --script > "prisma/migrations/$MIG_DIR/migration.sql"
  '

SQL_FILE="apps/api/prisma/migrations/${MIG_DIR}/migration.sql"

if [ ! -s "$SQL_FILE" ] || ! grep -q '[^[:space:]]' "$SQL_FILE"; then
  echo ""
  echo "ℹ️  No schema differences detected — production already matches schema.prisma."
  rm -rf "apps/api/prisma/migrations/${MIG_DIR}"
  exit 0
fi

echo ""
echo "✅ Wrote $SQL_FILE"
echo ""
echo "⚠️  REVIEW IT NOW — this is the data-loss gate:"
echo "    • Any DROP COLUMN / DROP TABLE you didn't intend?"
echo "    • A rename showing as drop+add? Rewrite to: ALTER TABLE ... RENAME COLUMN ..."
echo "    • ADD COLUMN ... NOT NULL on a populated table? Add a DEFAULT or make it nullable + backfill."
echo ""
echo "Then: git add apps/api/prisma/migrations && git commit && git push"
echo "Deploy applies it automatically (backup -> migrate deploy -> start)."
echo ""
echo "--- migration.sql ---"
cat "$SQL_FILE"
