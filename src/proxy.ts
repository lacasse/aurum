import { NextRequest, NextResponse } from "next/server";
import { verifySession, getSessionCookieName } from "./lib/auth";
import { DEMO_COOKIE } from "./lib/demo";
import { decideRoute } from "./lib/route-guard";

/*
 * The decision is made in lib/route-guard, where it is tested; this only reads
 * the cookies and turns the answer into a response.
 */
export function proxy(req: NextRequest) {
  const decision = decideRoute(req.nextUrl.pathname, {
    authenticated: verifySession(req.cookies.get(getSessionCookieName())?.value),
    demo: req.cookies.get(DEMO_COOKIE)?.value === "1",
  });

  if (decision.kind === "unauthorized") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const res =
    decision.kind === "redirect"
      ? NextResponse.redirect(new URL(decision.to, req.url))
      : NextResponse.next();
  if (decision.endDemo) res.cookies.delete(DEMO_COOKIE);
  return res;
}

export const config = {
  matcher: [
    /*
     * Protect everything except:
     * - api/login, api/logout (auth endpoints)
     * - static files and assets
     *
     * icon.svg is the tab icon, which the login page itself asks for: behind
     * the guard it redirected to /login and the tab fell back to the browser's
     * blank page icon. It is a coloured circle — there is nothing in it to
     * protect.
     */
    "/((?!api/login|api/logout|_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};
