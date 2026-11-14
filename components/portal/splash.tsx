"use client";

import { useEffect, useRef, useState } from "react";

// Opening screen for the portal: the StartUp Link wordmark "loads up", filling in from left to
// right with a soft blue sheen on the leading edge, while the session and applicants load
// underneath. The fill eases to ~85% on its own, waits there until `ready`, then completes,
// swells slightly and fades away to reveal the app. Shown once per page load.
//
// The real logo is a PNG, so it's used as a CSS mask: each layer below is a coloured block cut
// to the exact shape of the wordmark.

const INTRO_MS = 950;   // time to reach the holding point
const HOLD_AT = 0.85;   // how far the fill gets before waiting for the app
const FINISH_MS = 260;  // final stretch once the app is ready
const EXIT_MS = 520;    // fade-out

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const fill = useRef<HTMLDivElement>(null);
  const sheen = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const readyRef = useRef(ready);
  useEffect(() => { readyRef.current = ready; }, [ready]);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const start = performance.now();
    let finishFrom = -1; // progress when the app became ready
    let finishAt = 0;

    const paint = (p: number) => {
      const pct = Math.max(0, Math.min(1, p)) * 100;
      if (fill.current) fill.current.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      if (sheen.current) {
        sheen.current.style.backgroundPosition = `${pct}% 0`;
        sheen.current.style.opacity = p >= 1 ? "0" : "1";
      }
    };

    const leave = () => {
      setLeaving(true);
      exitTimer = setTimeout(() => doneRef.current(), reduced ? 150 : EXIT_MS);
    };

    if (reduced) {
      // No animation: show the full logo, then fade as soon as the app is ready.
      paint(1);
      const wait = () => { if (readyRef.current) leave(); else raf = requestAnimationFrame(wait); };
      raf = requestAnimationFrame(wait);
      return () => { cancelAnimationFrame(raf); clearTimeout(exitTimer); };
    }

    const tick = (now: number) => {
      const t = now - start;
      let p = easeOut(Math.min(1, t / INTRO_MS)) * HOLD_AT;
      // A gentle creep while waiting, so it never looks frozen.
      if (t > INTRO_MS) p = HOLD_AT + Math.min(0.08, (t - INTRO_MS) / 30000);
      if (readyRef.current && t >= INTRO_MS * 0.6) {
        if (finishFrom < 0) { finishFrom = p; finishAt = now; }
        const k = easeOut(Math.min(1, (now - finishAt) / FINISH_MS));
        p = finishFrom + (1 - finishFrom) * k;
        if (k >= 1) { paint(1); setTimeout(leave, 140); return; }
      }
      paint(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clearTimeout(exitTimer); };
  }, []);

  return (
    <div className={"splash" + (leaving ? " is-leaving" : "")} role="status" aria-live="polite" aria-label="Loading the committee portal">
      <div className="splash-logo" aria-hidden="true">
        <div className="splash-layer splash-base" />
        <div ref={fill} className="splash-layer splash-fill" style={{ clipPath: "inset(0 100% 0 0)" }} />
        <div ref={sheen} className="splash-layer splash-sheen" />
      </div>
    </div>
  );
}
