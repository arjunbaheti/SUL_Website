import type { Metadata } from "next";
import { CursorTrail } from "@/components/cursor-trail";
import { Effects } from "@/components/effects";
import "./site.css";

export const metadata: Metadata = {
  title: { default: "StartUp Link UniMelb | Your route into the startup world", template: "%s | StartUp Link UniMelb" },
  description:
    "StartUp Link UniMelb connects University of Melbourne students to startup jobs, skills, and a national founder/operator community.",
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
