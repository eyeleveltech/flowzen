#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "=== Flowzen Database Restore Utility ==="

# Check if the backup container is running or exists
BACKUP_CONTAINER=$(docker ps -aqf "name=flowzen-db-backup")

if [ -z "$BACKUP_CONTAINER" ]; then
  echo "Error: Could not find the backup container (flowzen-db-backup)."
  echo "Make sure docker-compose is running."
  exit 1
fi

echo "Available backups in the volume:"
docker exec $BACKUP_CONTAINER ls -lh /backups/daily/

echo ""
read -p "Enter the full filename of the backup you want to restore (e.g., elitepm-20260605-000000.sql.gz): " BACKUP_FILE

if [ -z "$BACKUP_FILE" ]; then
  echo "No filename provided. Exiting."
  exit 1
fi

echo ""
echo "WARNING: This will overwrite the current database with the backup!"
read -p "Are you absolutely sure? (y/N): " CONFIRM

if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Restore cancelled."
  exit 0
fi

echo "Restoring $BACKUP_FILE to the database..."

# Unzip and pipe the SQL dump directly into the postgres container
docker exec -i $BACKUP_CONTAINER sh -c "zcat /backups/daily/$BACKUP_FILE" | docker exec -i elitepm-db psql -U elitepm -d elitepm

echo "Restore complete!"
