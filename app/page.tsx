import { BgFlow, FullFooter, Header, HeroTitle, Ribbon } from "@/components/chrome";
import type { Metadata } from "next";
import { PartnersCarousel } from "@/components/home/partners-carousel";
import { SITE_DESCRIPTION } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "StartUp Link UniMelb | University of Melbourne Startup & Entrepreneurship Club" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

// Common questions, shown on the page and given to Google as FAQ structured data. Every answer
// is taken from what the site already says; keep them accurate when things change.
const FAQ: [string, string][] = [
  [
    "What is StartUp Link UniMelb?",
    "StartUp Link UniMelb is the University of Melbourne's startup club and the UniMelb chapter of StartUp Link Australia. We're recruitment-first: our job is getting students into startup roles through partner introductions, hands-on entrepreneurship workshops and Melbourne's founder and investor network.",
  ],
  [
    "Who can join?",
    "University of Melbourne students. Membership is through UMSU, the University of Melbourne Student Union: tap Join now to sign up on our UMSU club page.",
  ],
  [
    "What does the club run?",
    "Startup networking nights, founder talks and socials, plus workshops on validating an idea, pitching, building product and running lean, taught by people who have actually done it. Members also get introductions to partners recruiting for startup roles, internships and graduate programs.",
  ],
  [
    "How can startups and companies partner with us?",
    "Partners run workshops, sit on panels, host office visits and post internships, casual roles and graduate jobs straight to our members. See Partner with us to get in touch.",
  ],
  [
    "How do I join the committee?",
    "Committee recruitment opens in late February 2027 across four teams: Events, Projects, External Relations and Marketing. Details are on the Recruitment page.",
  ],
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
};

const JOIN_URL = "https://umsu.unimelb.edu.au/buddy-up/clubs/clubs-listing/join/8055/";

export default function HomePage() {
  return (
    <>
      <BgFlow />
      <Header current="/" />
      <main id="main">
        <section className="hero">
          <div className="hero-aurora" data-parallax="0.12" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <div className="container">
            <HeroTitle lines={[["60ms", <>The most <em>ambitious</em></>], ["180ms", "student club in Australia."]]} />
            <p className="lead">
              StartUp Link connects University of Melbourne students to Melbourne&apos;s growing startup ecosystem through
              networking, upskilling and social opportunities.
            </p>
            <div className="cta-row">
              <a className="btn btn-primary" data-magnetic="" href={JOIN_URL} target="_blank" rel="noopener">Join now</a>
            </div>
          </div>
          <Ribbon hero speed="0.6" items={["Startups", "Careers", "Founders", "Internships", "Network", "Melbourne"]} />
        </section>

        <section className="section section-alt partners-strip">
          <div className="container">
            <div className="section-head reveal">
              <h2>Past Partners</h2>
            </div>
            <PartnersCarousel />
          </div>
        </section>

        <section className="section faq" aria-labelledby="faq-title">
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD).replace(/</g, "\\u003c") }} />
          <div className="container faq-wrap">
            <div className="section-head reveal">
              <h2 id="faq-title">Questions</h2>
            </div>
            <div className="faq-list">
              {FAQ.map(([q, a]) => (
                <details className="faq-item" key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <FullFooter />
    </>
  );
}
