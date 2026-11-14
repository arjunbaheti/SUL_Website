import type { Metadata } from "next";
import { CursorTrail } from "@/components/cursor-trail";
import { Effects } from "@/components/effects";
import "./site.css";

// Absolute URLs for link previews: Vercel provides the production domain at build time.
const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";
const DESCRIPTION =
  "StartUp Link UniMelb connects University of Melbourne students to startup jobs, skills, and a national founder/operator community.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "StartUp Link UniMelb | Your route into the startup world", template: "%s | StartUp Link UniMelb" },
  description: DESCRIPTION,
  // Link previews (LinkedIn, Messenger, iMessage, Slack, X). The image is app/opengraph-image.tsx.
  openGraph: {
    type: "website",
    siteName: "StartUp Link UniMelb",
    locale: "en_AU",
    title: { default: "StartUp Link UniMelb", template: "%s | StartUp Link UniMelb" },
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "StartUp Link UniMelb", description: DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
        {/* The original site's shared effects: nav, reveal, magnetic buttons, ribbons, counters. */}
        <Effects />
        <CursorTrail />
      </body>
    </html>
  );
}
