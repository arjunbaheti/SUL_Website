"use client";

import { useState } from "react";
import { SEND_META, fmtDateTime } from "@/lib/portal";
import {
  DEFAULT_SETTINGS, EMAIL_KEYS, PLACEHOLDERS, fillTemplate, saveSettings,
  type EmailKey, type PortalSettings, type SettingsMeta,
} from "@/lib/settings";
import { Modal, confirmDialog, toast } from "./ui";

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
  checked: boolean; onChange: (v: boolean) => void; title: string; help?: string;
}) {
  return (
    <label className="crm-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="crm-toggle-track" aria-hidden="true"><span /></span>
      <span className="crm-toggle-text"><strong>{title}</strong>{help ? <span>{help}</span> : null}</span>
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

  async function close() {
    if (dirty && !(await confirmDialog({ title: "Discard unsaved changes?", body: "Your edits to the settings haven't been saved.", confirmLabel: "Discard", danger: true }))) return;
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
      size="lg"
      onClose={close}
      foot={
        <>
          <span className="crm-help" style={{ margin: 0 }}>
            {meta.updatedAt ? <>Last saved {fmtDateTime(meta.updatedAt)}{meta.updatedBy ? " by " + meta.updatedBy : ""}</> : null}
          </span>
          <span className="spacer" />
          <button className="ui-btn" type="button" onClick={close}>Cancel</button>
          <button className="ui-btn ui-btn-primary" type="button" disabled={busy || !dirty || meta.missingTable} onClick={save}>
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
          {kind === "received" ? (
            <Toggle
              checked={s.confirmationEnabled}
              onChange={(v) => setS((p) => ({ ...p, confirmationEnabled: v }))}
              title="Send this automatically when someone applies"
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
            <button className="ui-btn" type="button" onClick={() => setPreview((v) => !v)}>
              {preview ? "Edit" : "Preview with sample applicant"}
            </button>
            <button
              className="ui-btn"
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
          </div>
          <div className="crm-field">
            <label htmlFor="set-reply">Reply-to address (optional)</label>
            <input
              id="set-reply"
              type="email"
              maxLength={254}
              placeholder="Blank = club Gmail"
              value={s.replyTo}
              aria-invalid={!replyOk}
              onChange={(e) => setS((p) => ({ ...p, replyTo: e.target.value }))}
            />
            {replyOk ? null : <div className="crm-help" style={{ color: "var(--red)" }}>That doesn&apos;t look like an email address.</div>}
          </div>
        </>
      ) : null}

      {tab === "board" ? (
        <>
          <Toggle
            checked={s.autoInvitedAfterSend}
            onChange={(v) => setS((p) => ({ ...p, autoInvitedAfterSend: v }))}
            title="Move to “Interview invited” after sending an invite"
          />
          <Toggle
            checked={s.ratingMovesStage}
            onChange={(v) => setS((p) => ({ ...p, ratingMovesStage: v }))}
            title="Interview rating moves the applicant"
            help="Yes → Offer · Maybe → Waitlist · No → Rejected"
          />
        </>
      ) : null}

      {tab === "data" ? (
        <>
          <div className="crm-data-step">
            <strong>1. Download a backup</strong>
            <p>JSON and CSV. Resume files aren&apos;t included.</p>
            <button className="ui-btn" type="button" onClick={() => { onExport(); setExported(true); }}>
              {exported ? "Downloaded · download again" : "Download backup"}
            </button>
          </div>
          <div className={"crm-data-step danger" + (exported ? "" : " is-locked")}>
            <strong>2. Delete data</strong>
            <p>
              <b>Files only</b> keeps the board. <b>Everything</b> also removes all {applicantCount} applicant{applicantCount === 1 ? "" : "s"}. Can&apos;t be undone.
            </p>
            <div className="crm-field" style={{ marginBottom: "0.6rem" }}>
              <label htmlFor="set-confirm">Type DELETE to confirm</label>
              <input id="set-confirm" type="text" autoComplete="off" disabled={!exported || !!purging} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </div>
            <div className="crm-settings-actions">
              {(["files", "everything"] as PurgeMode[]).map((m) => (
                <button
                  key={m}
                  className={"ui-btn" + (m === "everything" ? " ui-btn-danger" : "")}
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
