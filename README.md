# Aurum · Personal Finance

A dark-themed personal finance webapp for tracking **net worth**, **income & expenses**,
**budgets**, and an **investment portfolio** — with charts everywhere. All data lives in
your browser (localStorage); no backend or account needed. Ships with 18 months of
realistic demo data you can reset at any time from the sidebar.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
```

Production:

```bash
npm run build && npm run start
```

## Features

| Page | What you get |
| --- | --- |
| **Dashboard** | Net worth / income / expenses / savings-rate KPI cards with sparklines, net-worth area chart (6–18M range toggle), expense donut, income-vs-expense bars, portfolio growth vs cost basis, stacked spending-by-category area, accounts overview, recent transactions |
| **Transactions** | Full CRUD with filters (search, type, category, account, month), filtered summary chips, filtered cash-flow chart, balances adjust automatically |
| **Investments** | Holdings CRUD with price updates, value-vs-cost-basis chart, asset-allocation donut, sector radar, gain/loss bars, per-position table with weights |
| **Budgets** | Monthly budgets per category, radial utilization gauge, budget-vs-actual bars, progress rows with inline limit editing, daily pace estimate — and a category manager: create, rename, and delete categories (renames cascade to budgets and existing transactions; deleted categories move their transactions to "Other") |
| **Accounts** | Assets/liabilities/net-worth KPIs, assets-vs-liabilities stacked area, account cards with history sparklines |
| **Import CSV** | Upload one or many credit-card CSV exports (Amex-style or `transaction_date/merchant/amount`), auto-detected format, auto-categorization against your budget-section categories, duplicate flagging, and a review step to edit/delete/include rows before anything is saved. Card payments are skipped; category corrections are remembered per merchant for future imports |

## Stack

- [Next.js](https://nextjs.org) 16 (App Router, Turbopack) + React 19 + TypeScript
- [Tailwind CSS](https://tailwindcss.com) v4 (semantic design tokens, dark theme by default with a light-mode toggle)
- [Recharts](https://recharts.org) for all charts
- [Papa Parse](https://www.papaparse.com) for CSV import
- [Zustand](https://zustand.docs.pmnd.rs) with `persist` middleware (localStorage)
- [lucide-react](https://lucide.dev) icons, [next-themes](https://github.com/pacocoursey/next-themes) theming

## Structure

```
src/
  app/            # routes: dashboard, transactions, investments, budgets, accounts
  components/     # shell (sidebar/topbar), ui primitives, charts, forms, stat cards
  lib/
    types.ts      # domain models
    sample.ts     # deterministic 18-month sample data generator
    store.ts      # zustand store + persistence + balance logic
    analytics.ts  # pure selectors: series, allocations, budgets, totals
    format.ts     # currency/date/month formatting helpers
    hooks.tsx     # mounted gate + page skeleton
```

Demo data is regenerated deterministically; use **Reset demo data** in the sidebar to
start over.

## Tests

```bash
npm run test:csv   # CSV parsing / categorization suite (scripts/csv-test.ts)
```
