import { findUserByUsername, listUsers, type UserRow } from "./repo";

/**
 * Whose record a maintenance script works on.
 *
 * Scripts used to act on "the database", which was one person's. With several
 * users a script that does not say whose rows it means would either act on
 * everyone's or on whichever came back first, so it must be told: `--user
 * <name>`. The one exception is an installation with a single account, where
 * there is only one answer and asking for it would be ceremony.
 *
 * Returns the user and the arguments with `--user` taken out.
 */
export async function scriptUser(argv: string[]): Promise<{ user: UserRow; args: string[] }> {
  const args = [...argv];
  let name: string | undefined;
  const i = args.findIndex((a) => a === "--user" || a.startsWith("--user="));
  if (i >= 0) {
    name = args[i].includes("=") ? args[i].slice("--user=".length) : args[i + 1];
    args.splice(i, args[i].includes("=") ? 1 : 2);
  }
  if (name) {
    const found = await findUserByUsername(name);
    if (!found) throw new Error(`no user named "${name}"`);
    const { passwordHash: _hash, ...user } = found;
    void _hash;
    return { user, args };
  }
  const all = await listUsers();
  if (all.length === 1) return { user: all[0], args };
  throw new Error(
    all.length === 0
      ? "there are no users yet — start the app once so the first account is created"
      : `this installation has ${all.length} users; say whose record to change with --user <name>`,
  );
}
