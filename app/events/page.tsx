import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";
import { BgFlow, Header, ShortFooter } from "@/components/chrome";

export const metadata: Metadata = pageMeta(
  "Startup events & workshops for UniMelb students",
  "What's on at StartUp Link UniMelb: startup networking nights, founder talks, entrepreneurship workshops and socials for University of Melbourne students.",
  "/events",
);

export default function EventsPage() {
  return (
    <>
      <BgFlow />
      <Header current="/events" />
      <main id="main">
        <section className="section ig-hero">
          <div className="container ig-solo reveal">
            <div className="ig-frame" data-spotlight="">
              {/*
                Live profile feed. Instagram's official embed covers single posts; a full profile feed needs a
                free widget (e.g. behold.so or snapwidget.com): generate one for @startuplinkunimelb and paste
                its iframe in place of the one below. The fallback panel shows if the embed is blocked.
              */}
              <div className="ig-fallback" aria-hidden="true">
                <span className="ig-glyph" style={{ width: 56, height: 56, borderRadius: 16 }}>
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 30, height: 30 }}>
                    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="#fff" strokeWidth="1.8" />
                    <circle cx="12" cy="12" r="4.2" stroke="#fff" strokeWidth="1.8" />
                    <circle cx="17.4" cy="6.6" r="1.3" fill="#fff" />
                  </svg>
                </span>
                <span className="big">@startuplinkunimelb</span>
                <p>Our latest posts live on Instagram. Tap through to see the grid.</p>
                <a className="btn btn-secondary" href="https://www.instagram.com/startuplinkunimelb/" target="_blank" rel="noopener">Open profile</a>
              </div>
              <iframe
                title="StartUp Link UniMelb on Instagram"
                src="https://www.instagram.com/startuplinkunimelb/embed"
                loading="lazy"
                scrolling="no"
                frameBorder={0}
              ></iframe>
            </div>
          </div>
        </section>
      </main>
      <ShortFooter />
    </>
  );
}
