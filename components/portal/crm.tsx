"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { portalClient } from "@/lib/supabase";
import {
  RATINGS, SEND_META, STAGES, STAGE_BY_ID, ago, applicantFromRow, csvCell,
  download, fmtDate, fmtDateTime, hasResume, rejectionKind, sentEmails, stamp, voteTally,
  type Applicant, type SendKind, type StageId,
} from "@/lib/portal";
import { ApplicantModal } from "./applicant-modal";
import { Insights } from "./insights";
import { BulkSendModal, type BulkKind } from "./bulk-send-modal";
import { SendModal } from "./send-modal";
import { SettingsModal, type PurgeMode } from "./settings-modal";
import { DEFAULT_SETTINGS, loadSettings, type PortalSettings, type SettingsMeta } from "@/lib/settings";
import { toast } from "./ui";

// The committee recruitment board. Same markup and class names as the original portal
// (styled by app/portal.css); React handles state instead of hand-built DOM.

const CSV_COLS = [
  "name", "email", "phone", "degree", "yearLevel", "role", "roleSecondary", "status", "rating", "linkedin",
  "statement", "experience", "questions", "extraNote", "booking", "secondChoiceFlag", "createdAt",
] as const;
const SELECT_FULL = "*, application_notes(*), application_votes(*)";
const SELECT_NO_VOTES = "*, application_notes(*)";
let select = SELECT_FULL;

/** Runs a board query; if the votes table hasn't been created yet, retries without votes. */
async function fetchApplications(q: (sel: string) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  let res = await q(select);
  if (res.error && select === SELECT_FULL && /application_votes/i.test(res.error.message)) {
    select = SELECT_NO_VOTES;
    toast("Screening votes need the latest database update (supabase/migrations). Showing the board without votes.");
    res = await q(select);
  }
  return res;
}
const NO_ID = "00000000-0000-0000-0000-000000000000"; // "match every row" filter for bulk updates/deletes

/** The one-click email button shown on a card in this stage, if any. */
function quickSend(a: Applicant): SendKind | null {
  if (a.status === "review") return "invite";
  if (a.status === "offer") return "offer";
  if (a.status === "rejected") return rejectionKind(a);
  return null;
}

function RatingPill({ rating }: { rating: string }) {
  const label = RATINGS.find((r) => r.id === rating)?.label ?? rating;
  return <span className={"rating " + rating}><span className="rd" />{label}</span>;
}

