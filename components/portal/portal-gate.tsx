"use client";

import { useEffect, useState } from "react";
import { portalClient } from "@/lib/supabase";
import { Crm } from "./crm";
import { Toaster } from "./ui";

// Real sign-in via Supabase Auth. Access is enforced by the database (Row Level Security plus
// the committee_members allowlist in supabase/schema.sql), not by this page: even if someone
// forced the portal view open they would get no data without a valid committee session.
export function PortalGate() {
  const [signedIn, setSignedIn] = useState(false);
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
      if (!alive || !data.session) return;
      if (await isCommittee()) setSignedIn(true);
      else await db.auth.signOut();
    });
    // Signed out elsewhere (other tab, expired session): drop back to the login form.
    const { data: sub } = db.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setSignedIn(false);
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
      setSignedIn(true);
    }
    setBusy(false);
  }

  return (
    <>
      <section className="section" id="login-view" style={{ paddingBottom: "1rem" }} hidden={signedIn}>
        <div className="container" style={{ maxWidth: 460 }}>
          <div className="section-head">
            <h2>Committee Portal Sign In</h2>
            <p>Intended for Committee and Executives only.</p>
          </div>
          <form className="card" id="portal-login" onSubmit={onSubmit}>
            <div className="form-field">
              <label htmlFor="username">Committee email</label>
              <input type="email" id="username" name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} />
            </div>
            <div className="form-field">
              <label htmlFor="password">Password</label>
              <input type="password" id="password" name="password" required autoComplete="current-password" />
            </div>
            <button className="btn btn-primary btn-block" type="submit" id="login-submit" disabled={busy}>Sign in</button>
            <p className="form-hint" id="login-error" role="alert" aria-live="assertive" style={{ color: "#ff8a8a" }}>{error}</p>
          </form>
        </div>
      </section>

      {signedIn ? (
        <section className="section" id="portal-view">
          <div className="container container-wide">
            <div className="crm-wrap"><div id="crm-root"><Crm /></div></div>
          </div>
        </section>
      ) : null}
      <Toaster />
    </>
  );
}
