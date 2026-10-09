# Development

## Develop against invented data

Development runs against `aurum_dev`, a separate database that holds nothing real:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d
```

The app is then on <http://127.0.0.1:3002>, running from the working tree, with unreleased
pages visible. `aurum_dev` is created empty, and an empty database is seeded from
`generateSampleData()`, so it comes up full of invented accounts, holdings and transactions
with no seeding step of its own.

It is a separate database on purpose. Development used to run against the production one,
which meant real balances were on screen while writing every test, comment and commit
message — and that is where they kept ending up. Reaching real data is still possible and
now has to be deliberate: pass `DATABASE_URL` explicitly for the one command that needs it.

## Run it (local, no Docker)

```bash
npm install
DATABASE_URL=postgres://aurum:aurum@localhost:5432/aurum_dev npm run dev
```

Without a reachable database the app still renders using bundled sample data (writes are
skipped with console errors).


## Stack

- [Next.js](https://nextjs.org) 16 (App Router, Turbopack) + React 19 + TypeScript
- [PostgreSQL](https://www.postgresql.org) 17 + [Drizzle ORM](https://orm.drizzle.team) (migrations in `drizzle/`, applied at startup)
- [Zod](https://zod.dev) for request-body validation — schemas are declared once in `src/lib/schemas.ts` and shared by every route
- Route Handlers under `src/app/api` expose the data (accounts, transactions, holdings, budgets, categories, merchant rules, recurring rules, snapshots, contribution limits, goals, settings, people and invitations, backups, prices, demo-data deletion)
- [Tailwind CSS](https://tailwindcss.com) v4 — semantic design tokens only (`--surface`, `--ink`, `--line`…), so both themes are one set of names with two sets of values, and the type scale is one declaration (`html { font-size }`)
- [Recharts](https://recharts.org) for all charts
- [Zustand](https://zustand.docs.pmnd.rs) as the client cache — optimistic updates with fire-and-forget persistence to the API
- [Papa Parse](https://www.papaparse.com) for CSV import, [lucide-react](https://lucide.dev) icons, [next-themes](https://github.com/pacocoursey/next-themes) theming

> **Security note (informational):** The production image runs the compiled
> Next.js **standalone** output (`node server.js`), so it is unaffected by the
> esbuild dev-service advisory that applies only to `next dev`/`tsx` in a
> development environment. Do not pin dev-only tooling below the advisory line.


## Shipping an unfinished page

Pages under construction are marked `unreleased` in the nav array in
`src/components/shell.tsx`, read through `SHOW_UNRELEASED` in `src/lib/unreleased.ts`,
which also gates anything such a page brings with it elsewhere — a checklist step, a
celebration. They are listed in development and hidden in a production build, so work carries on with no release branch to cherry-pick onto and no revert to
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
rather than a query. Measured against a real record of several years, the dashboard's
analysis costs **24 ms**, down from 59 ms, after four fixes worth recording because each
was a class of mistake rather than a slow line:

- **Dates parsed inside a loop that never needed them again.** The money-weighted return
  bisects dozens of times over the same flows, and each step re-parsed every date, so
  `Date.parse` ran once per flow per step for one pass over the holdings table. Hoisting them out took
  `consolidateHoldings` from 21 ms to 4.5 ms.
- **The same walk done twice.** The all-time series and the by-class series both replay
  every holding's flows month by month; the dashboard draws both. They now share one
  cached walk, keyed on the holdings array and the month range.
- **A linear scan behind a point lookup.** `accountValueAt` is asked for every month of
  every chart and scanned the account's history each time. It is indexed now, in a
  `WeakMap` on the history array — the store replaces those arrays rather than mutating
  them, so a stale entry falls out by itself.
- **String-keyed maps in the hot loop.** The month-keyed `Map` writes in every pass became
  array offsets.

The transactions table also draws a page at a time. It used to render every match, so every
keystroke in the search box rebuilt the lot.

## Structure

```
src/
  app/            # routes: overview, income, transactions, expenses, investments,
                  #   accounts, year, goals, tax, guide, settings, import-trades,
                  #   login, invite
  app/api/        # JSON API (force-dynamic route handlers)
  components/     # shell (sidebar/logo/topbar), ui primitives, charts, forms,
                  #   stat cards, the monthly checklist, goals, settings cards
  db/
    schema.ts     # Drizzle schema (13 tables; money stored as exact `numeric`)
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
    expenses.ts   # needs/wants/neither grouping, cost of ownership
    budget-habits.ts # budgets that follow the average, streaks, the year's review
    year.ts       # year-over-year rollups, roll forward, money flow, milestones
    story.ts      # the overview's verdicts: what moved net worth, what is worth a look
    goals.ts      # goal measures, progress and when a goal counts as met
    contributions.ts # registered plan contributions against each year's room
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
    invites.ts / route-guard.ts   # invitations, the routes that answer without a session
    api-keys.ts   # whose market-data keys a request uses
    demo.ts       # the browser-only demo from the login page
    unreleased.ts # whether unfinished pages are shown
    version.ts    # comparing the running version with the latest release
    format.ts     # currency/date/month formatting helpers
    hooks.tsx     # mounted/server-ready gates + page skeleton
drizzle/          # generated SQL migrations (applied on startup)
```

## Tests

```bash
npm test            # unit tests (money, schemas, auth, rate limiting, analytics, csv,
                    #   checklist, trades, expenses, goals, tax, pension, xirr…)
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

