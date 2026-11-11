"use client";

import { useState } from "react";
import { portalClient } from "@/lib/supabase";
import {
  SEND_META, emailSubject, inviteMessage, offerMessage, rejectionMessage,
  type Applicant, type SendKind,
} from "@/lib/portal";
import { Modal, copyText, toast } from "./ui";

/** The endpoint requires a committee session, so we pass the reviewer's access token. */
async function sendEmail(to: string, subject: string, text: string) {
  try {
    const { data } = await portalClient().auth.getSession();
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (data.session?.access_token ?? "") },
      body: JSON.stringify({ to, subject, text }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      toast("Couldn't send: " + (body.error || "HTTP " + res.status));
      return false;
    }
    return true;
  } catch (err) {
    toast("Couldn't send. Check your connection. (" + (err as Error)?.message + ")");
    return false;
  }
}

export function SendModal({ a, kind, onClose, onSent }: {
  a: Applicant; kind: SendKind; onClose: () => void; onSent: (a: Applicant, kind: SendKind) => Promise<void>;
}) {
  const [subject, setSubject] = useState(emailSubject(kind, a.role));
  const [body, setBody] = useState(
    kind === "invite" ? inviteMessage(a, a.booking.trim()) : kind === "offer" ? offerMessage(a) : rejectionMessage(a),
  );
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    if (!(await sendEmail(a.email, subject, body))) { setBusy(false); return; }
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
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => copyText(body)}>Copy instead</button>
          <span className="spacer" />
          <button className="btn btn-secondary btn-sm" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send email"}</button>
        </>
      }
    >
      <div className="crm-field"><label>To</label><input type="email" value={a.email} disabled /></div>
      <div className="crm-field"><label>Subject</label><input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
      <div className="crm-field"><label>Message</label><textarea style={{ minHeight: 220 }} value={body} onChange={(e) => setBody(e.target.value)} /></div>
    </Modal>
  );
}
