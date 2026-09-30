/** @type {import('next').NextConfig} */
const nextConfig = {
  // Root URL just shows the dashboard that lives in /public/index.html.
  // Always the newest version (9/30): the page and its script are never cached by the browser or phone, so every
  // visit after a deploy gets the new build without clearing the cache. API replies are never cached either.
  async headers() {
    const noStore = [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" }];
    return [
      { source: "/", headers: noStore },
      { source: "/index.html", headers: noStore },
      { source: "/app.js", headers: noStore },
      { source: "/api/:path*", headers: noStore },
    ];
  },
  async redirects() {
    return [
      { source: "/", destination: "/index.html", permanent: false },
    ];
  },
};
module.exports = nextConfig;
