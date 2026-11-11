"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { portalClient } from "@/lib/supabase";
import {
  RATINGS, STAGES, STAGE_BY_ID, fmtDateTime, fmtSize, interviewUnlocked, noteFromRow,
  withScheme, type Applicant, type Note, type RatingId, type StageId,
} from "@/lib/portal";
import { Modal, toast } from "./ui";

// Fields the committee can edit -> database column. Only changed fields are sent, so two
// reviewers editing different fields don't clobber each other.
const EDITABLE = {
  name: "name", email: "email", phone: "phone", role: "role",
  booking: "booking", status: "status", rating: "rating",
} as const;
type Editable = keyof typeof EDITABLE;

function changes(orig: Applicant, draft: Applicant) {
  const out: Record<string, string | null> = {};
  (Object.keys(EDITABLE) as Editable[]).forEach((k) => {
    if ((orig[k] || "") !== (draft[k] || "")) out[EDITABLE[k]] = draft[k] || "";
  });
  return out;
}

/** Gets a short-lived signed link for a stored file. Returns the URL, or an error message. */
async function signFile(path: string): Promise<{ url: string } | { error: string }> {
  try {
    const res = await portalClient().storage.from("resumes").createSignedUrl(path, 300);
    if (res.error || !res.data) return { error: res.error?.message || "not found" };
    return { url: res.data.signedUrl };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "network error" };
  }
}

/** Read-only block showing what the applicant submitted on the public form. */
function Submission({ a }: { a: Applicant }) {
  const [fileMsg, setFileMsg] = useState<{ text: string; url?: string } | null>(null);
  async function openFile(path: string) {
    setFileMsg({ text: "Opening…" });
    const res = await signFile(path);
    if ("error" in res) {
      setFileMsg({ text: "Couldn't open that file: " + res.error });
      return;
    }
    // Signed first, then opened, so a failure never leaves a blank tab behind.
    // (Not the "noopener" feature: it makes window.open return null, which looks like a blocked tab.)
    const win = window.open(res.url, "_blank");
    if (win) win.opener = null;
    setFileMsg(win ? null : { text: "Your browser blocked the new tab.", url: res.url });
  }
  const rows: [string, React.ReactNode][] = [];
  if (a.degree) rows.push(["Degree", a.degree]);
  if (a.yearLevel) rows.push(["Expected graduation", a.yearLevel]);
  if (a.roleSecondary) rows.push(["Second choice", a.roleSecondary]);
  if (a.linkedin) rows.push(["Link", <a key="l" href={withScheme(a.linkedin)} target="_blank" rel="noopener noreferrer">{a.linkedin}</a>]);
  if (a.statement) rows.push(["Why join", <div key="w" className="crm-sub-statement">{a.statement}</div>]);
  if (a.experience) rows.push(["Skills & experience", <div key="s" className="crm-sub-statement">{a.experience}</div>]);
  if (a.questions) rows.push(["Questions", <div key="q" className="crm-sub-statement">{a.questions}</div>]);
  if (a.extraNote) rows.push(["Note on attachment", a.extraNote]);
  if (a.files.length) {
    rows.push(["Files", (
      <div className="crm-files" key="f">
        {a.files.map((f) => (
          <button key={f.path} type="button" className="crm-file" onClick={() => openFile(f.path)}>
            <span className="fi">{f.kind === "resume" ? "📄 Resume" : "📎 Attachment"}</span>
            <span className="fn">{f.name || "file"}</span>
            <span className="fs">{fmtSize(f.size)}</span>
          </button>
        ))}
        {fileMsg ? (
          <p className="form-hint" role="status" style={{ color: fileMsg.text.startsWith("Couldn") ? "#ff8a8a" : undefined, margin: "0.3rem 0 0", overflowWrap: "anywhere" }}>
            {fileMsg.text}{fileMsg.url ? <> <a href={fileMsg.url} target="_blank" rel="noopener noreferrer">Open file</a></> : null}
          </p>
        ) : null}
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
      <button className="btn btn-secondary btn-sm" type="button" onClick={() => {
        const v = text.trim();
        if (!v) return;
        onAdd(v);
        setText("");
      }}>Add note</button>
    </div>
  );
}

export function ApplicantModal({ a, onClose, onSaved, onSendInvite }: {
  a: Applicant; onClose: () => void; onSaved: () => Promise<void>; onSendInvite: (id: string) => void;
}) {
  const [d, setD] = useState<Applicant>(a);
  const [extra, setExtra] = useState<Note[]>([]); // notes added in this session (until the board reloads)
  const [me, setMe] = useState("");
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
      base.current = { ...base.current, booking: draft.booking, status: draft.status, rating: draft.rating };
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

  // Who is signed in.
  useEffect(() => {
    portalClient().auth.getSession().then(({ data }) => setMe(data.session?.user.email ?? ""));
  }, []);

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

  // Rating an interview moves the applicant on: Yes or Maybe -> Offer, No -> Rejected.
  function setRating(r: RatingId) {
    setD((p) => {
      const next = { ...p, rating: r };
      if (r && ["booked", "interviewed", "offer", "rejected"].includes(p.status)) next.status = r === "no" ? "rejected" : "offer";
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
    if (!window.confirm("Delete " + (d.name || "this applicant") + (n ? " and their " + n + " attached file" + (n > 1 ? "s" : "") : "") + "? This cannot be undone.")) return;
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
      title="Applicant"
      onClose={close}
      foot={
        <>
          <button className="link-danger" type="button" onClick={remove}>Delete</button>
          <span className="spacer" />
          <span className="crm-save-state" role="status" aria-live="polite" data-state={state}>
            {state === "saving" ? "Saving…" : state === "saved" ? "All changes saved" : state === "error" ? "Couldn't save" : "Changes save automatically"}
          </span>
          <button className="btn btn-primary btn-sm" type="button" onClick={close}>Done</button>
        </>
      }
    >
      <Submission a={a} />
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
          <button className="btn btn-secondary btn-sm" type="button" onClick={sendInvite}>Send invite</button>
        </div>
        <div className="crm-help">This link goes into their interview invite. It saves automatically. <strong>Send invite</strong> emails them this link.</div>
      </div>
      <div className="crm-field">
        <label>Stage</label>
        <select value={d.status} onChange={(e) => up("status", e.target.value as StageId)}>
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div className="crm-field">
        <label>Application notes</label>
        <NoteList notes={appNotes} empty="No application notes yet." />
        <NoteComposer placeholder="Add a note about this application…" onAdd={(v) => addNote("manual", v)} />
      </div>
      <div className={"crm-interview" + (unlocked ? "" : " is-locked")}>
        <div className="crm-interview-head">
          <label>Interview</label>
          {unlocked ? null : <span className="crm-lock">🔒 Locked</span>}
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
