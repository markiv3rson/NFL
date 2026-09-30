import { NextRequest, NextResponse } from "next/server";

// Password gate for the whole site. Username/password come from Vercel
// environment variables you set yourself — never hard-coded here, so only
// you control access, and you can change the password anytime with no code change.

export function middleware(req: NextRequest) {
  const auth = req.headers.get("authorization");
  // .trim(): a stray space or line break pasted into the Vercel variable would otherwise lock out the scheduler (401)
  const validUser = (process.env.SITE_USERNAME || "").trim();
  const validPass = (process.env.SITE_PASSWORD || "").trim();

  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const i = decoded.indexOf(":"), user = decoded.slice(0, i).trim(), pass = decoded.slice(i + 1).trim();   // passwords may contain ":"
      if (user === validUser && pass === validPass && validUser && validPass) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="NFL BETTORS"' },
  });
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