export function Crm() {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filters, setFilters] = useState({ q: "", role: "", rating: "" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [send, setSend] = useState<{ id: string; kind: SendKind } | null>(null);
  const [dropTarget, setDropTarget] = useState<StageId | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // A card dropped into another column is re-rendered there, so the browser's "dragend" lands on the
  // old, removed element and the card's own onDragEnd never runs. Clear the drag state from the
  // window instead, so a moved card never stays greyed out.
  useEffect(() => {
    if (!dragging) return;
    const clear = () => { setDragging(null); setDropTarget(null); };
    window.addEventListener("dragend", clear, true);
    window.addEventListener("drop", clear, true);
    return () => {
      window.removeEventListener("dragend", clear, true);
      window.removeEventListener("drop", clear, true);
    };
  }, [dragging]);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [settings, setSettings] = useState<PortalSettings>(DEFAULT_SETTINGS);
  const [settingsMeta, setSettingsMeta] = useState<SettingsMeta>({ updatedAt: "", updatedBy: "", missingTable: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [me, setMe] = useState("");
  const [view, setView] = useState<"board" | "insights">("board");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const bulkMenuRef = useRef<HTMLDetailsElement>(null);

  // Who is signed in (for "your vote" and the "needs my vote" filter).
  useEffect(() => {
    portalClient().auth.getSession().then(({ data }) => setMe((data.session?.user.email ?? "").toLowerCase()));
  }, []);

  const refreshSettings = useCallback(async () => {
    const r = await loadSettings();
    setSettings(r.settings);
    setSettingsMeta(r.meta);
    return r;
  }, []);

  const load = useCallback(async () => {
    const db = portalClient();
    const a = await fetchApplications((sel) => db.from("applications").select(sel).order("created_at", { ascending: false }));
    if (a.error) {
      setLoadError(a.error.message || "Couldn't load applications.");
    } else {
      setApplicants((a.data ?? []).map(applicantFromRow));
      setLoadError("");
    }
    setLoading(false);
  }, []);

  const reload = useCallback(() => { setLoading(true); return load(); }, [load]);

  // Re-fetch just the given applicants (with their notes) and patch them into the board.
  // Anything that no longer comes back was deleted (or is no longer visible to us).
  const refreshIds = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const { data, error } = await fetchApplications((sel) => portalClient().from("applications").select(sel).in("id", ids));
    if (error) return; // keep what we have; the next change or a manual Refresh will catch up
    const fresh = new Map((data ?? []).map((r) => [(r as { id: string }).id, applicantFromRow(r)]));
    setApplicants((list) => {
      const next = list.filter((x) => !ids.includes(x.id) || fresh.has(x.id)).map((x) => fresh.get(x.id) ?? x);
      const added = [...fresh.values()].filter((f) => !list.some((x) => x.id === f.id));
      return [...added, ...next].sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || ""));
    });
  }, []);

  // Initial load + live updates. Each change only re-fetches the applicant it touched, not the
  // whole board, which keeps Supabase bandwidth low with hundreds of applicants and several
  // reviewers online. A full load runs whenever the live connection (re)connects, so nothing
  // missed while offline is lost.
  useEffect(() => {
    const db = portalClient();
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queue = (id?: string) => {
      if (!id) return;
      pending.add(id);
      clearTimeout(timer);
      timer = setTimeout(() => { const ids = [...pending]; pending.clear(); refreshIds(ids); }, 400);
    };
    type Row = { id?: string; application_id?: string };
    let connects = 0;
    const channel = db.channel("crm-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, (p) => {
        queue(((p.new as Row)?.id) || ((p.old as Row)?.id));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "application_notes" }, (p) => {
        const n = p.new as Row, o = p.old as Row;
        if (n?.application_id || o?.application_id) { queue(n?.application_id || o?.application_id); return; }
        // A deleted note only carries its own id: drop it from whichever applicant had it.
        if (o?.id) setApplicants((l) => l.map((x) => (x.notes.some((nt) => nt.id === o.id) ? { ...x, notes: x.notes.filter((nt) => nt.id !== o.id) } : x)));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "application_votes" }, (p) => {
        queue(((p.new as Row)?.application_id) || ((p.old as Row)?.application_id));
      })
      // A teammate saving settings updates everyone's board.
      .on("postgres_changes", { event: "*", schema: "public", table: "portal_settings" }, () => { refreshSettings(); })
      // The first connect is covered by the load below; later ones are reconnects after a drop.
      .subscribe((status) => { if (status === "SUBSCRIBED" && connects++ > 0) load(); });
    // Load straight away too, in case the live connection is slow or blocked.
    const first = setTimeout(load, 0);
    const settingsTimer = setTimeout(refreshSettings, 0);
    return () => { clearTimeout(timer); clearTimeout(first); clearTimeout(settingsTimer); db.removeChannel(channel); };
  }, [load, refreshIds, refreshSettings]);

  const roles = useMemo(
    () => [...new Set(applicants.flatMap((a) => [a.role, a.roleSecondary]).filter(Boolean))].sort(),
    [applicants],
  );
  // Applications that share an email address (same person applying twice).
  const dupesOf = useMemo(() => {
    const byEmail = new Map<string, Applicant[]>();
    for (const a of applicants) {
      const k = a.email.trim().toLowerCase();
      if (k) byEmail.set(k, [...(byEmail.get(k) ?? []), a]);
    }
    return (a: Applicant) => (byEmail.get(a.email.trim().toLowerCase()) ?? []).filter((x) => x.id !== a.id);
  }, [applicants]);

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return applicants.filter((a) => {
      // A team filter also shows people who picked that team as their second choice.
      if (filters.role && a.role !== filters.role && a.roleSecondary !== filters.role) return false;
      const f = filters.rating;
      if (f === "needs-my-vote" && (a.votes.some((v) => v.reviewer === me) || a.conflicts.some((c) => c.reviewer === me))) return false;
      if (f === "conflicts" && !a.conflicts.length) return false;
      if (f === "no-votes" && a.votes.length) return false;
      if (f === "votes-yes") { const t = voteTally(a.votes); if (!(t.yes > t.no && t.yes >= t.maybe)) return false; }
      if (f === "second-flag" && !a.secondChoiceFlag) return false;
      if (f === "duplicates" && !dupesOf(a).length) return false;
      if (["yes", "maybe", "no"].includes(f) && a.rating !== f) return false;
      if (q && !(a.name + " " + a.email + " " + a.role + " " + a.roleSecondary + " " + a.degree).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [applicants, filters, me, dupesOf]);

  const setFilter = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  async function addNote(id: string, text: string, type: "auto" | "manual" | "interview") {
    const { error } = await portalClient().from("application_notes").insert({ application_id: id, type, text });
    if (error) toast("Couldn't save note: " + error.message);
  }

  async function moveTo(id: string, status: StageId) {
    const a = applicants.find((x) => x.id === id);
    if (!a || a.status === status) return;
    const prev = a.status;
    const set = (s: StageId) => setApplicants((l) => l.map((x) => (x.id === id ? { ...x, status: s, updatedAt: new Date().toISOString() } : x)));
    set(status); // optimistic: show it now, roll back if the database refuses
    const { data, error } = await portalClient().from("applications").update({ status }).eq("id", id).select("id");
    if (error || !data?.length) {
      toast("Couldn't save: " + (error ? error.message : "you may not have permission, or the applicant was deleted."));
      set(prev);
      return;
    }
    await addNote(id, "Moved to " + STAGE_BY_ID[status].label, "auto");
  }

  function openSend(a: Applicant, kind: SendKind) {
    if (!a.email) { toast("This applicant doesn't have an email address on file."); return; }
    if (kind === "invite" && !a.booking.trim()) { toast("Paste their zcal link on their profile first, then save."); setOpenId(a.id); return; }
    setSend({ id: a.id, kind });
  }

  async function onSent(a: Applicant, kind: SendKind) {
    await addNote(a.id, SEND_META[kind].logged, "auto");
    if (kind === "invite" && a.status === "review" && settings.autoInvitedAfterSend) {
      await portalClient().from("applications").update({ status: "invited" }).eq("id", a.id);
      await addNote(a.id, "Moved to " + STAGE_BY_ID.invited.label, "auto");
    }
    await refreshIds([a.id]);
  }

  // ---- Selection + bulk actions ----------------------------------------------------------
  const selectedApplicants = applicants.filter((a) => selected.has(a.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };

  async function bulkMove(status: StageId) {
    const ids = selectedApplicants.filter((a) => a.status !== status).map((a) => a.id);
    if (!ids.length) return;
    if (!window.confirm(`Move ${ids.length} applicant${ids.length === 1 ? "" : "s"} to ${STAGE_BY_ID[status].label}?`)) return;
    const db = portalClient();
    const { data, error } = await db.from("applications").update({ status }).in("id", ids).select("id");
    if (error) { toast("Couldn't move them: " + error.message); return; }
    const moved = (data ?? []).map((r) => r.id as string);
    await db.from("application_notes").insert(moved.map((id) => ({ application_id: id, type: "auto", text: "Moved to " + STAGE_BY_ID[status].label })));
    toast(`Moved ${moved.length} to ${STAGE_BY_ID[status].label}`);
    await refreshIds(ids);
  }

  // ---- Export + end-of-season clean-up -------------------------------------------------
  const closeMenu = () => menuRef.current?.removeAttribute("open");

  function exportJSON() {
    download("sul-recruitment-" + stamp() + ".json", JSON.stringify({ exportedAt: new Date().toISOString(), applicants }, null, 2), "application/json");
  }
  function exportCSV() {
    const rows = [[...CSV_COLS, "screeningVotes", "conflictsOfInterest", "attachments", "notes"].join(",")];
    for (const a of applicants) {
      const line = CSV_COLS.map((c) => csvCell(a[c]));
      line.push(csvCell(a.votes.map((v) => v.reviewer + ": " + v.vote).join(" | ")));
      line.push(csvCell(a.conflicts.map((c) => c.reviewer).join(" | ")));
      line.push(csvCell(a.files.map((f) => f.name).join(" | ")));
      line.push(csvCell(a.notes.map((n) => fmtDateTime(n.ts) + " (" + (n.type === "interview" ? "interview" : n.type === "auto" ? "activity" : "application") + (n.author ? ", " + n.author : "") + "): " + n.text).join(" | ")));
      rows.push(line.join(","));
    }
    download("sul-recruitment-" + stamp() + ".csv", rows.join("\n"), "text/csv");
  }

  /** Every object in the resumes bucket, including uploads from abandoned or spam submissions. */
  async function allStoredPaths() {
    const bucket = portalClient().storage.from("resumes");
    const paths = new Set(applicants.flatMap((a) => a.files.map((f) => f.path)));
    const listAll = async (prefix: string) => {
      const out: { name: string; id: string | null }[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
        if (error || !data?.length) break;
        out.push(...data);
        if (data.length < 1000) break;
      }
      return out;
    };
    for (const entry of await listAll("")) {
      if (entry.id) { paths.add(entry.name); continue; } // a file at the top level
      for (const f of await listAll(entry.name)) if (f.id) paths.add(entry.name + "/" + f.name);
    }
    return [...paths];
  }

  async function purge(mode: PurgeMode): Promise<string> {
    const db = portalClient();
    const paths = await allStoredPaths();
    let removed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const { data, error } = await db.storage.from("resumes").remove(paths.slice(i, i + 100));
      if (error) return `Stopped after deleting ${removed} file(s): ${error.message}`;
      removed += data?.length ?? 0;
    }
    if (mode === "files") {
      const { error } = await db.from("applications").update({ files: [] }).neq("id", NO_ID);
      await reload();
      return error ? `Deleted ${removed} file(s), but couldn't clear the file list: ${error.message}` : `Deleted ${removed} file(s). Applicant records are kept.`;
    }
    const { data, error } = await db.from("applications").delete().neq("id", NO_ID).select("id");
    await reload();
    if (error) return `Deleted ${removed} file(s), but couldn't delete applicants: ${error.message}`;
    return `Deleted ${removed} file(s) and ${data?.length ?? 0} applicant(s), with their notes and votes.`;
  }

  const head = (
    <div className="crm-head">
      <div>
        <h2>Recruitment</h2>
        <p>Track every applicant from first application through to offer.</p>
      </div>
      <div className="crm-head-actions">
        <button
          className="btn btn-secondary btn-sm crm-settings-btn"
          type="button"
          onClick={async () => { await refreshSettings(); setSettingsOpen(true); }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => portalClient().auth.signOut()}>Sign out</button>
      </div>
    </div>
  );

  const settingsModal = settingsOpen ? (
    <SettingsModal
      key={settingsMeta.updatedAt || "default"}
      initial={settings}
      meta={settingsMeta}
      applicantCount={applicants.length}
      onClose={() => setSettingsOpen(false)}
      onSaved={() => { refreshSettings(); }}
      onExport={() => { exportJSON(); exportCSV(); }}
      onPurge={purge}
    />
  ) : null;

  if (loading) return <>{head}<div className="crm-empty"><h3>Loading applications…</h3></div>{settingsModal}</>;
  if (loadError) {
    return (
      <>
        {head}
        <div className="crm-empty">
          <h3>Couldn&apos;t load applications</h3>
          <p>{loadError} If this is a new setup, check that supabase/schema.sql has been run and your email is in committee_members.</p>
          <div className="cta-row"><button className="btn btn-primary" type="button" onClick={reload}>Try again</button></div>
        </div>
        {settingsModal}
      </>
    );
  }

  const n = (f: (a: Applicant) => boolean) => applicants.filter(f).length;
  const tiles: [string, number][] = [
    ["Total", applicants.length],
    ["In pipeline", n((a) => !["waitlist", "offer", "rejected"].includes(a.status))],
    ["Interviewed", n((a) => ["interviewed", "waitlist", "offer"].includes(a.status) || (a.status === "rejected" && !!a.rating))],
    ["Waitlist", n((a) => a.status === "waitlist")],
    ["Offers", n((a) => a.status === "offer")],
    ["Rejected", n((a) => a.status === "rejected")],
  ];
  const open = applicants.find((a) => a.id === openId);
  const sending = send ? applicants.find((a) => a.id === send.id) : undefined;
  const closeBulkMenu = () => bulkMenuRef.current?.removeAttribute("open");

  return (
    <>
      {head}
      <div className="crm-tabs crm-viewtabs" role="tablist" aria-label="Portal view">
        <button type="button" role="tab" aria-selected={view === "board"} onClick={() => setView("board")}>Board</button>
        <button type="button" role="tab" aria-selected={view === "insights"} onClick={() => { exitSelect(); setView("insights"); }}>Insights</button>
      </div>
      {view === "insights" ? <Insights applicants={applicants} /> : null}
      <div hidden={view !== "board"}>
      <div className="crm-stats">
        {tiles.map(([l, v]) => <div className="crm-stat" key={l}><div className="n">{v}</div><div className="l">{l}</div></div>)}
      </div>

      <div className="crm-toolbar">
        <div className="crm-search">
          <input type="search" placeholder="Search name, email, team, degree…" aria-label="Search applicants" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
        </div>
        <select aria-label="Filter by team" value={filters.role} onChange={(e) => setFilter("role", e.target.value)}>
          <option value="">All teams</option>
          {roles.map((r) => <option key={r} value={r}>{r} (incl. 2nd choice)</option>)}
        </select>
        <select aria-label="Filter" value={filters.rating} onChange={(e) => setFilter("rating", e.target.value)}>
          <option value="">Everyone</option>
          <optgroup label="Screening">
            <option value="needs-my-vote">Needs my vote</option>
            <option value="no-votes">No votes yet</option>
            <option value="votes-yes">Mostly yes votes</option>
            <option value="conflicts">Conflict of interest declared</option>
          </optgroup>
          <optgroup label="Interview rating">
            {RATINGS.map((r) => <option key={r.id} value={r.id}>Rated: {r.label}</option>)}
          </optgroup>
          <optgroup label="Other">
            <option value="second-flag">⭐ Flagged for 2nd choice</option>
            <option value="duplicates">Possible duplicates</option>
          </optgroup>
        </select>
        <button
          className={"btn btn-sm " + (selectMode ? "btn-primary" : "btn-secondary")}
          type="button"
          aria-pressed={selectMode}
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
        >
          {selectMode ? "Done selecting" : "Select"}
        </button>
        <details className="crm-menu" ref={menuRef}>
          <summary aria-label="More actions">⋯</summary>
          <div className="crm-menu-list">
            <button type="button" onClick={() => { closeMenu(); reload(); }}>Refresh</button>
            <div className="sep" />
            <button type="button" onClick={() => { closeMenu(); exportJSON(); }}>Export as JSON (backup)</button>
            <button type="button" onClick={() => { closeMenu(); exportCSV(); }}>Export as CSV</button>
          </div>
        </details>
      </div>

      {applicants.length === 0 ? (
        <div className="crm-empty">
          <h3>No applicants yet</h3>
          <p>Applications land here automatically as soon as someone submits the form on the Recruitment page.</p>
          <div className="cta-row">
            <a className="btn btn-secondary" href="/recruitment-demo" target="_blank" rel="noopener">Open the application form</a>
          </div>
        </div>
      ) : (
        <div className={"crm-board" + (selectMode ? " is-selecting" : "")} id="crm-board">
          {STAGES.map((stage) => {
            const items = visible.filter((a) => a.status === stage.id).sort((x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || ""));
            const allOn = items.length > 0 && items.every((a) => selected.has(a.id));
            return (
              <div className="crm-col" key={stage.id} style={{ "--col": stage.color } as React.CSSProperties}>
                <div className="crm-col-head">
                  <span className="dot" />
                  <span className="label">{stage.label}</span>
                  <span className="count">{items.length}</span>
                  {selectMode && items.length ? (
                    <button
                      type="button"
                      className="crm-col-select"
                      onClick={() => setSelected((s) => {
                        const nx = new Set(s);
                        items.forEach((a) => (allOn ? nx.delete(a.id) : nx.add(a.id)));
                        return nx;
                      })}
                    >
                      {allOn ? "None" : "All"}
                    </button>
                  ) : null}
                </div>
                <div
                  className={"crm-col-body" + (dropTarget === stage.id ? " drop-target" : "")}
                  data-stage={stage.id}
                  onDragOver={(e) => { if (selectMode) return; e.preventDefault(); setDropTarget(stage.id); }}
                  onDragLeave={() => setDropTarget((t) => (t === stage.id ? null : t))}
                  onDrop={(e) => { e.preventDefault(); setDropTarget(null); setDragging(null); moveTo(e.dataTransfer.getData("text/plain"), stage.id); }}
                >
                  {items.length === 0 ? <div className="crm-col-empty">{selectMode ? "Empty" : "Drop here"}</div> : null}
                  {items.map((a) => {
                    const quick = quickSend(a);
                    const sent = sentEmails(a);
                    const sentNow = quick ? sent[quick === "rejectScreen" ? "reject" : quick] : undefined;
                    const t = voteTally(a.votes);
                    const dupes = dupesOf(a).length;
                    const viaSecond = filters.role && a.role !== filters.role && a.roleSecondary === filters.role;
                    const isSel = selected.has(a.id);
                    return (
                      <div
                        key={a.id}
                        className={"crm-card" + (dragging === a.id ? " dragging" : "") + (isSel ? " selected" : "")}
                        draggable={!selectMode}
                        data-id={a.id}
                        onClick={() => (selectMode ? toggle(a.id) : setOpenId(a.id))}
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", a.id); e.dataTransfer.effectAllowed = "move"; setDragging(a.id); }}
                        onDragEnd={() => setDragging(null)}
                      >
                        <div className="cn">
                          {selectMode ? <input type="checkbox" className="crm-card-check" checked={isSel} readOnly tabIndex={-1} aria-label={"Select " + a.name} /> : null}
                          {a.name || "Unnamed"}
                          {a.secondChoiceFlag ? <span title={"Flagged for 2nd choice: " + a.roleSecondary}> ⭐</span> : null}
                        </div>
                        {a.role ? (
                          <div className="cr">
                            {viaSecond ? <>{a.roleSecondary} <span className="crm-tag">2nd choice</span></> : a.role}
                          </div>
                        ) : null}
                        <div className="crm-badges">
                          {a.votes.length ? (
                            <span className="crm-badge votes" title={a.votes.map((v) => v.reviewer + ": " + v.vote).join("\n")}>
                              {t.yes ? "👍" + t.yes : ""}{t.maybe ? " 🤔" + t.maybe : ""}{t.no ? " 👎" + t.no : ""}
                            </span>
                          ) : null}
                          {sent.invite ? <span className="crm-badge sent" title={"Invite emailed " + fmtDateTime(sent.invite)}>✉ Invite {ago(sent.invite)}</span> : null}
                          {sent.offer ? <span className="crm-badge sent" title={"Offer emailed " + fmtDateTime(sent.offer)}>✉ Offer {ago(sent.offer)}</span> : null}
                          {sent.reject ? <span className="crm-badge sent" title={"Rejection emailed " + fmtDateTime(sent.reject)}>✉ Rejection {ago(sent.reject)}</span> : null}
                          {a.conflicts.length ? (
                            <span className="crm-badge coi" title={"Knows this applicant (vote not counted):\n" + a.conflicts.map((c) => c.reviewer).join("\n")}>
                              ⚠ Conflict{a.conflicts.length > 1 ? " ×" + a.conflicts.length : ""}
                            </span>
                          ) : null}
                          {dupes ? <span className="crm-badge dup" title="Another application uses this email">Duplicate</span> : null}
                        </div>
                        <div className="cmeta">
                          {hasResume(a) ? <span className="crm-icon" title="Resume attached">📄</span> : null}
                          <span className="spacer" />
                          {a.rating ? <RatingPill rating={a.rating} /> : <span>{fmtDate(a.createdAt)}</span>}
                        </div>
                        {quick && !sentNow && !selectMode ? (
                          <button className="btn btn-primary btn-sm crm-card-action" type="button" onClick={(e) => { e.stopPropagation(); openSend(a, quick); }}>
                            {SEND_META[quick].button}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      </div>

      {selectMode && view === "board" ? (
        <div className="crm-bulkbar" role="toolbar" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <select
            aria-label="Move selected to stage"
            value=""
            disabled={!selected.size}
            onChange={(e) => { const v = e.target.value as StageId; e.target.value = ""; if (v) bulkMove(v); }}
          >
            <option value="">Move to…</option>
            {STAGES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
          </select>
          <details className="crm-menu crm-menu-up" ref={bulkMenuRef}>
            <summary className={"btn btn-primary btn-sm" + (selected.size ? "" : " is-disabled")} aria-disabled={!selected.size}>Email…</summary>
            {selected.size ? (
              <div className="crm-menu-list">
                <button type="button" onClick={() => { closeBulkMenu(); setBulk("invite"); }}>Interview invite</button>
                <button type="button" onClick={() => { closeBulkMenu(); setBulk("offer"); }}>Offer</button>
                <button type="button" onClick={() => { closeBulkMenu(); setBulk("reject"); }}>Rejection</button>
              </div>
            ) : null}
          </details>
          <span className="spacer" />
          <button className="btn btn-secondary btn-sm" type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={exitSelect}>Done</button>
        </div>
      ) : null}

      {open ? (
        <ApplicantModal
          key={open.id}
          a={open}
          me={me}
          duplicates={dupesOf(open)}
          ratingMovesStage={settings.ratingMovesStage}
          onClose={() => setOpenId(null)}
          onSaved={() => refreshIds([open.id])}
          onSendInvite={(id) => setSend({ id, kind: "invite" })}
          onOpenOther={(id) => setOpenId(id)}
        />
      ) : null}
      {send && sending ? (
        <SendModal a={sending} kind={send.kind} settings={settings} onClose={() => setSend(null)} onSent={async (a, k) => { await onSent(a, k); setOpenId(null); }} />
      ) : null}
      {bulk ? (
        <BulkSendModal
          applicants={selectedApplicants}
          initialKind={bulk}
          settings={settings}
          onClose={() => setBulk(null)}
          onSent={onSent}
        />
      ) : null}
      {settingsModal}
    </>
  );
}
