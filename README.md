# Aurum · Personal Finance

A dark-themed personal finance webapp for tracking **net worth**, **income & expenses**,
**budgets**, and an **investment portfolio** — with charts everywhere. State lives in
**PostgreSQL** (via Drizzle ORM) behind a small JSON API, and the whole stack ships as a
set of **Docker containers**. CSV imports of credit-card exports get auto-categorized and
reviewable before saving.

## Run it (Docker)

```bash
docker compose up --build
```

| Service | URL | Purpose |
| --- | --- | --- |
| app | https://localhost | Next.js app + JSON API (HTTPS only) |
| db | internal :5432 | PostgreSQL 17 (volume `pgdata` persists data) |
| adminer | localhost:8443 (loopback only) | DB browser (server: `db`), reach it via an SSH tunnel |

Only HTTPS is exposed. A self-signed certificate is generated automatically on first
startup (stored in the `certs` volume). HTTP requests on port 80 redirect to HTTPS. Since
the certificate is self-signed, browsers will show a warning you'll need to accept.

### Login

The app and its API are protected by a session-cookie login. Visiting any page (or hitting
any `/api/*` route) without a valid session redirects to `/login` (pages) or returns `401`
(API). After a successful login the session cookie lasts 7 days. Login attempts are rate
limited per IP (5 failures → progressively longer lockout).

Credentials are configured via environment variables **with no built-in defaults** — the
app refuses to start if any are missing:

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_USERNAME` | yes | Login username |
| `AUTH_PASSWORD` | yes* | Login password (plaintext, constant-time compared) |
| `AUTH_PASSWORD_HASH` | no | scrypt `salt:hash` of the password — preferred over `AUTH_PASSWORD` |
| `AUTH_SECRET` | yes | HMAC key used to sign session cookies |

*One of `AUTH_PASSWORD` or `AUTH_PASSWORD_HASH` is required (the hash takes precedence).

Generate a password hash and set it in `.env`:

```bash
npm run hash-password -- 'your-password'   # prints salt:hash hex
# paste it into AUTH_PASSWORD_HASH in .env, then remove AUTH_PASSWORD
```

**Change these before exposing the app.** Set them in `.env` or your environment, e.g.:

```bash
AUTH_USERNAME=you AUTH_PASSWORD=... AUTH_SECRET=a-long-random-secret docker compose up -d --build
```

Rotating `AUTH_PASSWORD`, `AUTH_PASSWORD_HASH`, or `AUTH_SECRET` immediately revokes every
existing session cookie (they are signed with a key derived from the current credentials).

The session cookie is `HttpOnly`, `Secure` (when NODE_ENV=production), and `SameSite=Lax`.

**Reset demo data** in the sidebar now requires typing `RESET` to confirm before the server
will wipe the database (it rejects the request otherwise).

Migrations run and demo data seeds automatically on first request. `docker compose down`
keeps your data (no flags). **Never run `docker compose down -v` or `docker volume prune`**
— those permanently delete the `pgdata` (data) and `backups` volumes.

### Backups

A `backup` service runs automatically (default every **6 hours**) and writes a gzipped
`pg_dump` to the persistent `backups` volume, keeping the newest 14 by default. Configure
with env vars (set in `.env` or the environment):

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKUP_INTERVAL` | `21600` | Seconds between automatic backups (21600 = 6h) |
| `BACKUP_RETENTION` | `14` | Number of latest backups to keep |
| `BACKUP_ENCRYPTION_KEY` | (empty) | Optional passphrase; encrypts backups with AES-256-CBC (OpenSSL) |

If `BACKUP_ENCRYPTION_KEY` is set, dumps are written as `.sql.gz.enc` and encrypted.

Check that backups exist (also visible under **GET `/api/backups`** after login):

```bash
docker exec finance-backup-1 sh -c 'ls -la /backups/'
```

Take a **manual backup before any risky operation** (schema change, reset, volume work):

```bash
docker exec finance-backup-1 /bin/sh -c 'cd /backups && STAMP=$(date -u +%Y%m%dT%H%M%SZ) && PGPASSWORD=aurum pg_dump -h db -U aurum -d aurum --no-owner --no-privileges | gzip > aurum_${STAMP}.sql.gz'
```

**Restore** a backup (reload a `*.sql.gz` from the `backups` volume into the DB):

