"use client";

import { useEffect, useRef } from "react";

// A soft light-blue trail behind the pointer, drawn on one full-screen canvas. The normal cursor
// stays as it is (so clicking and text selection feel exactly the same); the trail is purely
// decorative. It only runs on devices with a real mouse, stops drawing the moment the pointer is
// still, and is skipped entirely for people who've asked for reduced motion.

const LIFE_MS = 240;      // how long a point stays in the trail
const MAX_WIDTH = 7;      // trail thickness at the head, in CSS pixels

type Pt = { x: number; y: number; t: number };

export function CursorTrail() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!fine || reduced || !c || !ctx) return;

    let dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(window.innerWidth * dpr);
      c.height = Math.round(window.innerHeight * dpr);
    };
    resize();

    const pts: Pt[] = [];
    let raf = 0;
    let color = "";
    const readColor = () => {
      color = getComputedStyle(document.documentElement).getPropertyValue("--trail").trim() || "125, 180, 255";
    };
    readColor();

    const draw = () => {
      const now = performance.now();
      while (pts.length && now - pts[0].t > LIFE_MS) pts.shift();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      if (pts.length > 1) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Smooth curve through the midpoints of the recorded points, tapering and fading out
        // towards the tail. Butt caps so overlapping segments don't leave "beads".
        ctx.lineCap = "butt";
        ctx.lineJoin = "round";
        for (let i = 1; i < pts.length - 1; i++) {
          const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
          const k = 1 - (now - p1.t) / LIFE_MS; // 1 at the head, 0 at the tail
          if (k <= 0) continue;
          ctx.strokeStyle = `rgba(${color}, ${0.7 * k})`;
          ctx.lineWidth = Math.max(0.5, MAX_WIDTH * k);
          ctx.beginPath();
          ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
          ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
          ctx.stroke();
        }
        // A soft glow at the head.
        const h = pts[pts.length - 1];
        const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 14);
        g.addColorStop(0, `rgba(${color}, 0.35)`);
        g.addColorStop(1, `rgba(${color}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = pts.length ? requestAnimationFrame(draw) : 0;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (pts.length > 64) pts.shift();
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const onLeave = () => { pts.length = 0; };

    // Theme switches change the trail colour.
    const themeObserver = new MutationObserver(readColor);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", readColor);

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      scheme.removeEventListener("change", readColor);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvas} className="cursor-trail" aria-hidden="true" />;
}
