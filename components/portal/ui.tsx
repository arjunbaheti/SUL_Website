"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Modal + toast with the original portal's markup (.crm-modal / .crm-panel), styled by app/portal.css.

export function Modal({ title, onClose, children, foot }: {
  title: string; onClose: () => void; children: React.ReactNode; foot: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Render on <body>: inside <main> the modal is trapped in main's stacking layer, so the
  // footer (same layer, later in the page) painted over the bottom of it.
  return createPortal(
    <div className="crm-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="crm-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="crm-panel-head">
          <h3>{title}</h3>
          <button className="crm-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="crm-panel-body">{children}</div>
        <div className="crm-panel-foot">{foot}</div>
      </div>
    </div>,
    document.body,
  );
}

type Listener = (text: string) => void;
const listeners = new Set<Listener>();
export function toast(text: string) {
  listeners.forEach((l) => l(text));
}

export function Toaster() {
  const [text, setText] = useState("");
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show: Listener = (t) => {
      setText(t);
      setVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), Math.max(2200, t.length * 60));
    };
    listeners.add(show);
    return () => { listeners.delete(show); clearTimeout(timer); };
  }, []);
  if (!text) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 200,
        background: "#101a30", border: "1px solid rgba(255,255,255,0.22)", color: "#f4f7ff",
        padding: "0.6rem 1rem", borderRadius: 10, fontSize: "0.85rem", boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
        opacity: visible ? 1 : 0, transition: "opacity 0.2s ease",
      }}
    >
      {text}
    </div>,
    document.body,
  );
}

export async function copyText(text: string, message = "Invite copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    window.prompt("Copy this invite:", text);
  }
}
