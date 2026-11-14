import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";
import { Header, HeroTitle, ShortFooter, TeamGrid } from "@/components/chrome";

export const metadata: Metadata = pageMeta(
  "Committee recruitment",
  "Join the StartUp Link UniMelb committee. Recruitment for the University of Melbourne's startup club opens in late February 2027 across Events, Projects, External Relations and Marketing.",
  "/recruitment",
);

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
