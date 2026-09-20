import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";
import { countUsers, insertUser, isDemoDeleted, isSeeded, seed, setContributionLimits } from "./repo";
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
  // Seed only a database that has never held data. Once the user has deleted
  // the demo data, an empty database is a deliberate state: re-seeding it
  // would hand back the very rows they asked us to remove.
  if (!(await isSeeded()) && !(await isDemoDeleted())) {
    const data = generateSampleData();
    await seed(data, generateSampleSnapshots(data.holdings));
    // Room as well as deposits: the contribution card measures one against the
    // other, and seeding only the deposits leaves every gauge reading "not set".
    await setContributionLimits(generateSampleLimits(data));
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
  if ((await countUsers()) > 0) return;
  const first = bootstrapUserFromEnv(process.env);
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
