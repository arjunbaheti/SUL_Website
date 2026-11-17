import type { NextConfig } from "next";

const pages = ["about", "events", "partners", "committee", "join", "portal", "recruitment", "recruitment-demo"];

// Links in emails (booking pages, portal) always point at the live site, even when the email is
// sent from localhost or a preview deployment. Vercel provides the production domain at build
// time (including a custom domain once one is set up).
const PUBLIC_ORIGIN = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "https://sul-website.vercel.app";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_SITE_ORIGIN: process.env.NEXT_PUBLIC_SITE_ORIGIN || PUBLIC_ORIGIN },
  cacheComponents: true,
  partialPrefetching: true,
  // Old static-site addresses keep working.
  async redirects() {
    return [
      { source: "/index.html", destination: "/", permanent: true },
      ...pages.map((p) => ({ source: `/${p}.html`, destination: `/${p}`, permanent: true })),
    ];
  },
};

export default nextConfig;
