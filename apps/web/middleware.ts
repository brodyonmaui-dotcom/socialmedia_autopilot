import { NextResponse, type NextRequest } from "next/server";
import { middlewareDecision, MW_SESSION_COOKIE } from "./lib/auth/middleware-logic.js";

export function middleware(req: NextRequest) {
  if (middlewareDecision(req.nextUrl.pathname, req.cookies.get(MW_SESSION_COOKIE)?.value) === "redirect") {
    return NextResponse.redirect(new URL("/app/login", req.url));
  }
  return NextResponse.next();
}

// Relative to basePath (/app). Everything except the login page and static assets.
export const config = {
  // "/" separately: under a basePath the catch-all alone does not match the bare /app root.
  matcher: ["/", "/((?!login|_next/static|_next/image|manifest\\.json|sw\\.js|favicon\\.ico|icons).*)"],
};
