import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/db/session";
import {
  getContributionLimits,
  getRoomDeferrals,
  setContributionLimits,
  setRoomDeferrals,
} from "@/db/repo";
import { REGISTERED_PLANS } from "@/lib/contributions";

const planKeys = REGISTERED_PLANS as [string, ...string[]];

/*
 * Room is a dollar figure someone read off a notice of assessment, so it is
 * validated as one: a number, not negative, and capped well above any real
 * limit so a slipped decimal point is caught here rather than drawn as a gauge
 * that never moves.
 */
const bodySchema = z.object({
  limits: z.record(
    z.string().regex(/^\d{4}$/, "Year must be four digits."),
    z.record(z.enum(planKeys), z.number().min(0).max(10_000_000)),
  ),
  /** Months a question was put off in, so it can be asked again next month. */
  deferrals: z
    .record(
      z.string().regex(/^\d{4}$/, "Year must be four digits."),
      z.record(z.enum(planKeys), z.string().regex(/^\d{4}-\d{2}$/)),
    )
    .optional(),
});

export async function GET() {
  return withUser(async (user) => {
    return NextResponse.json({
      limits: await getContributionLimits(user.id),
      deferrals: await getRoomDeferrals(user.id),
    });
  });
}

export async function PUT(request: Request) {
  return withUser(async (user) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Contribution room must be a positive amount per plan, per year." },
        { status: 400 },
      );
    }
    await setContributionLimits(user.id, parsed.data.limits);
    if (parsed.data.deferrals) await setRoomDeferrals(user.id, parsed.data.deferrals);
    return NextResponse.json({
      limits: await getContributionLimits(user.id),
      deferrals: await getRoomDeferrals(user.id),
    });
  });
}
