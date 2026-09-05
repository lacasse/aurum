# Aurum · Personal Finance

A personal finance webapp for tracking **net worth**, **income & expenses**, **budgets**,
and an **investment portfolio** — with charts everywhere. State lives in **PostgreSQL**
(via Drizzle ORM) behind a small JSON API, and the whole stack ships as a set of **Docker
containers**. CSV imports — card statements, bank exports, brokerage activity reports —
are auto-categorized and reviewable before anything is saved, and a **monthly checklist**
closes a finished month in one pass.

Two themes: a warm cream light theme and a near-black dark one, both from the same set of
semantic tokens, with a toggle in the sidebar.

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

### What is reachable, and from where

**Every published port binds to `127.0.0.1`.** Nothing listens on a routable address, so the
app answers on this host and nowhere else — from another machine, reach it through an SSH
tunnel rather than by opening a port:

```bash
ssh -N -L 8443:localhost:443 user@<host>   # then https://localhost:8443
```

A port published as `"443:443"` listens on *every* interface. That is a decision worth
making rather than inheriting: everything this app holds is behind a login, but a login is
the only thing between the network and a complete financial history.

**Going internet-facing later** is three changes, and one of them is a deletion:

1. **Delete the port 80 line.** It exists to redirect to HTTPS, and a redirect is not worth
   an unencrypted port open to the internet. Anything that arrives on 80 either already
   knows to use HTTPS or is not a browser.
2. Widen 443 to `"443:443"`.
3. Replace the self-signed certificate in the `certs` volume with a real one, since a
   browser warning trains you to click through exactly the warning that matters.

Nothing else changes: the proxy already terminates TLS, sets the security headers, and is
the only way in.

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

If `BACKUP_ENCRYPTION_KEY` is set, dumps are written as `.sql.gz.enc`, encrypted with
AES-256-CBC and PBKDF2. **The backup service must run a Debian-based image for this**:
`postgres:17-alpine` carries no `openssl`, so the encrypted path fails with
`openssl: not found` and the service writes nothing at all — the compose file therefore
pins `postgres:17` for `backup` while `db` stays on alpine. Prefer that to installing the
package at startup, which would make every container start depend on a package mirror.

Use a passphrase with no shell metacharacters — the script interpolates it into an
`eval`, so hex is the safe shape (`openssl rand -hex 32`). Compose also expands `$` in
`.env`, which hex avoids.

> **The key is the backup.** It lives in `.env`, on the same machine as the `backups`
> volume — so a disk failure loses both, and an encrypted dump without its passphrase is
> noise. Keep a copy somewhere else. Turning encryption on does not re-encrypt the dumps
> already taken: they stay plain until retention ages them out.

Copy it into a password manager without putting it on screen. Reading a secret prints it
wherever you read it — a scrollback buffer, a shared session, a transcript — and every one
of those outlives the moment you needed it:

```bash
grep '^BACKUP_ENCRYPTION_KEY=' .env | cut -d= -f2 | tr -d '\n' | pbcopy   # macOS
grep '^BACKUP_ENCRYPTION_KEY=' .env | cut -d= -f2 | tr -d '\n' | xclip -sel clip   # Linux
pbcopy < /dev/null   # clear the clipboard once it is pasted
```

Confirm the copy matches without revealing either side — compare fingerprints, not keys:

```bash
grep '^BACKUP_ENCRYPTION_KEY=' .env | cut -d= -f2 | tr -d '\n' | shasum -a 256 | cut -c1-16
```

**If a key is ever exposed, rotate it.** Replace the line in `.env`, recreate the service
(`docker compose up -d --no-deps backup`), and check the log shows a new `.enc` file
written. Dumps taken under the old key still need the old key, so keep it until retention
has aged them out — then destroy it.

Check that backups exist (also visible under **GET `/api/backups`** after login):

```bash
docker exec finance-backup-1 sh -c 'ls -la /backups/'
```

Take a **manual backup before any risky operation** (schema change, reset, volume work):

```bash
docker exec finance-backup-1 /bin/sh /backup.sh once
```

