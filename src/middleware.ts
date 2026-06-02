import { NextRequest, NextResponse } from "next/server";

const PUBLIC = ["/login", "/api/auth"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Pass through public paths and Next.js internals
  if (PUBLIC.some((p) => pathname.startsWith(p)) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const auth = req.cookies.get("epub-auth");
  if (!auth || auth.value !== "ok") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
