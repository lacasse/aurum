<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Personal Data — CRITICAL RULES

This app's subject is one person's money. Their figures and facts must never
enter this repository. This has gone wrong four times, each time after the
previous one was supposedly learned, and twice it cost a full history rewrite.
Treat it as a hard constraint.

## What must never appear

Not in code, comments, tests, fixtures, migrations, scripts, docs, **commit
messages**, PR titles or bodies, review comments, tag messages or release notes.
"Attached text" is part of the repo: GitHub renders commit messages inside a
pull request, which is how a balance sheet ended up on a public page.

- **Amounts.** Any real balance, net worth, cost base, income, spending, debt or
  contribution.
- **Rows lifted from a statement or export.** Never paste a real CSV line into a
  test. Retype it: keep the shape, change every field.
- **Account and institution identifiers** — broker account codes, the broker's
  name, the pension plan's name, the loan servicer, the bank.
- **Tickers actually held.** Example tickers are fine; theirs are not. The
  benchmark ticker the app fetches is a public index and is allowed.
- **Names, emails, hostnames, LAN IPs, home directory paths.**
- **The commit identity.** Use the GitHub noreply address, not a personal one
  with a machine hostname. Check `git config user.email` in any fresh clone.

## The number is never necessary

A comment or commit message explaining why a bug mattered reads as if it needs
the real figure. It does not. "It read gross purchases as the amount invested"
says more than any amount would, and cannot leak anything. If magnitude matters,
say "roughly double" or "an order of magnitude", never the number.

## Invented data

Fixtures may hold numbers, and they must be obviously invented — round figures,
made-up symbols and names. If a value could be mistaken for real, it is as bad
as real. Demo data is invented end to end, in a portfolio *shape* unlike the
owner's: a demo that merely resembles the real thing is nearly as bad as one
that copies it.

Mark a single fixture line `INVENTED`. Mark a file whose every row is made up
`ALL-FIXTURES-INVENTED` — that waives only the export-row heuristic, because
some fixtures sit in raw CSV literals where a trailing comment would corrupt the
data. Amounts and private terms are still rejected in such a file.

## The guard

`scripts/check-no-personal-figures.sh` runs from a `pre-commit` hook, a
`commit-msg` hook and CI. It rejects comma-grouped currency figures, lines shaped
like an export row, and any term from a private deny-list.

The deny-list lives **outside the repository**, at
`~/.config/aurum/private-terms.txt` (override with `AURUM_PRIVATE_TERMS`) —
holdings, broker, plan, account codes, hostname. It has to be outside, because a
list of someone's holdings committed to their own repo is the disclosure it
exists to prevent. When the file is absent only the generic checks run, which is
correct for CI and a fresh clone.

**Never bypass it with `--no-verify`, and never weaken it to make a commit
pass.** Rewrite the text instead. If it fires, it is right.

Hooks are wired by `npm install` (`prepare` sets `core.hooksPath`). In a fresh
clone, run `git config core.hooksPath .githooks` if you skipped install.

## One-off operations on the owner's data belong outside this repo

A script or migration that only makes sense for one installation is not part of
the product. Two of the four incidents were exactly this: month-end portfolio
history shipped as a *migration*, so every deployment would have installed those
holdings; and an importer whose column map named a servicer and three people.
Such work takes its input from a file argument, or lives outside the repo
entirely.

## Develop against the dev database, never production

