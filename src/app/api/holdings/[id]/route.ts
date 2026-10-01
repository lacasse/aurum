import { ensureDb } from "@/db/init";
import { z } from "zod";
import { BadRequestError, deleteHoldingRow, parseHolding, replaceHolding, setHoldingPrice } from "@/db/repo";
import { handle, readJson } from "@/db/http";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    const holding = parseHolding(await readJson(req));
    await replaceHolding(user.id, { ...holding, id });
    return { ok: true };
  });
}

const Quote = z.object({
  price: z.number().finite().positive(),
  priceCAD: z.number().finite().positive(),
});

/** A new quote: the price columns and nothing else, whatever the caller holds. */
export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    const quote = Quote.safeParse(await readJson(req));
    if (!quote.success) throw new BadRequestError("A quote needs a positive price and priceCAD.");
    await setHoldingPrice(user.id, id, quote.data.price, quote.data.priceCAD);
    return { ok: true };
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async (user) => {
    await ensureDb();
    const { id } = await params;
    await deleteHoldingRow(user.id, id);
    return { ok: true };
  });
}
