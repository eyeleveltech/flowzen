#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# ONE-TIME baseline of an existing production database (run on the VPS).
#
# The prod DB was built with `db push` and has NO migration history. This snapshots
# its CURRENT structure as migration `0_init` and marks it already-applied, so future
# `prisma migrate deploy` runs won't try to recreate existing tables.
#
# Runs entirely in Docker — no local Node/Prisma or SSH tunnel needed. It talks to
# the `postgres` service over the compose network and writes the migration files into
# your repo (apps/api/prisma/migrations) so you can commit them.
#
# Usage (from the repo root on the VPS, with the stack running):
#   ./scripts/db-baseline.sh
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [ -d "apps/api/prisma/migrations/0_init" ]; then
  echo "ERROR: apps/api/prisma/migrations/0_init already exists — baseline appears done."
  echo "       If you really want to redo it, remove that folder first."
  exit 1
fi

echo "==> Baselining production DB via a one-off Docker container..."

docker compose run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$REPO/apps/api/prisma:/app/apps/api/prisma" \
  --entrypoint sh api -c '
    set -e
    cd /app/apps/api
    mkdir -p prisma/migrations/0_init
    printf "provider = \"postgresql\"\n" > prisma/migrations/migration_lock.toml

    echo "--> Capturing current production schema as 0_init..."
    npx prisma migrate diff --from-empty --to-url "$DATABASE_URL" --script \
      > prisma/migrations/0_init/migration.sql

    echo "--> Marking 0_init as already applied on production (no data SQL runs)..."
    npx prisma migrate resolve --applied 0_init
  '

echo ""
echo "✅ Baseline complete."
echo "   - Created apps/api/prisma/migrations/0_init/migration.sql"
echo "   - Production is now adopted into Prisma Migrate (DB data untouched)."
echo ""
echo "Next: commit the migrations folder, then run ./scripts/db-make-migration.sh <name>"
