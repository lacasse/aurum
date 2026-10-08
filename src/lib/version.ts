/**
 * Whether this installation is behind the newest published release.
 *
 * Pure, so the comparison can be tested without a network: the route fetches,
 * this decides.
 */

/** The repository releases are published to, as `owner/name`. */
export const DEFAULT_UPDATE_REPO = "lacasse/aurum";

export interface Release {
  /** Without the leading "v". */
  version: string;
  url: string;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * Negative when `a` is older than `b`, positive when newer, nought when equal.
 *
 * A pre-release sorts before the release it leads up to, as semver says, so a
 * test build of the next version is not reported as newer than that version.
 * Anything that is not a version compares as equal, which keeps a malformed
 * tag from raising a banner.
 */
export function compareVersions(a: string, b: string): number {
  const x = SEMVER.exec(a.trim());
  const y = SEMVER.exec(b.trim());
  if (!x || !y) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d;
  }
  if (x[4] && !y[4]) return -1;
  if (!x[4] && y[4]) return 1;
  return (x[4] ?? "").localeCompare(y[4] ?? "");
}

/**
 * The release named in GitHub's "latest release" response, or null.
 *
 * Drafts and pre-releases are never "latest" there, but both are checked
 * anyway: a banner asking someone to install a draft is worse than none. The
 * page has to be an https address, since it becomes a link in the app.
 */
export function parseLatestRelease(body: unknown): Release | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  if (typeof r.tag_name !== "string" || typeof r.html_url !== "string") return null;
  if (!SEMVER.test(r.tag_name)) return null;
  // The banner links to it, so it has to be a web page and nothing else.
  if (!/^https:\/\//.test(r.html_url)) return null;
  return { version: r.tag_name.replace(/^v/, ""), url: r.html_url };
}
