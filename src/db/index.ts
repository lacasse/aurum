import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://aurum:aurum@localhost:5432/aurum";

const globalForDb = globalThis as unknown as { __aurumPool?: Pool };

export const pool =
  globalForDb.__aurumPool ??
  new Pool({
    connectionString,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__aurumPool = pool;
}

export const db = drizzle(pool, { schema });
