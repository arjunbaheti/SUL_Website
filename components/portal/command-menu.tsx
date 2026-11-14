"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { STAGE_BY_ID, type Applicant } from "@/lib/portal";
import { Icon, type IconName } from "./icons";
import { useLayer } from "./ui";

// ⌘K / Ctrl+K command menu: jump to any applicant by name, email or team, or run an action
// (switch view, refresh, export, theme, move the open applicant...). Type to filter, ↑↓ to move,
// Enter to run, Esc to close.

export type Command = {
  id: string;
  label: string;
  group: string;
  icon?: IconName;
  hint?: ReactNode;
  keywords?: string;
  dot?: string;
  run: () => void;
};

/** Every word typed must appear somewhere in the label or keywords; earlier matches rank higher. */
function score(cmd: Command, words: string[]) {
  const hay = (cmd.label + " " + (cmd.keywords ?? "")).toLowerCase();
  let s = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return -1;
    s += i === 0 ? 3 : hay[i - 1] === " " ? 2 : 1;
  }
  return s;
}

export function CommandMenu({ commands, applicants, onOpenApplicant, onClose }: {
  commands: Command[];
  applicants: Applicant[];
  onOpenApplicant: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useLayer(onClose);
  useEffect(() => { input.current?.focus(); }, []);

  const results = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const people: Command[] = applicants.map((a) => ({
      id: "a:" + a.id,
      label: a.name || "Unnamed",
      group: "Applicants",
      keywords: [a.email, a.role, a.roleSecondary, a.degree, STAGE_BY_ID[a.status].label].join(" "),
      hint: <span className="cmd-meta">{a.role ? a.role + " · " : ""}{STAGE_BY_ID[a.status].label}</span>,
      dot: STAGE_BY_ID[a.status].color,
      run: () => onOpenApplicant(a.id),
    }));
    if (!words.length) return [...commands, ...people.slice(0, 6)];
    const ranked = [...commands, ...people]
      .map((c) => ({ c, s: score(c, words) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s);
    // Keep groups together in the order they first appear in the ranking.
    const order: string[] = [];
    for (const r of ranked) if (!order.includes(r.c.group)) order.push(r.c.group);
    return order.flatMap((g) => ranked.filter((r) => r.c.group === g).map((r) => r.c)).slice(0, 40);
  }, [q, commands, applicants, onOpenApplicant]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (i: number) => {
    const c = results[i];
    if (!c) return;
    onClose();
    c.run();
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(active); }
  }

  return createPortal(
    <div className="cmd-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="cmd-search">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search applicants or type a command"
            aria-label="Search applicants or type a command"
            aria-controls="cmd-list"
            aria-activedescendant={results[active] ? "cmd-" + active : undefined}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmd-list" id="cmd-list" role="listbox" ref={list}>
          {results.length === 0 ? <div className="cmd-empty">No matches</div> : null}
          {results.map((c, i) => {
            const head = i === 0 || results[i - 1].group !== c.group ? c.group : null;
            return (
              <div key={c.id} role="presentation">
                {head ? <div className="cmd-group">{head}</div> : null}
                <div
                  id={"cmd-" + i}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  className={"cmd-item" + (i === active ? " is-active" : "")}
                  onMouseMove={() => { if (active !== i) setActive(i); }}
                  onClick={() => run(i)}
                >
                  {c.dot ? <span className="ui-dot" style={{ background: c.dot }} /> : c.icon ? <Icon name={c.icon} /> : <span className="cmd-spacer" />}
                  <span className="cmd-label">{c.label}</span>
                  {c.hint ? <span className="cmd-hint">{c.hint}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className="cmd-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
