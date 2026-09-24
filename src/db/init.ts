import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";
import {
  claimPlaceholderOwner,
  countUsers,
  firstAdmin,
  insertUser,
  isDemoDeleted,
  isSeeded,
  seed,
  setContributionLimits,
} from "./repo";
import { bootstrapUserFromEnv } from "@/lib/bootstrap-user";
import {
  generateSampleData,
  generateSampleLimits,
  generateSampleSnapshots,
} from "@/lib/sample";

let readyPromise: Promise<void> | null = null;

async function init(): Promise<void> {
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  await ensureFirstUser();
  /*
   * Demo data for the first account only, and only while its record has never
   * held anything. People invited later start with an empty record of their
   * own — the demo is on the login page for anyone who wants to look around —
   * and once the owner has deleted the demo data, an empty record is a
   * deliberate state: re-seeding it would hand back the rows they removed.
   */
  const owner = await firstAdmin();
  if (owner && !(await isSeeded(owner.id)) && !(await isDemoDeleted(owner.id))) {
    const data = generateSampleData();
    await seed(owner.id, data, generateSampleSnapshots(data.holdings));
    // Room as well as deposits: the contribution card measures one against the
    // other, and seeding only the deposits leaves every gauge reading "not set".
    await setContributionLimits(owner.id, generateSampleLimits(data));
  }
}

/**
 * Runs migrations and first-run seeding exactly once per process.
 * Every API route awaits this before touching the database.
 */
/**
 * The first account, from the credentials the deployment already had.
 *
 * An installation upgrading into multiple users has one person, whose username
 * and password hash are in `.env` and whose data is every row in this
 * database. They become user one — an admin, since somebody has to be able to
 * invite the second — and nothing they do changes: the same login works,
 * against a row now instead of against the environment.
 *
 * Only when the table is empty. Once there is a user, `.env` no longer decides
 * anything about accounts, and editing it there does not reach in and change a
 * password.
 */
async function ensureFirstUser(): Promise<void> {
  const first = bootstrapUserFromEnv(process.env);
  /*
   * Migration 0027 gave every existing row to a placeholder account when there
   * was nobody else to own them. Claiming it — the deployment's username and
   * password hash on that same row — is what makes the owner of those rows the
   * person who already signs in, rather than a second account beside theirs.
   */
  if (first && (await claimPlaceholderOwner(first.username, first.passwordHash))) return;
  if ((await countUsers()) > 0) return;
  if (!first) return;
  await insertUser(first);
}

export function ensureDb(): Promise<void> {
  if (!readyPromise) {
    readyPromise = init().catch((err) => {
      readyPromise = null; // allow retry on next request
      throw err;
    });
  }
  return readyPromise;
}
