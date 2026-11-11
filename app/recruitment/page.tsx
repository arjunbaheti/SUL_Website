import type { Metadata } from "next";
import { Header, HeroTitle, ShortFooter, TeamGrid } from "@/components/chrome";

export const metadata: Metadata = {
  title: "Recruitment opens soon",
  description: "Committee recruitment at StartUp Link UniMelb opens in late February 2027.",
};

export default function RecruitmentPage() {
  return (
    <>
      <Header current="/recruitment" />
      <main id="main">
        <section className="hero apply-hero">
          <div className="container">
            <HeroTitle lines={[["60ms", "Build the"], ["150ms", <em key="e">next chapter</em>], ["240ms", "of StartUp Link."]]} />
            <p className="lead">
              Applications for the Semester 1 2027 committee open in late February. Check back then, or email us if you
              have questions in the meantime.
            </p>
            <div className="cta-row">
              <a className="btn btn-primary" href="/">Back to home</a>
            </div>
          </div>
        </section>
        <TeamGrid />
      </main>
      <ShortFooter previewLink />
    </>
  );
}
