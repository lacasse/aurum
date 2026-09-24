import { ensureDb } from "@/db/init";
import {
  deleteRecurringRule,
  getState,
  materializeRecurring,
  parseRecurringRule,
  replaceRecurringRule,
} from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    const rule = parseRecurringRule(await readJson(req));
    await replaceRecurringRule(user.id, { ...rule, id });
    await materializeRecurring(user.id);
    return getState(user.id);
  });
}

/**
 * Deletes the rule but keeps the transactions it already posted: they are real
 * money that moved, and their account balances have been adjusted for them.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    await deleteRecurringRule(user.id, id);
    return { ok: true };
  });
}
