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
    const refusal = constraintMessage(err);
    if (refusal) return Response.json({ error: refusal }, { status: 400 });
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

/**
 * The message from a database rule that refused a write, or null for anything
 * else.
 *
 * A constraint firing is not a server fault — it is the database answering a
 * question the caller got wrong, and its message says which. Flattening that to
 * "Internal server error" hides the one sentence worth reading, so the class of
 * error that guards the data is the class the user never got to see.
 *
 * Postgres class 23 is integrity constraint violation; the rules in `drizzle/`
 * raise inside it deliberately. Anything else stays a 500, because an
 * unexpected error's text is not fit to show and may not be fit to log.
 */
function constraintMessage(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const { code, message, hint } = err as {
    code?: unknown;
    message?: unknown;
    hint?: unknown;
  };
  if (typeof code !== "string" || !code.startsWith("23")) return null;
  if (typeof message !== "string" || !message) return null;
  return typeof hint === "string" && hint ? `${message}. ${hint}` : message;
}
