import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { PortalGate } from "@/components/portal/portal-gate";
import "../portal.css";

export const metadata: Metadata = { title: "Committee Portal", robots: { index: false, follow: false } };

// Inter: the typeface Figma uses across its editor and FigJam. Variable weight plus the optical
// size axis, so large headings get the tighter "Display" cut automatically. Self-hosted by Next.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", axes: ["opsz"], display: "swap" });

// The portal is its own app: no public-site header, footer or animated background.
export default function PortalPage() {
  return (
    <main id="main" className={"app-main " + inter.variable}>
      <PortalGate fontClass={inter.variable} />
    </main>
  );
}
