// Server-only: the emails that go out when an interview is booked, moved or cancelled.
// Each carries a calendar invite, so the interview appears in (or disappears from) the
// candidate's and interviewers' calendars. No Google API involved.
import { bookingUrl, buildIcs, fmtSlotLong, slotFromRow, type Slot } from "./booking";
import { clubAddress, cleanFromName, cleanReplyTo, sendClubMail } from "./mailer";
import { fillTemplate, mergeSettings } from "./settings";

/** What the database's booking functions return when something changed. */
export type BookingChange = {
  changed: boolean;
  app_id?: string; name?: string; email?: string; role?: string; token?: string;
  old?: unknown; new?: unknown; settings?: unknown;
  /** From the database (2026-11-17 update): goes up on every change, so calendar updates apply in
   *  the order the database made them. */
  seq?: number;
  /** Which booking this is: a new one after a cancel gets a new number, so a cancelled event's UID
   *  is never revived (some calendars ignore that). */
  booking_no?: number;
  /** The change number when the old slot was booked: its interviewers' event UID. */
  old_slot_seq?: number;
};

const DOMAIN = "startuplinkunimelb.net";
// The candidate's event: one per booking, so moving updates the same event and a rebooking after a
// cancel gets a fresh one. Must match booking_info()'s cal_uid (the booking page's "Add to calendar").
const candidateUid = (appId: string, bookingNo: number) => `interview-${appId}-${bookingNo}@${DOMAIN}`;
// Interviewers: one event per (slot, change that put them there), since different slots can mean
// different interviewers, and moving back to a slot later must not revive its cancelled event.
const interviewerUid = (appId: string, slotId: string, seq: number) => `interview-${appId}-${slotId}-${seq}@${DOMAIN}`;
// Before the 2026-11-17 database update there's no counter: fall back to the clock (tenths of a
// second, inside a 32-bit integer).
const clockSeq = () => Math.floor(Date.now() / 100) - 17_600_000_000;

export async function sendBookingEmails(c: BookingChange, origin: string, opts: { emailCandidate: boolean }) {
  if (!c.changed || !c.app_id) return;
  const settings = mergeSettings(c.settings);
  const from = cleanFromName(settings.senderName);
  const replyTo = cleanReplyTo(settings.replyTo) || "";
  const organizer = { name: from, email: clubAddress() };
  const oldSlot: Slot | null = c.old ? slotFromRow(c.old) : null;
  const newSlot: Slot | null = c.new ? slotFromRow(c.new) : null;
  const who = { name: c.name || "", role: c.role || "" };
  const first = (c.name || "").trim().split(/\s+/)[0] || "there";
  const link = bookingUrl(origin, c.token || "");
  const profile = `${origin.replace(/\/+$/, "")}/portal?a=${encodeURIComponent(c.app_id)}`;
  const fromDb = typeof c.seq === "number";
  const seq = fromDb ? c.seq! : clockSeq();
  const bookingNo = typeof c.booking_no === "number" ? c.booking_no : 0;
  const oldSlotSeq = typeof c.old_slot_seq === "number" ? c.old_slot_seq : 0;
  const sends: Promise<void>[] = [];
  const summary = `StartUp Link interview${c.role ? " · " + c.role : ""}`;

  // ---- Candidate
  if (opts.emailCandidate && c.email) {
    if (newSlot) {
      const extra = { when: fmtSlotLong(newSlot), location: newSlot.location };
      sends.push(sendClubMail({
        to: c.email, fromName: from, replyTo,
        subject: fillTemplate(settings.templates.booked.subject, who, link, extra),
        text: fillTemplate(settings.templates.booked.body, who, link, extra),
        ics: {
          method: "REQUEST",
          content: buildIcs({
            uid: candidateUid(c.app_id, bookingNo), method: "REQUEST", sequence: seq,
            startsAt: newSlot.startsAt, endsAt: newSlot.endsAt, location: newSlot.location,
            summary, description: `Your StartUp Link UniMelb interview.\nChange or cancel: ${link}`,
            organizer, attendees: [{ name: c.name, email: c.email }],
          }),
        },
      }));
    } else if (oldSlot) {
      sends.push(sendClubMail({
        to: c.email, fromName: from, replyTo,
        subject: "Interview cancelled — StartUp Link UniMelb",
        text: `Hi ${first},\n\nYour interview on ${fmtSlotLong(oldSlot)} has been cancelled.\n\nIf you'd like to pick another time, use your booking link:\n${link}\n\nIf you have any questions, just reply to this email.\n\n${from}`,
        ics: {
          method: "CANCEL",
          content: buildIcs({
            uid: candidateUid(c.app_id, bookingNo), method: "CANCEL", sequence: seq,
            startsAt: oldSlot.startsAt, endsAt: oldSlot.endsAt, summary, organizer,
            attendees: [{ name: c.name, email: c.email }],
          }),
        },
      }));
    }
  }

  // ---- Interviewers on the old slot (cancelled or moved away)
  if (oldSlot && (!newSlot || newSlot.id !== oldSlot.id)) {
    for (const email of oldSlot.interviewers) {
      sends.push(sendClubMail({
        to: email, fromName: from, replyTo,
        subject: `${newSlot ? "Moved" : "Cancelled"}: interview with ${c.name || "an applicant"}`,
        text: `${c.name || "An applicant"} (${c.role || "no team"}) is no longer in your interview slot on ${fmtSlotLong(oldSlot)}.` +
          (newSlot ? `\n\nThey've moved to ${fmtSlotLong(newSlot)}.` : "") + `\n\nProfile: ${profile}`,
        ics: {
          method: "CANCEL",
          content: buildIcs({
            uid: interviewerUid(c.app_id, oldSlot.id, oldSlotSeq), method: "CANCEL", sequence: seq,
            startsAt: oldSlot.startsAt, endsAt: oldSlot.endsAt, summary: `Interview: ${c.name || "applicant"}`,
            organizer, attendees: [{ email }],
          }),
        },
      }));
    }
  }

  // ---- Interviewers on the new slot
  if (newSlot) {
    for (const email of newSlot.interviewers) {
      sends.push(sendClubMail({
        to: email, fromName: from, replyTo,
        subject: `Interview booked: ${c.name || "an applicant"} (${c.role || "no team"})`,
        text: `${c.name || "An applicant"} has booked an interview for ${c.role || "the committee"}.\n\nWhen: ${fmtSlotLong(newSlot)}\nWhere: ${newSlot.location || "To be confirmed"}\n\nProfile, resume and notes: ${profile}`,
        ics: {
          method: "REQUEST",
          content: buildIcs({
            uid: interviewerUid(c.app_id, newSlot.id, seq), method: "REQUEST", sequence: seq,
            startsAt: newSlot.startsAt, endsAt: newSlot.endsAt, location: newSlot.location,
            summary: `Interview: ${c.name || "applicant"} (${c.role || "no team"})`,
            description: `Profile: ${profile}`, organizer, attendees: [{ email }],
          }),
        },
      }));
    }
  }

  // Sent one after another over a single Gmail connection (see sendClubMail).
  const results = await Promise.allSettled(sends);
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (failed.length) throw new Error(`${failed.length} of ${results.length} emails failed: ${(failed[0].reason as Error)?.message || "unknown error"}`);
}
