import { BadRequestError } from "./repo";

/** Wraps a route handler with JSON error handling. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const data = await fn();
    return Response.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof BadRequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("[api]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
}
