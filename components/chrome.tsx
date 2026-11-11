// Shared page chrome, ported 1:1 from the original static site's markup so the original
// stylesheet (app/site.css) and effects script (public/js/main.js) apply unchanged.
// Internal links are plain <a> tags on purpose: every page is a full page load, exactly like
// the old site, so main.js re-initialises its effects on each page.

import { Fragment } from "react";

const JOIN_URL = "https://umsu.unimelb.edu.au/buddy-up/clubs/clubs-listing/join/8055/";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/events", label: "What's on" },
  { href: "/partners", label: "Partner with us" },
  { href: "/committee", label: "Committee" },
  { href: "/recruitment", label: "Recruitment" },
];

function Logo({ large = false }: { large?: boolean }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/img/logo.png" alt="StartUp Link UniMelb" className={large ? "brand-logo brand-logo-lg" : "brand-logo"} />
      <span className="brand-fallback" style={{ display: "none" }}>
        <span className="mark" aria-hidden="true">SL</span>StartUp Link UniMelb
      </span>
    </>
  );
}

export function BgFlow() {
  return (
    <div className="bg-flow" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
  );
}

export function Header({ current }: { current?: string }) {
  return (
    <header className="nav" data-nav="" suppressHydrationWarning>
      <div className="container nav-inner">
        <a className="nav-logo" href="/" aria-label="StartUp Link UniMelb, home">
          <Logo />
        </a>
        <nav aria-label="Primary">
          <ul className="nav-links">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} aria-current={current === n.href ? "page" : undefined}>{n.label}</a>
              </li>
            ))}
            <li>
              <a className="nav-cta" href={JOIN_URL} target="_blank" rel="noopener">Join now</a>
            </li>
          </ul>
        </nav>
        <button className="nav-toggle" data-nav-toggle="" aria-expanded="false" aria-label="Toggle menu">☰</button>
      </div>
      <div className="container nav-mobile-panel">
        {NAV.map((n) => (
          <a key={n.href} href={n.href}>{n.label}</a>
        ))}
        <a href={JOIN_URL} target="_blank" rel="noopener"><strong>Join now →</strong></a>
      </div>
    </header>
  );
}

const ACK =
  "StartUp Link UniMelb acknowledges the Traditional Owners of the unceded lands on which we gather, learn, grow and innovate, the Wurundjeri Woi-wurrung people of the Kulin Nation.";

export function FullFooter() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <a className="nav-logo footer-logo" href="/" aria-label="StartUp Link UniMelb, home">
              <Logo large />
            </a>
            <p style={{ maxWidth: "40ch", fontSize: "0.88rem" }}>
              The University of Melbourne chapter of StartUp Link Australia. Connecting students to startup careers, skills, and community.
            </p>
          </div>
          <div>
            <h4>Explore</h4>
            <ul>
              <li><a href="/about">About</a></li>
              <li><a href="/events">What&apos;s on</a></li>
              <li><a href="/partners">Partner with us</a></li>
              <li><a href="/committee">Committee</a></li>
              <li><a href="/recruitment">Recruitment</a></li>
            </ul>
          </div>
          <div>
            <h4>Connect</h4>
            <ul>
              <li><a href={JOIN_URL} target="_blank" rel="noopener">Join now ↗</a></li>
              <li><a href="mailto:info@startuplinkunimelb.net">info@startuplinkunimelb.net</a></li>
              <li><a href="https://www.instagram.com/startuplinkunimelb/" target="_blank" rel="noopener">Instagram ↗</a></li>
              <li><a href="https://www.linkedin.com/company/startuplinkunimelb/" target="_blank" rel="noopener">LinkedIn ↗</a></li>
            </ul>
          </div>
        </div>
        <p className="footer-ack">{ACK}</p>
        <div className="footer-bottom">
          <span>© 2026 StartUp Link UniMelb</span>
        </div>
      </div>
    </footer>
  );
}

export function ShortFooter({ previewLink = false }: { previewLink?: boolean }) {
  return (
    <footer className="footer">
      <div className="container">
        <p className="footer-ack">{ACK}</p>
        <div className="footer-bottom">
          <span>© 2026 StartUp Link UniMelb</span>
          <a href="/">Back to home</a>
        </div>
        {previewLink ? (
          <p className="preview-link"><a href="/recruitment-demo" rel="nofollow">Preview application form</a></p>
        ) : null}
      </div>
    </footer>
  );
}

export function Ribbon({ items, speed, hero = false }: { items: string[]; speed: string; hero?: boolean }) {
  const words = [...items, ...items];
  return (
    <div className={hero ? "ribbon ribbon-hero" : "ribbon"} aria-hidden="true">
      <div className="ribbon-track" data-speed={speed} data-direction="left">
        {words.map((w, i) => (
          <Fragment key={i}>
            <span className={i % 2 === 0 ? "solid" : undefined}>{w}</span>
            <span className="star">✦</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function Stats() {
  const stats: [string, string, string][] = [
    ["700", "+", "Members in 2025"],
    ["45", "+", "Committee"],
    ["10", "+", "Events a year"],
    ["4", "", "Branches nationally"],
  ];
  return (
    <div className="stats-grid" style={{ marginTop: "3.5rem" }}>
      {stats.map(([n, suffix, label]) => (
        <div className="stat reveal" key={label}>
          <div className="num"><span data-count={n} data-suffix={suffix}>0</span></div>
          <div className="label">{label}</div>
        </div>
      ))}
    </div>
  );
}

export function HeroTitle({ lines }: { lines: [string, React.ReactNode][] }) {
  return (
    <h1 className="hero-title">
      {lines.map(([delay, content], i) => (
        <span className="line" key={i}>
          <span style={{ "--line-delay": delay } as React.CSSProperties}>{content}</span>
        </span>
      ))}
    </h1>
  );
}

export const TEAMS = [
  ["Events", "Plan and run the talks, socials and flagship nights our members show up for."],
  ["Projects", "Work with industry startups on real projects that contribute to their business."],
  ["External Relations", "Build partnerships with startups, investors and sponsors across the ecosystem."],
  ["Marketing", "Tell our story across socials, campaigns and content that grows the club."],
] as const;

export function TeamGrid() {
  return (
    <section className="section apply-teams">
      <div className="container">
        <div className="section-head">
          <h2>Where would you fit?</h2>
        </div>
        <div className="team-grid">
          {TEAMS.map(([name, blurb], i) => (
            <article className="team-tile" key={name}>
              <span className="team-num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{name}</h3>
              <p>{blurb}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
