import { hashPassword } from "./auth";
import { uid } from "./ids";
import { normaliseUsername } from "./usernames";

/**
 * The first user, worked out from the environment an installation already has.
 *
 * Kept apart from the database so the rule can be read and tested on its own:
 * given what is in `.env`, who is the first account and what is their password
 * hash. A deployment that has a hash keeps it exactly — nobody has to know the
 * password for the upgrade to preserve the login — and one that carries a
 * plaintext password has it hashed on the way in, which is an improvement it
 * gets for free.
 *
 * Null when there is nothing to build an account from. That is not an error
 * here: a brand-new installation with no credentials in its environment is
 * expected, and the app says so on its first run rather than refusing to start.
 */
export function bootstrapUserFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin";
  createdAt: string;
} | null {
  const username = normaliseUsername(env.AUTH_USERNAME ?? "");
  const hash = (env.AUTH_PASSWORD_HASH ?? "").trim();
  const plain = (env.AUTH_PASSWORD ?? "").trim();
  if (!username || (!hash && !plain)) return null;
  return {
    id: uid(),
    username,
    // A stored hash is kept as it is; the same password goes on working.
    passwordHash: hash || hashPassword(plain),
    role: "admin",
    createdAt: new Date().toISOString(),
  };
}
