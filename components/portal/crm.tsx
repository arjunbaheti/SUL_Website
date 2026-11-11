"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { portalClient } from "@/lib/supabase";
import {
  RATINGS, SEND_META, STAGES, STAGE_BY_ID, applicantFromRow, csvCell,
  download, fmtDate, fmtDateTime, hasResume, stamp,
  type Applicant, type SendKind, type StageId,
} from "@/lib/portal";
import { ApplicantModal } from "./applicant-modal";
import { SendModal } from "./send-modal";
import { toast } from "./ui";

// The committee recruitment board. Same markup and class names as the original portal
// (styled by app/portal.css); React handles state instead of hand-built DOM.

const CSV_COLS = [
  "name", "email", "phone", "degree", "yearLevel", "role", "roleSecondary", "status", "rating", "linkedin",
  "statement", "experience", "questions", "extraNote", "booking", "createdAt",
] as const;
const QUICK: Partial<Record<StageId, SendKind>> = { review: "invite", offer: "offer", rejected: "reject" };

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
  const menuRef = useRef<HTMLDetailsElement>(null);

  const load = useCallback(async () => {
    const db = portalClient();
    const a = await db.from("applications").select("*, application_notes(*)").order("created_at", { ascending: false });
    if (a.error) {
      setLoadError(a.error.message || "Couldn't load applications.");
    } else {
      setApplicants((a.data ?? []).map(applicantFromRow));
      setLoadError("");
    }
    setLoading(false);
  }, []);

  const reload = useCallback(() => { setLoading(true); return load(); }, [load]);

  // Initial load + live updates: a new application (or a teammate's edit) shows up without a refresh.
  useEffect(() => {
    const db = portalClient();
    let timer: ReturnType<typeof setTimeout>;
    const channel = db.channel("crm-live");
    for (const table of ["applications", "application_notes"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        clearTimeout(timer);
        timer = setTimeout(load, 500);
      });
    }
    channel.subscribe();
    timer = setTimeout(load, 0);
    return () => { clearTimeout(timer); db.removeChannel(channel); };
  }, [load]);

  const roles = useMemo(() => [...new Set(applicants.map((a) => a.role).filter(Boolean))].sort(), [applicants]);
  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return applicants.filter((a) => {
      if (filters.role && a.role !== filters.role) return false;
      if (filters.rating && a.rating !== filters.rating) return false;
      if (q && !(a.name + " " + a.email + " " + a.role + " " + a.degree).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [applicants, filters]);

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
    if (kind === "invite" && a.status === "review") {
      await portalClient().from("applications").update({ status: "invited" }).eq("id", a.id);
    }
    setOpenId(null);
    await load();
  }

  // ---- Export --------------------------------------------------------------------------
  const closeMenu = () => menuRef.current?.removeAttribute("open");

  function exportJSON() {
    download("sul-recruitment-" + stamp() + ".json", JSON.stringify({ applicants }, null, 2), "application/json");
  }
  function exportCSV() {
    const rows = [[...CSV_COLS, "attachments", "notes"].join(",")];
    for (const a of applicants) {
      const line = CSV_COLS.map((c) => csvCell(a[c]));
      line.push(csvCell(a.files.map((f) => f.name).join(" | ")));
      line.push(csvCell(a.notes.map((n) => fmtDateTime(n.ts) + " (" + (n.type === "interview" ? "interview" : n.type === "auto" ? "activity" : "application") + (n.author ? ", " + n.author : "") + "): " + n.text).join(" | ")));
      rows.push(line.join(","));
    }
    download("sul-recruitment-" + stamp() + ".csv", rows.join("\n"), "text/csv");
  }

  const head = (
    <div className="crm-head">
      <div>
        <h2>Recruitment</h2>
        <p>Track every applicant from first application through to offer.</p>
      </div>
      <div className="crm-head-actions">
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => portalClient().auth.signOut()}>Sign out</button>
      </div>
    </div>
  );

  if (loading) return <>{head}<div className="crm-empty"><h3>Loading applications…</h3></div></>;
  if (loadError) {
    return (
      <>
        {head}
        <div className="crm-empty">
          <h3>Couldn&apos;t load applications</h3>
          <p>{loadError} If this is a new setup, check that supabase/schema.sql has been run and your email is in committee_members.</p>
          <div className="cta-row"><button className="btn btn-primary" type="button" onClick={reload}>Try again</button></div>
        </div>
      </>
    );
  }

  const n = (f: (a: Applicant) => boolean) => applicants.filter(f).length;
  const tiles: [string, number][] = [
    ["Total", applicants.length],
    ["In pipeline", n((a) => a.status !== "offer" && a.status !== "rejected")],
    ["Interviewed", n((a) => ["interviewed", "offer", "rejected"].includes(a.status))],
    ["Offers", n((a) => a.status === "offer")],
    ["Rejected", n((a) => a.status === "rejected")],
  ];
  const open = applicants.find((a) => a.id === openId);
  const sending = send ? applicants.find((a) => a.id === send.id) : undefined;

  return (
    <>
      {head}
      <div className="crm-stats">
        {tiles.map(([l, v]) => <div className="crm-stat" key={l}><div className="n">{v}</div><div className="l">{l}</div></div>)}
      </div>

      <div className="crm-toolbar">
        <div className="crm-search">
          <input type="search" placeholder="Search name, email, role, degree…" aria-label="Search applicants" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
        </div>
        <select aria-label="Filter by role" value={filters.role} onChange={(e) => setFilter("role", e.target.value)}>
          <option value="">All roles</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select aria-label="Filter by rating" value={filters.rating} onChange={(e) => setFilter("rating", e.target.value)}>
          <option value="">Any rating</option>
          {RATINGS.map((r) => <option key={r.id} value={r.id}>Rated: {r.label}</option>)}
        </select>
        <details className="crm-menu" ref={menuRef}>
          <summary aria-label="More actions">⋯</summary>
          <div className="crm-menu-list">
            <button type="button" onClick={() => { closeMenu(); reload(); }}>Refresh</button>
            <div className="sep" />
            <button type="button" onClick={() => { closeMenu(); exportJSON(); }}>Export as JSON (backup)</button>
            <button type="button" onClick={() => { closeMenu(); exportCSV(); }}>Export as CSV</button>
            <div className="sep" />
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
        <div className="crm-board" id="crm-board">
          {STAGES.map((stage) => {
            const items = visible.filter((a) => a.status === stage.id).sort((x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || ""));
            return (
              <div className="crm-col" key={stage.id} style={{ "--col": stage.color } as React.CSSProperties}>
                <div className="crm-col-head">
                  <span className="dot" />
                  <span className="label">{stage.label}</span>
                  <span className="count">{items.length}</span>
                </div>
                <div
                  className={"crm-col-body" + (dropTarget === stage.id ? " drop-target" : "")}
                  data-stage={stage.id}
                  onDragOver={(e) => { e.preventDefault(); setDropTarget(stage.id); }}
                  onDragLeave={() => setDropTarget((t) => (t === stage.id ? null : t))}
                  onDrop={(e) => { e.preventDefault(); setDropTarget(null); moveTo(e.dataTransfer.getData("text/plain"), stage.id); }}
                >
                  {items.length === 0 ? <div className="crm-col-empty">Drop here</div> : null}
                  {items.map((a) => {
                    const quick = QUICK[a.status];
                    return (
                      <div
                        key={a.id}
                        className={"crm-card" + (dragging === a.id ? " dragging" : "")}
                        draggable
                        data-id={a.id}
                        onClick={() => setOpenId(a.id)}
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", a.id); e.dataTransfer.effectAllowed = "move"; setDragging(a.id); }}
                        onDragEnd={() => setDragging(null)}
                      >
                        <div className="cn">{a.name || "Unnamed"}</div>
                        {a.role ? <div className="cr">{a.role}</div> : null}
                        <div className="cmeta">
                          {hasResume(a) ? <span className="crm-icon" title="Resume attached">📄</span> : null}
                          <span className="spacer" />
                          {a.rating ? <RatingPill rating={a.rating} /> : <span>{fmtDate(a.createdAt)}</span>}
                        </div>
                        {quick ? (
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

      {open ? <ApplicantModal key={open.id} a={open} onClose={() => setOpenId(null)} onSaved={load} onSendInvite={(id) => setSend({ id, kind: "invite" })} /> : null}
      {send && sending ? <SendModal a={sending} kind={send.kind} onClose={() => setSend(null)} onSent={onSent} /> : null}
    </>
  );
}