That runs the scheduled dump's own code path rather than a second one written for the
occasion, which matters more than it sounds: it encrypts when `BACKUP_ENCRYPTION_KEY` is
set, applies the same integrity checks, prunes to retention, and exits non-zero if the
dump does not verify — so a script that backs up before doing something dangerous can
stop when the backup fails. A hand-typed `pg_dump` gets none of that and writes the whole
database in the clear; if you need a copy outside the volume, take one this way and
`docker cp` the encrypted file out.

**Restore** a backup (reload a dump from the `backups` volume into the DB):

```bash
# Find the file you want:
docker exec finance-backup-1 sh -c 'ls -l /backups/'
# Load it (drops nothing; COPY appends — for a full restore, truncate tables first):
docker exec finance-db-1 psql -U aurum -d aurum -c "TRUNCATE transactions, holdings, monthly_snapshots, accounts, budgets, categories, merchant_rules RESTART IDENTITY CASCADE;"
docker exec finance-backup-1 sh -c 'gzip -dc /backups/aurum_XXXXXXXX.sql.gz' | docker exec -i finance-db-1 psql -U aurum -d aurum
```

For an encrypted dump, decrypt on the way through:

```bash
docker exec finance-backup-1 sh -c 'openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"$BACKUP_ENCRYPTION_KEY" -in /backups/aurum_XXXXXXXX.sql.gz.enc | gzip -dc' \
  | docker exec -i finance-db-1 psql -U aurum -d aurum
```

**Rehearse it against a scratch database, not this one.** A backup nobody has restored is
an assumption. Restore into a throwaway container with no volumes attached, compare it
with what is live, then throw the container away — the live database is never written to:

```bash
docker run -d --name restore-check -e POSTGRES_PASSWORD=scratch -e POSTGRES_USER=aurum \
  -e POSTGRES_DB=postgres postgres:17-alpine
docker exec restore-check psql -U aurum -d postgres -c "CREATE DATABASE restored;"
docker exec finance-backup-1 sh -c 'gzip -dc /backups/aurum_XXXXXXXX.sql.gz' \
  | docker exec -i restore-check psql -U aurum -d restored -v ON_ERROR_STOP=1
# Same rows, same content? Run this against both and compare:
docker exec restore-check psql -U aurum -d restored -t -A -c \
  "SELECT md5(string_agg(id||date||amount::text||payee, '|' ORDER BY id)) FROM transactions;"
docker rm -f -v restore-check
```

Checksum the tables rather than counting them: a dump can carry every row and still have
lost a column. `holdings.flows` is the one worth checking by hand — it is JSON, it holds
every trade, and every return figure in the app is derived from it.

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
| **Dashboard** | Net worth KPI cards with sparklines, an all-time net-worth line, what net worth is *made of* as a 100% stacked composition, a financial-independence tracker against your own spending, cash-flow averages, income vs expenses, where the money went, and spending by category as a 100% stacked line |
| **Income** | Every kind of income over 1, 2 or 5 years: what arrives a month, how much of it is spendable, how much is passive, and a per-source table with trends — averaged over the window rather than over the months a source turned up in |
| **Transactions** | Everything that happened on a date, in one list: transactions **and trades**, under one set of filters (search, type — including buy/sell/dividend — category, account, month). Full CRUD on both; a trade is corrected by replaying its position's whole history rather than patching the numbers. Balances adjust automatically, every row records where the money came *from* and went *to*, and **Add** asks whether it repeats — a one-off, or a rule that posts itself on schedule. Rows are drawn a page at a time |
| **Expenses** | One month against the twelve before it: what it cost, how it split between necessity and choice, where it ranks against every month on record, what moved against each category's average, the recurring-cost floor, and a **cost-of-ownership card** (the car) averaged over every month owned rather than every month billed. **Budgets live here too** — a limit is an attribute of a category, so it is set beside what the category actually costs |
| **Investments** | Holdings CRUD with price updates, all-time value vs cost basis, asset allocation, holdings exposure by position, **where the money stands** — what open positions have done, what closed ones did, and what was paid out, kept apart so a good year is not hidden behind a loss already banked — three measures of return side by side (simple, money-weighted, time-weighted) against a benchmark, and a per-position table sortable by class, value, gain and MWRR |
| **Accounts** | Assets/liabilities/net-worth KPIs, assets-vs-liabilities stacked area, account cards with history sparklines, and a defined-benefit pension card (transfer value against what you contributed). Accounts carry a kind (chequing, savings, cash, investment, crypto, property, credit, loan, pension) and a registration (non-registered, TFSA, RRSP, FHSA, Pension) |
| **Year** | Every year on record against the one before: income against spending, what it grew to, what the portfolio did with it, and the month each milestone was first passed |
| **Tax** | Realized gains, dividends and interest by year — non-registered only, since that is the only place any of it is reportable |
| **Import CSV** | Drop in one file or many and each is routed by what it *is*: a card statement, a bank export with debit/credit columns, a trade log, or a brokerage activity report that is all of those at once. Format, sign convention and account are detected per file, categories are suggested against your own list, duplicates are flagged, and every row is reviewable before anything is saved |
| **Monthly checklist** | Closes the month that just ended in one pass: import → income → spending → *mergers* → trades → pension → save. The mergers step appears only when a file carried one. Nothing is written until the last step |
| **Guide** | How each figure is arrived at: the pension, staking rewards, necessity vs choice, what a statement is read for, what the checklist covers, realized vs unrealized, and which months a chart shows |

