import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/db/session";
import { getAllocationTargets, setAllocationTargets } from "@/db/repo";

const bodySchema = z.object({
  targets: z.record(z.string(), z.coerce.number().finite().min(0).max(100)),
});

export async function GET() {
  return withUser(async (user) => {
    return NextResponse.json({ targets: await getAllocationTargets(user.id) });
  });
}

export async function PUT(request: Request) {
  return withUser(async (user) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Targets must be percentages from 0 to 100." }, { status: 400 });
    }
    await setAllocationTargets(user.id, parsed.data.targets);
    return NextResponse.json({ targets: await getAllocationTargets(user.id) });
  });
}
