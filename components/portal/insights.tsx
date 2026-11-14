"use client";

import { useMemo, useState } from "react";
import { SEND_META, STAGES, fmtDate, fmtDateTime, type Applicant, type StageId } from "@/lib/portal";

// Recruitment insights for the exec: volume, mix, funnel, timing and reviewer workload.
// Everything is computed from the applicants the board already loaded (no extra queries).
// Charts are single-series bars in one validated accent colour (--crm-bar), each labelled
// with its value so nothing relies on colour or hover alone.

const DAY = 86400000;
const FUNNEL: { label: string; from: StageId }[] = [
  { label: "Applied", from: "applied" },
  { label: "Reviewed", from: "review" },
  { label: "Invited", from: "invited" },
  { label: "Booked", from: "booked" },
  { label: "Interviewed", from: "interviewed" },
  { label: "Offered", from: "offer" },
];
const ORDER = Object.fromEntries(STAGES.map((s, i) => [s.id, i])) as Record<StageId, number>;
const LABEL_TO_STAGE = Object.fromEntries(STAGES.map((s) => [s.label, s.id])) as Record<string, StageId>;
const EMAILED = new Set(Object.values(SEND_META).map((m) => m.logged));

/** Furthest stage an applicant ever reached (rejected people keep the stage they got to). */
function reached(a: Applicant) {
  let best = a.status === "rejected" ? 0 : ORDER[a.status];
  for (const n of a.notes) {
    if (n.type !== "auto") continue;
    const m = /^Moved to (.+)$/.exec(n.text);
    const st = m ? LABEL_TO_STAGE[m[1]] : undefined;
    if (st && st !== "rejected") best = Math.max(best, ORDER[st]);
    if (n.text === SEND_META.invite.logged) best = Math.max(best, ORDER.invited);
    if (n.text === SEND_META.offer.logged) best = Math.max(best, ORDER.offer);
  }
  if (a.votes.length || a.notes.some((n) => n.type === "manual")) best = Math.max(best, ORDER.review);
  return best;
}

/** First time something happened, from the activity log. */
function firstAt(a: Applicant, test: (text: string) => boolean) {
  let t = "";
  for (const n of a.notes) if (n.type === "auto" && test(n.text) && (!t || n.ts < t)) t = n.ts;
  return t;
}

export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const days = (from: string, to: string) => (+new Date(to) - +new Date(from)) / DAY;
const fmtDays = (d: number | null) => (d === null ? "—" : d < 1 ? "< 1 day" : `${d.toFixed(d < 10 ? 1 : 0)} days`);
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) + "%" : "—");
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function countBy(items: string[], top = 8) {
  const m = new Map<string, number>();
  for (const k of items) m.set(k || "Not given", (m.get(k || "Not given") ?? 0) + 1);
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length <= top) return rows;
  const rest = rows.slice(top - 1).reduce((s, [, v]) => s + v, 0);
  return [...rows.slice(0, top - 1), ["Other", rest] as [string, number]];
}

export function Bars({ rows, total, note }: { rows: [string, number, string?][]; total: number; note?: string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="ins-bars">
      {rows.map(([label, v, extra]) => (
        <div className="ins-bar-row" key={label} title={`${label}: ${v} (${pct(v, total)})${extra ? " · " + extra : ""}`}>
          <span className="ins-bar-label">{label}</span>
          <span className="ins-bar-track"><span className="ins-bar-fill" style={{ width: `${(v / max) * 100}%` }} /></span>
          <span className="ins-bar-value">{v}<small> {pct(v, total)}</small>{extra ? <small className="ins-bar-extra"> · {extra}</small> : null}</span>
        </div>
      ))}
      {note ? <p className="ins-note">{note}</p> : null}
    </div>
  );
}

