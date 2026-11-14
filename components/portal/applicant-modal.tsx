"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { portalClient } from "@/lib/supabase";
import {
  RATINGS, STAGES, STAGE_BY_ID, fmtDate, fmtDateTime, fmtSize, interviewUnlocked, noteFromRow, voteTally,
  safeLink, type Applicant, type Note, type Conflict, type RatingId, type StageId, type Vote,
} from "@/lib/portal";
import { FileViewer } from "./file-viewer";
import { Icon } from "./icons";
import { Modal, Select, confirmDialog, toast } from "./ui";

// Fields the committee can edit -> database column. Only changed fields are sent, so two
// reviewers editing different fields don't clobber each other.
const EDITABLE = {
  booking: "booking", status: "status", rating: "rating", secondChoiceFlag: "second_choice_flag",
} as const;
type Editable = keyof typeof EDITABLE;

function changes(orig: Applicant, draft: Applicant) {
  const out: Record<string, string | boolean> = {};
  (Object.keys(EDITABLE) as Editable[]).forEach((k) => {
    const o = orig[k], d = draft[k];
    if (typeof d === "boolean") { if (!!o !== d) out[EDITABLE[k]] = d; }
    else if ((o || "") !== (d || "")) out[EDITABLE[k]] = d || "";
  });
  return out;
}

const VOTE_LABEL: Record<Vote["vote"], string> = { yes: "Yes", maybe: "Maybe", no: "No" };

type MyVote = Vote["vote"] | "conflict" | "";

/** Each reviewer's screening vote: decides who gets an interview. Saves the moment you click.
 *  A reviewer who knows the applicant can declare a conflict instead: that replaces their vote,
 *  doesn't count towards the tally, and is shown to everyone. */
function Screening({ a, me }: { a: Applicant; me: string }) {
  const mine0: MyVote = a.conflicts.some((c) => c.reviewer === me) ? "conflict" : a.votes.find((v) => v.reviewer === me)?.vote ?? "";
  const [mine, setMine] = useState<MyVote>(mine0);
  const [saving, setSaving] = useState(false);
  const now = new Date().toISOString();
  const votes: Vote[] = [
    ...a.votes.filter((v) => v.reviewer !== me),
    ...(mine && mine !== "conflict" ? [{ reviewer: me, vote: mine, updatedAt: now }] : []),
  ];
  const conflicts: Conflict[] = [
    ...a.conflicts.filter((c) => c.reviewer !== me),
    ...(mine === "conflict" ? [{ reviewer: me, updatedAt: now }] : []),
  ];
  const t = voteTally(votes);
  const iConflict = mine === "conflict";

  async function save(next: MyVote) {
    if (!me || saving) return;
    const prev = mine;
    setMine(next);
    setSaving(true);
    const db = portalClient().from("application_votes");
    const { error } = next
      ? await db.upsert({ application_id: a.id, reviewer_email: me, vote: next }, { onConflict: "application_id,reviewer_email" })
      : await db.delete().eq("application_id", a.id).eq("reviewer_email", me);
    setSaving(false);
    if (!error) return;
    setMine(prev);
    toast(next === "conflict" && /vote_chk|check constraint/i.test(error.message)
      ? "Conflict of interest needs the latest database update (supabase/migrations/2026-11-12c-conflicts.sql)."
      : "Couldn't save: " + error.message);
  }

  async function toggleConflict(on: boolean) {
    if (on && hasVote(mine) && !(await confirmDialog({ title: "Declare a conflict of interest?", body: "This removes your " + mine + " vote. The rest of the committee will see that you know this applicant.", confirmLabel: "Declare conflict" }))) return;
    save(on ? "conflict" : "");
  }

  return (
    <div className="crm-field">
      <label>Screening vote · should they get an interview?</label>
      <div className="rating-btns">
        {(["yes", "maybe", "no"] as const).map((v) => (
          <button
            key={v} type="button" data-r={v} aria-pressed={mine === v} disabled={saving || iConflict}
            title={iConflict ? "You've declared a conflict of interest, so you can't vote" : undefined}
            onClick={() => save(v === mine ? "" : v)} // clicking your current vote clears it
          >
            <span className={"v " + v} aria-hidden="true" />{VOTE_LABEL[v]}
          </button>
        ))}
      </div>
      <div className="crm-votes">
        {votes.length === 0 ? <span className="crm-help" style={{ margin: 0 }}>No votes yet. Each reviewer gets one vote; click yours again to clear it.</span> : (
          <>
            <span className="crm-vote-tally">{t.yes} yes · {t.maybe} maybe · {t.no} no</span>
            {votes.map((v) => (
              <span key={v.reviewer} className={"crm-vote-chip " + v.vote} title={v.updatedAt ? "Voted " + fmtDate(v.updatedAt) : undefined}>
                <i className={"v " + v.vote} aria-hidden="true" />{v.reviewer === me ? "You" : v.reviewer}
              </span>
            ))}
          </>
        )}
      </div>
      {conflicts.length ? (
        <div className="crm-coi-list" role="note">
          <Icon name="alert" size={14} />
          <span>Conflict of interest declared by{" "}
          {conflicts.map((c) => (c.reviewer === me ? "you" : c.reviewer)).join(", ")}.
          {" "}{conflicts.length === 1 ? "That vote isn" : "Those votes aren"}&apos;t counted. Consider leaving the decision and the interview to someone else.</span>
        </div>
      ) : null}
      <label className="crm-coi">
        <input type="checkbox" checked={iConflict} disabled={saving || !me} onChange={(e) => toggleConflict(e.target.checked)} />
        <span><strong>I know this person</strong> (friend, partner, housemate, family…). Declares a conflict of interest: your vote is removed and the rest of the committee can see it.</span>
      </label>
    </div>
  );
}

