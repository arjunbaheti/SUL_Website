"use client";

import { useCallback, useEffect, useState } from "react";
import { portalClient } from "@/lib/supabase";
import { Crm } from "./crm";
import { CursorTrail } from "./cursor-trail";
import { Icon } from "./icons";
import { PortalHosts, THEME_KEY, copyText, usePortalDocument } from "./ui";

// Sets the portal flag and the saved theme while the HTML is still parsing, so the first paint
// is already in the right theme. On client-side navigations the script doesn't run (React never
// executes inserted scripts) and usePortalDocument() covers it instead. Rendered as text/plain on
// the client so React doesn't warn about a script tag.
const themeBoot = (fontClass: string) => `(function(){try{var d=document.documentElement;d.dataset.app="portal";d.classList.add(${JSON.stringify(fontClass)});var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")d.dataset.theme=t;}catch(e){}})();`;

function ThemeBoot({ fontClass }: { fontClass: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: themeBoot(fontClass) }}
    />
  );
}

// Real sign-in via Supabase Auth, with a required second step: a 6-digit code from an
// authenticator app (TOTP). The first time a member signs in they set one up by scanning a QR
// code. Access is enforced by the database, not by this page: is_committee() (supabase/schema.sql)
// only answers yes for an allowlisted email on a session that has passed two-factor (aal2), and
// every committee table, the resumes bucket and the email route are gated by it.

type Step =
  | { kind: "checking" }
  | { kind: "out" }
  | { kind: "verify"; factorId: string }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "in" };

type Db = ReturnType<typeof portalClient>;

/** Given a signed-in session, works out what the member has to do next. */
async function nextStep(db: Db): Promise<Step | { error: string }> {
  const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    const { data: factors, error: listErr } = await db.auth.mfa.listFactors();
    if (listErr) return { error: "Couldn't check two-factor: " + listErr.message };
    const verified = factors?.totp?.[0];
    if (verified) return { kind: "verify", factorId: verified.id };
    // First time: clear any half-finished set-up, then start a fresh one.
    for (const f of factors?.all ?? []) {
      if (f.factor_type === "totp" && f.status !== "verified") await db.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data: en, error: enErr } = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "Committee portal" });
    if (enErr || !en) return { error: "Couldn't start two-factor set-up: " + (enErr?.message ?? "unknown error") };
    return { kind: "enroll", factorId: en.id, qr: en.totp.qr_code, secret: en.totp.secret };
  }
  const { data, error } = await db.rpc("is_committee");
  if (error || data !== true) {
    await db.auth.signOut();
    return { error: "This account isn't on the committee reviewer list." };
  }
  return { kind: "in" };
}

function CodeInput({ onComplete, busy }: { onComplete: (code: string) => void; busy: boolean }) {
  const [code, setCode] = useState("");
  return (
    <input
      className="ui-input auth-code"
      autoFocus
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      placeholder="000000"
      aria-label="6-digit code"
      disabled={busy}
      value={code}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "").slice(0, 6);
        setCode(v);
        if (v.length === 6) { onComplete(v); setCode(""); }
      }}
    />
  );
}

export function PortalGate({ fontClass }: { fontClass: string }) {
  usePortalDocument(fontClass);
  const [step, setStep] = useState<Step>({ kind: "checking" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const advance = useCallback(async () => {
    const r = await nextStep(portalClient());
    if ("error" in r) { setError(r.error); setStep({ kind: "out" }); }
    else { setError(""); setStep(r); }
  }, []);

  useEffect(() => {
    const db = portalClient();
    let alive = true;
    // Resume an existing session on page load (it may still need its two-factor code).
    db.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      if (!data.session) { setStep({ kind: "out" }); return; }
      await advance();
    });
    // Signed out elsewhere (other tab, expired session): drop back to the login form.
    const { data: sub } = db.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setStep({ kind: "out" });
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [advance]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = e.currentTarget;
    const email = (form.elements.namedItem("username") as HTMLInputElement).value.trim();
    const pw = form.elements.namedItem("password") as HTMLInputElement;
    const { error: err } = await portalClient().auth.signInWithPassword({ email, password: pw.value });
    if (err) {
      setError("Incorrect email or password.");
      pw.value = "";
      pw.focus();
    } else {
      form.reset();
      await advance();
    }
    setBusy(false);
  }

  async function submitCode(factorId: string, code: string) {
    setError("");
    setBusy(true);
    const { error: err } = await portalClient().auth.mfa.challengeAndVerify({ factorId, code });
    if (err) setError(/invalid|expired/i.test(err.message) ? "That code didn't work. Try the newest one." : err.message);
    else await advance();
    setBusy(false);
  }

  async function startOver() {
    await portalClient().auth.signOut();
    setError("");
    setStep({ kind: "out" });
  }

  const card = (body: React.ReactNode) => (
    <div className="auth">
      <div className="auth-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand mark */}
        <img className="auth-mark brand-wordmark" src="/img/logo.png" alt="StartUp Link UniMelb" width={898} height={315} />
        {body}
        <p className="auth-error" role="alert" aria-live="assertive">{error}</p>
      </div>
      <a className="auth-back" href="/">← Back to the website</a>
    </div>
  );

  let view: React.ReactNode;
  if (step.kind === "in") view = <Crm />;
  else if (step.kind === "checking") view = <div className="auth" aria-busy="true" />;
  else if (step.kind === "verify") {
    view = card(
      <>
        <h1>Two-factor code</h1>
        <p className="auth-lead">Enter the 6-digit code from your authenticator app.</p>
        <CodeInput busy={busy} onComplete={(c) => submitCode(step.factorId, c)} />
        <button className="auth-link" type="button" onClick={startOver}>Use a different account</button>
      </>,
    );
  } else if (step.kind === "enroll") {
    view = card(
      <>
        <h1>Set up two-factor</h1>
        <p className="auth-lead">Scan with an authenticator app (Google Authenticator, 1Password, Authy…), then enter the code it shows.</p>
        <div className="auth-qr">
          {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL from Supabase */}
          <img src={step.qr} alt="Two-factor QR code" width={168} height={168} />
        </div>
        <button className="auth-secret" type="button" onClick={() => copyText(step.secret, "Set-up key copied")} data-tip="Copy">
          <code>{step.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          <Icon name="copy" size={14} />
        </button>
        <CodeInput busy={busy} onComplete={(c) => submitCode(step.factorId, c)} />
        <button className="auth-link" type="button" onClick={startOver}>Use a different account</button>
      </>,
    );
  } else {
    view = card(
      <>
        <h1>Committee portal</h1>
        <form onSubmit={onSubmit}>
          <label className="ui-label" htmlFor="username">Email</label>
          <input className="ui-input" type="email" id="username" name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} />
          <label className="ui-label" htmlFor="password">Password</label>
          <input className="ui-input" type="password" id="password" name="password" required autoComplete="current-password" />
          <button className="ui-btn ui-btn-primary ui-btn-lg is-block" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </>,
    );
  }

  return (
    <>
      <ThemeBoot fontClass={fontClass} />
      {view}
      <PortalHosts />
      <CursorTrail />
    </>
  );
}
