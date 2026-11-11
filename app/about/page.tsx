import type { Metadata } from "next";
import { BgFlow, Header, Ribbon, ShortFooter, Stats } from "@/components/chrome";
import { IndexRows } from "@/components/site/index-rows";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <BgFlow />
      <Header current="/about" />
      <main id="main">
        <section className="section">
          <div className="container">
            <div className="section-head reveal">
              <h2>About us</h2>
              <p>StartUp Link UniMelb is the University of Melbourne chapter of StartUp Link Australia. We are recruitment-first, not a generic club. Our job is getting you into a startup role.</p>
            </div>
            <IndexRows
              rows={[
                { title: "Bridge you to opportunities", href: "/partners", body: "Direct lines to partners actively recruiting students for startup roles, internships, and grad programs. We do the intros so you skip the cold-application pile." },
                { title: "Build entrepreneurial skills", href: "/events", body: "Hands-on workshops that build real entrepreneurial skills, from validating an idea and pitching to building product and running lean, taught by people who have actually done it." },
                { title: "Plug into the network", href: "/partners", body: "Our vast and deep connections across the Melbourne startup ecosystem. We open the door to the founders, operators, investors and community that make it move." },
              ]}
            />
            <Stats />
          </div>
        </section>
        <Ribbon speed="0.5" items={["Startups", "Careers", "Founders", "Internships", "Network", "Melbourne"]} />
      </main>
      <ShortFooter />
    </>
  );
}
