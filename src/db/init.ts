import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";
import { isSeeded, seed } from "./repo";
import { generateSampleData } from "@/lib/sample";

let readyPromise: Promise<void> | null = null;

async function init(): Promise<void> {
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  if (!(await isSeeded())) {
    await seed(generateSampleData());
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
