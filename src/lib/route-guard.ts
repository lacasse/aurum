/**
 * Who may load what: the rule behind `src/proxy.ts`, kept here so it can be
 * tested without the framework around it.
 *
 * Three kinds of visitor. Someone signed in gets everything. Someone in the
 * demo gets the page shells, which carry no data — every figure a page shows is
 * fetched from `/api/`, and in the demo it is invented in the browser instead.
 * Anyone else gets the login page. `/api/` answers only to a real session,
 * whatever else the request carries: that is the one line the demo must never
 * move.
 */
export type RouteDecision =
  /** Carry on. */
  | { kind: "next"; endDemo: boolean }
  /** Send to a page. */
  | { kind: "redirect"; to: string; endDemo: boolean }
  /** Refuse, as a 401. */
  | { kind: "unauthorized" };

export function decideRoute(
  pathname: string,
  visitor: { authenticated: boolean; demo: boolean },
): RouteDecision {
  if (visitor.authenticated) {
    // A real session ends any demo the same browser was in.
    const endDemo = visitor.demo;
    if (pathname === "/login") return { kind: "redirect", to: "/", endDemo };
    return { kind: "next", endDemo };
  }
  /*
   * Accepting an invitation is the one thing besides signing in that has to
   * work without an account, because the person doing it has none yet. Both
   * the page and its endpoint are named exactly; nothing else under /api opens.
   */
  if (pathname === "/api/invites/accept") return { kind: "next", endDemo: false };
  if (/^\/invite\/[^/]+$/.test(pathname)) return { kind: "next", endDemo: false };
  if (pathname === "/api" || pathname.startsWith("/api/")) return { kind: "unauthorized" };
  if (pathname === "/login") return { kind: "next", endDemo: false };
  if (visitor.demo) return { kind: "next", endDemo: false };
  return { kind: "redirect", to: `/login?next=${encodeURIComponent(pathname)}`, endDemo: false };
}
