import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";
import { BgFlow, Header, ShortFooter } from "@/components/chrome";
import { COMMITTEE, type Office } from "@/lib/content";

export const metadata: Metadata = pageMeta(
  "Committee",
  "Meet the StartUp Link UniMelb committee: the University of Melbourne students running Melbourne's student startup club, term by term.",
  "/committee",
);

function OfficeBlock({ role, name }: { role: string; name: Office }) {
  const names = Array.isArray(name) ? name : [name || "TBD"];
  return (
    <div className="office">
      <div className="office-role">{role}</div>
      <div className="office-names">
        {names.map((n) => <div className="office-name" key={n}>{n}</div>)}
      </div>
    </div>
  );
}

export default function CommitteePage() {
  return (
    <>
      <BgFlow />
      <Header current="/committee" />
      <main id="main">
        <section className="section">
          <div className="container">
            <figure className="committee-hero reveal">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/img/committee-photo.jpg" alt="The StartUp Link UniMelb executive committee at the University of Melbourne" loading="lazy" />
              <figcaption className="committee-hero-overlay">
                <h2>The Committee</h2>
              </figcaption>
            </figure>
            <div className="roster" id="committee-list">
              {COMMITTEE.length === 0 ? <div className="empty-state">Committee details coming soon.</div> : null}
              {COMMITTEE.map((t) => (
                <div className={"term-card reveal tilt" + (t.current ? " is-current" : "")} key={t.term}>
                  <div className="term-head"><div className="term-year">&apos;{t.term}</div></div>
                  <div className="term-offices">
                    <OfficeBlock role="President" name={t.president} />
                    <OfficeBlock role="Secretary" name={t.secretary} />
                    <OfficeBlock role="Treasurer" name={t.treasurer} />
                  </div>
                </div>
              ))}
            </div>
            <div className="cta-row" style={{ justifyContent: "center", marginTop: "2.75rem" }}>
              <a className="btn btn-primary" href="/portal">Committee Portal</a>
            </div>
          </div>
        </section>
      </main>
      <ShortFooter />
    </>
  );
}
