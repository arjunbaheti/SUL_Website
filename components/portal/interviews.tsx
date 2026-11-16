"use client";

import { useMemo, useState } from "react";
import { portalClient } from "@/lib/supabase";
import { TEAMS } from "@/lib/content";
import {
  dayKey, fmtDayLong, fmtSlotShort, fmtTime, melbourneToUtc, melbourneToday, sessionFits,
  type Session, type Slot,
} from "@/lib/booking";
import { STAGE_BY_ID, ago, inviteLink, sentEmails, type Applicant, type StageId } from "@/lib/portal";
import { Glyph3D } from "./glyph-3d";
import { Icon } from "./icons";
import { Menu, Modal, Select, Ticker, confirmDialog, copyText, toast } from "./ui";

// Built-in interview booking, committee side: the Interviews tab (slots + who's booked), the
// "Add slots" dialog, and the Interview section on an applicant's profile.
// Candidates book through /book/<token>; see app/api/booking and the 2026-11-16 migration.

export type Member = { email: string; firstName: string };
export const MIGRATION = "supabase/migrations/2026-11-16-interview-booking.sql";

const memberName = (members: Member[], email: string) => members.find((m) => m.email === email)?.firstName || email.split("@")[0];
const slotRange = (s: Slot) => `${fmtTime(s.startsAt)} – ${fmtTime(s.endsAt)}`;
const teamsLabel = (teams: string[]) => (teams.length ? teams.join(", ") : "All teams");

