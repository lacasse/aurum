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

The Compose project name is pinned to `finance` in `docker-compose.yml`, so the stack and
its volumes are the same on every machine and survive renaming or moving the checked-out
folder. Without that pin Compose names the project after the enclosing directory, and a
rename would start a second stack on empty volumes — indistinguishable, at a glance, from
losing every figure in the app. Containers are always `finance-*`, and `docker compose`
commands need no `-p` flag.

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

**Delete demo data** in the sidebar is destructive, so the server rejects the request
unless the body carries an explicit `{"confirm":"DELETE"}`.

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
| **Transactions** | Full CRUD with filters (search, type, category, account, month), filtered summary chips, filtered cash-flow chart, balances adjust automatically (client and server agree). Every row records where the money came *from* and went *to*; transfers move money between your own accounts. Recurring rules (rent, salary, contributions) post themselves on schedule and can be paused |
| **Investments** | Holdings CRUD with price updates, value-vs-cost-basis chart, asset-allocation donut, sector radar, gain/loss bars, per-position table with weights |
| **Budgets** | Monthly budgets per category, radial utilization gauge, budget-vs-actual bars, progress rows with inline limit editing, daily pace estimate — plus a category manager: create, rename, and delete categories (renames cascade to budgets and existing transactions; deleted categories move their transactions to "Other") |
| **Accounts** | Assets/liabilities/net-worth KPIs, assets-vs-liabilities stacked area, account cards with history sparklines. Accounts carry a kind (chequing, savings, cash, investment, crypto, property, credit, loan) and a registration (non-registered, TFSA, RRSP, FHSA, Pension) |
| **Import CSV** | Upload one or many credit-card CSV exports (Amex-style or `transaction_date/merchant/amount`), auto-detected format, auto-categorization against your budget-section categories, duplicate flagging, and a review step to edit/delete/include rows before anything is saved. Card payments are skipped; category corrections are remembered per merchant for future imports |

## Stack

