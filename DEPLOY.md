# Deployment: MacBook (dev) → Raspberry Pi (prod)

This project runs as a Docker Compose stack on two machines:

- **Dev**: your MacBook (`linux/amd64`). Where you write code and build images.
- **Prod**: a Raspberry Pi (`linux/aarch64`) at `192.168.0.2`. Runs the live stack.

This document explains how to ship changes from dev to prod. **Source of truth for code is
GitHub; source of truth for data is the PostgreSQL `pgdata` volume on each machine.**

---

## Core principle

Three separate things move at different times:

| Thing | Source of truth | How it moves |
| --- | --- | --- |
| **Code / config** | GitHub repo (`main` branch) | `git pull` on the Pi |
| **App image** (built binary) | Built on the Mac | Image tarball **or** registry (see below) |
| **Data** (Postgres) | `pgdata` volume on each host | `pg_dump` → transfer → restore |

**Never** put data in Git. **Never** commit secrets (use `.env`, gitignored).

---

## 1. Secrets (`.env`) must exist on both machines

`docker-compose.yml` now reads **all secrets** from env vars (it will fail loudly if a
required one is missing). Each machine needs its own `.env` (copied from `.env.example`):

```bash
cp .env.example .env
# then edit .env with real values
```

`.env` is gitignored and never pushed. `.env.example` IS committed (placeholders only).

- Mac: `/Users/alex/Documents/Finance/.env`
- Pi:  `~/finance/.env`

> The Pi's `.env` can reuse the same values as the Mac (same API keys, same DB password).
> `AUTH_SECRET` should be identical on both so sessions survive a machine move, but any
> value is fine as long as each machine's `.env` is self-consistent.

---

## 2. Ship code changes (via GitHub)

Work on the Mac, commit and push, then pull on the Pi:

```bash
# --- On the Mac ---
git add .
git commit -m "describe the change"
git push origin main

# --- On the Pi ---
cd ~/finance
git pull
```

The Pi always lags the Mac by however far behind `main` it is. Keep `main` green and
pull-then-restart as one release step.

---

## 3. Ship the app image

The Pi **cannot build** `next build` (a Pi 3B OOM-kills it), so the image is always built
on the Mac for `linux/arm64` and moved to the Pi. Two supported strategies:

### Option A — tarball transfer (current, no registry needed)

```bash
# --- On the Mac ---
docker build --platform linux/arm64 -t finance-app:arm64 .
docker save finance-app:arm64 | gzip > /tmp/finance-app-arm64.tar.gz
scp /tmp/finance-app-arm64.tar.gz alex@192.168.0.2:~/finance-app-arm64.tar.gz

# --- On the Pi ---
gunzip -c ~/finance-app-arm64.tar.gz | docker load
docker tag finance-app:arm64 finance-app:latest
cd ~/finance && docker compose up -d
```

Because `docker-compose.yml` references `image: finance-app:latest` (not `build:`), compose
will **not** try to build on the Pi — it just uses the loaded image. Rebuilding the app image
requires the tarball step every time.

### Option B — container registry (optional, push-button)

Publish the image to a registry (e.g. Docker Hub or GitHub Container Registry `ghcr.io`),
then the Pi pulls it:

```bash
# --- On the Mac, once ---
docker build --platform linux/arm64 -t <registry>/<owner>/finance-app:latest .
docker login
docker push <registry>/<owner>/finance-app:latest

# --- On the Pi ---
cd ~/finance && docker compose pull && docker compose up -d
```

Also update `app.image` in `docker-compose.yml` to the `<registry>/<owner>/finance-app:latest`
reference. This removes the manual tarball step but requires registry auth.

---

## 4. Restart the stack on the Pi

```bash
cd ~/finance && docker compose up -d
docker compose ps
```

Safe. Data lives in volumes and is untouched by restarts.

---

## 5. Ship data (Mac → Pi) — only when you intend to sync data

Data lives in Postgres on each machine. There is **no automated bidirectional sync**; a
Mac→Pi data push is manual, one-way, and overwrites what's on the Pi, so **only run it when
you intend to replace the Pi's data** (e.g. initial move, or a fresh prod seed from the Mac).

```bash
# --- On the Mac: create a backup ---
docker exec finance-db-1 pg_dump -U <user> -d <db> --no-owner --no-privileges \
  | gzip > /tmp/aurum-migrate-$(date +%Y%m%dT%H%M%SZ).sql.gz

# --- Transfer + restore on the Pi ---
scp /tmp/aurum-migrate-*.sql.gz alex@192.168.0.2:~/finance/restore.sql.gz

# --- On the Pi ---
# Optionally clear current data first (only if replacing it):
docker compose -f ~/finance/docker-compose.yml exec db psql -U aurum -d aurum \
  -c "TRUNCATE transactions, holdings, monthly_snapshots, accounts, budgets, categories, merchant_rules RESTART IDENTITY CASCADE;"
gunzip -c ~/finance/restore.sql.gz | docker compose -f ~/finance/docker-compose.yml exec -T db psql -U aurum -d aurum
```

> Modern Postgres uses `COPY ... FROM stdin` blocks in the dump. Loading into a fresh DB
> (via the normal restore) is enough; only TRUNCATE when you are replacing existing rows.

---

## Hygiene rules (read `AGENTS.md`)

- **Never** `docker compose down -v` or `docker volume prune` — deletes `pgdata`/`backups`.
- Back up before any risky operation; a `backup` service auto-dumps `pgdata` every 6h to the
  `backups` volume on each machine.
- The DB may display demo data if the API is down (`store.ts` fallback) — verify with
  `docker exec <db> psql -U aurum -c "SELECT count(*) FROM holdings;"` before trusting the UI.
