import { ensureDb } from "@/db/init";
import {
  BadRequestError,
  getSnapshots,
  parseSnapshotsBody,
  upsertSnapshots,
} from "@/db/repo";
import { handle, readJson } from "@/db/http";
import { monthKeySchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await ensureDb();
    const url = new URL(req.url);
    const month = monthKeySchema.safeParse(url.searchParams.get("month"));
    if (!month.success) {
      throw new BadRequestError("month query param required (YYYY-MM)");
    }
    return { snapshots: await getSnapshots(month.data) };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await ensureDb();
    await upsertSnapshots(parseSnapshotsBody(await readJson(req)));
    return { ok: true };
  });
}
