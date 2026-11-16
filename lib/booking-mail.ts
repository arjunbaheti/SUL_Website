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
};

const DOMAIN = "startuplinkunimelb.net";
// One calendar event per candidate: moving it updates the same event instead of adding another.
const candidateUid = (appId: string) => `interview-${appId}@${DOMAIN}`;
// Interviewers get one event per slot, since a different slot can mean different interviewers.
const interviewerUid = (appId: string, slotId: string) => `interview-${appId}-${slotId}@${DOMAIN}`;
// Calendar apps keep the highest sequence number, so later changes always win.
const sequence = () => Math.floor(Date.now() / 1000) - 1_700_000_000;

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
  const seq = sequence();
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
            uid: candidateUid(c.app_id), method: "REQUEST", sequence: seq,
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
            uid: candidateUid(c.app_id), method: "CANCEL", sequence: seq,
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
            uid: interviewerUid(c.app_id, oldSlot.id), method: "CANCEL", sequence: seq,
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
            uid: interviewerUid(c.app_id, newSlot.id), method: "REQUEST", sequence: seq,
            startsAt: newSlot.startsAt, endsAt: newSlot.endsAt, location: newSlot.location,
            summary: `Interview: ${c.name || "applicant"} (${c.role || "no team"})`,
            description: `Profile: ${profile}`, organizer, attendees: [{ email }],
          }),
        },
      }));
    }
  }

  const results = await Promise.allSettled(sends);
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (failed.length) throw new Error(`${failed.length} of ${results.length} emails failed: ${(failed[0].reason as Error)?.message || "unknown error"}`);
}