function Daily({ applicants, now }: { applicants: Applicant[]; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    if (!applicants.length) return [];
    const counts = new Map<string, number>();
    let first = now;
    for (const a of applicants) {
      const d = new Date(a.createdAt);
      if (isNaN(+d)) continue;
      first = Math.min(first, +d);
      counts.set(dayKey(d), (counts.get(dayKey(d)) ?? 0) + 1);
    }
    const start = new Date(Math.max(first, now - 59 * DAY)); // last 60 days at most
    start.setHours(0, 0, 0, 0);
    const out: { key: string; date: Date; n: number }[] = [];
    for (let t = +start; t <= now; t += DAY) {
      const d = new Date(t);
      out.push({ key: dayKey(d), date: d, n: counts.get(dayKey(d)) ?? 0 });
    }
    return out;
  }, [applicants, now]);
  if (!series.length) return null;
  const max = Math.max(1, ...series.map((s) => s.n));
  const h = hover !== null ? series[hover] : null;
  const peak = series.reduce((b, s) => (s.n > b.n ? s : b), series[0]);
  return (
    <div className="ins-daily">
      <div className="ins-daily-readout" aria-live="polite">
        {h
          ? <><strong>{h.n}</strong> application{h.n === 1 ? "" : "s"} on {h.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</>
          : <>Busiest day: <strong>{peak.n}</strong> on {peak.date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}. Hover a bar for that day.</>}
      </div>
      <div className="ins-daily-plot" role="img" aria-label={`Applications per day over the last ${series.length} days, peaking at ${peak.n}`} onMouseLeave={() => setHover(null)}>
        <div className="ins-gridline" style={{ bottom: "100%" }}><span>{max}</span></div>
        <div className="ins-gridline" style={{ bottom: "50%" }}><span>{Math.round(max / 2)}</span></div>
        {series.map((s, i) => (
          <div key={s.key} className={"ins-col" + (hover === i ? " is-hover" : "")} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${s.key}: ${s.n}`}>
            <span style={{ height: s.n ? `max(4px, ${(s.n / max) * 100}%)` : 0 }} />
          </div>
        ))}
      </div>
      <div className="ins-daily-axis">
        <span>{fmtDate(series[0].date.toISOString())}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

export function Insights({ applicants }: { applicants: Applicant[] }) {
  // "Now" is fixed when the page opens; switching tabs away and back refreshes it.
  const [now] = useState(() => Date.now());
  const d = useMemo(() => {
    const total = applicants.length;
    const thisWeek = applicants.filter((a) => now - +new Date(a.createdAt) < 7 * DAY).length;
    const lastWeek = applicants.filter((a) => { const age = now - +new Date(a.createdAt); return age >= 7 * DAY && age < 14 * DAY; }).length;
    const reach = applicants.map(reached);
    const funnel = FUNNEL.map((f) => [f.label, reach.filter((r) => r >= ORDER[f.from]).length] as [string, number]);
    const voted = applicants.filter((a) => a.votes.length > 0).length;
    const voted2 = applicants.filter((a) => a.votes.length >= 2).length;

    const toInvite: number[] = [], toBook: number[] = [], toDecision: number[] = [];
    for (const a of applicants) {
      const inv = firstAt(a, (t) => t === SEND_META.invite.logged);
      const booked = firstAt(a, (t) => t === "Moved to Interview booked");
      const decided = firstAt(a, (t) => t === SEND_META.offer.logged || t === SEND_META.reject.logged);
      if (inv) toInvite.push(days(a.createdAt, inv));
      if (inv && booked && booked > inv) toBook.push(days(inv, booked));
      if (decided) toDecision.push(days(a.createdAt, decided));
    }

    const teams = countBy(applicants.map((a) => a.role), 12).map(([team, n]) => {
      const second = applicants.filter((a) => a.roleSecondary === team).length;
      return [team, n, second ? `${second} as 2nd choice` : undefined] as [string, number, string?];
    });

    const people = new Map<string, { votes: number; notes: number; emails: number; last: string }>();
    const bump = (who: string, k: "votes" | "notes" | "emails", ts: string) => {
      if (!who) return;
      const p = people.get(who) ?? { votes: 0, notes: 0, emails: 0, last: "" };
      p[k]++;
      if (ts > p.last) p.last = ts;
      people.set(who, p);
    };
    for (const a of applicants) {
      for (const v of a.votes) bump(v.reviewer, "votes", v.updatedAt);
      for (const n of a.notes) {
        if (n.type === "manual" || n.type === "interview") bump(n.author, "notes", n.ts);
        else if (EMAILED.has(n.text)) bump(n.author, "emails", n.ts);
      }
    }
    const reviewers = [...people.entries()].sort((a, b) => (b[1].votes + b[1].notes) - (a[1].votes + a[1].notes));

    return {
      total, thisWeek, lastWeek, funnel, voted, voted2, teams, reviewers,
      // Years read best in calendar order, not by size.
      years: countBy(applicants.map((a) => a.yearLevel), 12).sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true })),
      degrees: countBy(applicants.map((a) => a.degree.trim())),
      timing: { toInvite: median(toInvite), toBook: median(toBook), toDecision: median(toDecision), nInvite: toInvite.length, nBook: toBook.length, nDecision: toDecision.length },
    };
  }, [applicants, now]);

  if (!d.total) {
    return <div className="state is-boxed"><h3>No data yet</h3><p>Insights fill in as applications arrive.</p></div>;
  }

  const delta = d.thisWeek - d.lastWeek;
  const tiles: [string, string, string][] = [
    ["Applications this week", String(d.thisWeek), d.lastWeek || d.thisWeek ? `${delta >= 0 ? "+" : ""}${delta} vs last week` : ""],
    ["Screened", pct(d.voted, d.total), `${d.voted} of ${d.total} have a vote · ${d.voted2} have 2+`],
    ["Interview rate", pct(d.funnel[3][1], d.total), `${d.funnel[3][1]} booked an interview`],
    ["Offer rate", pct(d.funnel[5][1], d.total), `${d.funnel[5][1]} offered a place`],
  ];

  return (
    <div className="ins">
      <div className="page-head ins-head">
        <div>
          <h1>Insights</h1>
          <p>Volume, funnel, timing and reviewer workload across {d.total} applicant{d.total === 1 ? "" : "s"}</p>
        </div>
      </div>
      <div className="ins-tiles">
        {tiles.map(([label, value, sub]) => (
          <div className="ins-tile" key={label}>
            <div className="ins-tile-label">{label}</div>
            <div className="ins-tile-value">{value}</div>
            {sub ? <div className="ins-tile-sub">{sub}</div> : null}
          </div>
        ))}
      </div>

      <section className="ins-card ins-wide">
        <h3>Applications per day</h3>
        <Daily applicants={applicants} now={now} />
      </section>

      <section className="ins-card">
        <h3>Recruitment funnel</h3>
        <p className="ins-sub">How far everyone got, including people later rejected. Percentages are of all applicants.</p>
        <Bars rows={d.funnel} total={d.total} />
      </section>

      <section className="ins-card">
        <h3>Time between steps</h3>
        <p className="ins-sub">Median, from the activity log.</p>
        <dl className="ins-timing">
          <div><dt>Applied → invite sent</dt><dd>{fmtDays(d.timing.toInvite)}<small>{d.timing.nInvite} people</small></dd></div>
          <div><dt>Invite sent → booked</dt><dd>{fmtDays(d.timing.toBook)}<small>{d.timing.nBook} people</small></dd></div>
          <div><dt>Applied → decision emailed</dt><dd>{fmtDays(d.timing.toDecision)}<small>{d.timing.nDecision} people</small></dd></div>
        </dl>
      </section>

      <section className="ins-card">
        <h3>First-choice team</h3>
        <Bars rows={d.teams} total={d.total} />
      </section>

      <section className="ins-card">
        <h3>Expected graduation</h3>
        <Bars rows={d.years} total={d.total} />
      </section>

      <section className="ins-card">
        <h3>Degree</h3>
        <Bars rows={d.degrees} total={d.total} note="Top degrees as typed by applicants; the rest are grouped as Other." />
      </section>

      <section className="ins-card ins-wide">
        <h3>Reviewer activity</h3>
        {d.reviewers.length ? (
          <div className="ins-table-wrap">
            <table className="ins-table">
              <thead><tr><th>Reviewer</th><th>Screening votes</th><th>Notes written</th><th>Emails sent</th><th>Last active</th></tr></thead>
              <tbody>
                {d.reviewers.map(([who, p]) => (
                  <tr key={who}><td>{who}</td><td>{p.votes}</td><td>{p.notes}</td><td>{p.emails}</td><td>{p.last ? fmtDateTime(p.last) : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="ins-sub">No votes or notes yet.</p>}
      </section>
    </div>
  );
}
