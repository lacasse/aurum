import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/db/session";
import { apiKeyStates } from "@/db/api-keys";
import { setSavedApiKeys } from "@/db/repo";
import { invalidReason, PROVIDERS } from "@/lib/api-keys";

/**
 * The market-data keys, as settings.
 *
 * Keys travel in one direction only. A GET describes them — set or not, saved
 * here or inherited from the deployment, and the last four characters — and
 * never returns one, because a page that can show a secret is a page that can
 * leak one. A PUT replaces a key, and an empty string clears it.
 */
const bodySchema = z.object({
  twelvedata: z.string().max(500).optional(),
  eodhd: z.string().max(500).optional(),
});

export async function GET() {
  return withUser(async () => NextResponse.json(await apiKeyStates()));
}

export async function PUT(request: Request) {
  return withUser(async () => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Send a key for each provider to change." }, { status: 400 });
    }
    for (const provider of PROVIDERS) {
      const value = parsed.data[provider];
      if (value === undefined) continue;
      const reason = invalidReason(value);
      if (reason) return NextResponse.json({ error: reason }, { status: 400 });
    }
    await setSavedApiKeys(parsed.data);
    return NextResponse.json(await apiKeyStates());
  });
}
