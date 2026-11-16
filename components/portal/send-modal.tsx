"use client";

import { useState } from "react";
import { portalClient } from "@/lib/supabase";
import { SEND_META, ago, inviteLink, sentEmails, sentGroup, type Applicant, type SendKind } from "@/lib/portal";
import { fillTemplate, type PortalSettings } from "@/lib/settings";
import { Icon } from "./icons";
import { Modal, confirmDialog, copyText, toast } from "./ui";

/** The endpoint requires a committee session, so we pass the reviewer's access token. */
export async function sendEmail(to: string, subject: string, text: string, settings: PortalSettings): Promise<string | null> {
  try {
    const { data } = await portalClient().auth.getSession();
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (data.session?.access_token ?? "") },
      body: JSON.stringify({ to, subject, text, fromName: settings.senderName, replyTo: settings.replyTo }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) return body.error || "HTTP " + res.status;
    return null;
  } catch (err) {
    return "Check your connection. (" + (err as Error)?.message + ")";
  }
}

export function draftFor(a: Applicant, kind: SendKind, settings: PortalSettings) {
  const tpl = settings.templates[kind];
  const link = inviteLink(a);
  return { subject: fillTemplate(tpl.subject, a, link), body: fillTemplate(tpl.body, a, link) };
}

export function SendModal({ a, kind: initialKind, settings, onClose, onSent }: {
  a: Applicant; kind: SendKind; settings: PortalSettings; onClose: () => void; onSent: (a: Applicant, kind: SendKind) => Promise<void>;
}) {
  const [kind, setKind] = useState<SendKind>(initialKind);
  const [subject, setSubject] = useState(() => draftFor(a, initialKind, settings).subject);
  const [body, setBody] = useState(() => draftFor(a, initialKind, settings).body);
  const [busy, setBusy] = useState(false);
  const isRejection = kind === "reject" || kind === "rejectScreen";
  const alreadySent = sentEmails(a)[sentGroup(kind)];

  function switchKind(k: SendKind) {
    if (k === kind) return;
    const d = draftFor(a, k, settings);
    setKind(k); setSubject(d.subject); setBody(d.body);
  }

  async function send() {
    if (alreadySent && !(await confirmDialog({ title: "Send this email again?", body: `${a.name || "This applicant"} was already sent this email ${ago(alreadySent)}.`, confirmLabel: "Send again" }))) return;
    setBusy(true);
    const err = await sendEmail(a.email, subject, body, settings);
    if (err) { toast("Couldn't send: " + err); setBusy(false); return; }
    await onSent(a, kind);
    toast(SEND_META[kind].logged);
    onClose();
  }

  return (
    <Modal
      title={SEND_META[kind].title}
      onClose={onClose}
      foot={
        <>
          <button className="ui-btn" type="button" onClick={() => copyText(body, "Email text copied")}><Icon name="copy" />Copy text</button>
          <span className="spacer" />
          <button className="ui-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="ui-btn ui-btn-primary" type="button" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send email"}</button>
        </>
      }
    >
      {alreadySent ? (
        <p className="crm-settings-warn" role="alert"><Icon name="alert" size={14} />Already sent {ago(alreadySent)}. Sending again will email them a second time.</p>
      ) : null}
      {isRejection ? (
        <div className="crm-seg" role="group" aria-label="Which rejection">
          {(["rejectScreen", "reject"] as SendKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => switchKind(k)}>{SEND_META[k].label}</button>
          ))}
        </div>
      ) : null}
      <div className="crm-field"><label>From</label><input type="text" value={settings.senderName + (settings.replyTo ? " (replies to " + settings.replyTo + ")" : "")} disabled /></div>
      <div className="crm-field"><label>To</label><input type="email" value={a.email} disabled /></div>
      <div className="crm-field"><label>Subject</label><input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
      <div className="crm-field"><label>Message</label><textarea style={{ minHeight: 220 }} value={body} onChange={(e) => setBody(e.target.value)} /></div>
    </Modal>
  );
}
