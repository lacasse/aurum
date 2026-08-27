import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readdirSync } from "node:fs";

export const dynamic = "force-dynamic";

const BACKUP_DIR = process.env.BACKUP_DIR || "/backups";

export async function GET() {
  let backups: {
    file: string;
    size: number;
    modified?: string;
  }[] = [];

  try {
    const entries = readdirSync(BACKUP_DIR);
    for (const name of entries) {
      if (!name.endsWith(".sql.gz")) continue;
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
    return NextResponse.json({ backups: [], error: "backup volume unavailable" });
  }

  return NextResponse.json({ backups });
}
