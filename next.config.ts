import type { NextConfig } from "next";

const pages = ["about", "events", "partners", "committee", "join", "portal", "recruitment", "recruitment-demo"];

const nextConfig: NextConfig = {
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
