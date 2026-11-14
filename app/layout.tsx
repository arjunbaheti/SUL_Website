import type { Metadata } from "next";
import { CursorTrail } from "@/components/cursor-trail";
import { Effects } from "@/components/effects";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, siteJsonLd } from "@/lib/site";
import "./site.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "StartUp Link UniMelb | University of Melbourne Startup & Entrepreneurship Club",
    template: "%s | StartUp Link UniMelb",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Google ignores this, but Bing and others still glance at it. Our own names and the
  // categories we are, never other clubs' names.
  keywords: [
    "StartUp Link", "StartUp Link UniMelb", "StartupLink", "UniMelb startup club", "University of Melbourne startup club",
    "Melbourne uni startup club", "student startup club Melbourne", "entrepreneurship club UniMelb", "startup society Melbourne",
    "startup internships Melbourne", "startup jobs for students", "UMSU clubs",
  ],
  alternates: { canonical: "/" },
  // Link previews (LinkedIn, Messenger, iMessage, Slack, X). The image is app/opengraph-image.tsx.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_AU",
    url: "/",
    title: { default: "StartUp Link UniMelb", template: "%s | StartUp Link UniMelb" },
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "StartUp Link UniMelb", description: SITE_DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Who we are, for search engines (Organization + WebSite structured data). */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()).replace(/</g, "\\u003c") }} />
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
        {/* The original site's shared effects: nav, reveal, magnetic buttons, ribbons, counters. */}
        <Effects />
        <CursorTrail />
      </body>
    </html>
  );
}
