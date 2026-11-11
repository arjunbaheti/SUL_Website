import type { Metadata } from "next";
import { BgFlow, Header, ShortFooter } from "@/components/chrome";
import { PortalGate } from "@/components/portal/portal-gate";
import "../portal.css";

export const metadata: Metadata = { title: "Committee Portal", robots: { index: false, follow: false } };

export default function PortalPage() {
  return (
    <>
      <BgFlow />
      <Header />
      <main id="main">
        <PortalGate />
      </main>
      <ShortFooter />
    </>
  );
}
