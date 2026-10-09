# Market data

Prices come from two providers, and **the ticker's exchange suffix decides which one**.

**Each person brings their own keys**, saved in **Settings → Market-data keys**: a key and its
allowance belong to one account, so the people an installation invites do not spend its
owner's. `EODHD_API_KEY` and `TWELVEDATA_API_KEY` in the environment stand in for the first
account only, so an installation that always kept its keys in `.env` upgrades with nothing
to do.
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

## The EODHD daily cap

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

## The Twelve Data credit ledger

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

## Monthly history, and the all-time charts

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

## What the refresh actually asks for

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

