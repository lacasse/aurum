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

