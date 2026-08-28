/**
 * In-memory login rate limiter to slow credential-stuffing / brute force.
 *
 * Keyed by client IP (falls back to a shared bucket when the caller does not
 * provide one, e.g. same-host requests). After MAX_FAILURES consecutive
 * failures the client is locked out for a window that grows with repeated
 * lockouts (exponential backoff), and a successful login resets the counters.
 *
 * This is a best-effort, single-instance guard suitable for a single-user LAN
 * app; it is not a distributed limiter.
 */

const MAX_FAILURES = 5;
const BASE_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOCKOUT_MS = 8 * 60 * 60 * 1000; // 8 hours cap

interface LoginBucket {
  failures: number;
  lockedUntil: number;
  lockoutCount: number;
}

const buckets = new Map<string, LoginBucket>();

function keyFor(ip: string | undefined): string {
  // Normalize missing / trust-any proxy header presence loosely; the exact
  // value is only used for bucketing so collisions just share a bucket.
  return (ip ?? "unknown").slice(0, 64) || "unknown";
}

/** True if the provided IP is currently locked out. */
export function isLoginLocked(ip: string | undefined): { locked: boolean; retryAfter: number } {
  const bucket = buckets.get(keyFor(ip));
  if (!bucket) return { locked: false, retryAfter: 0 };
  const remaining = bucket.lockedUntil - Date.now();
  if (remaining <= 0) return { locked: false, retryAfter: 0 };
  return { locked: true, retryAfter: Math.ceil(remaining / 1000) };
}

/** Record a failed login attempt. Returns true if this attempt triggered a lockout. */
export function recordLoginFailure(ip: string | undefined): void {
  const key = keyFor(ip);
  const now = Date.now();
  const bucket = buckets.get(key) ?? {
    failures: 0,
    lockedUntil: 0,
    lockoutCount: 0,
  };

  if (bucket.lockedUntil > now) {
    // Already locked: keep lockout, don't let failures accumulate further.
    return;
  }

  bucket.failures += 1;
  if (bucket.failures >= MAX_FAILURES) {
    bucket.lockoutCount += 1;
    const backoff = Math.min(
      BASE_LOCKOUT_MS * 2 ** (bucket.lockoutCount - 1),
      MAX_LOCKOUT_MS,
    );
    bucket.lockedUntil = now + backoff;
    bucket.failures = 0;
  }
  buckets.set(key, bucket);
}

/** Reset the failure/lockout state after a successful login. */
export function resetLoginFailures(ip: string | undefined): void {
  buckets.delete(keyFor(ip));
}