`docker-compose.dev.yml` runs the app from the working tree against `aurum_dev`,
a database that holds nothing real. It is empty on creation and `ensureDb()`
seeds an empty database from `generateSampleData()`, so it comes up full of
invented data with no seeding step.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d
```

This is architecture, not convenience. Development used to run against the
production database, so the owner's real balances were on screen while writing
every test, comment and commit message — and that is where they kept ending up.
A rule cannot beat an arrangement. Reaching real data is still possible and now
has to be deliberate: pass `DATABASE_URL` explicitly for the one command that
needs it.

## Build export fixtures, do not paste them

`src/lib/activities.fixture.ts` builds activity-export rows from named fields.
Use `activityRow`, `cashRow` and `tradeRow` in tests rather than writing a CSV
line by hand, because writing one by hand meant having a real export open and
copying from it. There is nothing to copy from a builder. The export-row check
in the guard is a backstop for this, not the primary defence.

## Before publishing, audit — do not grep the working tree

A working-tree grep is what let this survive four times.

1. `git clone --mirror` the remote, then also fetch `+refs/pull/*/head:refs/pull/*/head`.
2. Dump every blob once, scan that for amounts, export rows, private terms,
   secrets, names, hostnames and IPs.
3. Scan commit messages separately — a blob scan misses them.
4. Check the GitHub side: PR titles and bodies, review comments, issues, release
   notes, repo description, and the author/committer identity on every commit.

**GitHub pull-request refs are permanent.** `refs/pull/N/head` is read-only and
survives any force-push, so a PR pins the commits it was opened from forever.
Where PRs exist, a history rewrite is **not** enough — the repository has to be
deleted and recreated.

# The Owner's Records — CRITICAL RULES

The stored record of someone's money is not the app's to reinterpret. Two rules
follow from that, and both were broken.

## Never show demo data in place of real data

`loadFromServer` caught every failure — including a 401 from an expired session
— and left the bundled sample data on screen. The result was a complete,
plausible dashboard of somebody else's money: net worth, investments, debt,
cash and every holding wrong together, indistinguishable from the records having
been destroyed. The owner reasonably concluded they had been.

- **A failure to load must be visible.** An auth failure goes to the login page.
  Any other failure shows an error state that says the data could not be read.
- **Sample data is for a database that is genuinely empty**, never a fallback for
  a request that failed. A page with no data must look like a page with no data.
- **Never render a figure the app is not certain of as though it were a fact.**
  If provenance is unknown, say so on screen.
- Demo data must be **visibly** demo wherever it can appear — a banner, a
  distinct label — so it can never be mistaken for the owner's own.

## One rule per question, in one place, used by every path

An import created seven duplicate positions because `accumulatePositions` in
`trades.ts` matched an existing holding by exact ticker equality, while
`resolveTicker` in `trade-batch.ts` — written for precisely this, with a comment
describing precisely this failure — was never called by it. A broker export
writes bare symbols where the position is held with a venue suffix, so every
matching row opened a second holding beside the real one and the same trade was
counted twice.

- **When two code paths answer the same question, they call the same function.**
  Importing a trade from a CSV and entering one by hand are the same question
  about identity; they must not have two answers.
- **Before writing a matcher, a converter or a classifier, search for one.**
  The second implementation is always the careless one, because the first was
  written while thinking about the problem.
- **A rule with a comment explaining which bug it prevents is a rule that must
  be called everywhere that bug can occur.** Grep for its callers when touching
  any related path.
- **Identity is decided in one place.** For a security that is `baseTicker` plus
  account; nothing else may decide whether two rows are the same position.

## Creating a record is the dangerous branch, not updating one

Opening a position, an account or a category is where a mistake becomes a
duplicate that quietly double-counts. Updating the wrong row is visible;
creating a spurious one is not.

- **A create that could have been a match must justify itself.** Where an
  importer is about to open a position, it states so in the review step and says
  what it looked for. A silent create is the fault above.
- **Import review shows creates separately from updates**, with counts, so
  "opened 7 new positions" is read before it is committed rather than discovered
  weeks later.
- **After any bulk write, assert the invariants.** No two holdings may share a
  base ticker within one account; no account balance may be negative on an
  asset; totals must reconcile. Check them and report, rather than trusting that
  each row was individually correct — every row here was.

## Never recompute a stored historical value from a live input

`computeCadFields` re-derived a USD holding's Canadian cost base as
`avgCost * rate` on **every write**, so any save — a price refresh, an edit, a
checklist run — silently restated a cost base at that day's exchange rate. One
position's basis moved by 38% with no trade behind it.

- **A cost base is fixed when the thing is acquired.** So is a converted amount:
  the rate that applied on the day is a fact about that day.
- **Store it once, read it forever.** A stored figure is only recomputed when the
  event behind it changes — a corrected trade, an edited flow — never as a side
  effect of writing something else.
- **A write must change only what it was asked to change.** Recomputing adjacent
  fields "for consistency" is how a record drifts with nothing to point at.
- Where a derived value must be cached, keep the inputs that produced it and the
  date they applied, so it can be checked rather than trusted.

## When the owner says their data is wrong, believe the screen

Checking the database and answering "the counts are unchanged" does not address
what someone is looking at. Reproduce what they see first — open the page, read
the figures — then work back to the store, the API and the database. Row counts
matching is evidence about storage, not about correctness or display.

# Do What Was Asked, and Only That

## A reply that names part of an offer selects that part

Offered three things — add the rule, close the redundant pull request, amend
the release notes — and told "yes, add as a rule", all three were done. The
answer named one. Naming one is a choice, not shorthand for the rest.

- **A narrowed answer narrows the work.** When someone replies to a multi-part
  offer by naming a subset, do the subset. The unnamed parts were not approved,
  and "yes" attached to a specific thing does not extend to what sat beside it.
- **Ambiguity resolves toward less, then asks.** If a reply might mean all of it
  or one of it, do the part that was named, say what was left undone, and ask.
  That costs one message. The alternative spends actions that may have to be
  undone.
- **The costs are not symmetric.** Too little is one message from being fixed.
  Too much means work the owner did not ask for, and some of it cannot be taken
  back quietly — closing a pull request, editing a published release, deploying,
  or anything that leaves this machine.

## Asking a compound question invites this

Bundling three offers into one sentence made a one-word answer ambiguous, then
treated the ambiguity as consent. Offer one thing, or number them and ask which.
The fault began with the question, not the reply.

# Say Sorry When You Get It Wrong

## The apology is owed, and it is not the fix

Three mistakes in one session — a branch cut from the wrong base that shipped
an unapproved change, a confident statement about what production was running
that was false, and three actions taken when one was asked for — were each
explained, corrected, and written up as a rule. None of them was apologised
for. Explaining a fault is not the same as owning it, and a rule added in place
of an apology reads as changing the subject.

- **When you get something wrong, say so and say sorry.** Plainly, in the
  sentence where the mistake is named, not buried after a list of what else was
  done.
- **Do not wait to be asked.** If it surfaces because the owner noticed, the
  apology is already late; if you found it yourself, lead with it.
- **Name the cost to them**, not only the mechanism. "I branched from the wrong
  place" describes the fault; "I shipped a change you had not approved"
  describes what it did to someone.
- **Once, and briefly.** An apology that runs on turns the owner's problem into
  a performance about the assistant, and they still have to read past it to
  reach the fix. Say it, correct it, carry on.
- **A correction is not an apology, a rule is not an apology, and a fix is not
  an apology.** They belong together, and none of them substitutes for the
  others.

# Branches and What a Commit Actually Contains

## A branch starts from `main`, named explicitly

```bash
git checkout -b <name> main     # not: git checkout -b <name>
```

`git checkout -b` without a base uses whatever happens to be checked out. On
8 Sep 2026 that was another feature branch with an open pull request, so the
new branch carried that branch's commit as well as its own. The pull request
was squash-merged, and one commit landed on `main` containing two unrelated
changes under a message describing only one of them — a UI change nobody had
approved, shipped inside a database migration, and a release note that
described two changes for a release that held three.

Nothing about this is visible while working. The branch looks right, the tests
pass, the diff against the *branch point* is correct, and a squash merge
collapses the evidence into a single commit. It surfaced days later only
because a question about rebasing prompted reading the merged diff.

The base is one word. Type it.

## Read what a pull request contains, not what it says it contains

Before merging, list the files the diff actually touches and account for every
one:

```bash
git diff --stat main...<branch>
```

A file that has nothing to do with the change is the signal — `investments/`
had no business in a migration. The commit message is what the author
*intended*; the file list is what will happen. Only the second one merges.

The same check after the fact tells the truth about what shipped:
`git show --stat <merge-commit>`.

## When a commit turns out to carry more than it claimed

Say so, and correct the record where the record is wrong: the release notes for
that version, and the pull request that was silently made redundant. Do not
rewrite the merged history to tidy it — the change is already deployed and
already correct, and rewriting `main` to fix a commit message is a far larger
risk than the inaccurate message. Amend what is still editable, leave what is
not, and state plainly which is which.

# Versions and Releases

Semantic versioning, read for an application rather than a library. Nobody
imports this code, so there is no API to break in the usual sense. The
compatibility surface is **the deployment and the data already stored**, and
that gives one test:

> **Major means the operator has to do something, or figures already in their
> database change meaning. Everything else is minor or patch.**

Before tagging, ask what a stranger pulling this and restarting would need told:

- Nothing beyond what changed — **patch**
- A new capability, or behaviour worth reading about — **minor**
- A sentence beginning "before upgrading, you must…" — **major**

## What a major actually is here

- **A migration that cannot apply unattended.** Adding a column, backfilling and
  installing a constraint is a minor, even when it refuses bad data afterwards,
  because it runs on its own. One that stops and waits for a human to clean the
  database first is a major.
- **Reinterpreting a stored field.** Changing a cost base from the listing
  currency to Canadian dollars edits nobody's rows and makes everybody's rows
  wrong. This is the most dangerous kind and the least visible.
- **Changing the deployment contract** — an env var renamed or dropped, a port
  moved, a newer PostgreSQL required, the Compose project name touched.
- **Dropping an import format**, which breaks a monthly routine while the app
  itself runs perfectly.

## What is not a major, though it can feel like one

A behaviour change that leaves stored data valid and needs nothing done to
upgrade is a minor, however much it alters what the app decides. Ceasing to
match a depositary receipt to the share it tracks changed how every future
import resolves a ticker, and anyone holding both had a wrong position before
it — a minor, with a release note saying plainly what to check.

The line is who does the correcting. Shipping a *migration* that rewrote
everyone's holdings to split receipts from underlyings would have been a major,
because it edits other people's records on a guess about what their tickers
mean. Repairing one installation by hand is not a release at all.

## Cutting one

A release marks a deployment, not a merge. Several changes may sit on `main`
between releases; a fix worth deploying on its own is worth a release on its
own.

1. `package.json` **and** `package-lock.json` — both the top-level `version` and
   the one under `packages.""`. Never by replacing the old version string across
   the file: the lockfile's project version has been stale before now, so the
   only matches were dependencies that happened to share it, and two had their
   versions rewritten to a release of this app. Never by regenerating the
   lockfile either — that re-resolves every range, which is not what setting a
   version does.
2. Commit, tag `vX.Y.Z`, push both.
3. Release notes that lead with the fault, not the fix, and say what a reader
   should check in their own data.
4. Deploy, and say whether the deployed image matches the tag.

# Data Safety — CRITICAL RULES

The PostgreSQL database is the single source of truth for all personal finance data. Data
loss is irreversible. Follow these rules without exception.

## Never destroy data

- **NEVER run `docker compose down -v`, `docker volume prune`, or `docker compose down` with
  any volume-destroying flag.** `down` (no flags) is safe; `down -v` permanently deletes the
  `pgdata` and `backups` named volumes.
- Never remove/recreate the `db` service in a destructive way, and never manually wipe tables
  unless the user explicitly asks and a verified backup is taken first.
- Do not modify `docker-compose.yml` in a way that would delete the `pgdata` (or `backups`)
  volume declarations.
- **Never change or remove the top-level `name: finance` in `docker-compose.yml`.** The
  volumes are `finance_pgdata` / `finance_backups`; that name is what keeps pointing at
  them. Without it Compose falls back to the directory name, and `docker compose up` builds
  a second stack on empty volumes — the app then looks wiped even though the data is intact
  under the old prefix. If containers ever appear with a non-`finance-` prefix, STOP: do not
  run `down -v`, and check `docker volume ls` before anything else.

## Automated backups

- A `backup` service runs automatically (default every 6 hours) and writes gzipped `pg_dump`
  files to the persistent `backups` volume, retaining the newest 14 by default.
- Before any risky operation (DB migration, reset, volume change, major refactor), ALWAYS take
  a manual backup first. Ask the backup service for one — it is the same code path as the
  scheduled dump, so it encrypts when `BACKUP_ENCRYPTION_KEY` is set, verifies the result,
  and exits non-zero if the dump does not check out:
  ```bash
  docker exec finance-backup-1 /bin/sh /backup.sh once
  ```
- **Never hand-roll a `pg_dump` to do this.** A dump typed at the shell skips encryption and
  every integrity check, and writes the whole database in the clear — which is exactly what
  happened on 5 Sep 2026 when the pre-release backup landed as plaintext beside seven
  encrypted ones. If you need a copy outside the volume, take one the normal way and
  `docker cp` the encrypted file out.
- After any destructive change, verify a fresh backup exists in the `backups` volume
  (`docker exec finance-backup-1 sh -c 'ls -la /backups/'`) and that it decompresses cleanly
  (`gzip -t`).

## Verify data before/after operations

- Confirm the DB actually contains the expected (non-demo) data before concluding anything
  about user data. The Zustand store may display bundled demo data if the API fails
  (`src/lib/store.ts` `loadFromServer`), so always check the DB directly:
  ```bash
  docker exec finance-db-1 psql -U aurum -d aurum -c "SELECT count(*) FROM holdings;"
  ```
- Only commit changes when the user asks. Never commit secrets.

## Tests

- `npm test` transpiles with `tsc --noCheck` and runs the suite. Skipping the
  type check is what makes it quick — checking is roughly half the wall clock,
  and it is duplicated work: `npm run typecheck` already covers every file,
  test files included, and CI runs it as its own step before the tests.
- So a type error will **not** fail `npm test`. Run `npm run typecheck`, or
  `npm run test:checked` for both in one command.
- Don't run the checked and unchecked builds alternately out of habit — they
  share `.test-build`, and switching invalidates the incremental cache, which
  costs a full rebuild each way. `test:checked` avoids this by type-checking
  through the separate `tsconfig.json` build instead.

## Rebuilds / restarts

- Restarting or rebuilding the app/proxy/backup containers is safe (data lives in volumes).
- A fresh Postgres cluster is only (re)initialized when the `pgdata` directory is empty — that
  happens only after a volume-destroying action. If the DB ever shows demo data unexpectedly,
  STOP and verify backups before proceeding.

