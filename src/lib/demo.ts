/**
 * The demo: the app, with invented data, for someone who has not signed in.
 *
 * It exists on an instance that holds somebody's real record, so the whole
 * design is about what it cannot reach. The demo cookie lets a browser load the
 * page shells and nothing else — every `/api/` route still demands a real
 * session, and the pages themselves carry no data, so there is nothing a demo
 * visitor can read from the server however the requests are crafted. Their
 * data is generated in the browser, and every change they make is kept in the
 * browser too. Nothing is ever written to the server.
 *
 * Kept free of the DOM at import, so the cookie and storage rules can be tested
 * without a browser: the functions that need one take it as an argument.
 */
import type { FinanceData, MonthlySnapshot } from "./types";

/** Readable by the client on purpose: the app has to know it is in a demo. */
export const DEMO_COOKIE = "aurum_demo";

/** Long enough to come back to; a demo that expired overnight would lose work. */
const DEMO_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Where a demo visitor's record is kept.
 *
 * Versioned, because the shape of the record changes with the app: a demo saved
 * by an older build is dropped and started fresh rather than loaded into a
 * shape it no longer fits.
 */
export const DEMO_STORAGE_KEY = "aurum.demo.v1";

/** Whether a cookie header, or `document.cookie`, carries the demo flag. */
export function demoFromCookies(cookies: string | null | undefined): boolean {
  if (!cookies) return false;
  return cookies
    .split(";")
    .some((part) => part.trim() === `${DEMO_COOKIE}=1`);
}

/** Whether this browser is in the demo. False on the server. */
export function isDemo(): boolean {
  return typeof document !== "undefined" && demoFromCookies(document.cookie);
}

function cookieFor(value: string, maxAge: number): string {
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  return `${DEMO_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function enterDemo(): void {
  document.cookie = cookieFor("1", DEMO_COOKIE_MAX_AGE);
}

/** Leaves the demo. What was saved in it stays, for the next visit. */
export function leaveDemo(): void {
  document.cookie = cookieFor("", 0);
}

/** The record a demo visitor can change, as it is kept between visits. */
export interface DemoRecord extends FinanceData {
  merchantRules: Record<string, string>;
  snapshots: MonthlySnapshot[];
}

/**
 * Settings the pages load and save themselves, outside the store. Each has a
 * key of its own, so saving one can never overwrite the record or the other.
 */
export type DemoSetting = "expense-settings" | "contribution-limits";
const DEMO_SETTINGS: DemoSetting[] = ["expense-settings", "contribution-limits"];

export function demoSettingKey(name: DemoSetting): string {
  return `${DEMO_STORAGE_KEY}.${name}`;
}

export function readDemoSetting(store: KeyValueStore | null, name: DemoSetting): object | null {
  try {
    const raw = store?.getItem(demoSettingKey(name));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Merged over what was there, as the server merges a partial save. */
export function writeDemoSetting(
  store: KeyValueStore | null,
  name: DemoSetting,
  value: object,
): void {
  try {
    const next = { ...(readDemoSetting(store, name) ?? {}), ...value };
    store?.setItem(demoSettingKey(name), JSON.stringify(next));
  } catch {
    // A full or blocked storage loses the change, not the page.
  }
}

interface Stored {
  version: 1;
  record: DemoRecord;
}

/** The slice of Web Storage these need, so a test can hand in a map. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The demo as it was left, or null to start from fresh demo data.
 *
 * Anything unreadable is treated as nothing saved: a demo that fails to load
 * should start over, not break the app for someone evaluating it.
 */
export function readDemo(store: KeyValueStore | null): DemoRecord | null {
  if (!store) return null;
  try {
    const raw = store.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed?.version !== 1 || !parsed.record) return null;
    const r = parsed.record;
    if (!Array.isArray(r.accounts) || !Array.isArray(r.transactions)) return null;
    return r;
  } catch {
    return null;
  }
}

/** Saves the demo. A full or blocked storage loses the change, not the page. */
export function writeDemo(store: KeyValueStore | null, record: DemoRecord): boolean {
  if (!store) return false;
  try {
    store.setItem(DEMO_STORAGE_KEY, JSON.stringify({ version: 1, record } satisfies Stored));
    return true;
  } catch {
    return false;
  }
}

/** Forgets everything the demo saved, so the next load starts from fresh. */
export function clearDemo(store: KeyValueStore | null): void {
  try {
    store?.removeItem(DEMO_STORAGE_KEY);
    for (const name of DEMO_SETTINGS) store?.removeItem(demoSettingKey(name));
  } catch {
    // Nothing to clear is the same as cleared.
  }
}

/** The browser's storage, or null where there is none or it is blocked. */
export function browserStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
