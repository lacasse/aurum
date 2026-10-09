# About Aurum

## Why it exists

Budgeting services want your bank credentials, and spreadsheets stop scaling the moment
you own more than one thing. Aurum is the third option: the spreadsheet's control, with
software's memory of what you already told it.

The design follows from that. Every figure is **derived from what you recorded**, not
stored as a summary that can drift from it — a position's shares, cost base and return all
come from replaying its trades. Nothing is fetched from your bank; you import files you
already have. And the app runs bound to **loopback by default**, because the sensible
place for one person's finances is not the open internet.

## What it is opinionated about

These are the calls the app makes, so you can tell early whether they suit you:

- **Cost base is average cost, per account** — the Canadian treatment. A partial sale
  disposes of a proportional slice of it.
- **A cost base is fixed when you acquire something.** A converted amount is a fact about
  the day it converted, never recomputed at today's exchange rate.
- **Money you borrowed is not money you earned**, and a transfer between your own accounts
  is neither income nor spending. Both are excluded from every cash-flow figure.
- **Staking rewards are income *and* an acquisition** at what the tokens were worth on the
  day, so the income is recorded once and the eventual sale is not taxed on it twice.
- **A defined-benefit pension is not cash.** It counts toward net worth and is kept out of
  anything called "assets" or "spendable".
- **Realized and unrealized are kept apart**, so a good year is not hidden behind a loss
  already banked.
- **An RRSP year runs from 1 March to the end of February**, named for the year it starts
  in, because a contribution made in January or February uses the room of the year before.
  TFSA and FHSA room is a calendar year.

## Scope, and what it is not

- **Self-hosted, for one person or a few.** Each account keeps a separate record: nobody
  can see anyone else's, and there is no sharing between them. New accounts come only from
  invitations an administrator creates — nobody can sign themselves up.
- **Canadian by default** — registration types (TFSA, RRSP, FHSA), average-cost basis, CAD
  as the reporting currency with USD holdings converted at the rate you actually paid.
- **Not a tax filing tool.** The tax page reports realized gains, dividends and interest by
  year, and the superficial-loss rule is not implemented. Treat the output as a starting
  point for a conversation with an accountant, not as a return.
- **Not financial advice**, and not a broker. It records what you tell it.
- A personal project, shared in case it is useful. There is no support and no roadmap.


## Features

| Page | What you get |
| --- | --- |
| **Overview** | Where you stand over the trailing twelve months: net worth and what moved it, a **roll forward** from net worth a year ago through income, spending and markets to today, average monthly cash flow against the twelve months before, a **money flow** chart from each source through the accounts to what it became, financial independence and passive-income coverage, a short list of things worth a look, and net worth over time beside a **balance sheet** pie of everything owned — cash, stocks, bonds, crypto and the pension |
| **Income** | Every kind of income over the year to date, 1, 2 or 5 years: what arrives a month, how much of it is spendable, how much is passive, and a per-source table with trends — averaged over the window rather than over the months a source turned up in |
| **Transactions** | Everything that happened on a date, in one list: transactions **and trades**, under one set of filters (search, type — including buy/sell/dividend — category, account, month). Full CRUD on both; a trade is corrected by replaying its position's whole history rather than patching the numbers. Balances adjust automatically, every row records where the money came *from* and went *to*, and **Add** asks whether it repeats — a one-off, or a rule that posts itself on schedule. Rows are drawn a page at a time |
| **Expenses** | Opens on one month: what it cost against the 12-month average, how it split between **needs, wants and neither**, the last twelve months as bars that select a month, and the categories that moved most. One categories card with a simple view — spending against budget, a six-month streak per category, personal bests — and a detailed table; a category opens its expenses for the month. **Budgets live here** — a limit is an attribute of a category — and can follow each category's 12-month average until switched off. A **cost-of-ownership card** (the car) takes a purchase price and an estimate for months before the record begins, and can be hidden |
| **Investments** | The month so far, the monthly gain bars and the month's top movers on one row, then all-time value against cost basis, asset allocation, holdings exposure by position, **where the money stands** — what open positions have done, what closed ones did, and what was paid out, kept apart so a good year is not hidden behind a loss already banked — three measures of return side by side (simple, money-weighted, time-weighted) against a benchmark, and a per-position table sortable by class, value, gain and MWRR |
| **Accounts** | Assets/liabilities/net-worth KPIs, cash against debt, account cards with history sparklines, and a defined-benefit pension card (transfer value against what you contributed). Accounts carry a kind (chequing, savings, cash, investment, crypto, property, credit, loan, pension) and a registration (non-registered, TFSA, RRSP, FHSA, Pension) |
| **Year** | Every year on record against the one before: income against spending, a roll forward from opening to closing net worth, where the money came from and went, passive income over time, registered contribution room, a review of the year's spending against its budgets, what net worth is made of, and the month each milestone was first passed |
| **Goals** | The year's goals, set the SMART way from measures the app already keeps — net worth, the portfolio, cash on hand, debt, money saved and invested, passive income, plan contributions, spending and charitable giving — as an amount or a percentage, plus custom goals checked off by hand. Each goal shows whether it is on track; when one is met, on any page, there is confetti, a chime and a way to the goal |
| **Settings** | Your username and password, your own market-data keys, people and invitations (administrators), which optional cards are shown, and **Start over**, which deletes your own record and nothing else |
| **Import CSV** | Drop in one file or many and each is routed by what it *is*: a card statement, a bank export with debit/credit columns, a trade log, or a brokerage activity report that is all of those at once. Format, sign convention and account are detected per file, categories are suggested against your own list, duplicates are flagged, and every row is reviewable before anything is saved |
| **Monthly checklist** | Closes the month that just ended in one pass: import → income → spending → *mergers* → trades → pension → *room* → *goals* → save. The steps in italics appear only when there is something for them — a file that carried a merger, a new contribution year whose room is not set, and the January checklist that closes December. Nothing is written until the last step |
| **Tax** *(unreleased)* | Realized gains, dividends and interest by year — non-registered only, since that is the only place any of it is reportable |
| **Guide** *(unreleased)* | How each figure is arrived at: the pension, staking rewards, needs and wants, what a statement is read for, what the checklist covers, realized vs unrealized, and which months a chart shows |

Pages marked *unreleased* are hidden from the sidebar in a production build; see
[Shipping an unfinished page](development.md#shipping-an-unfinished-page).



Two themes: a warm cream light theme and a near-black dark one, both from the same set of
semantic tokens, with a toggle in the sidebar.
