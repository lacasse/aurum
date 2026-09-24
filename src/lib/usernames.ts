/**
 * What a username is.
 *
 * Two rules, applied in different places on purpose.
 *
 * Every username is *normalised* the same way wherever it is stored or looked
 * up — Unicode compatibility form, trimmed, lowercased — so the same name
 * typed two ways is one account, not two.
 *
 * A *new* username must also be plain: lowercase ASCII letters, digits, and
 * `.`, `_` or `-`. That is what stops two accounts that look identical —
 * `alex` and a Cyrillic `аlex` — from both existing, which normalising alone
 * cannot do. It is applied when an account is created from an invitation, not
 * to the first account, whose name comes from the deployment's own settings
 * and is not the app's to refuse.
 */
export function normaliseUsername(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}

const PLAIN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Why a name cannot be used for a new account, or null if it can. */
export function usernameProblem(name: string): string | null {
  const n = normaliseUsername(name);
  if (n.length < 3) return "A username needs at least three characters.";
  if (n.length > 32) return "A username can be at most 32 characters.";
  if (!PLAIN.test(n)) {
    return "Use letters a–z, digits, and . _ or - only, starting with a letter or digit.";
  }
  return null;
}
