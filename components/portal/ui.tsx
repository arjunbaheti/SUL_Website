"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

// The portal's own UI kit: dialogs, sheets, dropdowns, menus, confirms, toasts and the theme
// switch. Everything renders on <body> and is styled by app/portal.css, so it follows the
// dashboard's light/dark tokens instead of the browser's native controls.

/* ---------------------------------------------------------------------------------------------
 * Layers: dialogs and popovers stack, and only the top-most one reacts to Escape.
 * ------------------------------------------------------------------------------------------- */
const layers: number[] = [];
let layerSeq = 0;

export function useLayer(onEscape: () => void) {
  const esc = useRef(onEscape);
  useEffect(() => { esc.current = onEscape; });
  useEffect(() => {
    const id = ++layerSeq;
    layers.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || layers[layers.length - 1] !== id) return;
      e.preventDefault();
      esc.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = layers.indexOf(id);
      if (i >= 0) layers.splice(i, 1);
    };
  }, []);
}

/* ---------------------------------------------------------------------------------------------
 * Modal: a centred dialog, or a sheet that slides in from the right (variant="sheet").
 * ------------------------------------------------------------------------------------------- */
export function Modal({ title, subtitle, onClose, children, foot, actions, variant = "dialog", size = "md", origin }: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode;
  actions?: ReactNode; variant?: "dialog" | "sheet"; size?: "sm" | "md" | "lg";
  /** Screen rectangle the panel should grow out of (e.g. the card that was clicked). */
  origin?: DOMRect | null;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const [fromOrigin] = useState(() => !!origin && typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useLayer(onClose);

  // Grow out of the origin: a plain "ghost" surface expands from the card to the panel's place,
  // then the panel's content fades in on top of it.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!fromOrigin || !origin || !el) return;
    const to = el.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "ui-ghost";
    Object.assign(ghost.style, { left: origin.left + "px", top: origin.top + "px", width: origin.width + "px", height: origin.height + "px" });
    document.body.appendChild(ghost);
    const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    const grow = ghost.animate(
      [
        { left: origin.left + "px", top: origin.top + "px", width: origin.width + "px", height: origin.height + "px", borderRadius: "10px" },
        { left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px", borderRadius: "0px" },
      ],
      { duration: 340, easing: ease, fill: "forwards" },
    );
    el.style.opacity = "0";
    grow.onfinish = () => {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out", fill: "forwards" }).onfinish = () => {
        el.style.opacity = "";
        ghost.remove();
      };
    };
    return () => { grow.cancel(); ghost.remove(); el.style.opacity = ""; };
  }, [fromOrigin, origin]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  // Rendered on <body> so nothing on the page can paint over it.
  return createPortal(
    <div className={"ui-overlay is-" + variant} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} tabIndex={-1} className={`ui-panel is-${variant} is-${size}` + (fromOrigin ? " is-from-origin" : "")} role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <header className="ui-panel-head">
          <div className="ui-panel-title">
            <h2 id={labelId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions}
          <button className="ui-icon-btn" type="button" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="ui-panel-body">{children}</div>
        {foot ? <footer className="ui-panel-foot">{foot}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

/** True when a keypress should be left alone by panel shortcuts: typing in a field, a dropdown
 *  is open, a dialog sits on top, or a modifier key is held. */
export function shortcutBlocked(e: KeyboardEvent) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return true;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.("input, textarea, select, [contenteditable='true']")) return true;
  if (document.querySelector(".ui-pop")) return true;
  return document.querySelectorAll('[aria-modal="true"]').length > 1;
}

/* ---------------------------------------------------------------------------------------------
 * Popover: positions itself under (or above, if there's no room) an anchor element.
 * ------------------------------------------------------------------------------------------- */
const GAP = 6, MARGIN = 8;

