import { BgFlow, FullFooter, Header, HeroTitle, Ribbon } from "@/components/chrome";
import { PartnersCarousel } from "@/components/home/partners-carousel";

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
              We connect UniMelb students to the growing startup ecosystem through a range of networking, upskilling and
              social opportunities.
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
      </main>
      <FullFooter />
    </>
  );
}
