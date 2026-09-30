import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/db/session";
import { getGoals, setGoals } from "@/db/repo";
import { cleanGoals } from "@/lib/goals";

/*
 * The whole list, read and written at once. A goal is validated field by field
 * in `cleanGoals`; the schema here only refuses what is plainly not a list of
 * goals, and caps it, so a runaway client cannot write an unbounded setting.
 */
const bodySchema = z.object({
  goals: z.array(z.record(z.string(), z.unknown())).max(200),
});

export async function GET() {
  return withUser(async (user) => {
    return NextResponse.json({ goals: await getGoals(user.id) });
  });
}

export async function PUT(request: Request) {
  return withUser(async (user) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Goals must be a list." }, { status: 400 });
    }
    await setGoals(user.id, cleanGoals(parsed.data.goals));
    return NextResponse.json({ goals: await getGoals(user.id) });
  });
}
