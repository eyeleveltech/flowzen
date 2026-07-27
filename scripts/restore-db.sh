#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "=== Flowzen Database Restore Utility ==="

# DB user/name are read from the project's .env (falling back to the compose defaults).
# They used to be hardcoded to elitepm/elitepm, which silently fails on any deployment whose
# POSTGRES_USER/POSTGRES_DB differ (e.g. production uses postgres/eyelevelPm) — exactly when
# you least want your restore tool to break.
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
read_env() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}
PG_USER="${POSTGRES_USER:-$(read_env POSTGRES_USER)}"; PG_USER="${PG_USER:-elitepm}"
PG_DB="${POSTGRES_DB:-$(read_env POSTGRES_DB)}"; PG_DB="${PG_DB:-elitepm}"

echo "Target: user='$PG_USER' db='$PG_DB'"

# Find the running containers by name (substring match tolerates any project/hash prefix).
BACKUP_CONTAINER=$(docker ps -aqf "name=flowzen-db-backup" | head -1)
DB_CONTAINER=$(docker ps -qf "name=elitepm-db" | head -1)

if [ -z "$BACKUP_CONTAINER" ]; then
  echo "Error: Could not find the backup container (flowzen-db-backup)."
  echo "Make sure docker compose is running."
  exit 1
fi
if [ -z "$DB_CONTAINER" ]; then
  echo "Error: Could not find the database container (elitepm-db)."
  echo "Make sure docker compose is running."
  exit 1
fi

echo "Available backups in the volume:"
docker exec "$BACKUP_CONTAINER" ls -lh /backups/daily/

echo ""
read -p "Enter the full filename of the backup you want to restore (e.g., ${PG_DB}-20260605-000000.sql.gz): " BACKUP_FILE

if [ -z "$BACKUP_FILE" ]; then
  echo "No filename provided. Exiting."
  exit 1
fi

echo ""
echo "WARNING: This will overwrite the current database ('$PG_DB') with the backup!"
read -p "Are you absolutely sure? (y/N): " CONFIRM

if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Restore cancelled."
  exit 0
fi

echo "Restoring $BACKUP_FILE into '$PG_DB'..."

# Unzip and pipe the SQL dump directly into the postgres container.
docker exec -i "$BACKUP_CONTAINER" sh -c "zcat /backups/daily/$BACKUP_FILE" \
  | docker exec -i "$DB_CONTAINER" psql -U "$PG_USER" -d "$PG_DB"

echo "Restore complete!"
