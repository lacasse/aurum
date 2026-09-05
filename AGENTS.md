<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

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

