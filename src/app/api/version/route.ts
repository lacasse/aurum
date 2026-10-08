import { handle, requireAdmin } from "@/db/http";
import {
  DEFAULT_UPDATE_REPO,
  compareVersions,
  parseLatestRelease,
  type Release,
} from "@/lib/version";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/** How long one answer from GitHub is trusted before asking again. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** After a failure, wait this long rather than asking on every page load. */
const RETRY_AFTER_MS = 30 * 60 * 1000;

/*
 * Held in the process rather than the database: it is a public fact about the
 * repository, not about anyone's record, and losing it on a restart costs one
 * request. Unauthenticated GitHub calls allow sixty an hour per address, which
 * this stays far inside.
 */
let cached: { at: number; release: Release | null; ok: boolean } | null = null;

async function latestRelease(repo: string): Promise<Release | null> {
  const now = Date.now();
  if (cached && now - cached.at < (cached.ok ? CHECK_EVERY_MS : RETRY_AFTER_MS)) {
    return cached.release;
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "aurum-update-check" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const release = res.ok ? parseLatestRelease(await res.json()) : null;
    cached = { at: now, release, ok: res.ok };
  } catch {
    cached = { at: now, release: cached?.release ?? null, ok: false };
  }
  return cached.release;
}

/**
 * The running version and, when it is behind, the release that replaces it.
 *
 * Admin only: upgrading is the operator's job, and nobody else can act on it.
 * `AURUM_UPDATE_CHECK=off` stops the request to GitHub entirely, for an
 * installation that should not reach outside its network.
 */
export async function GET() {
  return handle(async (user) => {
    requireAdmin(user);
    const current = pkg.version;
    if (process.env.AURUM_UPDATE_CHECK === "off") {
      return { current, latest: null, url: null, updateAvailable: false };
    }
    const repo = process.env.AURUM_UPDATE_REPO || DEFAULT_UPDATE_REPO;
    const latest = await latestRelease(repo);
    return {
      current,
      latest: latest?.version ?? null,
      url: latest?.url ?? `https://github.com/${repo}`,
      updateAvailable: latest !== null && compareVersions(current, latest.version) < 0,
    };
  });
}
