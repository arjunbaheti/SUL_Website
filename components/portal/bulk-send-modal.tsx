"use client";

import { useMemo, useRef, useState } from "react";
import { SEND_META, ago, rejectionKind, sentEmails, sentGroup, type Applicant, type SendKind } from "@/lib/portal";
import { fillTemplate, type PortalSettings } from "@/lib/settings";
import { draftFor, sendEmail } from "./send-modal";
import { Modal, confirmDialog } from "./ui";

// Sends the same kind of email to many applicants, one at a time, using the saved templates.
// Gmail allows roughly 500 messages a day on a normal account (2,000 on Google Workspace), so a
// single batch is capped well under that.
export const MAX_BATCH = 300;

export type BulkKind = "invite" | "offer" | "reject";
const CHOICES: { id: BulkKind; label: string }[] = [
  { id: "invite", label: "Interview invite" },
  { id: "offer", label: "Offer" },
  { id: "reject", label: "Rejection" },
];

type Plan = { a: Applicant; kind: SendKind; skip: string; sentAt?: string };
type Result = "sent" | string; // "sent" or the error message

export function BulkSendModal({ applicants, initialKind, settings, onClose, onSent }: {
  applicants: Applicant[]; initialKind: BulkKind; settings: PortalSettings;
  onClose: () => void; onSent: (a: Applicant, kind: SendKind) => Promise<void>;
}) {
  const [choice, setChoice] = useState<BulkKind>(initialKind);
  const [resend, setResend] = useState(false);
  const [phase, setPhase] = useState<"review" | "sending" | "done">("review");
  const [results, setResults] = useState<Record<string, Result>>({});
  const stop = useRef(false);

  const plan: Plan[] = useMemo(() => applicants.map((a) => {
    const kind: SendKind = choice === "reject" ? rejectionKind(a) : choice;
    const sentAt = sentEmails(a)[sentGroup(kind)];
    let skip = "";
    if (!a.email) skip = "No email address";
    else if (kind === "invite" && !a.booking.trim()) skip = "No zcal link yet";
    else if (sentAt && !resend) skip = "Already sent " + ago(sentAt);
    return { a, kind, skip, sentAt };
  }), [applicants, choice, resend]);

  const ready = plan.filter((p) => !p.skip);
  const toSend = ready.slice(0, MAX_BATCH);
  const kindsUsed = [...new Set(ready.map((p) => p.kind))];
  const sentCount = Object.values(results).filter((r) => r === "sent").length;
  const failCount = Object.values(results).filter((r) => r !== "sent").length;
  const doneCount = sentCount + failCount;

  async function run() {
    if (!toSend.length) return;
    const noun = choice === "reject" ? "rejection" : choice === "offer" ? "offer" : "interview invite";
    if (!(await confirmDialog({ title: `Email ${toSend.length} ${noun}${toSend.length === 1 ? "" : "s"} now?`, body: "Emails go out one at a time from the club Gmail. This can't be undone.", confirmLabel: `Send ${toSend.length}` }))) return;
    stop.current = false;
    setPhase("sending");
    for (const p of toSend) {
      if (stop.current) break;
      const d = draftFor(p.a, p.kind, settings);
      const err = await sendEmail(p.a.email, d.subject, d.body, settings);
      if (!err) await onSent(p.a, p.kind);
      setResults((r) => ({ ...r, [p.a.id]: err ? err : "sent" }));
    }
    setPhase("done");
  }

  async function close() {
    if (phase === "sending") {
      if (!(await confirmDialog({ title: "Stop sending?", body: "Emails already sent stay sent.", confirmLabel: "Stop sending", danger: true }))) return;
      stop.current = true;
      return;
    }
    onClose();
  }

  const sample = ready[0]?.a ?? applicants[0];

  return (
    <Modal
      title={`Email ${applicants.length} applicant${applicants.length === 1 ? "" : "s"}`}
      onClose={close}
      foot={
        phase === "review" ? (
          <>
            <span className="crm-help" style={{ margin: 0 }}>Uses the templates in Settings.</span>
            <span className="spacer" />
            <button className="ui-btn" type="button" onClick={onClose}>Cancel</button>
            <button className="ui-btn ui-btn-primary" type="button" disabled={!toSend.length} onClick={run}>
              Send {toSend.length} email{toSend.length === 1 ? "" : "s"}
            </button>
          </>
        ) : phase === "sending" ? (
          <>
            <span className="crm-help" style={{ margin: 0 }}>Keep this tab open until it finishes.</span>
            <span className="spacer" />
            <button className="ui-btn" type="button" onClick={() => { stop.current = true; }}>Stop</button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <button className="ui-btn ui-btn-primary" type="button" onClick={onClose}>Done</button>
          </>
        )
      }
    >
      {phase === "review" ? (
        <>
          <div className="crm-seg" role="group" aria-label="Which email">
            {CHOICES.map((c) => (
              <button key={c.id} type="button" aria-pressed={choice === c.id} onClick={() => setChoice(c.id)}>{c.label}</button>
            ))}
          </div>
          {choice === "reject" && kindsUsed.length ? (
            <p className="crm-help">
              Picks the right rejection for each person:{" "}
              {ready.filter((p) => p.kind === "rejectScreen").length} not interviewed,{" "}
              {ready.filter((p) => p.kind === "reject").length} after interview.
            </p>
          ) : null}
          {sample && kindsUsed.length ? (
            <div className="crm-field">
              <label>Preview{kindsUsed.length > 1 ? " (" + SEND_META[kindsUsed[0]].label + ")" : ""} for {sample.name || "first applicant"}</label>
              <div className="crm-preview" style={{ maxHeight: 200 }}>
                <div className="crm-preview-subject">{fillTemplate(settings.templates[kindsUsed[0]].subject, sample, sample.booking)}</div>
                <div className="crm-preview-body">{fillTemplate(settings.templates[kindsUsed[0]].body, sample, sample.booking)}</div>
              </div>
            </div>
          ) : null}
          <label className="crm-check">
            <input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} />
            Also email people who were already sent this
          </label>
          {ready.length > MAX_BATCH ? (
            <p className="crm-settings-warn">
              Only the first {MAX_BATCH} will be sent in this batch, to stay under Gmail&apos;s daily limit. Send the rest tomorrow.
            </p>
          ) : null}
        </>
      ) : (
        <div className="crm-progress" role="status" aria-live="polite">
          <div className="crm-progress-bar"><span style={{ width: `${toSend.length ? (doneCount / toSend.length) * 100 : 0}%` }} /></div>
          <p>
            {phase === "sending" ? "Sending… " : doneCount < toSend.length ? "Stopped. " : "Finished. "}
            {sentCount} sent{failCount ? `, ${failCount} failed` : ""} of {toSend.length}.
          </p>
        </div>
      )}

      <div className="crm-bulk-list">
        {plan.map((p) => {
          const r = results[p.a.id];
          const state = r === "sent" ? "Sent" : r ? "Failed: " + r : p.skip ? "Skipped: " + p.skip : phase === "review" ? SEND_META[p.kind].label : "Waiting";
          return (
            <div className={"crm-bulk-row" + (p.skip ? " skip" : "") + (r && r !== "sent" ? " fail" : "")} key={p.a.id}>
              <span className="n">{p.a.name || "Unnamed"}</span>
              <span className="e">{p.a.email || "—"}</span>
              <span className="s">{state}</span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
