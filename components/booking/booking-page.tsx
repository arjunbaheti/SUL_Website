"use client";

import { useCallback, useEffect, useState } from "react";
import { applyClient } from "@/lib/supabase";
import { buildIcs, dayKey, fmtDayLong, fmtSlotLong, fmtTime } from "@/lib/booking";

// The candidate's view: pick an interview time, then see, change or cancel it.
// Everything is read through booking_info(token) and changed through /api/booking, which
// emails the confirmation and calendar invites.

type OpenSlot = { id: string; starts_at: string; ends_at: string; location: string };
type Info = {
  first_name: string; role: string; open: boolean; cutoff_hours: number;
  current: (OpenSlot & { can_change: boolean }) | null;
  slots: OpenSlot[];
};
type Phase = "loading" | "invalid" | "error" | "ready";

const span = (s: { starts_at: string; ends_at: string }) => ({ startsAt: s.starts_at, endsAt: s.ends_at });

function downloadIcs(s: OpenSlot, role: string) {
  const ics = buildIcs({
    uid: `interview-${s.id}@startuplinkunimelb.net`, method: "PUBLISH", sequence: 0,
    startsAt: s.starts_at, endsAt: s.ends_at, location: s.location,
    summary: `StartUp Link interview${role ? " · " + role : ""}`,
    description: `Your StartUp Link UniMelb interview. Change or cancel: ${window.location.href}`,
  });
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url; a.download = "startup-link-interview.ics";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BookingPage({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [info, setInfo] = useState<Info | null>(null);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [justBooked, setJustBooked] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await applyClient().rpc("booking_info", { p_token: token });
    if (error) { setPhase("error"); return; }
    if (!data) { setPhase("invalid"); return; }
    setInfo(data as Info);
    setPhase("ready");
  }, [token]);

  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const byDay = new Map<string, OpenSlot[]>();
  for (const s of info?.slots ?? []) {
    if (s.id === info?.current?.id) continue;
    const k = dayKey(s.starts_at);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const days = [...byDay.values()];
  const chosenSlot = info?.slots.find((s) => s.id === chosen) ?? null;

  async function call(payload: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/booking", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...payload }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string; emailed?: boolean };
      if (!res.ok || !body.ok) {
        setMsg({ text: body.error || "Something went wrong. Please try again.", error: true });
        if (body.code === "slot_taken" || body.code === "slot_missing" || body.code === "too_late") { setChosen(null); await load(); }
        return null;
      }
      return body;
    } catch {
      setMsg({ text: "Couldn't reach the server. Check your connection and try again.", error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!chosen) return;
    const r = await call({ slotId: chosen });
    if (!r) return;
    setChosen(null); setPicking(false); setJustBooked(true);
    setMsg(r.emailed === false
      ? { text: "You're booked, but we couldn't send the confirmation email. Save the details below.", error: true }
      : { text: "Confirmation sent to your email, with a calendar invite.", error: false });
    await load();
  }

  async function cancel() {
    if (!window.confirm("Cancel your interview? You can book a new time afterwards.")) return;
    const r = await call({ cancel: true });
    if (!r) return;
    setJustBooked(false); setPicking(true);
    setMsg({ text: "Your interview has been cancelled. Pick a new time below whenever you're ready.", error: false });
    await load();
  }

  if (phase === "loading") {
    return <div className="book-card book-loading" aria-busy="true"><span className="book-spinner" />Loading your booking…</div>;
  }
  if (phase === "invalid" || phase === "error" || !info) {
    return (
      <div className="book-card">
        <h1 className="book-title">{phase === "invalid" ? "This link isn't valid" : "Something went wrong"}</h1>
        <p className="book-lead">
          {phase === "invalid"
            ? "Check you've used the full link from your interview invite email. If it still doesn't work, reply to that email and we'll help."
            : "We couldn't load your booking. Please refresh the page in a moment."}
        </p>
      </div>
    );
  }

  const cur = info.current;
  const showPicker = info.open && (!cur || picking);
  const hours = Math.round(info.cutoff_hours);

  return (
    <div className="book-card">
      <p className="book-eyebrow">StartUp Link UniMelb · {info.role || "Committee"} interview</p>
      <h1 className="book-title">
        {cur ? (justBooked ? `You're booked, ${info.first_name}!` : `Your interview, ${info.first_name}`) : `Hi ${info.first_name}, pick your interview time`}
      </h1>

      {msg ? <p className={"book-msg" + (msg.error ? " is-error" : "")} role={msg.error ? "alert" : "status"}>{msg.text}</p> : null}

      {cur ? (
        <div className="book-current">
          <div className="book-when">
            <strong>{fmtDayLong(cur.starts_at)}</strong>
            <span>{fmtTime(cur.starts_at)} – {fmtTime(cur.ends_at)} (Melbourne time)</span>
          </div>
          <div className="book-where">{cur.location || "Location to be confirmed. We'll email you the details."}</div>
          <div className="book-actions">
            <button className="btn btn-primary" type="button" onClick={() => downloadIcs(cur, info.role)}>Add to calendar</button>
            {cur.can_change && info.open ? (
              <>
                <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => { setPicking((p) => !p); setChosen(null); setMsg(null); }}>
                  {picking ? "Keep this time" : "Change time"}
                </button>
                <button className="book-link-btn" type="button" disabled={busy} onClick={cancel}>Cancel interview</button>
              </>
            ) : null}
          </div>
          {!cur.can_change ? (
            <p className="book-note">Your interview is less than {hours} hours away, so it can&apos;t be changed online. If something comes up, reply to your invite email.</p>
          ) : null}
        </div>
      ) : !info.open ? (
        <p className="book-lead">Interview booking is closed for this application. If you think that&apos;s a mistake, reply to the email we sent you.</p>
      ) : (
        <p className="book-lead">Pick any time below. All times are Melbourne time, and you can change or cancel later from this page.</p>
      )}

      {showPicker ? (
        <div className="book-picker">
          {cur ? <h2 className="book-sub">Pick a new time</h2> : null}
          {days.length === 0 ? (
            <p className="book-note">
              There are no open times right now{hours ? ` (bookings close ${hours} hours before each interview)` : ""}. Reply to your invite email and we&apos;ll find a time that works.
            </p>
          ) : (
            days.map((slots) => (
              <div className="book-day" key={slots[0].starts_at}>
                <h3>{fmtDayLong(slots[0].starts_at)}</h3>
                <div className="book-times" role="radiogroup" aria-label={fmtDayLong(slots[0].starts_at)}>
                  {slots.map((s) => (
                    <button
                      key={s.id} type="button" role="radio" aria-checked={chosen === s.id}
                      className={"book-time" + (chosen === s.id ? " is-on" : "")}
                      onClick={() => setChosen(chosen === s.id ? null : s.id)}
                    >
                      {fmtTime(s.starts_at)}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          {chosenSlot ? (
            <div className="book-confirm">
              <div>
                <strong>{fmtSlotLong(span(chosenSlot))}</strong>
                {chosenSlot.location ? <span>{chosenSlot.location}</span> : null}
              </div>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={book}>
                {busy ? "Booking…" : cur ? "Move to this time" : "Confirm booking"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
