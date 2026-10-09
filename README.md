# Aurum · Personal Finance

**A self-hosted webapp for keeping track of your own money.** Net worth, income and
expenses, budgets, goals and an investment portfolio — on your own machine, in your own
database, with nothing about your money sent anywhere.

State lives in **PostgreSQL** behind a small JSON API, and the whole stack ships as a set
of **Docker containers**. CSV imports — card statements, bank exports, brokerage activity
reports — are routed by what each file *is*, auto-categorised, and reviewable before
anything is saved. A **monthly checklist** closes a finished month in one pass.

Self-hosted for one person or a few, Canadian by default, and not a tax or advice tool.
[About](docs/about.md) covers what it does and the calls it makes.

## Install

You need Docker with Compose.

```bash
git clone https://github.com/lacasse/aurum.git
cd aurum
cp .env.example .env
```

Edit `.env` before the first start:

- `AUTH_USERNAME` and `AUTH_PASSWORD` create the first account, an administrator. They are
  read once, on an empty database; after that, change them in **Settings → Your account**.
- `AUTH_SECRET` signs session cookies: a long random string.
- `POSTGRES_PASSWORD`: change it from the example.
- `BACKUP_ENCRYPTION_KEY` (optional) encrypts backups. Use `openssl rand -hex 32` and keep
  a copy somewhere other than this machine.

Then start it:

```bash
docker compose up -d --build
```

Open <https://localhost> and accept the self-signed certificate warning. Every port binds
to `127.0.0.1`, so from another machine use an SSH tunnel:

```bash
ssh -N -L 8443:localhost:443 user@<host>
```

Then open <https://localhost:8443>. Invite anyone else from **Settings → People**.

**Never run `docker compose down -v` or `docker volume prune`.** They delete the database
and its backups. `docker compose down` on its own is safe.

### Or use the ready-built image

Every release after 2.7.0 is published at `ghcr.io/lacasse/aurum` for Intel and ARM,
tagged `X.Y.Z` and `X.Y`. It saves building on the host, which takes most of half an hour
on a Raspberry Pi. Point the `app` service at it in a `docker-compose.override.yml`:

```yaml
services:
  app:
    image: ghcr.io/lacasse/aurum:X.Y
```

## Update

Read the release notes first; a major version says what to do before upgrading. An
administrator sees a banner in the app when a new release is out.

Take a backup, then update:

```bash
docker exec finance-backup-1 /bin/sh /backup.sh once
```

With the ready-built image:

```bash
docker compose pull app && docker compose up -d app
```

Built from source:

```bash
git pull && docker compose up -d --build app
```

Database migrations run on their own.

## Backups

A backup runs every 6 hours and the newest 14 are kept, in the `backups` volume.
[Running it](docs/running.md#backups) covers the settings, encryption, and how to restore
and test a restore.

## More

- [About](docs/about.md): why it exists, what it is opinionated about, the pages
- [Running it](docs/running.md): network exposure, outbound requests, accounts, backups
- [Using it](docs/using.md): accounts and transfers, the monthly checklist, imports, trades, demo data
- [Market data](docs/market-data.md): price providers, API limits, history
- [Development](docs/development.md): the dev database, stack, structure, tests

## Licence

**GNU Affero General Public License v3.0**. See [`LICENSE`](LICENSE).

The Affero clause is why: if you run a modified version as a network service, you owe your
users the source of your modifications, not only of what you were given. For an app about
somebody's money, that seemed like the case where it matters.

Contributions are welcome under the terms in [`CONTRIBUTING.md`](CONTRIBUTING.md), which
includes a contributor licence agreement.
