# Using it

## Accounts, transfers and recurring transactions

**Every place money can sit is an account**, including registered ones. An account has two
independent attributes, because they answer different questions:

- **Kind** — what it is and how it behaves: `checking`, `savings`, `cash`, `investment`,
  `crypto`, `property`, `credit`, `loan`, `pension`. This decides the balance arithmetic (credit cards
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
income → spending → mergers → trades → pension → room → goals → save. Mergers, room and
goals appear only when they have something to ask.

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

Deposits into and withdrawals from investment accounts are saved as **transfers**, so they
count toward contribution room rather than disappearing. Where more than one credit card
is on record, the checklist asks which one a statement belongs to rather than filing it
against the first.

**Room** appears when the month being closed opens a contribution year whose room is not
yet set. **Goals** appears only in the January checklist, the one that closes December,
as an optional step for setting the new year's goals.

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

Two kinds of row are recorded as transfers rather than as income or spending, because the
money only moved between your own accounts:

- **A deposit into an investment account** comes from the everyday account — or, where
  the same amount left another investment account that day, it is one transfer between
  the two. A deposit in a month kept as monthly totals is matched against that month
  rather than written beside it. An account moved in from another institution is listed
  for attention and not recorded.
- **A credit card payment** is recorded once, from the card's statement, as a transfer
  from the everyday account onto that card. The bank's line for the same payment is left
  out, so it is not also counted as spending.

Dividends paid in US dollars are added to the account's US-dollar cash, and withholding
tax is paired with the dividend it was taken from.

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
docker exec -e DATABASE_URL=<the real one> aurum-dev \
  npx tsx scripts/import-monthly-totals.ts rows.json --map my.map.json
```

`aurum-dev` points at the dev database, so a script meant to touch real data has to be
given the real `DATABASE_URL` explicitly. That is deliberate.

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

**The record is invented; the securities are real.** Every amount, account and person in
the sample is made up and reads nobody's records. The tickers are real listings — a
symbol and the company behind it are public — because real ones cover the cases the app
actually has to handle, such as a depositary receipt beside its underlying share, a venue
suffix and a coin, which invented ones only gesture at. What the sample never does is
mirror anyone's portfolio: the holdings, their sizes and their accounts are its own.

**Anyone can try it without an account.** **Explore with demo data** on the login page
opens the whole app on a freshly generated sample, kept entirely in that browser: the
demo can load page shells and nothing else from the server, every API route still demands
a real session, and nothing the visitor changes is ever written to the server. The app
says throughout that it is a demo.

The integration and smoke suites count what the generator produced rather than literals,
so growing the sample cannot fail CI for being right.

The seeded rows are recognised by their id prefixes (`acc-`, `hold-`, `txn-`); rows you
create are assigned UUIDs and so are never matched. After the deletion the app records a
`demo_data_deleted` marker in `app_meta`, which stops first-run seeding from putting the
sample data back if you later empty the database. The button disappears once there is
nothing left to delete.
