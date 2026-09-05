import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";
import { isDemoDeleted, isSeeded, seed } from "./repo";
import { generateSampleData, generateSampleSnapshots } from "@/lib/sample";

let readyPromise: Promise<void> | null = null;

async function init(): Promise<void> {
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  // Seed only a database that has never held data. Once the user has deleted
  // the demo data, an empty database is a deliberate state: re-seeding it
  // would hand back the very rows they asked us to remove.
  if (!(await isSeeded()) && !(await isDemoDeleted())) {
    const data = generateSampleData();
    await seed(data, generateSampleSnapshots(data.holdings));
  }
}

/**
 * Runs migrations and first-run seeding exactly once per process.
 * Every API route awaits this before touching the database.
 */
export function ensureDb(): Promise<void> {
  if (!readyPromise) {
    readyPromise = init().catch((err) => {
      readyPromise = null; // allow retry on next request
      throw err;
    });
  }
  return readyPromise;
}
