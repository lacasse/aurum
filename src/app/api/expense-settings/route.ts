import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/db/session";
import { getExpenseSettings, setExpenseSettings } from "@/db/repo";
import { SPEND_GROUPS } from "@/lib/expenses";

const bodySchema = z.object({
  groups: z.record(z.string(), z.enum(SPEND_GROUPS as [string, ...string[]])),
  car: z
    .object({
      start: z.string().regex(/^\d{4}-\d{2}$/, "Start must be a month."),
      categories: z.array(z.string()),
    })
    .nullable(),
});

export async function GET() {
  return withUser(async (user) => {
    return NextResponse.json(await getExpenseSettings(user.id));
  });
}

export async function PUT(request: Request) {
  return withUser(async (user) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Settings must name a group per category and a start month." },
        { status: 400 },
      );
    }
    await setExpenseSettings(user.id, parsed.data as Parameters<typeof setExpenseSettings>[1]);
    return NextResponse.json(await getExpenseSettings(user.id));
  });
}
