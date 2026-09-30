import { NextRequest, NextResponse } from "next/server";

// Password gate for the whole site. Username/password come from Vercel
// environment variables you set yourself — never hard-coded here, so only
// you control access, and you can change the password anytime with no code change.

// Constant-time string compare (Edge runtime has no crypto.timingSafeEqual).
function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  // Cross-site guard: browsers resend the saved Basic login on requests from ANY site, so another page could make
  // your browser hit /api/rerun or /api/snapshot?books=1 (burning Odds API credits). Browsers label those requests
  // Sec-Fetch-Site: cross-site; the Railway scheduler and your own page never do.
  if (req.nextUrl.pathname.startsWith("/api/") && req.headers.get("sec-fetch-site") === "cross-site") {
    return new NextResponse("Cross-site request blocked", { status: 403 });
  }
  const auth = req.headers.get("authorization");
  // .trim(): a stray space or line break pasted into the Vercel variable would otherwise lock out the scheduler (401)
  const validUser = (process.env.SITE_USERNAME || "").trim();
  const validPass = (process.env.SITE_PASSWORD || "").trim();

  if (auth && validUser && validPass) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      let decoded = "";
      try { decoded = atob(encoded); } catch { decoded = ""; }
      const i = decoded.indexOf(":");
      if (i > 0) {
        const user = decoded.slice(0, i).trim(), pass = decoded.slice(i + 1).trim();   // passwords may contain ":"
        const okUser = safeEqual(user, validUser), okPass = safeEqual(pass, validPass);   // both always run
        if (okUser && okPass) return NextResponse.next();
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