## Stack

- [Next.js](https://nextjs.org) 16 (App Router, Turbopack) + React 19 + TypeScript
- [PostgreSQL](https://www.postgresql.org) 17 + [Drizzle ORM](https://orm.drizzle.team) (migrations in `drizzle/`, applied at startup)
- [Zod](https://zod.dev) for request-body validation — schemas are declared once in `src/lib/schemas.ts` and shared by every route
- Route Handlers under `src/app/api` expose the data (accounts, transactions, holdings, budgets, categories, merchant rules, recurring rules, demo-data deletion)
- [Tailwind CSS](https://tailwindcss.com) v4 — semantic design tokens only (`--surface`, `--ink`, `--line`…), so both themes are one set of names with two sets of values, and the type scale is one declaration (`html { font-size }`)
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
  `crypto`, `property`, `credit`, `loan`. This decides the balance arithmetic (credit cards
  and loans store what is *owed*, so the signs invert) and which accounts can hold
  securities. Investment and crypto accounts both hold positions; a wallet or exchange
  account works the same way as a brokerage.
- **Registration** — its tax treatment: `non-registered`, `TFSA`, `RRSP`, `FHSA`,
  `Pension`. Offered on every kind that can be sheltered, so never on credit cards, loans
  or property.

They are deliberately separate rather than one list: a TFSA may be a cash savings account
or a portfolio of ETFs, and merging the two would force the cross product ("TFSA savings",
"TFSA investment", …). Holdings belong to an **account** by id rather than carrying a
loose "account type" tag, so a position's tax treatment is derived from its account
instead of being duplicated on the holding, and a TFSA contribution is an ordinary
transfer into a real account.

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
reopening the app after three months away posts exactly the three payments it missed. The
work is idempotent: rules are materialised on load, generated rows carry the rule's id,
and that id is what stops a second run from posting a duplicate. Month-based schedules
clamp to short months, so a rule anchored on the 31st posts on Feb 28 and then returns to
the 31st in March. Deleting a rule keeps the payments it already made — that money really
moved.

> **Investment account balances are uninvested cash only.** Securities are valued from the
> holdings themselves, so an investment account's balance covers just the cash sitting in
> it. Buying moves cash out of the balance and into a holding, leaving net worth
> unchanged; selling and dividends put cash back. Recording a contribution as a transfer
> and then adding the holdings you bought with it will count the money twice until you
> reduce the cash balance to match.

> **Money is never stored as a float.** Every monetary, price and quantity
> column is Postgres `numeric` (see `src/db/schema.ts`), and every total is
> accumulated in integer cents via `src/lib/money.ts`. Binary floating point
> cannot represent values like `0.10` exactly, and the error compounds across
> the repeated sums and FX conversions this app performs.

## The monthly checklist

One pass that closes the month that has just **finished**, not the one running: import →
income → spending → trades → pension → save.

Everything imported is trimmed to that month. A statement downloaded on the third carries
a few days of both months, and without the trim those days land silently in the wrong
month's totals. The file is read first because every step after it is a review of what the
file said — income is a total of it, spending is a list of it, trades are read out of it —
and each is editable.

**Nothing is written until the last step.** Every step collects; the final one lists
exactly what is about to be recorded and saves the lot at once. Closing the dialog before
then changes nothing. The steps used to save as you left them, which meant abandoning the
checklist halfway left half a month behind — income recorded against a month whose
spending was never reviewed, or trades posted before the snapshot meant to value them.

Income is dated the last day of the month being closed, whatever day the checklist is
actually done on, and the pension figure is recorded against that month too.

**Mergers and demergers get a step only when a file carried one.** An empty step every
month, for something that happens twice a decade, is a step people learn to click past.
When one does turn up it is applied *before* the trades: the action decides what the new
shares cost, and a sale of them in the same month is measured against that, so applying
it afterwards prices the sale against a cost base that did not exist when it happened.
Files were parsed for these and the results thrown away until recently — a month closed
here recorded the sale of shares whose basis nothing had moved, and reported a gain out of
nothing.

**The portfolio snapshot is no longer a step.** It was a table of sixty prices to scroll
past, and nobody edits a price they have no better source for than the app itself. Saving
the month records what is held, read *after* the trades land so it reflects the month it
closes and picks up positions that had no id a moment earlier. Nothing else takes a
snapshot on its own: skip a month and it has no closing value, so the months that are
missing — or that hold a fraction of the positions the months around them hold — are
counted on the checklist button.

## What an import works out for itself

Three things are detected per file rather than asked for, because each one has a right
answer written down in the file:

- **What the file is.** A card statement, a bank export with debit/credit columns, a trade
  log, or a brokerage activity report — which is a cash statement, a trade log and a
  corporate-action feed at once. Format detection is per file, so a mixed drop works.
- **Which sign means "out".** Some exports write spending negative, some positive, and
  some carry an explicit Debit/Credit column. The parser reads every row first, decides
  the convention for the file as a whole, and only then assigns directions — an explicit
  column always beats an inferred sign.
- **Which account a row belongs to.** An activity export names the account on every line.
  That used to be read only for *registered* accounts, so chequing rows arrived
  unattributed and the checklist filed them against the credit card: a month of
  pre-authorized debits and e-transfers recorded as card spending. The row's own word wins
  now, then the file's kind, and the everyday account is the last resort rather than the
  first.

Two smaller ones. A **ticker's exchange suffix is ignored when matching an existing
position** — a broker writes `TSLA.NEO` where you hold `TSLA`, and treating those as
different securities opened duplicate holdings. An exact match still wins, and where a
venue-less symbol matches two holdings the account decides; if it is still ambiguous the
row is left alone, because `MA` and `MA.NEO` in one account really are Mastercard and its
CDR. And a **repayment is asked which debt it pays**, since that is the one row whose far
side cannot be guessed — every other expense ends at the merchant.

## Importing a budgeting spreadsheet

A sheet that keeps one row per month and one column per category is a different shape from
the per-transaction data the app holds, so `scripts/import-monthly-totals.ts` turns each
non-zero cell into one transaction dated at the month end, with the sheet's own column name
as the payee. It leaves account balances alone — the totals are history, already reflected
in what the accounts carry today, and replaying them would count every dollar twice — and
its ids are derived from month, category and payee, so a second run corrects the same rows
rather than duplicating them.

```bash
docker exec -e DATABASE_URL=... aurum-dev \
  npx tsx scripts/import-monthly-totals.ts rows.json --map my.map.json
```

Without `--commit` it prints what it would write and changes nothing. `rows.json` is an
array of `{ date, kind, sheetCategory, amount }`; a negative amount in a spending column is
money coming back, and lands as income.

The column map is a **separate file you keep outside the repository**. That is the point of
the flag: a column map is a list of the things one particular person spends money on —
their lender, their landlord, the people they owe — and it has no business in source
control. `scripts/monthly-totals.example.json` shows the shape with generic names, and
`/scripts/*.map.json` is gitignored so your real one cannot be committed by accident.

## Realized, unrealized, and the cost base

Cost base is **average cost, per account**, and a partial sale disposes of a proportional
slice of it. That is the Canadian treatment, and per-account is not a detail: a loss in a
TFSA is not deductible and has no cost base worth tracking, while the same trade in a
non-registered account does.

The holdings table's gain column pools **unrealized + realized + dividends** across every
account and every closed lot, which is worth knowing before reading it. Sell a position at
a loss and buy back in two years later and the row shows the old loss, not how the new
position is doing — both figures are correct, they answer different questions. Realized and
unrealized are both on `HoldingRow` (`realizedGain`, `gain`) if you want them apart.

Two rules the app does **not** implement, and would need to for tax filing: the
**superficial loss** rule (a loss denied when the same security is bought back within 30
days, and added to the new cost base instead), and any adjustment for return of capital.

## Correcting a trade

A trade is not a transaction. It has no row and no id of its own — it is an entry in a
position's `flows` array — so a row on the transactions page carries the holding it
belongs to and its index in that array, and that is the way back to it.

**Editing one replays the position's whole history rather than patching its numbers.** A
buy in the middle of a history cannot be undone by subtracting it: average cost depends on
the order things happened in, and a sale between two buys was already priced against the
average at that moment. `replayFlows` in `src/lib/flows.ts` recomputes shares, cost base
and dividends from the first flow forward, sorted by date rather than by position in the
array — a statement that arrives a month late is appended to the end and belongs earlier.
A test asserts the replay agrees with what `planTrades` builds, since the two drifting
apart would silently restate a portfolio.

Three limits, each deliberate:

- **Account balances are not touched.** The cash moved when the trade did; correcting the
  record of it months later does not move any money back.
- **The kind and the position cannot be changed.** A buy that should have been a sell is a
  different event, and moving a trade between positions restates two cost bases. Delete it
  and record it properly.
- **Money in and out counts transactions only.** A buy is not spending and a sell is not
  income — both move money between things you own — so trades get a count in the page
  subtitle rather than a total. An afternoon of rebalancing would otherwise read as
  enormous earning and enormous spending at once.

## Shipping an unfinished page

Pages under construction are marked `unreleased` in the nav array in
`src/components/shell.tsx`. They are listed in development and hidden in a production
build, so work carries on with no release branch to cherry-pick onto and no revert to
re-apply. Promoting a page is deleting one word.

```ts
{ href: "/tax", label: "Tax", icon: Receipt, unreleased: true },
```

Visible when `NODE_ENV !== "production"`, or when `NEXT_PUBLIC_SHOW_UNRELEASED=1` is set
at build time for checking a production build. **This hides rather than disables** — the
route is still built and still answers to its URL, which is how a page is checked in the
real app before it is promoted. It is not a way to keep anything private.

## Performance

The client does all its own analysis, so the work that matters is a page's selectors
rather than a query. Measured against a real record — 1,438 transactions, 60 holdings, 80
months of history — the dashboard's analysis costs **24 ms**, down from 59 ms, after four
fixes worth recording because each was a class of mistake rather than a slow line:

- **Dates parsed inside a loop that never needed them again.** The money-weighted return
  bisects ~44 times over the same flows, and each pass re-parsed every date: 188,000
  `Date.parse` calls for one pass over the holdings table. Hoisting them out took
  `consolidateHoldings` from 21 ms to 4.5 ms.
- **The same walk done twice.** The all-time series and the by-class series both replay
  every holding's flows month by month; the dashboard draws both. They now share one
  cached walk, keyed on the holdings array and the month range.
- **A linear scan behind a point lookup.** `accountValueAt` is asked for every month of
  every chart and scanned the account's history each time. It is indexed now, in a
  `WeakMap` on the history array — the store replaces those arrays rather than mutating
  them, so a stale entry falls out by itself.
- **String-keyed maps in the hot loop.** Ten thousand month-keyed `Map` writes per pass
  became array offsets.

The transactions table also draws a page at a time. It used to render every match — 1,438
rows, some ten thousand elements — so every keystroke in the search box rebuilt the lot.

## Structure

```
src/
  app/            # routes: dashboard, income, transactions, expenses, investments,
                  #   accounts, year, tax, import, import-trades, guide, login
  app/api/        # JSON API (force-dynamic route handlers)
  components/     # shell (sidebar/logo/topbar), ui primitives, charts, forms,
                  #   stat cards, the monthly checklist
  db/
    schema.ts     # Drizzle schema (11 tables; money stored as exact `numeric`)
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
    analytics.ts  # pure selectors: series, allocations, returns, totals
    expenses.ts   # necessity/discretionary grouping, recurring floor, cost of ownership
    year.ts       # year-over-year rollups and milestones
    tax.ts        # realized gains, dividends and interest by year, non-registered only
    xirr.ts       # money-weighted return over dated flows
    pension.ts    # defined-benefit estimates from contributions
    allocation.ts # drift against target weights
    checklist.ts  # month partitioning, income detection, snapshot gaps
    trade-batch.ts# plans a batch of trades without applying it
    trades.ts     # trade-log parsing
    activities.ts # brokerage activity exports (cash, trades and actions in one file)
    corporate-actions.ts # splits, demergers, journalled listings
    import-router.ts # decides what a dropped file is, and which account a row names
    csv.ts        # CSV parsing, format and sign detection, categorization engine
    market.ts     # provider routing by exchange suffix
    benchmark.ts  # month-end benchmark series
    eodhd-quota.ts / twelvedata-quota.ts # per-provider call ledgers
    rewards.ts    # staking rewards awaiting a price
    fx.ts         # CAD/USD rate
    auth.ts / login-rate-limit.ts # session cookies, per-IP lockout
    format.ts     # currency/date/month formatting helpers
    hooks.tsx     # mounted/server-ready gates + page skeleton
drizzle/          # generated SQL migrations (applied on startup)
```

## Tests

```bash
npm test            # 592 unit tests (money, schemas, auth, rate limiting, analytics,
                    #   csv, checklist, trades, expenses, tax, pension, xirr…)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run check:security
npm run test:csv    # CSV parsing / categorization suite (scripts/csv-test.ts)
npm run test:db     # boots embedded PostgreSQL, tests migrations + repository end-to-end
```

Unit tests live beside the code as `src/lib/*.test.ts` and run on Node's built-in
test runner — `npm test` compiles them with `tsconfig.test.json` into `.test-build/`
and runs `node --test`, so there is no extra test-framework dependency.

`npm test` compiles with `--noCheck`, which is what makes it quick: skipping the type
check is roughly half its wall clock, and `npm run typecheck` already covers every file
including the tests. So **a type error does not fail `npm test`** — run `npm run
test:checked` for both in one command. The two share `.test-build/`, so alternating
between them invalidates the incremental cache and costs a full rebuild each way.

Every one of the above runs in CI on push and pull request
(`.github/workflows/ci.yml`), along with a Docker image build.

## Market data

Prices come from two providers, and **the ticker's exchange suffix decides which one**.
A ticker naming its listing venue — `XEQT.TO`, `RETL.NEO`, `AUTO.NE` — is quoted by
EODHD. A bare ticker — `AAPL`, `REIT`, `BTC` — is quoted by Twelve Data.

That rule used to key on the holding's currency instead, which read sensibly until you
notice the currency is a form field that defaults to CAD. Someone typing a US stock into
a fresh trade row never said "Canadian" — the default did — and the app went looking for
`AAPL.TO`, a symbol that does not exist, spending one of a strictly limited twenty daily
calls to find that out. A suffix is something you write down on purpose, so routing on it
replaces an inference with a statement and leaves no ambiguous case to guess at. It also
reaches both crypto cases without a special case: a bare coin goes to Twelve Data, while
an exchange-listed crypto product like `CRYP-A.TO` stays on EODHD.

The rule only holds if no Canadian listing is stored bare, which migration
`0008_normalise_exchange_suffixes` guarantees. A bare symbol sent to Twelve Data does not
merely fail — it can match a same-named US listing and return a confident price, in the
wrong currency, for a security you do not own. A stale price is visible; that is not.

### The EODHD daily cap

[EODHD](https://eodhd.com)'s free plan allows **20 requests per day**, resetting at
**00:00 GMT**. Going over does not degrade gracefully — it just fails — so every EODHD
call in the app reserves against a ledger first and the app never exceeds the cap.

The count lives in the database (`app_meta.eodhd_quota`, keyed by UTC date), not in
memory: an in-process counter resets on every container restart, and a few redeploys
could otherwise spend a whole day's allowance. `EODHD_DAY_LIMIT` overrides the cap;
CI pins it to `0` so automated runs can never consume it, and no test calls the
provider.

Because there are usually far more holdings than daily calls, the refresh spends them
on the tickers that have gone longest without an update, tracked per ticker in
`app_meta.eodhd_last_fetch`. EOD prices only change after the market close, so nothing
is spent before 16:00 Eastern.

Type-ahead ticker validation draws on the same twenty calls, but not on equal terms.
Validation fires on a debounce as you type where the refresh runs once, so left
unchecked the typing wins — and a stale price is visible on every holding, while a
validation tick is a convenience on one field. Validation therefore stops short of the
last `EODHD_VALIDATE_RESERVE` calls (default **5**) and reports that it could not check,
rather than spending what the prices need.

### The Twelve Data credit ledger

[Twelve Data](https://twelvedata.com) quotes everything without an exchange suffix: US
equities and coins. Its free plan is limited on **two** axes at once — **8 credits per
minute** and **800 per day** — and one request costs one credit per symbol, so a
portfolio refresh can trip the per-minute limit long before the daily one.

Reservations are all-or-nothing, unlike EODHD's: a Twelve Data request carries a batch
of symbols, and a partial grant would mean deciding which symbols to drop, so callers
batch to fit instead. The ledger is again in the database — `app_meta.twelvedata_quota`,
holding a minute bucket and a day bucket (`minute:used|day:used`) — and reserved under a
row lock, so two concurrent refreshes cannot both see the same headroom and jointly
exceed the cap.

Both limits keep a reserve rather than spending to the last credit, so an interactive
lookup is not starved by a background refresh that arrived first:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TWELVEDATA_MINUTE_LIMIT` | `8` | Provider's per-minute allowance |
| `TWELVEDATA_DAY_LIMIT` | `800` | Provider's daily allowance |
| `TWELVEDATA_MINUTE_RESERVE` | `1` | Credits a minute never spends |
| `TWELVEDATA_DAY_RESERVE` | `100` | Credits a day never spends |

CI pins the minute and day limits to `0`, on the same reasoning as EODHD: no test calls
the provider, and a zero limit means a future one could not either.

### Monthly history, and the all-time charts

The two providers above answer one question — what is this worth *now*. The portfolio
growth and time-weighted return charts ask a different one: what was it worth in every
month since the record begins. Neither allowance can carry that. EODHD's whole day is
twenty calls and its free plan caps history at **one year** regardless of the range
requested; Twelve Data has no TSX coverage at all.

So the history is **not fetched**. It comes from two places, both stored:

- **Your own month-end records**, in `monthly_snapshots`. What a position was actually
  worth at each month end is a better figure than any provider's — it is a record, not a
  price fetched years later multiplied by a share count replayed from trades. Where the
  two disagree, the record wins.
- **The benchmark series**, in `price_history` under source `benchmark`, shipped with the
  code in migration `0016`. A month-end close does not change once the month is over, so
  it is data rather than a feed: nothing to poll, no quota, no failure mode.

The current month is the one month never covered, since it is only recorded once it ends;
it falls back to the live price, which is right for today and wrong for every earlier
month. That is why the fallback is confined to the last point.

**Yahoo used to serve both of these and has been removed entirely.** Its chart endpoint
answers a burst from one address with `429`s that last many minutes, and it refused every
request across a full day of attempts, paced and unpaced alike. Worse, the benchmark route
fell back to a deterministic simulation when the fetch failed — so the "XEQT" line was a
random walk wearing its name, marked only by a badge. A number that is quietly invented is
worse than one that is missing.

The series keeps itself current from EODHD, and costs **one call however wide the gap**:
the EOD endpoint takes a date range and `period=m` returns one bar per month, so a year of
missing months arrives in a single response.

It is careful with a scarce allowance. It runs only when a completed month is actually
missing, which is at most once a month — the ordinary case reads one row and stops. It
draws against the same reserved ceiling as ticker validation, so it can never take the
last calls a price refresh depends on; if the day is spent it waits for tomorrow. And it
marks the day whether or not it succeeded, so a bad afternoon at the provider costs one
call rather than one per page load.

There is deliberately no scheduled month-end job. A job that fires on the last day of the
month only works if the app is running and reached on that exact day; miss it once and
that month is lost. Filling by *absence* instead means any completed month that is missing
gets picked up whenever the chart is next drawn — on the 1st, the 15th, or three months
later — with no scheduler and nothing to miss.

The month in progress is never fetched. Its close does not exist yet, and writing a
month-to-date figure into a series of month-end closes would either leave a stale number
for the rest of the month or turn one call a month into thirty. It arrives as a real close
once the month has ended, like every other month.

The monthly checklist deliberately does **not** feed this series, though it looks like it
could. It records holdings "as of the 1st of the month" from whatever live price the app
holds — which is not a month-end close, and quietly filing one in a column of published
closes would put two different kinds of number in the same place.

Two limits worth knowing. EODHD's free plan serves **one year** of history whatever range
is asked for, so a gap wider than that cannot be closed automatically — ship the missing
closes in a migration instead. And an empty series is not treated as a gap: that means the
shipped migration has not run, and fetching a decade one year at a time is not the answer.

### What the refresh actually asks for

One request per **security**, not per position. The same ticker held in four accounts
asked for four prices before, spending four calls to learn one number.

**Closed positions are not polled.** A sold-off holding's price changes nothing — its
realized gain is settled by what it sold for — so keeping it current on a timer spends a
scarce allowance on a number nobody is looking at. They are priced once, on demand, the
first time you open the closed-positions section.

**When a price cannot be refreshed** — the allowance is spent, the market has not closed
yet, or the request failed — the holding keeps its **last known price** and is marked
stale: a `STALE` badge on the row and a banner above the table. Nothing is silently
presented as current.

Staleness is not a duration. A ticker is stale when a refresh returns **no price for it**,
from either provider, having found nothing in the server's cache either. That cache is
what decides how long a price stays fresh: **5 minutes** for Twelve Data, **24 hours** for
EODHD, whose end-of-day figure does not change intraday anyway. It lives in process
memory, so a restart empties it and every holding is briefly stale after a deployment —
the prices are not old, the server has simply forgotten them.

Both providers are covered. Earlier this was computed over the EODHD tickers alone, a
leftover from when that was the only rationed feed, so a coin or US stock that failed to
quote went on showing its last known price with nothing to say the figure was not current.
The banner names the daily cap only when the cap is genuinely the cause, since a Twelve
Data failure has nothing to do with the EODHD allowance and waiting for its reset would
change nothing.

The same distinction applies to ticker validation, which reports three outcomes rather
than two: a green tick for a symbol the provider knows, a red cross for one it rejects,
and a grey question mark for one **nobody looked up** — the allowance was gone, or the
request failed. Collapsing that third case into the second is why every ticker once
appeared to be invalid once the day's EODHD calls were spent. A ticker you already hold
skips the network entirely: it is held, so it exists.

## Demo data

A fresh deployment seeds 18 months of deterministic sample data so the app is not empty
on first run. Once you start entering your own figures it is just noise, so the sidebar
offers **Delete demo data** — a one-time cleanup that removes the seeded accounts,
transactions, holdings and budgets while keeping anything you added yourself, along with
your category list.

**It exists to show the app working, so it has to reach every page.** Positions are built
from trades and their numbers read back off them, so the holdings table, the exposure ring
and the trade rows are three views of one record. One position is closed at a loss and two
were trimmed while still held, which is what makes the realized and unrealized halves of a
return disagree. Month-end snapshots are seeded alongside — without them the app values
every past month at book cost and the portfolio charts are a flat line however good the
prices are. Income runs to eight sources including a loan advance that is deliberately not
income, there is a pension account, debt repayments, transfers and standing rules.
`src/lib/sample.test.ts` asserts that coverage: a generator that quietly stops producing
trades leaves whole features looking broken to anyone seeing them for the first time.

**The securities are invented.** The sample is a fiction throughout and reads nobody's
records, but real tickers still invite the wrong reading — a demo portfolio holding the
same names as the real one is hard to tell apart at a glance, and a screenshot of it looks
like a statement.

The integration and smoke suites count what the generator produced rather than literals,
so growing the sample cannot fail CI for being right.

The seeded rows are recognised by their id prefixes (`acc-`, `hold-`, `txn-`); rows you
create are assigned UUIDs and so are never matched. After the deletion the app records a
`demo_data_deleted` marker in `app_meta`, which stops first-run seeding from putting the
sample data back if you later empty the database. The button disappears once there is
nothing left to delete.
