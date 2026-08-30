#!/bin/sh
set -e
# A dump is written through a pipe into gzip. Without pipefail a pg_dump that
# dies mid-stream still leaves gzip exiting 0, and the failure is invisible:
# what lands is a small, perfectly valid gzip of nothing.
set -o pipefail 2>/dev/null || true

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
# Optional passphrase to encrypt backup dumps with openssl (AES-256-CBC).
# Leave empty for plain gzip dumps.
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
# Anything smaller than this is not a real dump of this database. Configurable
# because a brand-new, nearly empty database is legitimately small.
MIN_BYTES="${BACKUP_MIN_BYTES:-2048}"

export PGPASSWORD="$DB_PASSWORD"

log() {
  echo "[backup] $(date -u '+%Y-%m-%d %H:%M:%S UTC') $*"
}

backup_now() {
  STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
  if [ -n "$ENCRYPTION_KEY" ]; then
    FILE="${BACKUP_DIR}/${DB_NAME}_${STAMP}.sql.gz.enc"
    log "dumping + encrypting ${DB_NAME} -> ${FILE}"
    if ! pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
      --format=plain --no-owner --no-privileges | gzip | openssl enc -aes-256-cbc -pbkdf2 -e \
      -pass pass:"$ENCRYPTION_KEY" > "$FILE.tmp"; then
      log "ERROR: pg_dump failed — nothing written"
      rm -f "$FILE.tmp"
      return 1
    fi
  else
    FILE="${BACKUP_DIR}/${DB_NAME}_${STAMP}.sql.gz"
    log "dumping ${DB_NAME} -> ${FILE}"
    if ! pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
      --format=plain --no-owner --no-privileges | gzip > "$FILE.tmp"; then
      log "ERROR: pg_dump failed — nothing written"
      rm -f "$FILE.tmp"
      return 1
    fi
  fi
  mv "$FILE.tmp" "$FILE"

  # Verify the file is valid, and that it is a whole dump.
  #
  # gzip -t alone is not enough: an empty dump compresses to a couple of dozen
  # bytes that pass it happily. That is not hypothetical — a scheduled run that
  # fires while the database is unreachable produces exactly that, and because
  # retention counts files rather than good ones, enough of them would push the
  # real backups out. So the size is floored and the dump has to carry the
  # trailer pg_dump only writes once it has finished.
  if [ -n "$ENCRYPTION_KEY" ]; then
    PLAIN="openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:${ENCRYPTION_KEY} -in ${FILE} | gzip -dc"
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"$ENCRYPTION_KEY" -in "$FILE" | gzip -t 2>/dev/null; then
      log "ERROR: backup failed integrity check, removing ${FILE}"
      rm -f "$FILE"
      return 1
    fi
    TAIL="$(eval "$PLAIN" 2>/dev/null | tail -n 5)"
  elif ! gzip -t "$FILE" 2>/dev/null; then
    log "ERROR: backup failed integrity check, removing ${FILE}"
    rm -f "$FILE"
    return 1
  else
    TAIL="$(gzip -dc "$FILE" 2>/dev/null | tail -n 5)"
  fi

  SIZE="$(wc -c < "$FILE" | tr -d ' ')"
  if [ "$SIZE" -lt "$MIN_BYTES" ]; then
    log "ERROR: backup is ${SIZE} bytes, under the ${MIN_BYTES}-byte floor — removing ${FILE}"
    rm -f "$FILE"
    return 1
  fi

  if ! echo "$TAIL" | grep -q "PostgreSQL database dump complete"; then
    log "ERROR: backup has no completion marker (truncated dump) — removing ${FILE}"
    rm -f "$FILE"
    return 1
  fi

  log "backup ok (${SIZE} bytes)"

  prune
}

# Remove old backups beyond retention, keeping the newest RETENTION files.
prune() {
  # shellcheck disable=SC2012
  COUNT="$(ls -1 ${BACKUP_DIR}/*.sql.gz* 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$COUNT" -gt "$RETENTION" ]; then
    TO_DELETE=$((COUNT - RETENTION))
    log "pruning ${TO_DELETE} old backup(s) (keeping ${RETENTION})"
    ls -1t ${BACKUP_DIR}/*.sql.gz* 2>/dev/null | tail -n "$TO_DELETE" | xargs -r rm -f
  fi
}

# Initial backup on start, then loop.
log "starting backup loop (interval=${BACKUP_INTERVAL}s, retention=${RETENTION})"
backup_now || true

while true; do
  sleep "$BACKUP_INTERVAL"
  backup_now || true
done