```bash
# Find the file you want:
docker exec finance-backup-1 sh -c 'ls -l /backups/'
# Load it (drops nothing; COPY appends — for a full restore, truncate tables first):
docker exec finance-db-1 psql -U aurum -d aurum -c "TRUNCATE transactions, holdings, monthly_snapshots, accounts, budgets, categories, merchant_rules RESTART IDENTITY CASCADE;"
docker exec finance-backup-1 sh -c 'gzip -dc /backups/aurum_XXXXXXXX.sql.gz' | docker exec -i finance-db-1 psql -U aurum -d aurum
```

## Run it (local, no Docker)

```bash
npm install
DATABASE_URL=postgres://aurum:aurum@localhost:5432/aurum npm run dev
```

Without a reachable database the app still renders using bundled sample data (writes are
skipped with console errors).

## Features

| Page | What you get |
| --- | --- |
| **Dashboard** | Net worth / income / expenses / savings-rate KPI cards with sparklines, net-worth area chart (6–18M range toggle), expense donut, income-vs-expense bars, portfolio growth vs cost basis, stacked spending-by-category area, accounts overview, recent transactions |
| **Transactions** | Full CRUD with filters (search, type, category, account, month), filtered summary chips, filtered cash-flow chart, balances adjust automatically (client and server agree) |
| **Investments** | Holdings CRUD with price updates, value-vs-cost-basis chart, asset-allocation donut, sector radar, gain/loss bars, per-position table with weights |
| **Budgets** | Monthly budgets per category, radial utilization gauge, budget-vs-actual bars, progress rows with inline limit editing, daily pace estimate — plus a category manager: create, rename, and delete categories (renames cascade to budgets and existing transactions; deleted categories move their transactions to "Other") |
| **Accounts** | Assets/liabilities/net-worth KPIs, assets-vs-liabilities stacked area, account cards with history sparklines |
| **Import CSV** | Upload one or many credit-card CSV exports (Amex-style or `transaction_date/merchant/amount`), auto-detected format, auto-categorization against your budget-section categories, duplicate flagging, and a review step to edit/delete/include rows before anything is saved. Card payments are skipped; category corrections are remembered per merchant for future imports |

## Stack

- [Next.js](https://nextjs.org) 16 (App Router, Turbopack) + React 19 + TypeScript
- [PostgreSQL](https://www.postgresql.org) 17 + [Drizzle ORM](https://orm.drizzle.team) (migrations in `drizzle/`, applied at startup)
- Route Handlers under `src/app/api` expose the data (accounts, transactions, holdings, budgets, categories, merchant rules, reset)
- [Tailwind CSS](https://tailwindcss.com) v4 (semantic design tokens, dark theme by default with a light-mode toggle)
- [Recharts](https://recharts.org) for all charts
- [Zustand](https://zustand.docs.pmnd.rs) as the client cache — optimistic updates with fire-and-forget persistence to the API
- [Papa Parse](https://www.papaparse.com) for CSV import, [lucide-react](https://lucide.dev) icons, [next-themes](https://github.com/pacocoursey/next-themes) theming

> **Security note (informational):** The production image runs the compiled
> Next.js **standalone** output (`node server.js`), so it is unaffected by the
> esbuild dev-service advisory that applies only to `next dev`/`tsx` in a
> development environment. Do not pin dev-only tooling below the advisory line.

## Structure

```
src/
  app/            # routes: dashboard, transactions, investments, budgets, accounts, import
  app/api/        # JSON API (force-dynamic route handlers)
  components/     # shell (sidebar/topbar), ui primitives, charts, forms, stat cards
  db/
    schema.ts     # Drizzle schema (7 tables)
    repo.ts       # queries, validation, balance side-effects, seed/reset
    init.ts       # one-shot migrate + first-run seed
  lib/
    types.ts      # domain models
    sample.ts     # deterministic 18-month sample data generator
    store.ts      # zustand store — optimistic updates + API sync
    api.ts        # typed fetch client for the API
    analytics.ts  # pure selectors: series, allocations, budgets, totals
    csv.ts        # CSV parsing, format detection, categorization engine
    format.ts     # currency/date/month formatting helpers
    hooks.tsx     # mounted/server-ready gates + page skeleton
drizzle/          # generated SQL migrations (applied on startup)
```

## Tests

```bash
npm run test:csv   # CSV parsing / categorization suite (scripts/csv-test.ts)
npm run test:db    # boots embedded PostgreSQL, tests migrations + repository end-to-end
```

Demo data is regenerated deterministically; use **Reset demo data** in the sidebar to
start over (server-side reset).
