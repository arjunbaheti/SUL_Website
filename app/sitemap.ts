import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// /sitemap.xml: the public pages we want in search results (the portal and the unlisted form
// preview are left out, and blocked in robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
    ["", 1, "weekly"],
    ["/about", 0.9, "monthly"],
    ["/events", 0.8, "weekly"],
    ["/recruitment", 0.8, "weekly"],
    ["/partners", 0.7, "monthly"],
    ["/committee", 0.6, "monthly"],
    ["/join", 0.6, "monthly"],
  ];
  return pages.map(([path, priority, changeFrequency]) => ({
    url: SITE_URL + path,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));
}