const hasVote = (m: MyVote) => m === "yes" || m === "maybe" || m === "no";

/** Read-only block showing what the applicant submitted on the public form. */
function Submission({ a }: { a: Applicant }) {
  const [viewing, setViewing] = useState<string | null>(null);
  const rows: [string, React.ReactNode][] = [];
  if (a.degree) rows.push(["Degree", a.degree]);
  if (a.yearLevel) rows.push(["Expected graduation", a.yearLevel]);
  if (a.roleSecondary) rows.push(["Second choice", a.roleSecondary]);
  if (a.linkedin) {
    const href = safeLink(a.linkedin);
    rows.push(["Link", href ? <a key="l" href={href} target="_blank" rel="noopener noreferrer">{a.linkedin}</a> : a.linkedin]);
  }
  if (a.statement) rows.push(["Why join", <div key="w" className="crm-sub-statement">{a.statement}</div>]);
  if (a.experience) rows.push(["Skills & experience", <div key="s" className="crm-sub-statement">{a.experience}</div>]);
  if (a.questions) rows.push(["Questions", <div key="q" className="crm-sub-statement">{a.questions}</div>]);
  if (a.extraNote) rows.push(["Note on attachment", a.extraNote]);
  if (a.files.length) {
    rows.push(["Files", (
      <div className="crm-files" key="f">
        {a.files.map((f) => (
          <button key={f.path} type="button" className={"crm-file" + (viewing === f.path ? " is-viewing" : "")} aria-pressed={viewing === f.path} onClick={() => setViewing(viewing === f.path ? null : f.path)}>
            <span className="fi"><Icon name={f.kind === "resume" ? "file" : "paperclip"} size={14} />{f.kind === "resume" ? "Resume" : "Attachment"}</span>
            <span className="fn">{f.name || "file"}</span>
            <span className="fs">{fmtSize(f.size)}</span>
          </button>
        ))}
        {viewing ? <FileViewer key={viewing} files={a.files} startPath={viewing} applicantName={a.name || "Applicant"} onClose={() => setViewing(null)} /> : null}
      </div>
    )]);
  }
  if (!rows.length) return null;
  rows.push(["Submitted", fmtDateTime(a.createdAt)]);
  return (
    <div className="crm-field">
      <label>Application</label>
      <div className="crm-sub">
        {rows.map(([k, v]) => (
          <div className="crm-sub-row" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
        ))}
      </div>
    </div>
  );
}

