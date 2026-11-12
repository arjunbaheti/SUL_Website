"use client";

import { useState } from "react";
import { SEND_META, fmtDateTime } from "@/lib/portal";
import {
  DEFAULT_SETTINGS, EMAIL_KEYS, PLACEHOLDERS, fillTemplate, saveSettings,
  type EmailKey, type PortalSettings, type SettingsMeta,
} from "@/lib/settings";
import { Modal, toast } from "./ui";

const TABS = [
  { id: "emails", label: "Emails" },
  { id: "sender", label: "Sender" },
  { id: "board", label: "Board" },
  { id: "data", label: "Data" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const EMAIL_LABEL: Record<EmailKey, string> = {
  received: "Application received",
  invite: SEND_META.invite.label,
  offer: SEND_META.offer.label,
  reject: SEND_META.reject.label,
  rejectScreen: SEND_META.rejectScreen.label,
};
const SAMPLE = { name: "Alex Chen", role: "Marketing" };
const SAMPLE_LINK = "https://zcal.co/i/example";

function Toggle({ checked, onChange, title, help }: {
  checked: boolean; onChange: (v: boolean) => void; title: string; help: string;
}) {
  return (
    <label className="crm-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="crm-toggle-track" aria-hidden="true"><span /></span>
      <span className="crm-toggle-text"><strong>{title}</strong><span>{help}</span></span>
    </label>
  );
}

export type PurgeMode = "files" | "everything";

export function SettingsModal({ initial, meta, applicantCount, onClose, onSaved, onExport, onPurge }: {
  initial: PortalSettings; meta: SettingsMeta; applicantCount: number;
  onClose: () => void; onSaved: (s: PortalSettings) => void;
  onExport: () => void; onPurge: (mode: PurgeMode) => Promise<string>;
}) {
  const [s, setS] = useState<PortalSettings>(initial);
  const [tab, setTab] = useState<Tab>("emails");
  const [kind, setKind] = useState<EmailKey>("received");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [purging, setPurging] = useState<PurgeMode | null>(null);
  const [purgeResult, setPurgeResult] = useState("");
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  const tpl = s.templates[kind];
  const setTpl = (k: "subject" | "body", v: string) =>
    setS((p) => ({ ...p, templates: { ...p.templates, [kind]: { ...p.templates[kind], [k]: v } } }));
  const isDefault = tpl.subject === DEFAULT_SETTINGS.templates[kind].subject && tpl.body === DEFAULT_SETTINGS.templates[kind].body;
  const replyOk = !s.replyTo.trim() || /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s.replyTo.trim());
  const inviteMissingLink = !s.templates.invite.body.includes("{link}");

  function close() {
    if (dirty && !window.confirm("Discard your unsaved settings changes?")) return;
    onClose();
  }

  async function save() {
    if (!replyOk) { setTab("sender"); toast("The reply-to address doesn't look like an email."); return; }
    if (!s.senderName.trim()) { setTab("sender"); toast("Sender name can't be empty."); return; }
    setBusy(true);
    const err = await saveSettings(s);
    setBusy(false);
    if (err) { toast("Couldn't save settings: " + err); return; }
    onSaved(s);
    toast("Settings saved for the whole committee");
    onClose();
  }

  return (
    <Modal
      title="Settings"
      onClose={close}
      foot={
        <>
          <span className="crm-help" style={{ margin: 0 }}>
            {meta.updatedAt ? <>Last saved {fmtDateTime(meta.updatedAt)}{meta.updatedBy ? " by " + meta.updatedBy : ""}</> : "Shared by all committee reviewers"}
          </span>
          <span className="spacer" />
          <button className="btn btn-secondary btn-sm" type="button" onClick={close}>Cancel</button>
          <button className="btn btn-primary btn-sm" type="button" disabled={busy || !dirty || meta.missingTable} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      {meta.missingTable ? (
        <p className="crm-settings-warn" role="alert">
          Settings can&apos;t be saved yet: the <code>portal_settings</code> table doesn&apos;t exist. Run the
          &quot;Portal settings&quot; section of <code>supabase/schema.sql</code> in the Supabase SQL editor, then reload.
          Until then the portal uses the default emails below.
        </p>
      ) : null}

      <div className="crm-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === "emails" ? (
        <>
          <div className="crm-seg" role="group" aria-label="Which email">
            {EMAIL_KEYS.map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{EMAIL_LABEL[k]}</button>
            ))}
          </div>
          <p className="crm-help">
            {kind === "received"
              ? "Sent automatically the moment someone submits the application form."
              : kind === "reject"
              ? "Sent to applicants rejected after an interview."
              : kind === "rejectScreen"
                ? "Sent to applicants rejected before an interview (screened out). The portal picks the right rejection automatically."
                : <>Used as the starting text when someone clicks <strong>{SEND_META[kind].button}</strong>.</>}
            {kind === "received" ? null : " You can still tweak each email before it goes out."}
          </p>
          {kind === "received" ? (
            <Toggle
              checked={s.confirmationEnabled}
              onChange={(v) => setS((p) => ({ ...p, confirmationEnabled: v }))}
              title="Send this automatically when someone applies"
              help="Turn off to stop confirmation emails (for example, if Gmail's daily limit is getting close)."
            />
          ) : null}
          <div className="crm-field">
            <label htmlFor="set-subject">Subject</label>
            <input id="set-subject" type="text" maxLength={200} value={tpl.subject} onChange={(e) => setTpl("subject", e.target.value)} />
          </div>
          <div className="crm-field">
            <label htmlFor="set-body">Message</label>
            {preview ? (
              <div className="crm-preview">
                <div className="crm-preview-subject">{fillTemplate(tpl.subject, SAMPLE)}</div>
                <div className="crm-preview-body">{fillTemplate(tpl.body, SAMPLE, SAMPLE_LINK)}</div>
              </div>
            ) : (
              <textarea id="set-body" style={{ minHeight: 280 }} maxLength={8000} value={tpl.body} onChange={(e) => setTpl("body", e.target.value)} />
            )}
          </div>
          {kind === "invite" && inviteMissingLink ? (
            <p className="crm-settings-warn">The invite doesn&apos;t include <code>{"{link}"}</code>, so applicants won&apos;t get their booking link.</p>
          ) : null}
          <div className="crm-placeholders">
            <span>Placeholders:</span>
            {PLACEHOLDERS.map((p) => (
              <code key={p.key} title={p.help}>{p.key}</code>
            ))}
          </div>
          <div className="crm-settings-actions">
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setPreview((v) => !v)}>
              {preview ? "Edit" : "Preview with sample applicant"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={isDefault}
              onClick={() => setS((p) => ({ ...p, templates: { ...p.templates, [kind]: { ...DEFAULT_SETTINGS.templates[kind] } } }))}
            >
              Reset to default
            </button>
          </div>
        </>
      ) : null}

      {tab === "sender" ? (
        <>
          <div className="crm-field">
            <label htmlFor="set-from">Sender name</label>
            <input id="set-from" type="text" maxLength={80} value={s.senderName} onChange={(e) => setS((p) => ({ ...p, senderName: e.target.value }))} />
            <div className="crm-help">Shown as the &quot;From&quot; name in applicants&apos; inboxes. Emails still come from the club Gmail account.</div>
          </div>
          <div className="crm-field">
            <label htmlFor="set-reply">Reply-to address (optional)</label>
            <input
              id="set-reply"
              type="email"
              maxLength={254}
              placeholder="Leave blank to use the club Gmail"
              value={s.replyTo}
              aria-invalid={!replyOk}
              onChange={(e) => setS((p) => ({ ...p, replyTo: e.target.value }))}
            />
            <div className="crm-help" style={!replyOk ? { color: "#ff8a8a" } : undefined}>
              {replyOk ? "Where applicants' replies go, e.g. a People & Culture inbox." : "That doesn't look like an email address."}
            </div>
          </div>
        </>
      ) : null}

      {tab === "board" ? (
        <>
          <Toggle
            checked={s.autoInvitedAfterSend}
            onChange={(v) => setS((p) => ({ ...p, autoInvitedAfterSend: v }))}
            title="Move to “Interview invited” after sending an invite"
            help="When an invite is emailed to someone in Under review, move their card along automatically."
          />
          <Toggle
            checked={s.ratingMovesStage}
            onChange={(v) => setS((p) => ({ ...p, ratingMovesStage: v }))}
            title="Interview rating moves the applicant"
            help="Rating Yes moves them to Offer, Maybe to Waitlist, and No to Rejected."
          />
        </>
      ) : null}

      {tab === "data" ? (
        <>
          <p className="crm-help" style={{ marginTop: 0 }}>
            At the end of recruitment, keep a copy and then delete applicants&apos; personal data. Applicants only agreed to
            their details being used for this recruitment round, so don&apos;t hold resumes longer than you need them.
          </p>
          <div className="crm-data-step">
            <strong>1. Download a backup</strong>
            <p>Saves every applicant, note and vote as JSON and CSV (files themselves aren&apos;t included).</p>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => { onExport(); setExported(true); }}>
              {exported ? "Downloaded ✓ (download again)" : "Download backup"}
            </button>
          </div>
          <div className={"crm-data-step danger" + (exported ? "" : " is-locked")}>
            <strong>2. Delete data</strong>
            <p>
              <b>Delete files only</b> removes every resume and attachment but keeps the board.{" "}
              <b>Delete everything</b> also removes all {applicantCount} applicant{applicantCount === 1 ? "" : "s"}, their notes and votes.
              This can&apos;t be undone.
            </p>
            <div className="crm-field" style={{ marginBottom: "0.6rem" }}>
              <label htmlFor="set-confirm">Type DELETE to confirm</label>
              <input id="set-confirm" type="text" autoComplete="off" disabled={!exported || !!purging} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </div>
            <div className="crm-settings-actions">
              {(["files", "everything"] as PurgeMode[]).map((m) => (
                <button
                  key={m}
                  className={"btn btn-sm " + (m === "everything" ? "btn-danger" : "btn-secondary")}
                  type="button"
                  disabled={!exported || confirmText !== "DELETE" || !!purging}
                  onClick={async () => {
                    setPurging(m);
                    setPurgeResult("");
                    const msg = await onPurge(m);
                    setPurgeResult(msg);
                    setPurging(null);
                    setConfirmText("");
                  }}
                >
                  {purging === m ? "Deleting…" : m === "files" ? "Delete files only" : "Delete everything"}
                </button>
              ))}
            </div>
            {!exported ? <p className="crm-help" style={{ marginBottom: 0 }}>Download the backup first.</p> : null}
            {purgeResult ? <p className="crm-help" role="status" style={{ marginBottom: 0 }}>{purgeResult}</p> : null}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
