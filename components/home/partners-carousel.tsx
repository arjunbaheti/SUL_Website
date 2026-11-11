"use client";

import { useEffect, useRef } from "react";
import { PARTNERS } from "@/lib/content";

// Stepped partner carousel from the original home page: show a row, hold ~3s, slide one card
// left, repeat. Same markup and timings as before; the DOM work runs after mount.
export function PartnersCarousel() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || mount.childElementCount) return;
    const partners = PARTNERS.slice();
    if (!partners.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Partners coming soon.";
      mount.appendChild(empty);
      return;
    }

    const GAP = 14; // must match .pcarousel-track gap
    const HOLD = 3000;
    const CLONES = 4;
    let visible = 4;

    const track = document.createElement("div");
    track.className = "pcarousel-track";
    const card = (p: (typeof partners)[number]) => {
      const a = document.createElement("a");
      a.className = "pcard";
      a.href = p.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.setAttribute("aria-label", `${p.name}, opens in a new tab`);
      const img = document.createElement("img");
      img.src = p.logo;
      img.alt = `${p.name} logo`;
      img.loading = "lazy";
      if (p.mono) img.className = "is-mono";
      a.appendChild(img);
      return a;
    };
    partners.forEach((p) => track.appendChild(card(p)));
    partners.slice(0, CLONES).forEach((p) => {
      const c = card(p);
      c.setAttribute("aria-hidden", "true");
      track.appendChild(c);
    });
    mount.appendChild(track);

    const TRANS = "transform 0.7s cubic-bezier(0.16,1,0.3,1)";
    let step = 0;
    let idx = 0;
    const sizeItems = () => {
      visible = mount.clientWidth < 640 ? 2 : 4;
      const itemW = (mount.clientWidth - GAP * (visible - 1)) / visible;
      Array.from(track.children).forEach((c) => ((c as HTMLElement).style.width = itemW + "px"));
      step = itemW + GAP;
    };
    const place = () => (track.style.transform = `translateX(${-idx * step}px)`);
    const jump = () => {
      track.style.transition = "none";
      place();
      void track.offsetWidth;
      track.style.transition = TRANS;
    };
    sizeItems();
    track.style.transition = TRANS;
    jump();
    const onResize = () => { sizeItems(); jump(); };
    window.addEventListener("resize", onResize);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer: number | undefined;
    const next = () => {
      idx++;
      place();
      if (idx >= partners.length) window.setTimeout(() => { idx = 0; jump(); }, 720);
    };
    const start = () => { timer = window.setInterval(next, HOLD); };
    const stop = () => window.clearInterval(timer);
    if (!reduced && partners.length > visible) {
      start();
      mount.addEventListener("mouseenter", stop);
      mount.addEventListener("mouseleave", start);
    }
    return () => {
      stop();
      window.removeEventListener("resize", onResize);
      mount.removeEventListener("mouseenter", stop);
      mount.removeEventListener("mouseleave", start);
      mount.innerHTML = "";
    };
  }, []);

  return <div className="pcarousel reveal" id="home-partners-marquee" aria-label="Past partners" ref={mountRef} />;
}