/** Tick-box list of committee members. */
function PeoplePicker({ members, value, onChange }: { members: Member[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!members.length) return <p className="crm-help" style={{ margin: 0 }}>No committee members found.</p>;
  return (
    <div className="iv-people">
      {members.map((m) => (
        <label key={m.email} className="crm-check iv-person">
          <input type="checkbox" checked={value.includes(m.email)} onChange={() => onChange(value.includes(m.email) ? value.filter((x) => x !== m.email) : [...value, m.email])} />
          <span>{m.firstName || m.email}{m.firstName ? <small>{m.email}</small> : null}</span>
        </label>
      ))}
    </div>
  );
}

/** Books, moves (slotId) or cancels (null) an interview for an applicant, emailing everyone.
 *  notify=false leaves the candidate out (interviewers are always told). */
export async function setInterview(applicationId: string, slotId: string | null, notify = true, quiet = false): Promise<boolean> {
  try {
    const { data } = await portalClient().auth.getSession();
    const res = await fetch("/api/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (data.session?.access_token ?? "") },
      body: JSON.stringify({ applicationId, slotId, notify }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; changed?: boolean; emailed?: boolean; emailError?: string };
    if (!res.ok || !body.ok) { toast("Couldn't update the interview: " + (body.error || "HTTP " + res.status)); return false; }
    if (body.changed && body.emailed === false) toast("Saved, but the emails didn't send: " + (body.emailError || "unknown error"));
    else if (body.changed && !quiet) toast(slotId ? "Interview booked and invites sent" : "Interview cancelled and everyone emailed");
    return true;
  } catch (err) {
    toast("Check your connection. (" + (err as Error)?.message + ")");
    return false;
  }
}

/** Stages that mean "no interview (yet)": moving a booked applicant here gives up their slot. */
const RELEASE_STAGES: StageId[] = ["applied", "review", "invited", "rejected"];

/** Before moving applicants to `to`: if any have an upcoming interview, asks, then cancels it
 *  (interviewers get a calendar cancellation; the candidate isn't emailed, since a rejection or
 *  re-invite usually follows). Returns false if the move should stop. */
export async function releaseInterviews(apps: Applicant[], to: StageId, slots: Slot[]): Promise<boolean> {
  if (!RELEASE_STAGES.includes(to)) return true;
  const now = Date.now();
  const ahead = apps.filter((a) => {
    if (!a.interviewSlotId || a.status === to) return false;
    const start = slots.find((s) => s.id === a.interviewSlotId)?.startsAt || a.interviewAt;
    return !start || +new Date(start) > now;
  });
  if (!ahead.length) return true;
  const one = ahead[0];
  const ok = await confirmDialog({
    title: ahead.length === 1
      ? `${one.name || "This applicant"} has an interview ${one.interviewAt ? "on " + fmtSlotShort(one.interviewAt) : "booked"}`
      : `${ahead.length} of them have interviews booked`,
    body: `Moving to ${STAGE_BY_ID[to].label} cancels ${ahead.length === 1 ? "it" : "them"} and frees the slot. Interviewers get a calendar cancellation. The candidate isn't emailed, so send them your own message if needed.`,
    confirmLabel: "Move and cancel interview",
    danger: to === "rejected",
  });
  if (!ok) return false;
  for (const a of ahead) if (!(await setInterview(a.id, null, false, true))) return false;
  return true;
}

/** Slots nobody has booked yet, from now on. */
function openSlots(slots: Slot[], applicants: Applicant[]) {
  const taken = new Set(applicants.map((a) => a.interviewSlotId).filter(Boolean));
  const now = Date.now();
  return slots.filter((s) => !taken.has(s.id) && +new Date(s.startsAt) > now);
}

// ---- Applicant profile section --------------------------------------------------------------

export function InterviewSection({ a, slots, sessions = [], applicants, members, onChanged, onSendInvite }: {
  a: Applicant; slots: Slot[]; sessions?: Session[]; applicants: Applicant[]; members: Member[];
  onChanged: () => Promise<void>; onSendInvite: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const slot = slots.find((s) => s.id === a.interviewSlotId) ?? null;
  const open = openSlots(slots, applicants);
  const link = inviteLink(a);
  const sessionOf = (s: Slot) => sessions.find((x) => x.id === s.sessionId);
  const fits = (s: Slot) => { const ss = sessionOf(s); return ss ? sessionFits(ss, a) : !s.team || s.team === a.role; };
  // Their own sessions first, then everything else (the committee can book anyone anywhere).
  const options = [...open.filter(fits), ...open.filter((s) => !fits(s))].map((s) => ({
    value: s.id,
    label: fmtSlotShort(s.startsAt),
    group: (sessionOf(s)?.name || (s.team ? s.team + " slots" : "Interviews")) + (fits(s) ? "" : " (not their team)"),
    hint: s.location || undefined,
  }));
  const bookedSession = slot ? sessionOf(slot)?.name : "";

  async function pick(slotId: string) {
    const s = slots.find((x) => x.id === slotId);
    if (!s) return;
    const moving = !!a.interviewSlotId;
    if (!(await confirmDialog({
      title: (moving ? "Move " : "Book ") + (a.name || "this applicant") + (moving ? " to " : " for ") + fmtSlotShort(s.startsAt) + "?",
      body: "They'll get a confirmation email with a calendar invite, and the slot's interviewers will get one too.",
      confirmLabel: moving ? "Move interview" : "Book interview",
    }))) return;
    setBusy(true);
    if (await setInterview(a.id, slotId)) await onChanged();
    setBusy(false);
  }

  async function cancel() {
    if (!(await confirmDialog({
      title: "Cancel " + (a.name || "this") + "'s interview?",
      body: "They'll be emailed that it's cancelled, with their link to book a new time. They move back to Interview invited.",
      confirmLabel: "Cancel interview", danger: true,
    }))) return;
    setBusy(true);
    if (await setInterview(a.id, null)) await onChanged();
    setBusy(false);
  }

  if (!a.bookingToken) {
    return (
      <div className="crm-field">
        <label>Interview</label>
        <p className="crm-settings-warn" style={{ margin: 0 }}>
          Built-in booking needs the latest database update. Run <code>{MIGRATION}</code> in the Supabase SQL editor, then reload.
        </p>
      </div>
    );
  }

  return (
    <div className="crm-field">
      <label>Interview</label>
      {a.interviewSlotId ? (
        <div className="iv-booked">
          <Icon name="calendar" />
          <div className="iv-booked-text">
            <strong>{slot ? fmtDayLong(slot.startsAt) + ", " + slotRange(slot) : a.interviewAt ? fmtSlotShort(a.interviewAt) : "Booked"}</strong>
            <span>
              {bookedSession ? bookedSession + " · " : ""}
              {slot?.location || "No location set"}
              {slot?.interviewers.length ? " · with " + slot.interviewers.map((e) => memberName(members, e)).join(", ") : ""}
            </span>
          </div>
          <div className="iv-booked-actions">
            <Select
              label="Move to another time"
              placeholder="Move…"
              value=""
              disabled={busy || !options.length}
              align="end"
              onChange={pick}
              options={options}
            />
            <button className="ui-btn ui-btn-ghost is-danger" type="button" disabled={busy} onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="crm-inline">
            <div className="crm-field" style={{ margin: 0 }}>
              <input type="url" readOnly value={link} aria-label="Their booking link" onFocus={(e) => e.currentTarget.select()} />
            </div>
            <button className="ui-icon-btn" type="button" aria-label="Copy booking link" data-tip="Copy link" onClick={() => copyText(link, "Booking link copied")}><Icon name="copy" /></button>
            <button className="ui-btn" type="button" onClick={onSendInvite}><Icon name="mail" />Send invite</button>
          </div>
          <div className="iv-or">
            <span>{open.filter(fits).length ? open.filter(fits).length + " open time" + (open.filter(fits).length === 1 ? "" : "s") + " for their team. They pick one from the link, or" : "No open times for their team yet. Add some in the Interviews tab, or"}</span>
            {open.length ? (
              <Select label="Book a time for them" placeholder="Book a time for them…" value="" disabled={busy} onChange={pick} options={options} />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Add slots ------------------------------------------------------------------------------

const LENGTHS = [15, 20, 30, 45, 60];
const GAPS = [0, 5, 10, 15];

function AddSlotsModal({ members, me, existing, sessions, initialSession = "", onClose, onSaved }: {
  members: Member[]; me: string; existing: Slot[]; sessions: Session[]; initialSession?: string;
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const start = sessions.find((x) => x.id === initialSession);
  const [sessionId, setSessionId] = useState(start?.id ?? "");
  const [date, setDate] = useState(melbourneToday);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("13:00");
  const [len, setLen] = useState("30");
  const [gap, setGap] = useState("0");
  const [location, setLocation] = useState(start?.location ?? "");
  const [team, setTeam] = useState("");
  const [people, setPeople] = useState<string[]>(start?.interviewers.length ? start.interviewers : me ? [me] : []);
  // Picking a session fills in its usual place and interviewers (still editable per batch).
  function chooseSession(id: string) {
    setSessionId(id);
    const ss = sessions.find((x) => x.id === id);
    if (ss) { setLocation(ss.location); if (ss.interviewers.length) setPeople(ss.interviewers); }
  }
  const [busy, setBusy] = useState(false);
  const [openedAt] = useState(() => Date.now());

  const planned = useMemo(() => {
    if (!date || !from || !to) return [];
    const start = melbourneToUtc(date, from), end = melbourneToUtc(date, to);
    const step = (+len + +gap) * 60000, dur = +len * 60000;
    const out: { starts_at: string; ends_at: string }[] = [];
    for (let t = +start; t + dur <= +end && out.length < 48; t += step) {
      out.push({ starts_at: new Date(t).toISOString(), ends_at: new Date(t + dur).toISOString() });
    }
    return out;
  }, [date, from, to, len, gap]);
  const past = planned.length > 0 && +new Date(planned[0].starts_at) < openedAt;
  // Same start time and place as a slot that already exists: skipped, so adding twice is harmless.
  const loc = location.trim().toLowerCase();
  const isDup = (p: { starts_at: string }) => existing.some((e) => +new Date(e.startsAt) === +new Date(p.starts_at) && e.location.trim().toLowerCase() === loc);
  const fresh = planned.filter((p) => !isDup(p));
  const dupes = planned.length - fresh.length;
  // An interviewer already down for an overlapping slot elsewhere.
  const clashes = fresh.filter((p) => existing.some((e) =>
    +new Date(e.startsAt) < +new Date(p.ends_at) && +new Date(e.endsAt) > +new Date(p.starts_at)
    && e.interviewers.some((x) => people.includes(x)))).length;

  async function save() {
    if (!fresh.length || past) return;
    setBusy(true);
    const rows = fresh.map((p) => ({
      ...p, location: location.trim(), interviewers: people,
      ...(sessionId ? { session_id: sessionId, team: "" } : { team }),
    }));
    const { error } = await portalClient().from("interview_slots").insert(rows);
    setBusy(false);
    if (error) { toast("Couldn't add slots: " + error.message); return; }
    toast(`Added ${rows.length} slot${rows.length === 1 ? "" : "s"}`);
    await onSaved();
    onClose();
  }

  return (
    <Modal
      title="Add interview slots"
      onClose={onClose}
      foot={
        <>
          <span className="crm-help" style={{ margin: 0 }}>
            {past ? "That time has already passed." : !planned.length ? "No slots fit in that window."
              : !fresh.length ? "These slots already exist."
              : `${fresh.length} slot${fresh.length === 1 ? "" : "s"}: ${fmtTime(fresh[0].starts_at)} – ${fmtTime(fresh[fresh.length - 1].ends_at)}`
                + (dupes ? ` · ${dupes} already exist${dupes === 1 ? "s" : ""}, skipped` : "")}
          </span>
          <span className="spacer" />
          <button className="ui-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="ui-btn ui-btn-primary" type="button" disabled={busy || !fresh.length || past} onClick={save}>
            {busy ? "Adding…" : `Add ${fresh.length || ""} slot${fresh.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <p className="crm-help" style={{ marginTop: 0 }}>Times are Melbourne time. Each slot takes one candidate.</p>
      {sessions.length ? (
        <div className="crm-field">
          <label>Session</label>
          <Select
            block label="Session" value={sessionId} onChange={chooseSession}
            options={[...sessions.map((x) => ({ value: x.id, label: x.name, hint: teamsLabel(x.teams) })), { value: "", label: "No session", hint: "pick who can book below" }]}
          />
        </div>
      ) : null}
      <div className="crm-row">
        <div className="crm-field"><label htmlFor="iv-date">Day</label><input id="iv-date" type="date" value={date} min={melbourneToday()} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="crm-row">
          <div className="crm-field"><label htmlFor="iv-from">From</label><input id="iv-from" type="time" step={300} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="crm-field"><label htmlFor="iv-to">Until</label><input id="iv-to" type="time" step={300} value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </div>
      <div className="crm-row">
        <div className="crm-field">
          <label>Each interview</label>
          <Select block label="Slot length" value={len} onChange={setLen} options={LENGTHS.map((n) => ({ value: String(n), label: n + " minutes" }))} />
        </div>
        <div className="crm-field">
          <label>Break between</label>
          <Select block label="Break between slots" value={gap} onChange={setGap} options={GAPS.map((n) => ({ value: String(n), label: n ? n + " minutes" : "No break" }))} />
        </div>
      </div>
      <div className="crm-row">
        <div className="crm-field">
          <label htmlFor="iv-loc">Location</label>
          <input id="iv-loc" type="text" maxLength={300} placeholder="e.g. Arts West 353, or a meeting link" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="crm-field">
          <label>Who can book</label>
          {sessionId ? (
            <input readOnly value={teamsLabel(sessions.find((x) => x.id === sessionId)?.teams ?? []) + " (from the session)"} />
          ) : (
            <Select block label="Team" value={team} onChange={setTeam} options={[{ value: "", label: "Any team" }, ...TEAMS.map((t) => ({ value: t.name, label: t.name + " applicants" }))]} />
          )}
        </div>
      </div>
      <div className="crm-field">
        <label>Interviewers <span className="iv-label-note">get a calendar invite for each booking</span></label>
        <PeoplePicker members={members} value={people} onChange={setPeople} />
      </div>
      {clashes ? (
        <p className="crm-settings-warn" role="alert"><Icon name="alert" size={14} />{clashes} of these overlap{clashes === 1 ? "s" : ""} a slot one of these interviewers already has.</p>
      ) : null}
      {!people.length ? <p className="crm-help" style={{ margin: 0 }}>No interviewers ticked, so nobody gets a calendar invite for these bookings.</p> : null}
    </Modal>
  );
}

// ---- Sessions -------------------------------------------------------------------------------

function SessionModal({ session, members, me, upcomingOpen, onClose, onSaved }: {
  session: Session | null; members: Member[]; me: string;
  /** Open (unbooked) upcoming slots in this session, which pick up interviewer/location changes. */
  upcomingOpen: Slot[];
  onClose: () => void; onSaved: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(session?.name ?? "");
  const [teams, setTeams] = useState<string[]>(session?.teams ?? []);
  const [people, setPeople] = useState<string[]>(session?.interviewers ?? (me ? [me] : []));
  const [location, setLocation] = useState(session?.location ?? "");
  const [note, setNote] = useState(session?.note ?? "");
  const [busy, setBusy] = useState(false);
  const toggleTeam = (t: string) => setTeams((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));

  async function save() {
    if (!name.trim()) { toast("Give the session a name."); return; }
    setBusy(true);
    const row = { name: name.trim(), teams, interviewers: people, location: location.trim(), note: note.trim() };
    const db = portalClient();
    const res = session
      ? await db.from("interview_sessions").update(row).eq("id", session.id).select("id").single()
      : await db.from("interview_sessions").insert(row).select("id").single();
    if (res.error || !res.data) {
      setBusy(false);
      toast(/interview_sessions|schema cache/i.test(res.error?.message ?? "")
        ? "Sessions need the latest database update (supabase/migrations/2026-11-16c-interview-sessions.sql)."
        : "Couldn't save: " + (res.error?.message ?? "unknown error"));
      return;
    }
    // Unbooked upcoming slots follow the session's interviewers and place. Booked ones keep theirs,
    // so nobody's confirmed interview changes under them.
    if (session && upcomingOpen.length) {
      const changedPeople = people.join() !== session.interviewers.join();
      const changedPlace = location.trim() !== session.location;
      if (changedPeople || changedPlace) {
        await db.from("interview_slots").update({
          ...(changedPeople ? { interviewers: people } : {}),
          ...(changedPlace ? { location: location.trim() } : {}),
        }).in("id", upcomingOpen.map((x) => x.id));
      }
    }
    setBusy(false);
    toast(session ? "Session saved" : "Session created");
    await onSaved(res.data.id as string);
    onClose();
  }

  return (
    <Modal
      title={session ? "Edit session" : "New interview session"}
      onClose={onClose}
      foot={
        <>
          <span className="spacer" />
          <button className="ui-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="ui-btn ui-btn-primary" type="button" disabled={busy || !name.trim()} onClick={save}>{busy ? "Saving…" : session ? "Save" : "Create session"}</button>
        </>
      }
    >
      <div className="crm-field">
        <label htmlFor="ss-name">Name</label>
        <input id="ss-name" type="text" maxLength={80} placeholder="e.g. Project interviews" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="crm-field">
        <label>For applicants to <span className="iv-label-note">none ticked = every team</span></label>
        <div className="iv-teams">
          {TEAMS.map((t) => (
            <label key={t.name} className="crm-check iv-person">
              <input type="checkbox" checked={teams.includes(t.name)} onChange={() => toggleTeam(t.name)} />
              <span>{t.name}</span>
            </label>
          ))}
        </div>
        <p className="crm-help" style={{ margin: "4px 0 0" }}>Applicants see these times if it&apos;s their first choice, or their second choice when you&apos;ve flagged them for it.</p>
      </div>
      <div className="crm-field">
        <label>Interviewers <span className="iv-label-note">default for new slots · each gets a calendar invite</span></label>
        <PeoplePicker members={members} value={people} onChange={setPeople} />
      </div>
      <div className="crm-field">
        <label htmlFor="ss-loc">Usual location</label>
        <input id="ss-loc" type="text" maxLength={300} placeholder="e.g. Arts West 353, or a meeting link" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      <div className="crm-field">
        <label htmlFor="ss-note">Note for candidates <span className="iv-label-note">shown on the booking page</span></label>
        <textarea id="ss-note" maxLength={500} placeholder="e.g. Bring a project you're proud of. About 20 minutes." value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {session && upcomingOpen.length ? (
        <p className="crm-help" style={{ margin: 0 }}>Interviewer and location changes also apply to this session&apos;s {upcomingOpen.length} open upcoming slot{upcomingOpen.length === 1 ? "" : "s"}. Booked interviews keep their details.</p>
      ) : null}
    </Modal>
  );
}

// ---- Interviews tab -------------------------------------------------------------------------

/** Applicants waiting on an email from us, with one-click send / resend and "Email all". */
function SendList({ title, empty, people, onOpen, onSend, onBulk }: {
  title: string; empty: string; people: Applicant[];
  onOpen: (id: string) => void; onSend: (a: Applicant) => void; onBulk: (list: Applicant[]) => void;
}) {
  const unsent = people.filter((a) => !sentEmails(a).invite);
  return (
    <section className="ins-card ins-wide">
      <div className="iv-sec-head">
        <h3>{title} {people.length ? <small className="h-note">{people.length}</small> : null}</h3>
        <span className="spacer" />
        {people.length > 1 ? (
          <button className="ui-btn" type="button" onClick={() => onBulk(unsent.length ? unsent : people)}>
            <Icon name="mail" />{unsent.length ? `Email ${unsent.length} not yet invited` : `Resend to all ${people.length}`}
          </button>
        ) : null}
      </div>
      {people.length === 0 ? <p className="ins-sub">{empty}</p> : (
        <div className="ins-table-wrap">
          <table className="ins-table iv-table">
            <thead><tr><th>Applicant</th><th>Team</th><th>Invite</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {people.map((a) => {
                const sent = sentEmails(a).invite;
                return (
                  <tr key={a.id}>
                    <td><button type="button" className="crm-linkbtn" onClick={() => onOpen(a.id)}>{a.name || "Unnamed"}</button></td>
                    <td>{a.role || "—"}</td>
                    <td>{sent ? <span className="iv-sent">Sent {ago(sent)}</span> : <span className="iv-unsent">Not emailed yet</span>}</td>
                    <td className="iv-act">
                      <span className="iv-row-btns">
                        <button className="ui-icon-btn" type="button" aria-label={"Copy " + (a.name || "their") + " booking link"} data-tip="Copy booking link" disabled={!inviteLink(a)} onClick={() => copyText(inviteLink(a), "Booking link copied")}>
                          <Icon name="copy" />
                        </button>
                        <button className={"ui-btn" + (sent ? "" : " ui-btn-primary")} type="button" disabled={!a.email} title={a.email ? undefined : "No email address on file"} onClick={() => onSend(a)}>
                          <Icon name="mail" />{sent ? "Resend" : "Send invite"}
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Interviews({ applicants, slots, sessions, members, me, missing, onOpen, onReload, onSend, onBulk, onMove }: {
  applicants: Applicant[]; slots: Slot[]; sessions: Session[]; members: Member[]; me: string; missing: boolean;
  onOpen: (id: string) => void; onReload: () => Promise<void>;
  /** Opens the invite email for one applicant, or the bulk sender for several. */
  onSend: (a: Applicant) => void; onBulk: (list: Applicant[]) => void;
  onMove: (id: string, status: StageId) => void;
}) {
  const [adding, setAdding] = useState<{ session: string } | null>(null);
  const [editing, setEditing] = useState<Session | "new" | null>(null);
  const [filter, setFilter] = useState("all"); // "all" | session id | "none"
  const [showPast, setShowPast] = useState(false);
  const [now] = useState(() => Date.now());

  const byslot = useMemo(() => new Map(applicants.filter((a) => a.interviewSlotId).map((a) => [a.interviewSlotId, a])), [applicants]);
  const upcoming = slots.filter((s) => +new Date(s.endsAt) > now);
  const inFilter = (s: Slot) => filter === "all" || (filter === "none" ? !s.sessionId : s.sessionId === filter);
  const shown = (showPast ? slots : upcoming).filter(inFilter);
  const sessionName = (s: Slot) => sessions.find((x) => x.id === s.sessionId)?.name ?? "";
  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of shown) m.set(dayKey(s.startsAt), [...(m.get(dayKey(s.startsAt)) ?? []), s]);
    return [...m.entries()];
  }, [shown]);
  const booked = upcoming.filter((s) => byslot.has(s.id)).length;
  const waiting = applicants.filter((a) => a.status === "invited" && !a.interviewSlotId);
  // Screened and ready, but not invited yet.
  const ready = applicants.filter((a) => a.status === "review" && !a.interviewSlotId && !sentEmails(a).invite);

  // New times added while people were stuck with "no open times": offer to email them.
  async function slotsAdded() {
    await onReload();
    const told = waiting.filter((a) => sentEmails(a).invite);
    if (told.length) {
      toast(`${told.length} invited ${told.length === 1 ? "person hasn't" : "people haven't"} booked yet`, {
        action: { label: "Email them", onClick: () => onBulk(told) },
      });
    }
  }

  async function remove(s: Slot) {
    if (byslot.has(s.id)) { toast("Someone's booked this slot. Cancel or move their interview first."); return; }
    const { error } = await portalClient().from("interview_slots").delete().eq("id", s.id);
    if (error) { toast("Couldn't delete: " + error.message); return; }
    toast("Slot deleted");
    await onReload();
  }

  async function removeDay(list: Slot[]) {
    const free = list.filter((s) => !byslot.has(s.id));
    if (!free.length) { toast("Every slot that day is booked."); return; }
    if (!(await confirmDialog({ title: `Delete ${free.length} open slot${free.length === 1 ? "" : "s"} on ${fmtDayLong(list[0].startsAt)}?`, body: "Booked slots are kept.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await portalClient().from("interview_slots").delete().in("id", free.map((s) => s.id));
    if (error) { toast("Couldn't delete: " + error.message); return; }
    await onReload();
  }

  /** Applicants a session is for who still need to book (not yet booked, still in the running). */
  const pendingFor = (ss: Session) => applicants.filter((a) =>
    ["applied", "review", "invited"].includes(a.status) && !a.interviewSlotId && sessionFits(ss, a));

  async function removeSession(ss: Session) {
    const mine = slots.filter((x) => x.sessionId === ss.id);
    if (mine.some((x) => byslot.has(x.id))) { toast("This session has booked interviews. Cancel or move them first."); return; }
    if (!(await confirmDialog({
      title: `Delete "${ss.name}"?`,
      body: mine.length ? `Its ${mine.length} open slot${mine.length === 1 ? "" : "s"} will be deleted too.` : "It has no slots.",
      confirmLabel: "Delete session", danger: true,
    }))) return;
    const db = portalClient();
    if (mine.length) {
      const r = await db.from("interview_slots").delete().in("id", mine.map((x) => x.id));
      if (r.error) { toast("Couldn't delete its slots: " + r.error.message); return; }
    }
    const { error } = await db.from("interview_sessions").delete().eq("id", ss.id);
    if (error) { toast("Couldn't delete: " + error.message); return; }
    if (filter === ss.id) setFilter("all");
    toast("Session deleted");
    await onReload();
  }

  async function cancelFor(a: Applicant) {
    if (!(await confirmDialog({ title: "Cancel " + (a.name || "this") + "'s interview?", body: "They'll be emailed with their link to book a new time.", confirmLabel: "Cancel interview", danger: true }))) return;
    if (await setInterview(a.id, null)) await onReload();
  }

  const head = (
    <div className="page-head ins-head">
      <div className="title-row">
        <Glyph3D kind="network" />
        <h1>Interviews</h1>
      </div>
      <div className="page-head-actions">
        <button className="ui-btn" type="button" aria-pressed={showPast} onClick={() => setShowPast((x) => !x)}>{showPast ? "Hide past" : "Show past"}</button>
        <button className="ui-btn" type="button" disabled={missing} onClick={() => setEditing("new")}><Icon name="plus" />New session</button>
        <button className="ui-btn ui-btn-primary" type="button" disabled={missing} onClick={() => setAdding({ session: filter !== "all" && filter !== "none" ? filter : sessions.length === 1 ? sessions[0].id : "" })}><Icon name="plus" />Add slots</button>
      </div>
    </div>
  );

  if (missing) {
    return (
      <div className="ins">
        {head}
        <section className="ins-card ins-wide">
          <h3>One-time setup</h3>
          <p className="ins-sub">Run <code>{MIGRATION}</code> in Supabase → SQL Editor, then reload this page.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="ins">
      {head}
      <div className="ins-tiles">
        {([
          ["Upcoming slots", String(upcoming.length), days.length ? `across ${new Set(upcoming.map((s) => dayKey(s.startsAt))).size} day(s)` : "Add some to start"],
          ["Booked", String(booked), upcoming.length ? Math.round((booked / upcoming.length) * 100) + "% of slots" : ""],
          ["Open", String(upcoming.length - booked), ""],
          ["Invited, not booked", String(waiting.length), waiting.length > upcoming.length - booked ? "More than open slots" : ""],
        ] as [string, string, string][]).map(([label, value, sub]) => (
          <div className="ins-tile" key={label}>
            <div className="ins-tile-label">{label}</div>
            <div className="ins-tile-value"><Ticker value={value} /></div>
            {sub ? <div className={"ins-tile-sub" + (label === "Invited, not booked" && sub ? " iv-warn" : "")}>{sub}</div> : null}
          </div>
        ))}
      </div>

      <section className="ins-card ins-wide">
        <div className="iv-sec-head">
          <h3>Sessions {sessions.length ? <small className="h-note">{sessions.length}</small> : null}</h3>
        </div>
        {sessions.length === 0 ? (
          <div className="iv-empty">
            <p className="ins-sub">Group interviews by team, e.g. &quot;Project interviews&quot; with the Projects leads. Only applicants for those teams see its times.</p>
            <button className="ui-btn" type="button" onClick={() => setEditing("new")}><Icon name="plus" />New session</button>
          </div>
        ) : (
          <div className="iv-sessions">
            {sessions.map((ss) => {
              const mine = upcoming.filter((x) => x.sessionId === ss.id);
              const taken = mine.filter((x) => byslot.has(x.id)).length;
              const pending = pendingFor(ss);
              const uninvited = pending.filter((a) => !sentEmails(a).invite);
              return (
                <div className={"iv-session" + (filter === ss.id ? " is-on" : "")} key={ss.id}>
                  <div className="iv-session-top">
                    <button type="button" className="iv-session-name" onClick={() => setFilter(filter === ss.id ? "all" : ss.id)} title="Show only this session's schedule">{ss.name}</button>
                    <Menu label={"More for " + ss.name} items={[
                      { label: "Edit session", onSelect: () => setEditing(ss) },
                      { label: "Delete session…", icon: <Icon name="trash" />, danger: true, onSelect: () => removeSession(ss) },
                    ]}>
                      <Icon name="more" />
                    </Menu>
                  </div>
                  <div className="iv-session-meta">
                    <span><Icon name="users" size={13} />{teamsLabel(ss.teams)}</span>
                    {ss.interviewers.length ? <span>with {ss.interviewers.map((e) => memberName(members, e)).join(", ")}</span> : null}
                  </div>
                  <div className="iv-session-stats">
                    <span><b>{mine.length}</b> upcoming slot{mine.length === 1 ? "" : "s"}</span>
                    <span><b>{taken}</b> booked</span>
                    <span className={pending.length > mine.length - taken ? "iv-warn" : undefined}><b>{pending.length}</b> still to book</span>
                  </div>
                  <div className="iv-session-actions">
                    <button className="ui-btn" type="button" onClick={() => setAdding({ session: ss.id })}><Icon name="plus" />Add slots</button>
                    <button
                      className={"ui-btn" + (uninvited.length ? " ui-btn-primary" : "")} type="button" disabled={!pending.length}
                      title={pending.length ? undefined : "Everyone this session is for has booked"}
                      onClick={() => onBulk(uninvited.length ? uninvited : pending)}
                    >
                      <Icon name="mail" />{uninvited.length ? `Invite ${uninvited.length}` : pending.length ? `Remind ${pending.length}` : "All booked"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="ins-card ins-wide">
        <div className="iv-sec-head">
          <h3>Schedule <small className="h-note">Melbourne time</small></h3>
          <span className="spacer" />
          {sessions.length ? (
            <Select
              label="Show session" value={filter} onChange={setFilter} align="end"
              options={[
                { value: "all", label: "All sessions" },
                ...sessions.map((x) => ({ value: x.id, label: x.name })),
                ...(slots.some((x) => !x.sessionId) ? [{ value: "none", label: "No session" }] : []),
              ]}
            />
          ) : null}
        </div>
        {days.length === 0 ? (
          <div className="iv-empty">
            <p className="ins-sub">No {showPast ? "" : "upcoming "}interview slots{filter !== "all" ? " here" : ""} yet.</p>
            <button className="ui-btn ui-btn-primary" type="button" onClick={() => setAdding({ session: filter !== "all" && filter !== "none" ? filter : "" })}><Icon name="plus" />Add slots</button>
          </div>
        ) : days.map(([k, list]) => (
          <div className="iv-day" key={k}>
            <div className="iv-day-head">
              <h4>{fmtDayLong(list[0].startsAt)}</h4>
              <span className="iv-day-count">{list.filter((s) => byslot.has(s.id)).length}/{list.length} booked</span>
              <span className="spacer" />
              <Menu label={"More for " + fmtDayLong(list[0].startsAt)} items={[{ label: "Delete open slots this day…", icon: <Icon name="trash" />, danger: true, onSelect: () => removeDay(list) }]}>
                <Icon name="more" />
              </Menu>
            </div>
            <div className="ins-table-wrap">
              <table className="ins-table iv-table">
                <thead><tr><th>Time</th><th>Candidate</th><th>Location</th><th>Interviewers</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {list.map((s) => {
                    const a = byslot.get(s.id);
                    const isPast = +new Date(s.endsAt) <= now;
                    return (
                      <tr key={s.id} className={isPast ? "is-past" : undefined}>
                        <td className="iv-time">{slotRange(s)}{sessionName(s) && filter === "all" ? <small className="iv-sess">{sessionName(s)}</small> : null}</td>
                        <td>
                          {a ? (
                            <button type="button" className="crm-linkbtn iv-cand" onClick={() => onOpen(a.id)}>
                              <span className="ui-dot" style={{ background: STAGE_BY_ID[a.status].color }} />{a.name || "Unnamed"}
                              <small>{a.role}</small>
                            </button>
                          ) : null}
                          {a && isPast && a.status === "booked" ? (
                            <button type="button" className="ui-btn iv-mark" onClick={() => onMove(a.id, "interviewed")}><Icon name="check" />Interviewed</button>
                          ) : null}
                          {a ? null : (
                            <span className="iv-open">Open{!s.sessionId && s.team ? <span className="crm-tag">{s.team} only</span> : null}</span>
                          )}
                        </td>
                        <td className="iv-loc">{s.location || "—"}</td>
                        <td className="iv-who">{s.interviewers.length ? s.interviewers.map((e) => memberName(members, e)).join(", ") : "—"}</td>
                        <td className="iv-act">
                          <Menu
                            label="Slot actions"
                            items={a ? [
                              { label: "Open " + (a.name || "applicant"), onSelect: () => onOpen(a.id) },
                              ...(isPast && a.status === "booked" ? [{ label: "Mark as interviewed", icon: <Icon name="check" />, onSelect: () => onMove(a.id, "interviewed") }] : []),
                              ...(isPast ? [] : [{ label: "Cancel interview…", icon: <Icon name="x" />, danger: true, onSelect: () => cancelFor(a) }]),
                            ] : [
                              { label: "Delete slot", icon: <Icon name="trash" />, danger: true, onSelect: () => remove(s) },
                            ]}
                          >
                            <Icon name="more" />
                          </Menu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <SendList
        title="Invited, not booked yet"
        empty="Everyone invited has booked a time."
        people={waiting} onOpen={onOpen} onSend={onSend} onBulk={onBulk}
      />
      <SendList
        title="Ready to invite"
        empty="Nobody in Under review is waiting for an invite."
        people={ready} onOpen={onOpen} onSend={onSend} onBulk={onBulk}
      />

      {adding ? (
        <AddSlotsModal
          members={members} me={me} existing={slots} sessions={sessions} initialSession={adding.session}
          onClose={() => setAdding(null)} onSaved={slotsAdded}
        />
      ) : null}
      {editing ? (
        <SessionModal
          session={editing === "new" ? null : editing} members={members} me={me}
          upcomingOpen={editing === "new" ? [] : upcoming.filter((x) => x.sessionId === editing.id && !byslot.has(x.id))}
          onClose={() => setEditing(null)}
          onSaved={async (id) => { await onReload(); if (editing === "new") setAdding({ session: id }); }}
        />
      ) : null}
    </div>
  );
}
