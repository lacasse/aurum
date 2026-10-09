# Running it

How the stack is laid out, who can reach it, how sign-in works, and how backups are taken and restored.

## The Compose project

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

## What is reachable, and from where

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

## What leaves the machine

Nothing about your record. The app makes two kinds of outbound request, and neither
carries an amount, an account or a person:

- **Price lookups**, to the two market-data providers described under
  [Market data](market-data.md), which name the tickers being priced.
- **An update check** for administrators: the server asks GitHub for this repository's
  latest release, caching the answer for six hours, and the app shows an administrator a
  banner when a newer one is out. Dismissing it hides that version until the next.
  `AURUM_UPDATE_CHECK=off` stops the request entirely; `AURUM_UPDATE_REPO` (`owner/name`)
  points it at a fork.

## Accounts and login

The app and its API are protected by a session-cookie login. Visiting any page (or hitting
any `/api/*` route) without a valid session redirects to `/login` (pages) or returns `401`
(API). After a successful login the session cookie lasts 7 days. Login attempts are rate
limited per IP (5 failures → progressively longer lockout).

**The first account comes from the environment.** On the first start, with no accounts in
the database yet, the app creates one from `AUTH_USERNAME` and the password below, as an
administrator. An installation that ran before accounts existed keeps its login exactly:
the same username and password now sign into that first account, and every row already in
the database belongs to it. After that the environment decides nothing about accounts —
changing `AUTH_PASSWORD` in `.env` does not change anybody's password.
Change a username or password in **Settings → Your account** instead. The values in `.env`
are then out of date, and are only ever read again if the app starts on an empty database —
a restored backup brings its own accounts back — so it is worth updating them to match, or
removing them once the first account exists.

**Everyone else is invited.** An administrator opens **Settings → People → Invite
someone** and gets a link, shown once. It makes one account and stops working after seven
days, or when revoked. Only a hash of its token is stored. The invited person picks a
username and a password of at least 12 characters, and starts with an empty record of
their own.

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_USERNAME` | first start | Username of the first account |
| `AUTH_PASSWORD` | first start* | Its password (hashed when the account is created) |
| `AUTH_PASSWORD_HASH` | no | scrypt `salt:hash` of that password — preferred over `AUTH_PASSWORD` |
| `AUTH_SECRET` | yes | HMAC key used to sign session cookies |

*One of `AUTH_PASSWORD` or `AUTH_PASSWORD_HASH` creates the first account (the hash takes
precedence).

Generate a password hash and set it in `.env`:

```bash
npm run hash-password -- 'your-password'   # prints salt:hash hex
# paste it into AUTH_PASSWORD_HASH in .env, then remove AUTH_PASSWORD
```

**Change these before exposing the app.** Set them in `.env` or your environment, e.g.:

```bash
AUTH_USERNAME=you AUTH_PASSWORD=... AUTH_SECRET=a-long-random-secret docker compose up -d --build
```

Rotating `AUTH_SECRET` immediately revokes every session cookie for every account. A
session also stops working if its account's password is changed.

The session cookie is `HttpOnly`, `Secure` (when NODE_ENV=production), and `SameSite=Lax`.

**Delete demo data** in the sidebar is destructive, so the server rejects the request
unless the body carries an explicit `{"confirm":"DELETE"}`.

Migrations run and demo data seeds automatically on first request. `docker compose down`
keeps your data (no flags). **Never run `docker compose down -v` or `docker volume prune`**
— those permanently delete the `pgdata` (data) and `backups` volumes.

## Backups

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

**Restore** a backup by replacing the database with the dump. A dump is the whole
database — tables, rows, and the keys between them — so it goes into an **empty** one.
Loaded over a database that already has its tables, every row is refused: the tables
already carry their foreign keys, and the dump writes rows before the users they belong
to. Emptying the tables first does not help, for the same reason.

This deletes everything in the database. Take a fresh backup first, even of a database
you believe is broken: it is the only way back if the dump you chose turns out to be the
wrong one.

```bash
# Find the file you want:
docker exec finance-backup-1 sh -c 'ls -l /backups/'
# Stop the app, so nothing writes while the database is replaced:
docker compose stop app
# Replace the database with an empty one:
docker exec finance-db-1 psql -U aurum -d postgres -c "DROP DATABASE aurum WITH (FORCE);" -c "CREATE DATABASE aurum;"
# Load the dump, stopping at the first error rather than carrying on half-restored:
docker exec finance-backup-1 sh -c 'gzip -dc /backups/aurum_XXXXXXXX.sql.gz' \
  | docker exec -i finance-db-1 psql -U aurum -d aurum -v ON_ERROR_STOP=1
docker compose start app
```

For an encrypted dump, decrypt on the way through in the load step:

```bash
docker exec finance-backup-1 sh -c 'openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"$BACKUP_ENCRYPTION_KEY" -in /backups/aurum_XXXXXXXX.sql.gz.enc | gzip -dc' \
  | docker exec -i finance-db-1 psql -U aurum -d aurum -v ON_ERROR_STOP=1
```

If the load stops on an error, the database is partly restored. Fix the cause, then
replace and load it again from the top.

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

