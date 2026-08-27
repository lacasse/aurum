#!/bin/sh
set -e

# Configuration
DB_HOST="${POSTGRES_HOST:-db}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-aurum}"
DB_PASSWORD="${POSTGRES_PASSWORD:-aurum}"
DB_NAME="${POSTGRES_DB:-aurum}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
# Interval in seconds between backups (default: every 6 hours).
BACKUP_INTERVAL="${BACKUP_INTERVAL:-21600}"
# Number of backups to retain (default: 14).
RETENTION="${RETENTION:-14}"

export PGPASSWORD="$DB_PASSWORD"

log() {
  echo "[backup] $(date -u '+%Y-%m-%d %H:%M:%S UTC') $*"
}

backup_now() {
  STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
  FILE="${BACKUP_DIR}/${DB_NAME}_${STAMP}.sql.gz"
  log "dumping ${DB_NAME} -> ${FILE}"
  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --format=plain --no-owner --no-privileges | gzip > "$FILE.tmp"
  mv "$FILE.tmp" "$FILE"
  log "backup complete: ${FILE}"

  # Verify the file is a valid gzip and not empty.
  if ! gzip -t "$FILE" 2>/dev/null; then
    log "ERROR: backup failed integrity check, removing ${FILE}"
    rm -f "$FILE"
    return 1
  fi

  prune
}

# Remove old backups beyond retention, keeping the newest RETENTION files.
prune() {
  # shellcheck disable=SC2012
  COUNT="$(ls -1 "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$COUNT" -gt "$RETENTION" ]; then
    TO_DELETE=$((COUNT - RETENTION))
    log "pruning ${TO_DELETE} old backup(s) (keeping ${RETENTION})"
    ls -1t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | tail -n "$TO_DELETE" | xargs -r rm -f
  fi
}

# Initial backup on start, then loop.
log "starting backup loop (interval=${BACKUP_INTERVAL}s, retention=${RETENTION})"
backup_now || true

while true; do
  sleep "$BACKUP_INTERVAL"
  backup_now || true
done
