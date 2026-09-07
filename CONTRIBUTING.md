# Contributing

Aurum is a personal project shared in case it is useful. There is no support and
no roadmap, and issues or pull requests may sit for a long time. That is not
rudeness — it is one person's spare time.

If you do send something, please read the two short sections below first.

## Licence

Aurum is licensed under the **GNU Affero General Public License v3.0**, in
`LICENSE`. The Affero clause is the point of choosing it: if you run a modified
version as a network service, you have to offer your users the source of your
modifications, not just of what you were given. Self-hosting an app about
somebody's money seemed like the case where that matters.

## Contributor Licence Agreement

By opening a pull request you agree that:

1. You wrote the contribution, or have the right to submit it under the AGPL.
2. You grant the project owner a perpetual, worldwide, irrevocable, royalty-free
   licence to use, modify, sublicense and **relicense** your contribution,
   including under terms other than the AGPL.

The second point is what makes a dual licence possible later — an AGPL release
alongside a commercial one — and it cannot be added retroactively once other
people's code is in the tree. If you are not comfortable granting it, say so in
the pull request and it will not be merged; no hard feelings, and the
conversation may still be useful.

Nothing here takes your copyright away. You keep it, and the same rights over
your own work as before.

## Before opening a pull request

- `npm run test:checked` — typecheck and the full suite.
- `npm run lint`
- `npm run check:security` and `npm run check:figures`.

The last one matters more than it looks: the app's subject is one person's
money, and the check rejects real financial figures, rows that look like a
brokerage export, and anything on a private deny-list. See **Personal Data** in
`AGENTS.md`. Never bypass it with `--no-verify`; rewrite the text instead.

Development runs against a database that holds nothing real:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d
```