- [Next.js](https://nextjs.org) 16 (App Router, Turbopack) + React 19 + TypeScript
- [PostgreSQL](https://www.postgresql.org) 17 + [Drizzle ORM](https://orm.drizzle.team) (migrations in `drizzle/`, applied at startup)
- [Zod](https://zod.dev) for request-body validation — schemas are declared once in `src/lib/schemas.ts` and shared by every route
- Route Handlers under `src/app/api` expose the data (accounts, transactions, holdings, budgets, categories, merchant rules, recurring rules, demo-data deletion)
- [Tailwind CSS](https://tailwindcss.com) v4 (semantic design tokens, dark theme by default with a light-mode toggle)
- [Recharts](https://recharts.org) for all charts
- [Zustand](https://zustand.docs.pmnd.rs) as the client cache — optimistic updates with fire-and-forget persistence to the API
- [Papa Parse](https://www.papaparse.com) for CSV import, [lucide-react](https://lucide.dev) icons, [next-themes](https://github.com/pacocoursey/next-themes) theming

> **Security note (informational):** The production image runs the compiled
> Next.js **standalone** output (`node server.js`), so it is unaffected by the
> esbuild dev-service advisory that applies only to `next dev`/`tsx` in a
> development environment. Do not pin dev-only tooling below the advisory line.

## Accounts, transfers and recurring transactions

**Every place money can sit is an account**, including registered ones. An account has two
independent attributes, because they answer different questions:

- **Kind** — what it is and how it behaves: `checking`, `savings`, `cash`, `investment`,
  `property`, `credit`, `loan`. This decides the balance arithmetic (credit cards and
  loans store what is *owed*, so the signs invert) and which accounts can hold securities.
- **Registration** — its tax treatment: `non-registered`, `TFSA`, `RRSP`, `FHSA`,
  `Pension`. Offered on every kind except debts and property, where it is meaningless.

They are deliberately separate rather than one list: a TFSA may be a cash savings account
or a portfolio of ETFs, and merging the two would force the cross product ("TFSA savings",
"TFSA investment", …). Holdings reference an investment account by id, so a position's tax
treatment is derived from its account instead of being duplicated on the holding.

**Transactions have a source and a destination.** One side is always an account of yours;
the other is either the outside world (named by `payee`) or a second account of yours:

| Type | Source | Destination |
| --- | --- | --- |
| `expense` | your account | outside (payee) |
| `income` | outside (payee) | your account |
| `transfer` | your account | your other account |

Transfers are how money reaches a registered account — a TFSA contribution is a transfer
from chequing to the TFSA. They move money *within* your net worth rather than in or out
of it, so they are excluded from income, spending, budgets and the cash-flow charts.

**Recurring transactions** are templates plus a schedule (weekly, every 2 weeks, monthly,
quarterly, yearly), managed on the Transactions page. Each rule owns a `nextDate`; loading
the app posts every occurrence a rule owes up to today and advances it past them, so
reopening the app after three months away posts exactly the three payments it missed.
Generated rows carry the rule's id, which is also what stops a second run from posting a
duplicate. Deleting a rule keeps the payments it already made — that money really moved.
Month-based schedules clamp to short months, so a rule anchored on the 31st posts on
Feb 28 and then returns to the 31st in March.

> **Investment account balances are uninvested cash only.** Securities are valued from the
> holdings themselves, so an investment account's balance covers just the cash sitting in
> it. Recording a contribution as a transfer and then adding the holdings you bought with
> it will count the money twice until you reduce the cash balance to match.

> **Money is never stored as a float.** Every monetary, price and quantity
> column is Postgres `numeric` (see `src/db/schema.ts`), and every total is
> accumulated in integer cents via `src/lib/money.ts`. Binary floating point
> cannot represent values like `0.10` exactly, and the error compounds across
> the repeated sums and FX conversions this app performs.

## Structure

```
src/
  app/            # routes: dashboard, transactions, investments, budgets, accounts, import
  app/api/        # JSON API (force-dynamic route handlers)
  components/     # shell (sidebar/topbar), ui primitives, charts, forms, stat cards
  db/
    schema.ts     # Drizzle schema (9 tables; money stored as exact `numeric`)
    repo.ts       # queries, validation, balance side-effects, seed/reset
    init.ts       # one-shot migrate + first-run seed
  lib/
    types.ts      # domain models
    schemas.ts    # Zod request schemas shared by every API route
    money.ts      # exact money arithmetic in integer cents
    recurrence.ts # schedule arithmetic for recurring transactions
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
npm test            # unit tests (money, schemas, auth, rate limiting, analytics)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run check:security
npm run test:csv    # CSV parsing / categorization suite (scripts/csv-test.ts)
npm run test:db     # boots embedded PostgreSQL, tests migrations + repository end-to-end
```

Unit tests live beside the code as `src/lib/*.test.ts` and run on Node's built-in
test runner — `npm test` compiles them with `tsconfig.test.json` into `.test-build/`
and runs `node --test`, so there is no extra test-framework dependency.

Every one of the above runs in CI on push and pull request
(`.github/workflows/ci.yml`), along with a Docker image build.

## Accounts, transfers and recurring transactions

An account has two independent properties: a **kind** (checking, savings, cash,
investment, crypto, property, credit, loan) describing what it is and how it behaves, and a
**registration** (Non-registered, TFSA, RRSP, FHSA, Pension) describing its tax
treatment. They are deliberately not one list — a TFSA can be a cash savings account
or a portfolio of ETFs, and flattening them would force a "TFSA savings" / "TFSA
investment" cross product. Registration is only offered on kinds that can be
sheltered, so never on credit cards, loans or property.

Holdings belong to an **account** rather than carrying a loose "account type" tag, so a
contribution to a TFSA is an ordinary transfer into a real account. Investment and
crypto accounts both hold positions; a crypto wallet or exchange account works the same
way as a brokerage.

Every transaction records **where the money came from and where it went**. One side
is always an account of yours; the other is either a second account (a transfer) or
the outside world, named by the payee:

| Type | Source | Destination |
| --- | --- | --- |
| Expense | your account | payee |
| Income | payer | your account |
| Transfer | your account | your account |

Transfers change nothing about your net worth, so they are excluded from income,
spending, budgets and the cash-flow charts.

**A positions-holding account's balance is uninvested cash only** — its securities are
valued from the holdings. Buying therefore moves cash out of the account balance and
into a holding, leaving net worth unchanged; selling and dividends put cash back.
Adding a holding by hand records a position you already own and deliberately leaves
the cash alone.

**Recurring transactions** are templates plus a schedule (weekly, every 2 weeks,
monthly, quarterly, yearly), managed on the Transactions page. Each rule owns the
date it should next post, so catching up after the app has been closed for a month is
just a loop, and the work is idempotent: rules are materialised on load, generated
transactions are tagged with their rule id, and a rule that is up to date produces
nothing. Month-based schedules clamp to short months — a rule anchored on the 31st
posts on Feb 28 and returns to the 31st in March. Deleting a rule keeps the payments
it already posted, since that money really moved.

## Market data and the EODHD daily cap

Canadian holdings are priced by [EODHD](https://eodhd.com), whose free plan allows
**20 requests per day**, resetting at **00:00 GMT**. Going over does not degrade
gracefully — it just fails — so every EODHD call in the app reserves against a ledger
first and the app never exceeds the cap.

The count lives in the database (`app_meta.eodhd_quota`, keyed by UTC date), not in
memory: an in-process counter resets on every container restart, and a few redeploys
could otherwise spend a whole day's allowance. `EODHD_DAY_LIMIT` overrides the cap;
CI pins it to `0` so automated runs can never consume it, and no test calls the
provider.

Because there are usually far more holdings than daily calls, the refresh spends them
on the tickers that have gone longest without an update, tracked per ticker in
`app_meta.eodhd_last_fetch`. EOD prices only change after the market close, so nothing
is spent before 16:00 Eastern.

**When a price cannot be refreshed** — the allowance is spent, or the request failed —
the holding keeps its **last known price** and is marked stale: a `STALE` badge on the
row and a banner saying how many prices are affected and when the limit resets. Nothing
is silently presented as current, and the prices update on their own after the reset.

## Demo data

A fresh deployment seeds 18 months of deterministic sample data so the app is not empty
on first run. Once you start entering your own figures it is just noise, so the sidebar
offers **Delete demo data** — a one-time cleanup that removes the seeded accounts,
transactions, holdings and budgets while keeping anything you added yourself, along with
your category list.

The seeded rows are recognised by their id prefixes (`acc-`, `hold-`, `txn-`); rows you
create are assigned UUIDs and so are never matched. After the deletion the app records a
`demo_data_deleted` marker in `app_meta`, which stops first-run seeding from putting the
sample data back if you later empty the database. The button disappears once there is
nothing left to delete.
