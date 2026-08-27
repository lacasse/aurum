import { NextRequest, NextResponse } from "next/server";
import { verifySession, getSessionCookieName } from "./lib/auth";

function isAuthenticated(req: NextRequest): boolean {
  return verifySession(req.cookies.get(getSessionCookieName())?.value);
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isAuthenticated(req)) {
    // Already logged in: don't show the login page
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // Not authenticated.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (pathname === "/login") {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, req.url));
}

export const config = {
  matcher: [
    /*
     * Protect everything except:
     * - api/login, api/logout (auth endpoints)
     * - static files and assets
     */
    "/((?!api/login|api/logout|_next/static|_next/image|favicon.ico).*)",
  ],
};
