import { verifyPassword } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { isLoginLocked, recordLoginFailure, resetLoginFailures } from "@/lib/login-rate-limit";
import { BadRequestError, passwordHashOf, type UserRow } from "./repo";

/**
 * Asks for the password again before anything that cannot be taken back or
 * that changes how someone signs in.
 *
 * A session is not enough for these: it may be a browser left open. Wrong
 * guesses count against the same allowance as signing in, so this cannot be
 * used to try passwords faster than the login page allows.
 */
export async function confirmPassword(req: Request, user: UserRow, password: unknown): Promise<void> {
  const ip = clientIp(req);
  if (isLoginLocked(ip).locked) {
    throw new BadRequestError("Too many wrong passwords. Try again later.");
  }
  const hash = await passwordHashOf(user.id);
  if (typeof password !== "string" || !hash || !verifyPassword(hash, password)) {
    recordLoginFailure(ip);
    throw new BadRequestError("That is not your current password.");
  }
  resetLoginFailures(ip);
}
