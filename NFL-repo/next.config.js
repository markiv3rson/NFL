/** @type {import('next').NextConfig} */
const nextConfig = {
  // Root URL just shows the dashboard that lives in /public/index.html.
  async redirects() {
    return [
      { source: "/", destination: "/index.html", permanent: false },
    ];
  },
};
module.exports = nextConfig;
