/**
 * The address a request came from, for rate limiting. Shared by every route
 * that counts failures per address, so they all agree on who is asking.
 */
export function clientIp(request: Request): string | undefined {
  // Prefer X-Real-IP: nginx sets it to the real peer address (not spoofable
  // from outside). If we must use X-Forwarded-For, take the last entry, which
  // nginx appends and is therefore the true originating address — the leading
  // entries are client-supplied and can be spoofed to dodge the lockout.
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim());
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return undefined;
}