function Popover({ anchor, onClose, align = "start", matchWidth = false, className = "", children, ...rest }: {
  anchor: RefObject<HTMLElement | null>; onClose: () => void; align?: "start" | "end"; matchWidth?: boolean;
  className?: string; children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(() => { onClose(); anchor.current?.focus(); });

  // Placement reads layout, so it runs after every render (cheap) and on scroll/resize.
  const placeRef = useRef<() => void>(() => {});
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      if (matchWidth) el.style.minWidth = a.width + "px";
      el.style.maxHeight = "";
      const below = window.innerHeight - a.bottom - GAP - MARGIN;
      const above = a.top - GAP - MARGIN;
      let h = el.offsetHeight;
      const up = h > below && above > below;
      const room = Math.max(120, up ? above : below);
      if (h > room) { el.style.maxHeight = room + "px"; h = room; }
      const w = el.offsetWidth;
      let left = align === "end" ? a.right - w : a.left;
      left = Math.min(Math.max(MARGIN, left), window.innerWidth - w - MARGIN);
      el.style.top = (up ? a.top - GAP - h : a.bottom + GAP) + "px";
      el.style.left = left + "px";
      el.style.visibility = "visible";
      el.dataset.side = up ? "top" : "bottom";
    };
    placeRef.current = place;
    place();
  });

  useEffect(() => {
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) placeRef.current(); };
    const onResize = () => placeRef.current();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) closeRef.current();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [anchor]);

  return createPortal(<div ref={ref} className={"ui-pop " + className} {...rest}>{children}</div>, document.body);
}

/* ---------------------------------------------------------------------------------------------
 * List: the keyboard-driven option list shared by Select and Menu.
 * ------------------------------------------------------------------------------------------- */
type Row = {
  key: string; label: ReactNode; text: string; icon?: ReactNode; dot?: string; hint?: ReactNode;
  group?: string; selected?: boolean; danger?: boolean; disabled?: boolean; sep?: boolean;
};

