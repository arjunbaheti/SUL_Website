"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { portalClient } from "@/lib/supabase";
import { voteTally, type Applicant } from "@/lib/portal";
import { Icon } from "./icons";

// Board extras: live presence, smooth card moves, the loading skeleton, hover previews and the
// little avatars. Kept out of crm.tsx so the board component stays about the board.

/* ---------------------------------------------------------------------------------------------
 * Names + avatars
 * ------------------------------------------------------------------------------------------- */
/** "jamie.smith@x.com" -> "Jamie". */
export function firstName(email: string) {
  const w = (email.split("@")[0] || "").split(/[._-]+/)[0] || "";
  return w ? w[0].toUpperCase() + w.slice(1) : "";
}

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.45, "--h": hue(name) } as React.CSSProperties} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AvatarStack({ names, size = 20, max = 3, label }: { names: string[]; size?: number; max?: number; label: string }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  return (
    <span className="avatar-stack" role="img" aria-label={label} data-tip={label}>
      {shown.map((n) => <Avatar key={n} name={n} size={size} />)}
      {names.length > max ? <span className="avatar avatar-more" style={{ width: size, height: size, fontSize: size * 0.42 }}>+{names.length - max}</span> : null}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Presence: who else has the board open, and which applicant they're looking at.
 * Shares only a first name and the applicant id being viewed (ids mean nothing without a
 * committee session), never emails. One entry per browser tab, merged by name.
 * ------------------------------------------------------------------------------------------- */
type PresenceMeta = { name: string; viewing: string | null };

export function usePresence(me: string, viewing: string | null) {
  const [peers, setPeers] = useState<PresenceMeta[]>([]);
  const channel = useRef<RealtimeChannel | null>(null);
  const viewingRef = useRef(viewing);
  const name = firstName(me);

  useEffect(() => {
    if (!name) return;
    const db = portalClient();
    const tabKey = Math.random().toString(36).slice(2);
    const ch = db.channel("crm-presence", { config: { presence: { key: tabKey } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<PresenceMeta>();
      const others = Object.entries(state)
        .filter(([key]) => key !== tabKey)
        .map(([, metas]) => metas[metas.length - 1])
        .filter((m): m is PresenceMeta & { presence_ref: string } => !!m && !!m.name);
      setPeers(others.map((m) => ({ name: m.name, viewing: m.viewing })));
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") ch.track({ name, viewing: viewingRef.current });
    });
    channel.current = ch;
    return () => { channel.current = null; db.removeChannel(ch); };
  }, [name]);

  useEffect(() => {
    viewingRef.current = viewing;
    if (name) channel.current?.track({ name, viewing })?.catch?.(() => {});
  }, [viewing, name]);

  const online = [...new Set(peers.map((p) => p.name))].filter((n) => n !== name);
  const viewers = new Map<string, string[]>();
  for (const p of peers) {
    if (!p.viewing || p.name === name) continue;
    const list = viewers.get(p.viewing) ?? [];
    if (!list.includes(p.name)) viewers.set(p.viewing, [...list, p.name]);
  }
  return { online, viewers };
}

/* ---------------------------------------------------------------------------------------------
 * Smooth card moves (FLIP): when a card changes column or position, it slides from where it
 * was. Positions are stored relative to each column's scroll, so scrolling never causes jumps.
 * ------------------------------------------------------------------------------------------- */
type Spot = { stage: string; x: number; y: number };

export function useFlip(boardRef: RefObject<HTMLElement | null>, signature: string) {
  const prev = useRef(new Map<string, Spot>());
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cols = new Map<string, HTMLElement>();
    board.querySelectorAll<HTMLElement>(".crm-col-body[data-stage]").forEach((c) => cols.set(c.dataset.stage!, c));
    const screenY = (s: Spot) => {
      const col = cols.get(s.stage);
      return col ? col.getBoundingClientRect().top + s.y - col.scrollTop : null;
    };
    const next = new Map<string, Spot>();
    board.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const col = el.closest<HTMLElement>(".crm-col-body[data-stage]");
      if (!col) return;
      const r = el.getBoundingClientRect();
      const c = col.getBoundingClientRect();
      const spot: Spot = { stage: col.dataset.stage!, x: r.left + board.scrollLeft, y: r.top - c.top + col.scrollTop };
      next.set(el.dataset.flip!, spot);
      const was = prev.current.get(el.dataset.flip!);
      if (!was || reduced) return;
      const wasY = screenY(was);
      if (wasY === null) return;
      const dx = was.x - spot.x;
      const dy = wasY - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)`, zIndex: 5 }, { transform: "translate(0, 0)", zIndex: 5 }],
        { duration: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    });
    prev.current = next;
  }, [boardRef, signature]);
}

/* ---------------------------------------------------------------------------------------------
 * Skeleton shown while the board loads (after the opening screen, e.g. on Refresh).
 * ------------------------------------------------------------------------------------------- */
export function BoardSkeleton() {
  const cards = [3, 2, 1, 2, 1];
  return (
    <div className="skel-board" aria-busy="true" aria-label="Loading applications">
      <div className="skel-head">
        <span className="skel skel-title" />
        <span className="skel skel-stats" />
      </div>
      <div className="skel-toolbar">
        <span className="skel" style={{ width: 300 }} />
        <span className="skel" style={{ width: 96 }} />
        <span className="skel" style={{ width: 96 }} />
      </div>
      <div className="skel-cols">
        {cards.map((n, i) => (
          <div className="skel-col" key={i}>
            <span className="skel skel-col-title" />
            {Array.from({ length: n }, (_, j) => (
              <div className="skel-card" key={j}>
                <span className="skel" style={{ width: "62%" }} />
                <span className="skel" style={{ width: "40%" }} />
                <span className="skel" style={{ width: "28%", marginTop: 10 }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Hover preview: a quick look at someone's answers without opening their panel.
 * ------------------------------------------------------------------------------------------- */
export function HoverPreview({ a, rect }: { a: Applicant; rect: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const W = el.offsetWidth, H = el.offsetHeight, M = 12;
    const right = rect.right + M + W <= window.innerWidth - M;
    el.style.left = (right ? rect.right + M : Math.max(M, rect.left - M - W)) + "px";
    el.style.top = Math.min(Math.max(M, rect.top), window.innerHeight - H - M) + "px";
    el.style.visibility = "visible";
  }, [rect]);
  const t = voteTally(a.votes);
  const meta = [a.degree, a.yearLevel].filter(Boolean).join(" · ");
  return createPortal(
    <div ref={ref} className="peek" role="tooltip">
      <div className="peek-head">
        <strong>{a.name || "Unnamed"}</strong>
        <span>{a.role}{a.roleSecondary ? ` · 2nd: ${a.roleSecondary}` : ""}</span>
        {meta ? <span>{meta}</span> : null}
      </div>
      {a.statement ? <div className="peek-block"><label>Why join</label><p>{a.statement}</p></div> : null}
      {a.experience ? <div className="peek-block"><label>Skills &amp; experience</label><p>{a.experience}</p></div> : null}
      <div className="peek-foot">
        {a.votes.length ? (
          <span className="peek-votes">
            {t.yes ? <><i className="v yes" />{t.yes}</> : null}
            {t.maybe ? <><i className="v maybe" />{t.maybe}</> : null}
            {t.no ? <><i className="v no" />{t.no}</> : null}
          </span>
        ) : <span>No votes yet</span>}
        {a.files.length ? <span><Icon name="paperclip" size={12} />{a.files.length}</span> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Opens the preview after a short, deliberate hover; anything else cancels it. */
export function usePeek(enabled: boolean) {
  const [peek, setPeek] = useState<{ id: string; rect: DOMRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fine = useRef(false);
  useEffect(() => { fine.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches; }, []);
  useEffect(() => {
    if (enabled) return;
    clearTimeout(timer.current);
    const t = setTimeout(() => setPeek(null), 0);
    return () => clearTimeout(t);
  }, [enabled]);
  const enter = (id: string, el: HTMLElement) => {
    if (!enabled || !fine.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek({ id, rect: el.getBoundingClientRect() }), 600);
  };
  const leave = () => { clearTimeout(timer.current); setPeek(null); };
  return { peek, enter, leave };
}
