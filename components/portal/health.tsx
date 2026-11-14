"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { portalClient } from "@/lib/supabase";
import { fmtDate } from "@/lib/portal";
import { Bars, median, pct } from "./insights";
import { Icon } from "./icons";
import { Menu, Segmented, confirmDialog, toast } from "./ui";

// Application health: how people get on with the public application form, from the anonymous
// progress events in public.form_events (lib/form-tracking.ts). Answers are never stored, only
// which fields each visit filled in, where submit was blocked, and whether it went through.

type Ev = { session_id: string; event: string; field: string | null; device: string | null; created_at: string };

const DAY = 86400000;
const IDLE_MS = 30 * 60000; // no activity for 30 minutes = they've left
const LIVE_EVERY_MS = 20000;
const PAGE = 1000;
const MAX_ROWS = 50000;

const FIELD_LABEL: Record<string, string> = {
  name: "Full name", email: "Email", phone: "Phone", degree: "Degree", year: "Graduation date",
  role: "First-choice team", role2: "Second-choice team", statement: "Why join (200 words)",
  experience: "Skills & experience", linkedin: "Link", resume: "Resume upload", extra: "Extra attachment",
  extra_note: "Attachment note", questions: "Questions", consent: "Consent box",
  upload: "File upload", save: "Saving the application",
};
const label = (f: string) => FIELD_LABEL[f] ?? f;

// Funnel stages, in the order the form asks for things. A visit's stage is the furthest one it
// reached; the four middle milestones each need all of their fields filled in.
const STAGES = [
  "Opened the form", "Started typing", "Finished About you", "Answered both questions",
  "Attached a resume", "Ticked consent", "Pressed submit", "Submitted",
];
const MILESTONES: string[][] = [
  ["name", "email", "degree", "year"],
  ["role", "statement", "experience"],
  ["resume"],
  ["consent"],
];
const SUBMITTED = STAGES.length - 1;

type Visit = {
  first: number; last: number; device: string; started: boolean; startAt: number;
  fields: Set<string>; lastField: string; attempted: boolean; blockedOn: Set<string>;
  errors: string[]; submitted: boolean; submittedAt: number; stage: number;
};
type Range = "7" | "30" | "all";
type Device = "all" | "desktop" | "mobile";

const fmtMins = (ms: number | null) => {
  if (ms === null) return "—";
  const m = ms / 60000;
  if (m < 1) return "< 1 min";
  if (m < 60) return `${Math.round(m)} min`;
  return `${(m / 60).toFixed(1)} h`;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function countTop(keys: string[], n = 8): [string, number][] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return rows.length <= n ? rows : [...rows.slice(0, n - 1), ["Other", rows.slice(n - 1).reduce((s, [, x]) => s + x, 0)]];
}

