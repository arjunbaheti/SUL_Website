"use client";

import { useEffect, useRef } from "react";

// Small monochrome 3D marks that sit before each page title, one per view:
//   network  (Board)    points on a sphere joined to their nearest neighbours
//   bars     (Insights) a ring of wireframe columns, like a radial 3D bar chart
//   pulse    (Health)   a heart-monitor trace, the beat scrolling along a gently rocking line
// All share one look: hairline edges, tiny dots, depth shown only by opacity, a slow turn, no
// glow or hover effects. Drawn in the text colour (white in dark mode, near-black in light).
// Paused when off-screen or the tab is hidden; a single still frame for reduced motion.

export type GlyphKind = "network" | "bars" | "pulse";

type V3 = { x: number; y: number; z: number };
type Model = { lines: [V3, V3][]; dots: V3[] };

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });

/* ---------- Board: network sphere ---------- */
function networkModel(): Model {
  const N = 26;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const pts: V3[] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    pts.push(v(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r));
  }
  const seen = new Set<string>();
  const lines: [V3, V3][] = [];
  pts.forEach((p, i) => {
    pts
      .map((q, j) => ({ j, d: (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .forEach(({ j }) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(key)) { seen.add(key); lines.push([p, pts[j]]); }
      });
  });
  return { lines, dots: pts };
}

/* ---------- Insights: radial 3D bar chart ---------- */
function barsModel(): Model {
  // Six columns standing in a ring on a faint base circle; only uprights and tops are drawn,
  // so it stays light at 34px.
  const heights = [0.5, 0.95, 0.35, 0.75, 0.6, 1.0];
  const half = 0.17, ringR = 0.62, base = -0.85, span = 1.75;
  const lines: [V3, V3][] = [];
  const dots: V3[] = [];
  heights.forEach((ht, i) => {
    const a = (i / heights.length) * Math.PI * 2;
    const cx = Math.cos(a) * ringR, cz = Math.sin(a) * ringR;
    const top = base + span * ht;
    const c = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([dx, dz]) => [cx + dx, cz + dz]);
    for (let e = 0; e < 4; e++) {
      const [ax, az] = c[e], [bx, bz] = c[(e + 1) % 4];
      lines.push([v(ax, top, az), v(bx, top, bz)]);
      lines.push([v(ax, base, az), v(ax, top, az)]);
    }
    dots.push(v(cx, top, cz));
  });
  const SEG = 48;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    lines.push([v(Math.cos(a0) * 0.95, base, Math.sin(a0) * 0.95), v(Math.cos(a1) * 0.95, base, Math.sin(a1) * 0.95)]);
  }
  return { lines, dots };
}

/* ---------- Health: heartbeat ring ---------- */
const bump = (u: number, at: number, width: number, height: number) => height * Math.exp(-(((u - at) / width) ** 2));
function ecg(u: number) {
  // One beat over u in [0, 1): small P wave, sharp QRS spike, then a T wave.
  return bump(u, 0.1, 0.03, 0.12) + bump(u, 0.2, 0.012, -0.18) + bump(u, 0.23, 0.014, 1)
    + bump(u, 0.26, 0.014, -0.38) + bump(u, 0.4, 0.045, 0.25);
}
function pulseModel(t: number): Model {
  // A heart-monitor trace: one beat scrolling along a line, which rocks gently in 3D (see
  // SETUP.rock) instead of spinning, so it always reads as a heartbeat.
  const SEG = 120;
  const lines: [V3, V3][] = [];
  const dots: V3[] = [];
  const phase = (t * 0.00025) % 1; // one beat crosses about every 4 seconds
  let prev: V3 | null = null, peak: V3 | null = null, best = -Infinity;
  for (let i = 0; i <= SEG; i++) {
    const f = i / SEG;
    const u = ((f - phase) % 1 + 1) % 1;
    const y = ecg(u) * 1.15 - 0.3;
    const p = v(-1 + 2 * f, y, 0);
    if (y > best) { best = y; peak = p; }
    if (prev) lines.push([prev, p]);
    prev = p;
  }
  if (peak) dots.push(peak);
  return { lines, dots };
}

/* ---------- Shared renderer ---------- */
const SETUP: Record<GlyphKind, { tilt: number; speed: number; animated: boolean; rock?: boolean }> = {
  network: { tilt: 0.42, speed: 0.00018, animated: false },
  bars: { tilt: 0.38, speed: 0.00016, animated: false },
  pulse: { tilt: 0.22, speed: 0.0005, animated: true, rock: true },
};

function rgbOf(cssColor: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(cssColor.trim());
  if (!hex) return "236, 236, 239";
  const n = parseInt(hex[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function Glyph3D({ kind }: { kind: GlyphKind }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { tilt, speed, animated, rock } = SETUP[kind];
    const staticModel = kind === "network" ? networkModel() : kind === "bars" ? barsModel() : null;

    let ink = "236, 236, 239";
    const readColor = () => { ink = rgbOf(getComputedStyle(document.documentElement).getPropertyValue("--fg")); };
    readColor();

    let w = 0, h = 0, dpr = 1;
    const size = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    size();

    let angle = rock ? 0 : 0.5, clock = 0;
    const draw = () => {
      const model = staticModel ?? pulseModel(clock);
      const cy = Math.cos(angle), sy = Math.sin(angle), cx = Math.cos(tilt), sx = Math.sin(tilt);
      const F = 4; // camera distance in model radii (gentle perspective)
      const R = (Math.min(w, h) / 2 - 1.5) / (F / (F - 1));
      const project = (p: V3) => {
        const x1 = p.x * cy + p.z * sy;
        const z1 = -p.x * sy + p.z * cy;
        const y2 = p.y * cx - z1 * sx;
        const z2 = p.y * sx + z1 * cx;
        const s = F / (F - z2);
        return { x: w / 2 + x1 * R * s, y: h / 2 - y2 * R * s, d: (z2 + 1) / 2 }; // screen y runs down
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // Strokes and dots scale with the mark so it stays crisp at any size (tuned at 56px).
      const k = Math.max(0.6, Math.min(w, h) / 56);
      ctx.lineWidth = (kind === "pulse" ? 1.4 : kind === "bars" ? 0.9 : 0.75) * k;
      ctx.lineCap = "round";
      for (const [a, b] of model.lines) {
        const A = project(a), B = project(b);
        ctx.strokeStyle = `rgba(${ink}, ${0.1 + ((A.d + B.d) / 2) * 0.4})`;
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }
      for (const p of model.dots) {
        const P = project(p);
        ctx.fillStyle = `rgba(${ink}, ${0.25 + P.d * 0.75})`;
        ctx.beginPath();
        ctx.arc(P.x, P.y, (1.1 + P.d * 1.0) * k, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    let raf = 0, last = performance.now(), visible = true;
    const loop = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      if (animated) clock += dt;
      // Spin continuously, or (rock) sway gently either side of facing the viewer.
      angle = rock ? Math.sin(clock * speed) * 0.55 : angle + dt * speed;
      draw();
      raf = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    };
    const resume = () => {
      if (raf || reduced || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    if (reduced) draw(); else raf = requestAnimationFrame(loop);

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; resume(); });
    io.observe(canvas);
    const onVis = () => resume();
    document.addEventListener("visibilitychange", onVis);
    const recolor = () => { readColor(); if (reduced) draw(); };
    const theme = new MutationObserver(recolor);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", recolor);
    const ro = new ResizeObserver(() => { size(); if (reduced) draw(); });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      theme.disconnect();
      scheme.removeEventListener("change", recolor);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [kind]);

  return <canvas ref={ref} className="net-glyph" aria-hidden="true" />;
}
