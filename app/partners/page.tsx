import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";
import { BgFlow, Header, Ribbon, ShortFooter, Stats } from "@/components/chrome";
import { IndexRows } from "@/components/site/index-rows";

export const metadata: Metadata = pageMeta(
  "Partner with UniMelb's student startup club",
  "Hire entrepreneurial University of Melbourne students. Partner with StartUp Link UniMelb to run workshops, meet members in person and post startup internships and graduate roles.",
  "/partners",
);

export default function PartnersPage() {
  return (
    <>
      <BgFlow />
      <Header current="/partners" />
      <main id="main">
        <section className="section">
          <div className="container">
            <div className="section-head reveal">
              <h2>Why partner with us</h2>
              <p>We connect University of Melbourne students to startup careers. If you are hiring, building brand on campus, or looking for sharp early-stage talent, StartUp Link UniMelb is the shortest path to it.</p>
            </div>
            <IndexRows
              rows={[
                { title: "Hire entrepreneurial talent", body: "Our members join to meet fellow builders, find co-founders, and connect directly with founders who have actually shipped. You reach students who already want an early-stage role, filtered for motivation before you spend a cent on recruiting." },
                { title: "Meet members in person", body: "Run a workshop, sit on a panel, or host an office visit. Put your team, your product, and your open roles in front of a room of students deciding where to start their careers." },
                { title: "Build your pipeline early", body: "Post internships, casual gigs, and graduate roles straight to our members. Meet strong candidates a year or two before they reach the open market, and stay front of mind when they do." },
              ]}
            />
            <Stats />
            <div className="partner-cta reveal">
              <h3>Ready to work with us?</h3>
              <p>Tell us what you are after, whether that is hiring, an event, or a longer partnership, and we will come back with a plan that fits.</p>
              <div className="cta-row">
                <a className="btn btn-primary" href="mailto:info@startuplinkunimelb.net?subject=Partnering%20with%20StartUp%20Link%20UniMelb">Get in touch</a>
              </div>
            </div>
          </div>
        </section>
        <Ribbon speed="0.45" items={["Hire our members", "Run a workshop", "Post a role", "info@startuplinkunimelb.net"]} />
      </main>
      <ShortFooter />
    </>
  );
}
