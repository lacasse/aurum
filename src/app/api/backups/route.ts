import { promises as fs } from "node:fs";
import path from "node:path";
import { readdirSync } from "node:fs";
import { handle, requireAdmin } from "@/db/http";

export const dynamic = "force-dynamic";

const BACKUP_DIR = process.env.BACKUP_DIR || "/backups";
const BACKUP_GLOB = /\.sql\.gz(\.enc)?$/;

export async function GET() {
  return handle(async (user) => {
    /*
     * The backups are of the whole installation — every user's record in one
     * file — so only an administrator is told they exist.
     */
    requireAdmin(user);
    const backups: {
      file: string;
      size: number;
      modified?: string;
    }[] = [];

    try {
      const entries = readdirSync(BACKUP_DIR);
      for (const name of entries) {
        if (!BACKUP_GLOB.test(name)) continue;
        const p = path.join(BACKUP_DIR, name);
        try {
          const stat = await fs.stat(p);
          backups.push({
            file: name,
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
        } catch {
          backups.push({ file: name, size: 0 });
        }
      }
      backups.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
    } catch {
      return { backups: [], error: "backup volume unavailable" };
    }

    return { backups };
  });
}
