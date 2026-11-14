import type { Metadata } from "next";
import { PortalGate } from "@/components/portal/portal-gate";
import "../portal.css";

export const metadata: Metadata = { title: "Committee Portal", robots: { index: false, follow: false } };

// The portal is its own app: no public-site header, footer or animated background.
export default function PortalPage() {
  return (
    <main id="main" className="app-main">
      <PortalGate />
    </main>
  );
}
