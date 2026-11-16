"use client";

import { useMemo, useState } from "react";
import { portalClient } from "@/lib/supabase";
import { TEAMS } from "@/lib/content";
import {
  dayKey, fmtDayLong, fmtSlotShort, fmtTime, melbourneToUtc, melbourneToday, type Slot,
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

export function InterviewSection({ a, slots, applicants, members, onChanged, onSendInvite }: {
  a: Applicant; slots: Slot[]; applicants: Applicant[]; members: Member[];
  onChanged: () => Promise<void>; onSendInvite: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const slot = slots.find((s) => s.id === a.interviewSlotId) ?? null;
  const open = openSlots(slots, applicants);
  const link = inviteLink(a);
  const options = open.map((s) => ({
    value: s.id,
    label: fmtSlotShort(s.startsAt),
    group: fmtDayLong(s.startsAt),
    hint: s.team && s.team !== a.role ? s.team + " slot" : s.location || undefined,
  }));

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
            <span>{open.length ? open.length + " open time" + (open.length === 1 ? "" : "s") + ". They pick one from the link, or" : "No open times yet. Add some in the Interviews tab."}</span>
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

function AddSlotsModal({ members, me, existing, onClose, onSaved }: {
  members: Member[]; me: string; existing: Slot[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [date, setDate] = useState(melbourneToday);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("13:00");
  const [len, setLen] = useState("30");
  const [gap, setGap] = useState("0");
  const [location, setLocation] = useState("");
  const [team, setTeam] = useState("");
  const [people, setPeople] = useState<string[]>(me ? [me] : []);
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
    const rows = fresh.map((p) => ({ ...p, location: location.trim(), team, interviewers: people }));
    const { error } = await portalClient().from("interview_slots").insert(rows);
    setBusy(false);
    if (error) { toast("Couldn't add slots: " + error.message); return; }
    toast(`Added ${rows.length} slot${rows.length === 1 ? "" : "s"}`);
    await onSaved();
    onClose();
  }

  const togglePerson = (email: string) => setPeople((p) => (p.includes(email) ? p.filter((x) => x !== email) : [...p, email]));

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
          <Select block label="Team" value={team} onChange={setTeam} options={[{ value: "", label: "Any team" }, ...TEAMS.map((t) => ({ value: t.name, label: t.name + " applicants" }))]} />
        </div>
      </div>
      <div className="crm-field">
        <label>Interviewers <span className="iv-label-note">get a calendar invite for each booking</span></label>
        {members.length ? (
          <div className="iv-people">
            {members.map((m) => (
              <label key={m.email} className="crm-check iv-person">
                <input type="checkbox" checked={people.includes(m.email)} onChange={() => togglePerson(m.email)} />
                <span>{m.firstName || m.email}{m.firstName ? <small>{m.email}</small> : null}</span>
              </label>
            ))}
          </div>
        ) : <p className="crm-help" style={{ margin: 0 }}>No committee members found.</p>}
      </div>
      {clashes ? (
        <p className="crm-settings-warn" role="alert"><Icon name="alert" size={14} />{clashes} of these overlap{clashes === 1 ? "s" : ""} a slot one of these interviewers already has.</p>
      ) : null}
      {!people.length ? <p className="crm-help" style={{ margin: 0 }}>No interviewers ticked, so nobody gets a calendar invite for these bookings.</p> : null}
    </Modal>
  );
}

// ---- Interviews tab -------------------------------------------------------------------------

export function Interviews({ applicants, slots, members, me, missing, onOpen, onReload }: {
  applicants: Applicant[]; slots: Slot[]; members: Member[]; me: string; missing: boolean;
  onOpen: (id: string) => void; onReload: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [now] = useState(() => Date.now());

  const byslot = useMemo(() => new Map(applicants.filter((a) => a.interviewSlotId).map((a) => [a.interviewSlotId, a])), [applicants]);
  const upcoming = slots.filter((s) => +new Date(s.endsAt) > now);
  const shown = showPast ? slots : upcoming;
  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of shown) m.set(dayKey(s.startsAt), [...(m.get(dayKey(s.startsAt)) ?? []), s]);
    return [...m.entries()];
  }, [shown]);
  const booked = upcoming.filter((s) => byslot.has(s.id)).length;
  const waiting = applicants.filter((a) => a.status === "invited" && !a.interviewSlotId);

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
        <button className="ui-btn ui-btn-primary" type="button" disabled={missing} onClick={() => setAdding(true)}><Icon name="plus" />Add slots</button>
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
        <h3>Schedule <small className="h-note">Melbourne time</small></h3>
        {days.length === 0 ? (
          <div className="iv-empty">
            <p className="ins-sub">No {showPast ? "" : "upcoming "}interview slots yet.</p>
            <button className="ui-btn ui-btn-primary" type="button" onClick={() => setAdding(true)}><Icon name="plus" />Add slots</button>
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
                        <td className="iv-time">{slotRange(s)}</td>
                        <td>
                          {a ? (
                            <button type="button" className="crm-linkbtn iv-cand" onClick={() => onOpen(a.id)}>
                              <span className="ui-dot" style={{ background: STAGE_BY_ID[a.status].color }} />{a.name || "Unnamed"}
                              <small>{a.role}</small>
                            </button>
                          ) : <span className="iv-open">Open{s.team ? <span className="crm-tag">{s.team} only</span> : null}</span>}
                        </td>
                        <td className="iv-loc">{s.location || "—"}</td>
                        <td className="iv-who">{s.interviewers.length ? s.interviewers.map((e) => memberName(members, e)).join(", ") : "—"}</td>
                        <td className="iv-act">
                          <Menu
                            label="Slot actions"
                            items={a ? [
                              { label: "Open " + (a.name || "applicant"), onSelect: () => onOpen(a.id) },
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

      <section className="ins-card ins-wide">
        <h3>Invited, not booked yet</h3>
        {waiting.length === 0 ? <p className="ins-sub">Everyone invited has booked a time.</p> : (
          <div className="ins-table-wrap">
            <table className="ins-table iv-table">
              <thead><tr><th>Applicant</th><th>Team</th><th>Invite sent</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {waiting.map((a) => {
                  const sent = sentEmails(a).invite;
                  return (
                    <tr key={a.id}>
                      <td><button type="button" className="crm-linkbtn" onClick={() => onOpen(a.id)}>{a.name || "Unnamed"}</button></td>
                      <td>{a.role || "—"}</td>
                      <td>{sent ? ago(sent) : "Not emailed"}</td>
                      <td className="iv-act">
                        <button className="ui-icon-btn" type="button" aria-label={"Copy " + (a.name || "their") + " booking link"} data-tip="Copy booking link" disabled={!inviteLink(a)} onClick={() => copyText(inviteLink(a), "Booking link copied")}>
                          <Icon name="copy" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adding ? <AddSlotsModal members={members} me={me} existing={slots} onClose={() => setAdding(false)} onSaved={onReload} /> : null}
    </div>
  );
}
