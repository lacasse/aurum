import { ensureDb } from "@/db/init";
import { getSnapshots, upsertSnapshots } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await ensureDb();
    const url = new URL(req.url);
    const month = url.searchParams.get("month");
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return { error: "month query param required (YYYY-MM)" };
    }
    const rows = await getSnapshots(month);
    return { snapshots: rows };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureDb();
    const body = (await readJson(req)) as Record<string, unknown>;
    const snapshots = body.snapshots;
    if (!Array.isArray(snapshots)) {
      return { error: "snapshots array required" };
    }
    await upsertSnapshots(snapshots);
    return { ok: true };
  });
}
