import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/db/session";
import { addAppliedConversions, getAppliedConversions } from "@/db/repo";

/*
 * The import keys of currency conversions already applied. A save adds to the
 * list and never replaces it, so two imports finishing close together cannot
 * drop each other's keys.
 */
const bodySchema = z.object({ keys: z.array(z.string().max(200)).max(5000) });

export async function GET() {
  return withUser(async (user) => {
    return NextResponse.json({ keys: await getAppliedConversions(user.id) });
  });
}

export async function PUT(request: Request) {
  return withUser(async (user) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Conversions must be a list of keys." }, { status: 400 });
    }
    await addAppliedConversions(user.id, parsed.data.keys);
    return NextResponse.json({ keys: await getAppliedConversions(user.id) });
  });
}