async function loadEvents(): Promise<{ rows: Ev[]; error: string; missing: boolean }> {
  const db = portalClient();
  const rows: Ev[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db
      .from("form_events")
      .select("session_id, event, field, device, created_at")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { rows, error: error.message, missing: /form_events|does not exist|schema cache/i.test(error.message) };
    rows.push(...((data ?? []) as Ev[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: "", missing: false };
}

function buildVisits(rows: Ev[]): Visit[] {
  const visits = new Map<string, Visit>();
  for (const e of rows) {
    const t = +new Date(e.created_at);
    let v = visits.get(e.session_id);
    if (!v) {
      v = { first: t, last: t, device: e.device || "desktop", started: false, startAt: 0, fields: new Set(), lastField: "",
        attempted: false, blockedOn: new Set(), errors: [], submitted: false, submittedAt: 0, stage: 0 };
      visits.set(e.session_id, v);
    }
    v.first = Math.min(v.first, t);
    v.last = Math.max(v.last, t);
    if (e.event === "start" || e.event === "field") { if (!v.started) v.startAt = t; v.started = true; }
    if (e.event === "field" && e.field) { v.fields.add(e.field); v.lastField = e.field; }
    if (e.event === "invalid" && e.field) { v.attempted = true; v.blockedOn.add(e.field); }
    if (e.event === "submit") v.attempted = true;
    if (e.event === "error" && e.field) v.errors.push(e.field);
    if (e.event === "submitted") { v.submitted = true; v.submittedAt = t; v.attempted = true; }
  }
  for (const v of visits.values()) {
    let s = v.started ? 1 : 0;
    MILESTONES.forEach((fields, i) => { if (fields.every((f) => v.fields.has(f))) s = Math.max(s, 2 + i); });
    if (v.attempted) s = Math.max(s, 6);
    if (v.submitted) s = SUBMITTED;
    v.stage = s;
  }
  return [...visits.values()];
}

/* ---------------------------------------------------------------------------------------------
 * Funnel: each stage is a bar centred on the axis, joined to the next by a tapering neck that
 * shows how many were lost in between. Click a stage to see who stopped there.
 * ------------------------------------------------------------------------------------------- */
function Funnel({ counts, selected, onSelect }: { counts: number[]; selected: number | null; onSelect: (i: number | null) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(1, counts[0]);
  const w = (n: number) => Math.max(4, (n / top) * 100);
  const focus = hover ?? selected;
  return (
    <div className="fn" onMouseLeave={() => setHover(null)}>
      {counts.map((n, i) => {
        const next = counts[i + 1];
        const lost = next === undefined ? 0 : n - next;
        const last = i === counts.length - 1;
        return (
          <Fragment key={STAGES[i]}>
            <button
              type="button"
              className={"fn-row" + (selected === i ? " is-selected" : "") + (focus !== null && focus !== i ? " is-dim" : "") + (last ? " is-last" : "")}
              aria-pressed={last ? undefined : selected === i}
              disabled={last}
              title={last ? undefined : `See who stopped after “${STAGES[i]}”`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect(selected === i ? null : i)}
            >
              <span className="fn-label">{STAGES[i]}</span>
              <span className="fn-track"><span className="fn-bar" style={{ width: w(n) + "%" }} /></span>
              <span className="fn-num"><strong>{n}</strong><small>{pct(n, top)}</small></span>
            </button>
            {next !== undefined ? (
              <div className={"fn-gap" + (focus !== null && focus !== i ? " is-dim" : "") + (selected === i ? " is-selected" : "")} aria-hidden="true">
                <span />
                <span
                  className="fn-neck"
                  style={{ clipPath: `polygon(${(100 - w(n)) / 2}% 0, ${(100 + w(n)) / 2}% 0, ${(100 + w(next)) / 2}% 100%, ${(100 - w(next)) / 2}% 100%)` }}
                />
                <span className="fn-drop">{lost > 0 ? <>−{lost}<small> {pct(lost, n)}</small></> : null}</span>
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Daily: started vs submitted (stacked), or the completion rate per day.
 * ------------------------------------------------------------------------------------------- */
function Daily({ days }: { days: { date: Date; started: number; submitted: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [mode, setMode] = useState<"volume" | "rate">("volume");
  if (!days.length) return <p className="ins-sub">Nothing in this period.</p>;
  const max = mode === "rate" ? 100 : Math.max(1, ...days.map((d) => d.started));
  const h = hover !== null ? days[hover] : null;
  const total = days.reduce((s, d) => s + d.started, 0);
  const done = days.reduce((s, d) => s + d.submitted, 0);
  return (
    <div className="ins-daily">
      <div className="hl-daily-head">
        <div className="ins-daily-readout" aria-live="polite">
          {h
            ? <><strong>{h.started}</strong> started · <strong>{h.submitted}</strong> submitted{h.started ? <> · <strong>{pct(h.submitted, h.started)}</strong> completed</> : null} on {h.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</>
            : <><strong>{total}</strong> started and <strong>{done}</strong> submitted over {days.length} days. Hover a day for detail.</>}
        </div>
        <Segmented
          size="sm"
          label="Chart"
          value={mode}
          onChange={setMode}
          options={[{ value: "volume", label: "Volume" }, { value: "rate", label: "Completion %" }]}
        />
      </div>
      <div className="ins-daily-plot" role="img" aria-label={`Applications started and submitted per day over ${days.length} days`} onMouseLeave={() => setHover(null)}>
        <div className="ins-gridline" style={{ bottom: "100%" }}><span>{mode === "rate" ? "100%" : max}</span></div>
        <div className="ins-gridline" style={{ bottom: "50%" }}><span>{mode === "rate" ? "50%" : Math.round(max / 2)}</span></div>
        {days.map((d, i) => {
          const rate = d.started ? (d.submitted / d.started) * 100 : 0;
          return (
            <div
              key={d.date.toISOString()}
              className={"ins-col" + (hover === i ? " is-hover" : "")}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              tabIndex={0}
              aria-label={`${dayKey(d.date)}: ${d.started} started, ${d.submitted} submitted`}
            >
              {mode === "volume" ? (
                <span className="hl-stack" style={{ height: d.started ? `max(4px, ${(d.started / max) * 100}%)` : 0 }}>
                  <span className="hl-done" style={{ height: d.started ? `${(d.submitted / d.started) * 100}%` : 0 }} />
                </span>
              ) : (
                <span className="hl-rate" style={{ height: d.started ? `max(3px, ${rate}%)` : 0 }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="ins-daily-axis">
        <span>{fmtDate(days[0].date.toISOString())}</span>
        {mode === "volume"
          ? <span className="hl-legend"><i className="hl-key is-start" />Started <i className="hl-key is-done" />Submitted</span>
          : <span className="hl-legend"><i className="hl-key is-done" />Share of that day&apos;s starters who submitted</span>}
        <span>Today</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Heatmap: when people start applications, by weekday and hour (local time).
 * ------------------------------------------------------------------------------------------- */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function Heatmap({ visits }: { visits: Visit[] }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const grid = useMemo(() => {
    const g = WEEKDAYS.map(() => Array<number>(24).fill(0));
    for (const v of visits) {
      if (!v.started && !v.submitted) continue;
      const d = new Date(v.startAt || v.first);
      g[(d.getDay() + 6) % 7][d.getHours()]++;
    }
    return g;
  }, [visits]);
  const max = Math.max(1, ...grid.flat());
  const busiest = grid.flatMap((row, d) => row.map((n, hr) => ({ d, hr, n }))).sort((a, b) => b.n - a.n)[0];
  const hourLabel = (hr: number) => (hr === 0 ? "12am" : hr < 12 ? `${hr}am` : hr === 12 ? "12pm" : `${hr - 12}pm`);
  const hv = hover ? { d: hover[0], hr: hover[1], n: grid[hover[0]][hover[1]] } : null;
  return (
    <div className="hm">
      <div className="ins-daily-readout" aria-live="polite">
        {hv
          ? <><strong>{hv.n}</strong> started on {WEEKDAYS[hv.d]} between {hourLabel(hv.hr)} and {hourLabel((hv.hr + 1) % 24)}</>
          : busiest?.n ? <>Busiest: <strong>{WEEKDAYS[busiest.d]} {hourLabel(busiest.hr)}</strong> ({busiest.n} started). Hover a cell for detail.</> : "No starts in this period."}
      </div>
      <div className="hm-grid" role="img" aria-label="Applications started by weekday and hour" onMouseLeave={() => setHover(null)}>
        {grid.map((row, d) => (
          <Fragment key={WEEKDAYS[d]}>
            <span className="hm-day">{WEEKDAYS[d]}</span>
            {row.map((n, hr) => (
              <span
                key={hr}
                className={"hm-cell" + (hover && hover[0] === d && hover[1] === hr ? " is-hover" : "")}
                style={{ "--a": n ? 0.15 + (n / max) * 0.85 : 0 } as React.CSSProperties}
                onMouseEnter={() => setHover([d, hr])}
              />
            ))}
          </Fragment>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, hr) => <span key={hr} className="hm-hour">{hr % 6 === 0 ? hourLabel(hr) : ""}</span>)}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The Health view.
 * ------------------------------------------------------------------------------------------- */
export function Health() {
  const [rows, setRows] = useState<Ev[] | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [range, setRange] = useState<Range>("30");
  const [device, setDevice] = useState<Device>("all");
  const [live, setLive] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    const r = await loadEvents();
    setRows(r.rows);
    setError(r.error);
    setMissing(r.missing);
    setNow(Date.now());
    setLoadedAt(Date.now());
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, LIVE_EVERY_MS);
    return () => clearInterval(t);
  }, [live, load]);

  const allVisits = useMemo(() => (rows ? buildVisits(rows) : []), [rows]);

  const d = useMemo(() => {
    const from = range === "all" ? 0 : now - Number(range) * DAY;
    const visits = allVisits.filter((v) => v.first >= from && (device === "all" || v.device === device));
    const isLive = (v: Visit) => !v.submitted && now - v.last < IDLE_MS;
    const started = visits.filter((v) => v.stage >= 1);
    const submitted = visits.filter((v) => v.submitted);
    const live = started.filter(isLive);
    const dropped = started.filter((v) => !v.submitted && !isLive(v));

    const counts = STAGES.map((_, i) => visits.filter((v) => v.stage >= i).length);
    // Everyone whose furthest stage was `i` and has since left.
    const lostAt = (i: number) => visits.filter((v) => v.stage === i && !isLive(v) && !v.submitted);

    const blocked = started.filter((v) => v.blockedOn.size);
    const days: { date: Date; started: number; submitted: number }[] = [];
    if (started.length) {
      const firstStart = Math.min(...started.map((v) => v.startAt || v.first));
      const start = new Date(Math.max(firstStart, range === "all" ? now - 89 * DAY : from));
      start.setHours(0, 0, 0, 0);
      const byDay = new Map<string, { started: number; submitted: number }>();
      for (const v of started) {
        const k = dayKey(new Date(v.startAt || v.first));
        const b = byDay.get(k) ?? { started: 0, submitted: 0 };
        b.started++;
        if (v.submitted) b.submitted++;
        byDay.set(k, b);
      }
      for (let t = +start; t <= now; t += DAY) {
        const date = new Date(t);
        days.push({ date, ...(byDay.get(dayKey(date)) ?? { started: 0, submitted: 0 }) });
      }
    }

    const devices = (["desktop", "mobile"] as const).map((dev) => {
      const vs = allVisits.filter((v) => v.first >= from && v.device === dev);
      return { dev, visits: vs.length, started: vs.filter((v) => v.stage >= 1).length, submitted: vs.filter((v) => v.submitted).length };
    });

    return {
      visits, started, submitted, live, dropped, counts, lostAt, days, devices,
      blockers: countTop(started.flatMap((v) => [...v.blockedOn].map(label))),
      blocked: blocked.length,
      blockedThenSubmitted: blocked.filter((v) => v.submitted).length,
      errors: countTop(visits.flatMap((v) => v.errors.map(label))),
      timeToSubmit: median(submitted.filter((v) => v.startAt).map((v) => v.submittedAt - v.startAt)),
      timeBeforeLeaving: median(dropped.map((v) => v.last - (v.startAt || v.first))),
      since: rows?.length ? rows[0].created_at : "",
    };
  }, [allVisits, rows, range, device, now]);

  async function clearAll() {
    const ok = await confirmDialog({
      title: "Clear all health data?",
      body: "Deletes every tracked form visit, e.g. after testing the form yourselves. Applications aren't affected. This can't be undone.",
      confirmLabel: "Clear data",
      danger: true,
    });
    if (!ok) return;
    const { error: err } = await portalClient().from("form_events").delete().gte("id", 0);
    if (err) { toast("Couldn't clear: " + err.message); return; }
    toast("Health data cleared");
    setStep(null);
    await load();
  }

  const head = (
    <div className="page-head ins-head">
      <div>
        <h1>Application health</h1>
        <p>
          How people get on with the application form: where they stop and what blocks them.
          {d.since ? <> Tracking since {fmtDate(d.since)}.</> : null}
        </p>
      </div>
      <div className="page-head-actions">
        <button
          className={"ui-btn hl-live" + (live ? " is-on" : "")}
          type="button"
          aria-pressed={live}
          title={live ? "Updating every 20 seconds" : "Turn on to update automatically"}
          onClick={() => setLive((x) => !x)}
        >
          <span className="hl-live-dot" aria-hidden="true" />{live ? "Live" : "Paused"}
        </button>
        <button className="ui-icon-btn" type="button" data-tip="Refresh now" aria-label="Refresh now" onClick={load}><Icon name="refresh" /></button>
        <Menu label="More health actions" items={[{ label: "Clear health data…", icon: <Icon name="trash" />, danger: true, onSelect: clearAll }]}>
          <Icon name="more" />
        </Menu>
      </div>
    </div>
  );

  if (!rows) return <div className="state"><span className="spinner" aria-hidden="true" /><p>Loading form activity…</p></div>;
  if (missing) {
    return (
      <div className="ins">
        {head}
        <div className="state is-boxed ins-wide">
          <h3>One-time database setup needed</h3>
          <p>Run <code>supabase/migrations/2026-11-14-form-health.sql</code> in Supabase → SQL Editor, then refresh. Tracking starts from then on.</p>
        </div>
      </div>
    );
  }
  if (error) {
    return <div className="ins">{head}<div className="state is-boxed ins-wide"><h3>Couldn&apos;t load form activity</h3><p>{error}</p></div></div>;
  }
  if (!allVisits.length) {
    return (
      <div className="ins">
        {head}
        <div className="state is-boxed ins-wide"><h3>No form activity yet</h3><p>This fills in as soon as people open the application form.</p></div>
      </div>
    );
  }

  const nVisits = d.visits.length, nStarted = d.started.length, nSubmitted = d.submitted.length, nDropped = d.dropped.length;
  const tiles: [string, string, string][] = [
    ["Opened the form", String(nVisits), `${nVisits - nStarted} left without typing`],
    ["Started", String(nStarted), `${pct(nStarted, nVisits)} of visits`],
    ["Submitted", String(nSubmitted), `${pct(nSubmitted, nStarted)} of people who started`],
    ["Dropped off", String(nDropped), `${pct(nDropped, nStarted)} of starters`],
  ];

  // Drill-down: everyone who stopped after the selected funnel stage, or all drop-offs.
  const lost = step === null ? d.dropped : d.lostAt(step);
  const lostTitle = step === null ? "Where people stop" : `Stopped after “${STAGES[step]}”`;
  const lostMobile = lost.filter((v) => v.device === "mobile").length;
  const lostTime = median(lost.map((v) => v.last - (v.startAt || v.first)));
  const lastFields = countTop(lost.map((v) => (v.lastField ? label(v.lastField) : step === 0 ? "Never typed anything" : "Before finishing a field")));

  return (
    <div className="ins">
      {head}

      <div className="hl-controls ins-wide">
        <Segmented
          label="Period"
          value={range}
          onChange={(v) => { setRange(v); setStep(null); }}
          options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "all", label: "All time" }]}
        />
        <Segmented
          label="Device"
          value={device}
          onChange={(v) => { setDevice(v); setStep(null); }}
          options={[{ value: "all", label: "All devices" }, { value: "desktop", label: "Desktop" }, { value: "mobile", label: "Mobile" }]}
        />
        <span className="spacer" />
        {d.live.length ? <span className="hl-now"><span className="live-dot" aria-hidden="true" />{d.live.length} filling it in now</span> : null}
        {loadedAt ? <span className="hl-updated">Updated {new Date(loadedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span> : null}
      </div>

      <div className="ins-tiles">
        {tiles.map(([l, v, sub]) => (
          <div className="ins-tile" key={l}>
            <div className="ins-tile-label">{l}</div>
            <div className="ins-tile-value">{v}</div>
            <div className="ins-tile-sub">{sub}</div>
          </div>
        ))}
      </div>

      <section className="ins-card hl-funnel-card">
        <div className="hl-card-head">
          <div>
            <h3>Form funnel</h3>
            <p className="ins-sub">Furthest step each visit reached. Click a step to see who stopped there.</p>
          </div>
        </div>
        {nVisits ? <Funnel counts={d.counts} selected={step} onSelect={setStep} /> : <p className="ins-sub">No visits in this period.</p>}
      </section>

      <section className={"ins-card hl-lost" + (step !== null ? " is-focused" : "")}>
        <div className="hl-card-head">
          <div>
            <h3>{lostTitle}</h3>
            <p className="ins-sub">
              {step === null
                ? "The last thing filled in by people who started and then left (idle 30+ minutes)."
                : "The last field they filled in before leaving."}
            </p>
          </div>
          {step !== null ? <button className="ui-btn ui-btn-ghost" type="button" onClick={() => setStep(null)}>Show all</button> : null}
        </div>
        <div className="hl-lost-stats">
          <div><strong>{lost.length}</strong><span>{lost.length === 1 ? "person" : "people"}</span></div>
          <div><strong>{fmtMins(lostTime)}</strong><span>median time on form</span></div>
          <div><strong>{pct(lostMobile, lost.length)}</strong><span>on mobile</span></div>
        </div>
        {lost.length ? <Bars rows={lastFields} total={lost.length} /> : <p className="ins-sub">Nobody stopped here in this period.</p>}
      </section>

      <section className="ins-card ins-wide">
        <h3>Started vs submitted per day</h3>
        <Daily days={d.days} />
      </section>

      <section className="ins-card">
        <h3>What blocks submit</h3>
        <p className="ins-sub">
          Fields that stopped someone pressing submit. {d.blocked} {d.blocked === 1 ? "person was" : "people were"} blocked at least once;{" "}
          {d.blockedThenSubmitted} fixed it and submitted.
        </p>
        {d.blockers.length ? <Bars rows={d.blockers} total={d.blocked} /> : <p className="ins-sub">No blocked submissions.</p>}
      </section>

      <section className="ins-card">
        <h3>When people apply</h3>
        <p className="ins-sub">Applications started, by weekday and hour.</p>
        <Heatmap visits={d.visits} />
      </section>

      <section className="ins-card">
        <h3>Timing &amp; reliability</h3>
        <p className="ins-sub">Medians across visits.</p>
        <dl className="ins-timing">
          <div><dt>Time to finish an application</dt><dd>{fmtMins(d.timeToSubmit)}<small>{nSubmitted} submitted</small></dd></div>
          <div><dt>Time spent before giving up</dt><dd>{fmtMins(d.timeBeforeLeaving)}<small>{nDropped} dropped off</small></dd></div>
          <div>
            <dt>Technical failures</dt>
            <dd>{d.errors.reduce((s, [, n]) => s + n, 0)}<small>{d.errors.length ? d.errors.map(([k, n]) => `${k}: ${n}`).join(" · ") : "uploads and saves all went through"}</small></dd>
          </div>
        </dl>
      </section>

      <section className="ins-card">
        <h3>Desktop vs mobile</h3>
        <p className="ins-sub">Completion rate of people who started, in this period.</p>
        <div className="hl-devices">
          {d.devices.map((r) => {
            const rate = r.started ? r.submitted / r.started : 0;
            return (
              <button
                key={r.dev}
                type="button"
                className={"hl-device" + (device === r.dev ? " is-on" : "")}
                aria-pressed={device === r.dev}
                onClick={() => { setDevice(device === r.dev ? "all" : r.dev); setStep(null); }}
                title={device === r.dev ? "Show all devices" : `Filter the dashboard to ${r.dev}`}
              >
                <span className="hl-ring" style={{ "--p": rate } as React.CSSProperties}><span>{pct(r.submitted, r.started)}</span></span>
                <span className="hl-device-text">
                  <strong>{r.dev === "mobile" ? "Phone / tablet" : "Desktop"}</strong>
                  <small>{r.visits} opened · {r.started} started · {r.submitted} submitted</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
