import type { Metadata } from "next";
import { Header, HeroTitle, ShortFooter, TeamGrid } from "@/components/chrome";
import { ApplyForm } from "@/components/apply/apply-form";

// Unlisted: the working application form, kept for demos until recruitment opens.
export const metadata: Metadata = {
  title: "Recruitment form (preview)",
  description: "Semester 1 2027 committee recruitment at StartUp Link UniMelb. Apply for a role, tell us about yourself and attach your resume.",
  robots: { index: false, follow: false },
};

export default function RecruitmentDemoPage() {
  return (
    <>
      <Header current="/recruitment" />
      <main id="main">
        <section className="hero apply-hero">
          <div className="container">
            <HeroTitle lines={[["60ms", "Build the"], ["150ms", <em key="e">next chapter</em>], ["240ms", "of StartUp Link."]]} />
            <p className="lead">
              We&apos;re recruiting for the Semester 1 2027 committee. Pick a team, tell us who you are and attach your
              resume. It takes about five minutes.
            </p>
            <div className="cta-row">
              <a className="btn btn-primary" href="#apply">Start your application</a>
            </div>
          </div>
        </section>
        <TeamGrid />
        <section className="section apply-section" id="apply" style={{ paddingTop: "1rem" }}>
          <div className="container apply-wrap">
            <ApplyForm />
          </div>
        </section>
      </main>
      <ShortFooter />
    </>
  );
}
