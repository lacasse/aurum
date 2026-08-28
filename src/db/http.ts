import { cookies } from "next/headers";
import { BadRequestError } from "./repo";
import { getSessionCookieName, verifySession } from "@/lib/auth";

/**
 * Wraps a route handler with JSON error handling and an authentication
 * chokepoint. Every API route that goes through `handle` requires a valid
 * session, so protection does not depend on the proxy matcher alone.
 */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const cookieStore = await cookies();
    const value = cookieStore.get(getSessionCookieName())?.value;
    if (!verifySession(value)) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
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