/** One saved (or not-yet-saved) note, always showing who wrote it. */
function NoteList({ notes, empty, auto = false }: { notes: Note[]; empty: string; auto?: boolean }) {
  return (
    <div className="crm-notes">
      {notes.length === 0 ? <div className="crm-note-empty">{empty}</div> : null}
      {notes.map((n, i) => (
        <div className={"crm-note-item" + (auto ? " crm-note-auto" : "")} key={n.id ?? "p" + i}>
          <div className="t">
            <strong className="crm-note-author">{n.author || "Unknown"}</strong> · {fmtDateTime(n.ts)}
          </div>
          <div className="b">{n.text}</div>
        </div>
      ))}
    </div>
  );
}

function NoteComposer({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="crm-inline">
      <div className="crm-field" style={{ margin: 0 }}>
        <textarea placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <button className="ui-btn" type="button" disabled={!text.trim()} onClick={() => {
        const v = text.trim();
        if (!v) return;
        onAdd(v);
        setText("");
      }}>Add note</button>
    </div>
  );
}

export function ApplicantModal({ a, me, duplicates = [], ratingMovesStage = true, onClose, onSaved, onSendInvite, onOpenOther }: {
  a: Applicant; me: string; duplicates?: Applicant[]; ratingMovesStage?: boolean;
  onClose: () => void; onSaved: () => Promise<void>; onSendInvite: (id: string) => void; onOpenOther: (id: string) => void;
}) {
  const [d, setD] = useState<Applicant>(a);
  const [extra, setExtra] = useState<Note[]>([]); // notes added in this session (until the board reloads)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const up = <K extends keyof Applicant>(k: K, v: Applicant[K]) => setD((p) => ({ ...p, [k]: v }));

  // Autosave: only fields that changed since the last save are sent, a moment after you stop typing.
  const base = useRef<Applicant>(a);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const dirtySaved = useRef(false);
  const latest = useRef(d);
  useEffect(() => { latest.current = d; }, [d]);

  const saveNow = useCallback((): Promise<void> => {
    chain.current = chain.current.then(async () => {
      const draft = latest.current;
      const patch = changes(base.current, draft);
      if (!Object.keys(patch).length) return;
      setState("saving");
      const db = portalClient();
      const { data, error } = await db.from("applications").update(patch).eq("id", a.id).select("id");
      if (error || !data?.length) {
        setState("error");
        toast("Couldn't save: " + (error ? error.message : "you may not have permission, or the applicant was deleted."));
        return;
      }
      base.current = { ...base.current, booking: draft.booking, status: draft.status, rating: draft.rating, secondChoiceFlag: draft.secondChoiceFlag };
      dirtySaved.current = true;
      if (patch.status) {
        const r = await db.from("application_notes")
          .insert({ application_id: a.id, type: "auto", text: "Moved to " + STAGE_BY_ID[patch.status as StageId].label })
          .select().single();
        if (r.data) setExtra((x) => [noteFromRow(r.data), ...x]);
      }
      setState("saved");
    });
    return chain.current;
  }, [a.id]);

  useEffect(() => {
    if (!Object.keys(changes(base.current, d)).length) return;
    setState("saving");
    const timer = setTimeout(saveNow, 700);
    return () => clearTimeout(timer);
  }, [d, saveNow]);

  // Closing (Done, Escape, clicking outside) saves anything still waiting first.
  const close = useCallback(async () => {
    await saveNow();
    onClose();
    if (dirtySaved.current) await onSaved();
  }, [saveNow, onClose, onSaved]);

  const allNotes = [...extra, ...a.notes.filter((n) => !extra.some((x) => x.id && x.id === n.id))];
  const appNotes = allNotes.filter((n) => n.type === "manual");
  const interviewNotes = allNotes.filter((n) => n.type === "interview");
  const auto = allNotes.filter((n) => n.type === "auto");
  const unlocked = interviewUnlocked(d.status, allNotes);

  // Notes save the moment you add them.
  async function addNote(type: "manual" | "interview", text: string) {
    const { data, error } = await portalClient().from("application_notes")
      .insert({ application_id: a.id, type, text }).select().single();
    if (error || !data) { toast("Couldn't save note: " + (error?.message ?? "unknown error")); return; }
    setExtra((x) => [{ ...noteFromRow(data), author: noteFromRow(data).author || me }, ...x]);
    dirtySaved.current = true;
  }

  // Rating an interview moves the applicant on (unless turned off in Settings):
  // Yes -> Offer, Maybe -> Waitlist, No -> Rejected.
  function setRating(r: RatingId) {
    setD((p) => {
      const next = { ...p, rating: r };
      if (ratingMovesStage && r && ["booked", "interviewed", "waitlist", "offer", "rejected"].includes(p.status)) {
        next.status = r === "yes" ? "offer" : r === "maybe" ? "waitlist" : "rejected";
      }
      return next;
    });
  }

  // Saves the pasted link, then opens the invite email with that link already in it.
  async function sendInvite() {
    if (!d.booking.trim()) { toast("Paste the zcal link first."); return; }
    if (!a.email) { toast("This applicant doesn't have an email address on file."); return; }
    await saveNow();
    if (Object.keys(changes(base.current, latest.current)).length) return; // the save failed; the error is already showing
    onClose();
    await onSaved();
    onSendInvite(a.id);
  }

  async function remove() {
    const n = a.files.length;
    if (!(await confirmDialog({
      title: "Delete " + (d.name || "this applicant") + "?",
      body: (n ? "Their application, notes, votes and " + n + " attached file" + (n > 1 ? "s" : "") : "Their application, notes and votes") + " will be permanently removed. This can't be undone.",
      confirmLabel: "Delete applicant",
      danger: true,
    }))) return;
    const db = portalClient();
    // Delete the row first (notes go with it via ON DELETE CASCADE), then the files.
    const { data, error } = await db.from("applications").delete().eq("id", a.id).select("id");
    if (error || !data?.length) { toast("Couldn't delete: " + (error ? error.message : "no permission")); return; }
    if (n) {
      const r = await db.storage.from("resumes").remove(a.files.map((f) => f.path));
      if (r.error) toast("Applicant deleted, but their files couldn't be removed: " + r.error.message);
    }
    onClose();
    await onSaved();
  }

  return (
    <Modal
      variant="sheet"
      title={a.name || "Unnamed applicant"}
      subtitle={
        <span className="sheet-sub">
          <span className="stage-chip" style={{ "--col": STAGE_BY_ID[d.status].color } as React.CSSProperties}><span className="ui-dot" />{STAGE_BY_ID[d.status].label}</span>
          {a.role ? <span>{a.role}</span> : null}
          {a.createdAt ? <span>Applied {fmtDate(a.createdAt)}</span> : null}
        </span>
      }
      onClose={close}
      foot={
        <>
          <button className="ui-btn ui-btn-ghost is-danger" type="button" onClick={remove}><Icon name="trash" />Delete</button>
          <span className="spacer" />
          <span className="crm-save-state" role="status" aria-live="polite" data-state={state}>
            {state === "saving" ? "Saving…" : state === "saved" ? "All changes saved" : state === "error" ? "Couldn't save" : "Changes save automatically"}
          </span>
          <button className="ui-btn ui-btn-primary" type="button" onClick={close}>Done</button>
        </>
      }
    >
      {duplicates.length ? (
        <div className="crm-settings-warn" role="alert">
          <strong>Possible duplicate.</strong> {duplicates.length === 1 ? "Another application uses" : duplicates.length + " other applications use"} this email:{" "}
          {duplicates.map((o, i) => (
            <span key={o.id}>
              {i ? ", " : ""}
              <button type="button" className="crm-linkbtn" onClick={async () => { await saveNow(); if (dirtySaved.current) await onSaved(); onOpenOther(o.id); }}>
                {o.role || "no team"} · {fmtDate(o.createdAt)} · {STAGE_BY_ID[o.status].label}
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <Submission a={a} />
      <Screening key={me} a={a} me={me} />
      {a.roleSecondary ? (
        <label className="crm-check" style={{ marginTop: "-0.3rem", marginBottom: "0.9rem" }}>
          <input type="checkbox" checked={d.secondChoiceFlag} onChange={(e) => up("secondChoiceFlag", e.target.checked)} />
          <Icon name="star" size={14} />Worth considering for their 2nd choice ({a.roleSecondary})
        </label>
      ) : null}
      <div className="crm-row">
        <div className="crm-field"><label>Full name</label><input id="ap-name" readOnly value={a.name} /></div>
        <div className="crm-field"><label>Email</label><input type="email" readOnly value={a.email} /></div>
      </div>
      <div className="crm-row">
        <div className="crm-field"><label>Phone</label><input readOnly value={a.phone} /></div>
        <div className="crm-field"><label>Team applied for</label><input readOnly value={a.role} /></div>
      </div>
      <p className="crm-help" style={{ marginTop: "-0.4rem" }}>Name, email, phone and team come from the applicant&apos;s submission and can&apos;t be edited.</p>
      <div className="crm-field">
        <label>Zcal link</label>
        <div className="crm-inline">
          <div className="crm-field" style={{ margin: 0 }}>
            <input type="url" placeholder="Paste their zcal link, e.g. https://zcal.co/…" value={d.booking} onChange={(e) => up("booking", e.target.value)} />
          </div>
          <button className="ui-btn" type="button" onClick={sendInvite}><Icon name="mail" />Send invite</button>
        </div>
        <div className="crm-help">This link goes into their interview invite. It saves automatically. <strong>Send invite</strong> emails them this link.</div>
      </div>
      <div className="crm-field">
        <label>Stage</label>
        <Select
          block
          label="Stage"
          value={d.status}
          onChange={(v) => up("status", v as StageId)}
          options={STAGES.map((s) => ({ value: s.id, label: s.label, dot: s.color }))}
        />
      </div>
      <div className="crm-field">
        <label>Application notes</label>
        <NoteList notes={appNotes} empty="No application notes yet." />
        <NoteComposer placeholder="Add a note about this application…" onAdd={(v) => addNote("manual", v)} />
      </div>
      <div className={"crm-interview" + (unlocked ? "" : " is-locked")}>
        <div className="crm-interview-head">
          <label>Interview</label>
          {unlocked ? null : <span className="crm-lock"><Icon name="lock" size={13} />Locked</span>}
        </div>
        {unlocked ? (
          <>
            <div className="crm-field">
              <label>Interview rating</label>
              <div className="rating-btns">
                {([{ id: "", label: "—" }, ...RATINGS] as { id: RatingId; label: string }[]).map((r) => (
                  <button key={r.id || "none"} type="button" data-r={r.id} aria-pressed={d.rating === r.id ? "true" : "false"} onClick={() => setRating(r.id)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="crm-field" style={{ marginBottom: 0 }}>
              <label>Interview notes</label>
              <NoteList notes={interviewNotes} empty="No interview notes yet." />
              <NoteComposer placeholder="Add an interview note, impression, next step…" onAdd={(v) => addNote("interview", v)} />
            </div>
          </>
        ) : (
          <p className="crm-help" style={{ margin: 0 }}>
            Interview notes and the rating unlock once this applicant moves to <strong>Interview booked</strong> or later.
          </p>
        )}
      </div>
      <div className="crm-field">
        <label>Activity</label>
        <NoteList notes={auto} empty="No activity yet." auto />
      </div>
    </Modal>
  );
}
