// Interview booking: shared by the public booking page, the portal and the server route.
// All interview times are Melbourne time, whatever time zone the viewer's device is in.

export const TZ = "Australia/Melbourne";

export type Slot = {
  id: string;
  startsAt: string; endsAt: string;
  location: string;
  interviewers: string[];
  team: string; // only for slots without a session: '' = any team
  sessionId: string; // the named session it belongs to, or ""
};

/** A named group of slots ("Project interviews") and who it's for. */
export type Session = {
  id: string;
  name: string;
  teams: string[]; // [] = every team
  interviewers: string[];
  location: string;
  note: string; // shown to candidates on the booking page
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function slotFromRow(r: any): Slot {
  return {
    id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, location: r.location || "",
    interviewers: Array.isArray(r.interviewers) ? r.interviewers : [], team: r.team || "",
    sessionId: r.session_id || "",
  };
}

export function sessionFromRow(r: any): Session {
  return {
    id: r.id, name: r.name || "", teams: Array.isArray(r.teams) ? r.teams : [],
    interviewers: Array.isArray(r.interviewers) ? r.interviewers : [], location: r.location || "", note: r.note || "",
  };
}

/** Can this applicant book this session's slots? First-choice team, or a second-choice team
 *  they've been flagged for. Mirrors _slot_open_to() in the database. */
export function sessionFits(s: Pick<Session, "teams">, a: { role: string; roleSecondary: string; secondChoiceFlag: boolean }) {
  return !s.teams.length || s.teams.includes(a.role) || (a.secondChoiceFlag && !!a.roleSecondary && s.teams.includes(a.roleSecondary));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o }).format(new Date(iso));

/** "2:30 pm" */
export const fmtTime = (iso: string) => fmt(iso, { hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.?m\.?/i, " $1m");
/** "Tuesday 24 November" */
export const fmtDayLong = (iso: string) => fmt(iso, { weekday: "long", day: "numeric", month: "long" });
/** "Tue 24 Nov" */
export const fmtDayShort = (iso: string) => fmt(iso, { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
/** "Tuesday 24 November, 2:30 pm – 3:00 pm (Melbourne time)" */
export const fmtSlotLong = (s: { startsAt: string; endsAt: string }) =>
  `${fmtDayLong(s.startsAt)}, ${fmtTime(s.startsAt)} – ${fmtTime(s.endsAt)} (Melbourne time)`;
/** "Tue 24 Nov · 2:30 pm" */
export const fmtSlotShort = (iso: string) => `${fmtDayShort(iso)} · ${fmtTime(iso)}`;
/** Melbourne calendar day, for grouping: "2026-11-24" */
export const dayKey = (iso: string) => fmt(iso, { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("-");

/** Melbourne's offset from UTC (ms) at a given instant. */
function tzOffset(utcMs: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

/** A Melbourne wall-clock date ("2026-11-24") and time ("14:30") as a UTC instant. */
export function melbourneToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let utc = wall - tzOffset(wall);
  utc = wall - tzOffset(utc); // second pass settles daylight-saving changeovers
  return new Date(utc);
}

/** Today's date in Melbourne, "2026-11-24" (for date inputs). */
export const melbourneToday = () => dayKey(new Date().toISOString());

/** The live site's address, used for every link that goes out in an email (set in next.config.ts). */
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://sul-website.vercel.app").replace(/\/+$/, "");

/** The candidate's personal booking page. */
export const bookingUrl = (origin: string, token: string) => (token ? origin.replace(/\/+$/, "") + "/book/" + token : "");

// ---- Calendar invites (.ics) -----------------------------------------------------------------

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Lines over 75 bytes are folded onto continuation lines, as the format requires. */
function fold(line: string) {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export type IcsEvent = {
  uid: string;
  method: "REQUEST" | "CANCEL" | "PUBLISH";
  sequence: number;
  startsAt: string; endsAt: string;
  summary: string; description?: string; location?: string;
  organizer?: { name: string; email: string };
  attendees?: { name?: string; email: string }[];
};

export function buildIcs(e: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//StartUp Link UniMelb//Interviews//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:" + e.method,
    "BEGIN:VEVENT",
    "UID:" + e.uid,
    "DTSTAMP:" + icsDate(new Date().toISOString()),
    "SEQUENCE:" + e.sequence,
    "DTSTART:" + icsDate(e.startsAt),
    "DTEND:" + icsDate(e.endsAt),
    "SUMMARY:" + icsText(e.summary),
    ...(e.location ? ["LOCATION:" + icsText(e.location)] : []),
    ...(e.description ? ["DESCRIPTION:" + icsText(e.description)] : []),
    ...(e.organizer ? [`ORGANIZER;CN=${icsText(e.organizer.name)}:mailto:${e.organizer.email}`] : []),
    ...(e.attendees ?? []).map((a) =>
      `ATTENDEE;${a.name ? "CN=" + icsText(a.name) + ";" : ""}ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    "STATUS:" + (e.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"),
    ...(e.method === "CANCEL" ? [] : ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsText(e.summary), "TRIGGER:-PT1H", "END:VALARM"]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
