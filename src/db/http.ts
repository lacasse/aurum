import { BadRequestError, type UserRow } from "./repo";
import { currentUser } from "./session";

/**
 * Wraps a route handler with JSON error handling and an authentication
 * chokepoint. Every API route that goes through `handle` requires a valid
 * session, so protection does not depend on the proxy matcher alone.
 */
/**
 * Runs a route for whoever is signed in, and turns its result into a response.
 *
 * The handler is given the user. Everything in the repository takes that
 * user's id, so a route cannot read or write a row without saying whose — and
 * one that ignores the argument does not compile, because every query needs it.
 */
export async function handle(fn: (user: UserRow) => Promise<unknown>): Promise<Response> {
  try {
    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const data = await fn(user);
    return Response.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof BadRequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    const refusal = constraintMessage(err);
    if (refusal) return Response.json({ error: refusal }, { status: 400 });
    console.error("[api]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** A signed-in user asking for something only an admin may have. */
export class ForbiddenError extends Error {
  constructor(message = "Only an administrator can do that.") {
    super(message);
  }
}

export function requireAdmin(user: UserRow): void {
  if (user.role !== "admin") throw new ForbiddenError();
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
