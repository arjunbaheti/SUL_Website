import type { Metadata } from "next";
import { BgFlow, Header, ShortFooter } from "@/components/chrome";
import { JoinForm } from "@/components/join/join-form";

export const metadata: Metadata = { title: "Join" };

export default function JoinPage() {
  return (
    <>
      <BgFlow />
      <Header />
      <main id="main">
        <section className="section" style={{ paddingBottom: "1rem" }}>
          <div className="container" style={{ maxWidth: 620 }}>
            <div className="section-head">
              <h2>Join StartUp Link UniMelb</h2>
              <p>Takes under a minute. You&apos;ll get events, curated opportunities, and everything else on our list.</p>
            </div>
            <div className="form-note">
              <strong>Prototype note:</strong> this form isn&apos;t wired to a real database yet. Submitting it opens a
              pre-filled email to the club instead. Before launch, swap this for wherever membership data should actually
              live (UMSU&apos;s system, a club spreadsheet, or the platform&apos;s native form/CMS store, see the PRD&apos;s
              open question on this).
            </div>
            <JoinForm />
          </div>
        </section>
      </main>
      <ShortFooter />
    </>
  );
}