function List({ anchor, rows, kind, onPick, onClose, align, matchWidth, label }: {
  anchor: RefObject<HTMLButtonElement | null>; rows: Row[]; kind: "listbox" | "menu";
  onPick: (key: string) => void; onClose: () => void; align?: "start" | "end"; matchWidth?: boolean; label: string;
}) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const usable = rows.map((r, i) => (!r.sep && !r.disabled ? i : -1)).filter((i) => i >= 0);
  const [active, setActive] = useState(() => {
    const sel = rows.findIndex((r) => r.selected && !r.disabled);
    return sel >= 0 ? sel : usable[0] ?? -1;
  });
  const typed = useRef({ text: "", at: 0 });

  useEffect(() => { listRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const move = (delta: number) => {
    if (!usable.length) return;
    const at = usable.indexOf(active);
    const next = at < 0 ? (delta > 0 ? 0 : usable.length - 1) : Math.min(usable.length - 1, Math.max(0, at + delta));
    setActive(usable[next]);
  };
  const pick = (i: number) => {
    const r = rows[i];
    if (!r || r.sep || r.disabled) return;
    onClose();
    anchor.current?.focus();
    onPick(r.key);
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(usable[0] ?? -1); }
    else if (e.key === "End") { e.preventDefault(); setActive(usable[usable.length - 1] ?? -1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); }
    else if (e.key === "Tab") { onClose(); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Type-ahead: jump to the first option starting with what was typed.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const hit = usable.find((i) => rows[i].text.toLowerCase().startsWith(typed.current.text));
      if (hit !== undefined) setActive(hit);
    }
  }

  return (
    <Popover anchor={anchor} onClose={onClose} align={align} matchWidth={matchWidth} className={"ui-list is-" + kind}>
      <div
        ref={listRef}
        id={id}
        role={kind}
        aria-label={label}
        tabIndex={-1}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        onKeyDown={onKeyDown}
        className="ui-list-inner"
      >
        {rows.map((r, i) => {
          if (r.sep) return <div key={r.key} className="ui-list-sep" role="separator" />;
          const prev = rows[i - 1];
          const head = r.group && (!prev || prev.sep || prev.group !== r.group) ? r.group : null;
          return (
            <div key={r.key} role="presentation">
              {head ? <div className="ui-list-group" role="presentation">{head}</div> : null}
              <div
                id={`${id}-${i}`}
                data-i={i}
                role={kind === "listbox" ? "option" : "menuitem"}
                aria-selected={kind === "listbox" ? !!r.selected : undefined}
                aria-disabled={r.disabled || undefined}
                className={"ui-list-item" + (i === active ? " is-active" : "") + (r.danger ? " is-danger" : "") + (r.selected ? " is-selected" : "")}
                onMouseMove={() => { if (!r.disabled && active !== i) setActive(i); }}
                onClick={() => pick(i)}
              >
                {r.dot ? <span className="ui-dot" style={{ background: r.dot }} /> : r.icon ? <span className="ui-list-icon">{r.icon}</span> : null}
                <span className="ui-list-label">{r.label}</span>
                {r.hint ? <span className="ui-list-hint">{r.hint}</span> : null}
                {kind === "listbox" ? <span className="ui-list-check">{r.selected ? <Icon name="check" size={14} /> : null}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Popover>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Select: replaces the native <select>.
 * ------------------------------------------------------------------------------------------- */
export type SelectOption = { value: string; label: string; group?: string; dot?: string; icon?: ReactNode; hint?: ReactNode };

export function Select({ value, onChange, options, label, placeholder, disabled, className = "", block = false, align = "start", prefix }: {
  value: string; onChange: (v: string) => void; options: SelectOption[]; label: string;
  placeholder?: string; disabled?: boolean; className?: string; block?: boolean; align?: "start" | "end"; prefix?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  const close = useCallback(() => setOpen(false), []);
  const shown = current && (current.value !== "" || !placeholder) ? current : null;

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={"ui-select" + (block ? " is-block" : "") + (open ? " is-open" : "") + (shown ? "" : " is-placeholder") + (className ? " " + className : "")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); setOpen(true); } }}
      >
        {prefix ? <span className="ui-select-prefix">{prefix}</span> : null}
        {shown?.dot ? <span className="ui-dot" style={{ background: shown.dot }} /> : shown?.icon ? <span className="ui-list-icon">{shown.icon}</span> : null}
        <span className="ui-select-value">{shown ? shown.label : placeholder ?? current?.label ?? ""}</span>
        <Icon name="chevronUpDown" size={14} className="ui-select-chev" />
      </button>
      {open ? (
        <List
          anchor={btn}
          kind="listbox"
          label={label}
          align={align}
          matchWidth
          onClose={close}
          onPick={onChange}
          rows={options.map((o) => ({
            key: o.value, label: o.label, text: o.label, group: o.group, dot: o.dot, icon: o.icon, hint: o.hint,
            selected: o.value === value,
          }))}
        />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Menu: a button that opens a list of actions.
 * ------------------------------------------------------------------------------------------- */
export type MenuItem =
  | { label: string; onSelect: () => void; icon?: ReactNode; hint?: ReactNode; danger?: boolean; disabled?: boolean; checked?: boolean }
  | "sep"
  | { heading: string };

export function Menu({ label, items, children, className = "ui-icon-btn", align = "end", disabled }: {
  label: string; items: MenuItem[]; children: ReactNode; className?: string; align?: "start" | "end"; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const actions = new Map<string, () => void>();
  let group: string | undefined;
  const rows: Row[] = [];
  items.forEach((it, i) => {
    if (it === "sep") { rows.push({ key: "sep" + i, label: null, text: "", sep: true }); group = undefined; return; }
    if ("heading" in it) { group = it.heading; return; }
    const key = "i" + i;
    actions.set(key, it.onSelect);
    rows.push({
      key, label: it.label, text: it.label, hint: it.hint, danger: it.danger, disabled: it.disabled, group,
      icon: it.checked !== undefined ? <span className="ui-list-tick">{it.checked ? <Icon name="check" size={14} /> : null}</span> : it.icon,
    });
  });

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className + (open ? " is-open" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-tip={className.includes("ui-icon-btn") ? label : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
      >
        {children}
      </button>
      {open ? <List anchor={btn} kind="menu" label={label} align={align} onClose={close} onPick={(k) => actions.get(k)?.()} rows={rows} /> : null}
    </>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Segmented control: a small set of mutually exclusive choices shown side by side.
 * ------------------------------------------------------------------------------------------- */
export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; label: string; size?: "sm" | "md";
}) {
  return (
    <div className={"ui-seg is-" + size} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Confirm: an in-house replacement for window.confirm. `await confirmDialog({...})`.
 * ------------------------------------------------------------------------------------------- */
type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };
type ConfirmReq = ConfirmOpts & { resolve: (ok: boolean) => void };
const confirmHosts = new Set<(r: ConfirmReq) => void>();

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  if (!confirmHosts.size) return Promise.resolve(window.confirm(opts.title));
  return new Promise((resolve) => confirmHosts.forEach((h) => h({ ...opts, resolve })));
}

function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    const host = (r: ConfirmReq) => setReq(r);
    confirmHosts.add(host);
    return () => { confirmHosts.delete(host); };
  }, []);
  if (!req) return null;
  const done = (ok: boolean) => { req.resolve(ok); setReq(null); };
  return (
    <Modal
      title={req.title}
      size="sm"
      onClose={() => done(false)}
      foot={
        <>
          <span className="spacer" />
          <button className="ui-btn" type="button" onClick={() => done(false)}>Cancel</button>
          <button autoFocus className={"ui-btn " + (req.danger ? "ui-btn-danger" : "ui-btn-primary")} type="button" onClick={() => done(true)}>
            {req.confirmLabel ?? "Continue"}
          </button>
        </>
      }
    >
      {req.body ? <p className="ui-confirm-body">{req.body}</p> : null}
    </Modal>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Toasts.
 * ------------------------------------------------------------------------------------------- */
type ToastAction = { label: string; onClick: () => void };
type ToastMsg = { text: string; action?: ToastAction; id: number };
type Listener = (m: ToastMsg) => void;
const listeners = new Set<Listener>();
let toastSeq = 0;
/** Shows a toast. Pass `action` for an inline button, e.g. { label: "Undo", onClick }. */
export function toast(text: string, opts: { action?: ToastAction } = {}) {
  const m = { text, action: opts.action, id: ++toastSeq };
  listeners.forEach((l) => l(m));
}

function Toaster() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = useCallback(() => { clearTimeout(timer.current); setVisible(false); }, []);
  useEffect(() => {
    const show: Listener = (m) => {
      setMsg(m);
      setVisible(true);
      clearTimeout(timer.current);
      // Toasts with an action (Undo) stay a little longer so there's time to use it.
      timer.current = setTimeout(() => setVisible(false), m.action ? 6500 : Math.max(2400, m.text.length * 60));
    };
    listeners.add(show);
    return () => { listeners.delete(show); clearTimeout(timer.current); };
  }, []);
  if (!msg) return null;
  return createPortal(
    <div className={"ui-toast" + (visible ? " is-visible" : "") + (msg.action ? " has-action" : "")} role="status" aria-live="polite">
      <span>{msg.text}</span>
      {msg.action ? (
        <button type="button" className="ui-toast-action" onClick={() => { hide(); msg.action?.onClick(); }}>{msg.action.label}</button>
      ) : null}
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------------------------------------
 * Ticker: a number that counts to its new value instead of jumping. Accepts "12", "47%", "3 min".
 * ------------------------------------------------------------------------------------------- */
export function Ticker({ value, duration = 520 }: { value: string | number; duration?: number }) {
  const text = String(value);
  const m = /^(-?\d+)(.*)$/.exec(text);
  const target = m ? Number(m[1]) : NaN;
  const suffix = m ? m[2] : "";
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (Number.isNaN(target)) return;
    const start = from.current;
    if (start === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      const t = setTimeout(() => setShown(target), 0);
      return () => clearTimeout(t);
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(start + (target - start) * eased);
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  if (Number.isNaN(target)) return <>{text}</>;
  return <span className="ui-ticker">{shown}{suffix}</span>;
}

/** Mounts the toast and confirm hosts once for the whole portal. */
export function PortalHosts() {
  return <><Toaster /><ConfirmHost /></>;
}

export async function copyText(text: string, message = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    window.prompt("Copy this:", text);
  }
}

/* ---------------------------------------------------------------------------------------------
 * Theme: System / Light / Dark, remembered per browser. The <html data-theme> attribute is set
 * before first paint by the inline script in app/portal/page.tsx, so there's no flash.
 * ------------------------------------------------------------------------------------------- */
export type ThemePref = "system" | "light" | "dark";
export const THEME_KEY = "sul-portal-theme";

function readTheme(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref) {
  const d = document.documentElement;
  if (pref === "system") delete d.dataset.theme;
  else d.dataset.theme = pref;
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readTheme);
  const set = useCallback((p: ThemePref) => {
    setPref(p);
    applyTheme(p);
    try {
      if (p === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, p);
    } catch { /* private mode: still applies for this visit */ }
  }, []);
  return [pref, set] as const;
}

/** Marks the page as the portal app while mounted, so portal styles apply and the public site's
 *  cursor effects switch off. `fontClass` puts the portal font on <html>, so dialogs rendered on
 *  <body> get it too. */
export function usePortalDocument(fontClass?: string) {
  useEffect(() => {
    const d = document.documentElement;
    d.dataset.app = "portal";
    if (fontClass) d.classList.add(fontClass);
    applyTheme(readTheme());
    return () => {
      delete d.dataset.app;
      delete d.dataset.theme;
      if (fontClass) d.classList.remove(fontClass);
    };
  }, [fontClass]);
}
