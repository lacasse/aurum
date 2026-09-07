/**
 * Migrate and seed the development database, then exit.
 *
 * `ensureDb()` normally runs on the first API request, but every route checks
 * auth first, so an unauthenticated dev container came up against a database
 * with no tables in it. Doing it at startup means the dev app is usable the
 * moment it answers.
 *
 * It refuses to touch anything that is not a development database. That guard
 * is the point of the file as much as the seeding is: this script's whole job
 * is to fill a database with invented data, and pointing it at a real one by
 * accident would write demo rows into somebody's records.
 */
import { ensureDb } from "@/db/init";

const url = process.env.DATABASE_URL ?? "";
const name = url.split("/").pop()?.split("?")[0] ?? "";

if (!/_dev$|^dev$|_test$/.test(name)) {
  console.error(
    `refusing to seed "${name || "(no DATABASE_URL)"}": this only runs against a\n` +
      `database whose name ends in _dev or _test. Seeding fills a database with\n` +
      `invented data, which is not something to do to a real one by accident.`,
  );
  process.exit(1);
}

ensureDb()
  .then(() => {
    console.log(`${name}: migrated and seeded`);
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
