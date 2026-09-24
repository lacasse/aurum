/**
 * The market-data keys this installation uses, and how they are talked about.
 *
 * They used to be environment variables, set once when the stack was deployed,
 * which meant changing a key was an edit to a `.env` file and a restart —
 * something the person whose data this is could not do from the app at all.
 * They are settings now, kept with the rest of the record.
 *
 * A key is a secret, so the rule here is that it only ever travels in one
 * direction. What goes to the browser is this file's `KeyState`: whether a key
 * is set, where it came from, and its last four characters, which is enough to
 * tell one key from another and useless to anybody else. Nothing sends a whole
 * key back out.
 */

export const PROVIDERS = ["twelvedata", "eodhd"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Where a key in use came from. */
export type KeySource = "account" | "environment";

export interface KeyState {
  set: boolean;
  /** "account" when saved in settings, "environment" for a deployment's own. */
  source: KeySource | null;
  /** The last few characters, to tell one key from another. Never the key. */
  hint: string | null;
}

export type KeyStates = Record<Provider, KeyState>;

export interface ApiKeys {
  twelvedata: string;
  eodhd: string;
}

/**
 * The last four characters, and nothing else.
 *
 * A short key gives up nothing at all rather than most of itself: four
 * characters of an eight-character key is half the secret.
 */
export function hint(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed.length < 12) return trimmed.length > 0 ? "••••" : null;
  return `••••${trimmed.slice(-4)}`;
}

/** What the browser is told about one key. */
export function stateOf(saved: string | undefined, fromEnv: string | undefined): KeyState {
  const account = (saved ?? "").trim();
  if (account) return { set: true, source: "account", hint: hint(account) };
  const env = (fromEnv ?? "").trim();
  if (env) return { set: true, source: "environment", hint: hint(env) };
  return { set: false, source: null, hint: null };
}

/**
 * The key to use: what was saved here, or the one the deployment was started
 * with. An installation that has always had its keys in the environment keeps
 * working untouched, and saving one in settings takes over from it.
 */
export function effectiveKey(saved: string | undefined, fromEnv: string | undefined): string {
  const account = (saved ?? "").trim();
  return account || (fromEnv ?? "").trim();
}

/**
 * What a saved key is allowed to look like.
 *
 * Deliberately loose: providers change their formats, and refusing a key that
 * would have worked is worse than letting the provider refuse it. This only
 * catches what cannot be a key — something pasted with a newline in it, or a
 * whole URL copied out of documentation.
 */
export function invalidReason(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed === "") return null; // Clearing a key is allowed.
  if (trimmed.length < 8) return "That looks too short to be a key.";
  if (trimmed.length > 200) return "That is longer than any key these providers issue.";
  if (/\s/.test(trimmed)) return "A key has no spaces in it. Check what was pasted.";
  if (/^https?:\/\//i.test(trimmed)) return "That is a web address, not a key.";
  return null;
}

/**
 * The keys one user fetches with.
 *
 * A key is somebody's: it is tied to their account with the provider, and the
 * provider's daily allowance is counted against it. So a user's saved keys are
 * theirs alone, and the keys in the deployment's environment stand in only for
 * the deployment's owner — the first account, whose installation it is and who
 * put them there. Everybody else brings their own; an installation with keys in
 * its environment does not hand them to whoever it invites.
 */
export function keysFor(
  saved: Partial<ApiKeys>,
  env: Partial<ApiKeys>,
  isOwner: boolean,
): ApiKeys {
  const fallback = isOwner ? env : {};
  return {
    twelvedata: effectiveKey(saved.twelvedata, fallback.twelvedata),
    eodhd: effectiveKey(saved.eodhd, fallback.eodhd),
  };
}

/** The same rule, as the settings page is told it. */
export function statesFor(
  saved: Partial<ApiKeys>,
  env: Partial<ApiKeys>,
  isOwner: boolean,
): KeyStates {
  const fallback = isOwner ? env : {};
  return {
    twelvedata: stateOf(saved.twelvedata, fallback.twelvedata),
    eodhd: stateOf(saved.eodhd, fallback.eodhd),
  };
}

/** Whether prices can be fetched at all: neither provider has a key. */
export function noKeysAtAll(states: KeyStates): boolean {
  return !states.twelvedata.set && !states.eodhd.set;
}
