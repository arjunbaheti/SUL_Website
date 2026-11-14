import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// /robots.txt: everything public is crawlable; the committee portal, the unlisted application
// form preview and the API routes are not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/portal", "/recruitment-demo", "/api/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
