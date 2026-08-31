import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureDb } from "@/db/init";
import { getAllocationTargets, setAllocationTargets } from "@/db/repo";

const bodySchema = z.object({
  targets: z.record(z.string(), z.coerce.number().finite().min(0).max(100)),
});

export async function GET() {
  await ensureDb();
  return NextResponse.json({ targets: await getAllocationTargets() });
}

export async function PUT(request: Request) {
  await ensureDb();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Targets must be percentages from 0 to 100." }, { status: 400 });
  }
  await setAllocationTargets(parsed.data.targets);
  return NextResponse.json({ targets: await getAllocationTargets() });
}
