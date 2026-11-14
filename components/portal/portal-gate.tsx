"use client";

import { useEffect, useState } from "react";
import { portalClient } from "@/lib/supabase";
import { Crm } from "./crm";
import { CursorTrail } from "./cursor-trail";
import { PortalHosts, THEME_KEY, usePortalDocument } from "./ui";

// Sets the portal flag and the saved theme while the HTML is still parsing, so the first paint
// is already in the right theme. On client-side navigations the script doesn't run (React never
// executes inserted scripts) and usePortalDocument() covers it instead. Rendered as text/plain on
// the client so React doesn't warn about a script tag.
const THEME_BOOT = `(function(){try{var d=document.documentElement;d.dataset.app="portal";var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")d.dataset.theme=t;}catch(e){}})();`;

function ThemeBoot() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_BOOT }}
    />
  );
}

// Real sign-in via Supabase Auth. Access is enforced by the database (Row Level Security plus
// the committee_members allowlist in supabase/schema.sql), not by this page: even if someone
// forced the portal view open they would get no data without a valid committee session.
export function PortalGate() {
  usePortalDocument();
  const [state, setState] = useState<"checking" | "out" | "in">("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const db = portalClient();
    const isCommittee = async () => {
      const { data, error: err } = await db.rpc("is_committee");
      return !err && data === true;
    };
    let alive = true;
    // Resume an existing session on page load.
    db.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      if (!data.session) { setState("out"); return; }
      if (await isCommittee()) { if (alive) setState("in"); }
      else { await db.auth.signOut(); if (alive) setState("out"); }
    });
    // Signed out elsewhere (other tab, expired session): drop back to the login form.
    const { data: sub } = db.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setState("out");
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = e.currentTarget;
    const db = portalClient();
    const email = (form.elements.namedItem("username") as HTMLInputElement).value.trim();
    const pw = form.elements.namedItem("password") as HTMLInputElement;
    const { error: err } = await db.auth.signInWithPassword({ email, password: pw.value });
    let message = "";
    if (err) message = "Incorrect email or password.";
    else {
      const { data, error: rpcErr } = await db.rpc("is_committee");
      if (rpcErr || data !== true) {
        await db.auth.signOut();
        message = "This account isn't on the committee reviewer list.";
      }
    }
    if (message) {
      setError(message);
      pw.value = "";
      pw.focus();
    } else {
      form.reset();
      setState("in");
    }
    setBusy(false);
  }

  return (
    <>
      <ThemeBoot />
      {state === "in" ? <Crm /> : (
        <div className="auth" aria-busy={state === "checking"}>
          <div className="auth-card" hidden={state === "checking"}>
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand mark */}
            <img className="auth-mark" src="/icon.png" alt="" width={40} height={40} />
            <h1>Committee portal</h1>
            <p className="auth-sub">StartUp Link UniMelb · committee and executives only</p>
            <form onSubmit={onSubmit}>
              <label className="ui-label" htmlFor="username">Email</label>
              <input className="ui-input" type="email" id="username" name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} />
              <label className="ui-label" htmlFor="password">Password</label>
              <input className="ui-input" type="password" id="password" name="password" required autoComplete="current-password" />
              <button className="ui-btn ui-btn-primary ui-btn-lg is-block" type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
              <p className="auth-error" role="alert" aria-live="assertive">{error}</p>
            </form>
          </div>
          <a className="auth-back" href="/">← Back to the website</a>
        </div>
      )}
      <PortalHosts />
      <CursorTrail />
    </>
  );
}
