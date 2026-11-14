"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { portalClient } from "@/lib/supabase";
import {
  RATINGS, SEND_META, STAGES, STAGE_BY_ID, ago, applicantFromRow, csvCell,
  download, fmtDate, fmtDateTime, hasResume, rejectionKind, sentEmails, stamp, voteTally,
  type Applicant, type SendKind, type StageId,
} from "@/lib/portal";
import { ApplicantModal, type PanelNav } from "./applicant-modal";
import { Insights } from "./insights";
import { Health } from "./health";
import { Glyph3D } from "./glyph-3d";
import { BulkSendModal, type BulkKind } from "./bulk-send-modal";
import { SendModal } from "./send-modal";
import { SettingsModal, type PurgeMode } from "./settings-modal";
import { DEFAULT_SETTINGS, loadSettings, type PortalSettings, type SettingsMeta } from "@/lib/settings";
import { Icon } from "./icons";
import { Menu, Select, Ticker, toast, useTheme, type SelectOption } from "./ui";
import { CommandMenu, type Command } from "./command-menu";
import { AvatarStack, BoardSkeleton, HoverPreview, firstName, useFlip, usePeek, usePresence } from "./board-extras";

// The committee recruitment board: the app shell (top bar), the pipeline board and the
// insights view. Styled by app/portal.css.

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

/** Still waiting on this reviewer's screening vote (only while being screened). */
function needsMyVote(a: Applicant, me: string) {
  return !!me && (a.status === "applied" || a.status === "review")
    && !a.votes.some((v) => v.reviewer === me) && !a.conflicts.some((c) => c.reviewer === me);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function RatingPill({ rating }: { rating: string }) {
  const label = RATINGS.find((r) => r.id === rating)?.label ?? rating;
  return <span className={"rating " + rating} title={"Interview rating: " + label}><span className="rd" />{label}</span>;
}

const FILTERS: SelectOption[] = [
  { value: "", label: "Everyone" },
  { value: "needs-my-vote", label: "Needs my vote", group: "Screening" },
  { value: "no-votes", label: "No votes yet", group: "Screening" },
  { value: "votes-yes", label: "Mostly yes votes", group: "Screening" },
  { value: "conflicts", label: "Conflict of interest", group: "Screening" },
  ...RATINGS.map((r) => ({ value: r.id, label: "Rated " + r.label.toLowerCase(), group: "Interview rating" })),
  { value: "second-flag", label: "Flagged for 2nd choice", group: "Other" },
  { value: "duplicates", label: "Possible duplicates", group: "Other" },
];

function initials(email: string) {
  const name = email.split("@")[0] || "?";
  const parts = name.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || name[0].toUpperCase();
}

const COLUMN_PAGE = 40;

type CardActions = {
  open: (id: string, rect: DOMRect) => void;
  toggle: (id: string) => void;
  peekEnter: (id: string, el: HTMLElement) => void;
  peekLeave: () => void;
  dragStart: (id: string) => void;
  dragEnd: () => void;
  send: (a: Applicant, kind: SendKind) => void;
};

/** One applicant card. Memoised: it only re-renders when its own data or state changes. */
const BoardCard = memo(function BoardCard({ a, selectMode, isSel, isDragging, viaSecond, dupes, viewers, actions }: {
  a: Applicant; selectMode: boolean; isSel: boolean; isDragging: boolean; viaSecond: boolean; dupes: number;
  viewers: string; actions: React.RefObject<CardActions>;
}) {
  const quick = quickSend(a);
  const sent = sentEmails(a);
  const sentNow = quick ? sent[quick === "rejectScreen" ? "reject" : quick] : undefined;
  const t = voteTally(a.votes);
  const watching = viewers ? viewers.split(",") : [];
  const activate = (el: HTMLElement) => { if (selectMode) actions.current.toggle(a.id); else actions.current.open(a.id, el.getBoundingClientRect()); };
  return (
    <div
      className={"crm-card" + (isDragging ? " dragging" : "") + (isSel ? " selected" : "")}
      draggable={!selectMode}
      data-id={a.id}
      data-flip={a.id}
      onMouseEnter={(e) => actions.current.peekEnter(a.id, e.currentTarget)}
      onMouseLeave={() => actions.current.peekLeave()}
      role="button"
      tabIndex={0}
      aria-pressed={selectMode ? isSel : undefined}
      onClick={(e) => { actions.current.peekLeave(); activate(e.currentTarget); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(e.currentTarget); } }}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", a.id); e.dataTransfer.effectAllowed = "move"; actions.current.dragStart(a.id); }}
      onDragEnd={() => actions.current.dragEnd()}
    >
      <div className="card-top">
        {selectMode ? <span className={"ui-check" + (isSel ? " is-on" : "")} aria-hidden="true"><Icon name="check" size={12} /></span> : null}
        <span className="cn">{a.name || "Unnamed"}</span>
        {a.secondChoiceFlag ? <span className="card-flag" title={"Flagged for 2nd choice: " + a.roleSecondary}><Icon name="star" size={13} /></span> : null}
        {hasResume(a) ? <span className="card-file" title="Resume attached"><Icon name="paperclip" size={13} /></span> : null}
      </div>
      {a.role ? (
        <div className="cr">
          {viaSecond ? <>{a.roleSecondary} <span className="crm-tag">2nd choice</span></> : a.role}
        </div>
      ) : null}
      <div className="crm-badges">
        {a.votes.length ? (
          <span className="crm-badge votes" title={a.votes.map((v) => v.reviewer + ": " + v.vote).join("\n")}>
            {t.yes ? <><i className="v yes" />{t.yes}</> : null}
            {t.maybe ? <><i className="v maybe" />{t.maybe}</> : null}
            {t.no ? <><i className="v no" />{t.no}</> : null}
          </span>
        ) : null}
        {sent.invite ? <span className="crm-badge sent" title={"Invite emailed " + fmtDateTime(sent.invite)}><Icon name="mail" size={12} />Invite · {ago(sent.invite)}</span> : null}
        {sent.offer ? <span className="crm-badge sent" title={"Offer emailed " + fmtDateTime(sent.offer)}><Icon name="mail" size={12} />Offer · {ago(sent.offer)}</span> : null}
        {sent.reject ? <span className="crm-badge sent" title={"Rejection emailed " + fmtDateTime(sent.reject)}><Icon name="mail" size={12} />Rejection · {ago(sent.reject)}</span> : null}
        {a.conflicts.length ? (
          <span className="crm-badge coi" title={"Knows this applicant (vote not counted):\n" + a.conflicts.map((c) => c.reviewer).join("\n")}>
            <Icon name="alert" size={12} />Conflict{a.conflicts.length > 1 ? " ×" + a.conflicts.length : ""}
          </span>
        ) : null}
        {dupes ? <span className="crm-badge dup" title="Another application uses this email">Duplicate</span> : null}
      </div>
      <div className="cmeta">
        <span>{fmtDate(a.createdAt)}</span>
        <span className="spacer" />
        <AvatarStack names={watching} size={18} max={2} label={watching.join(", ") + " viewing"} />
        {a.rating ? <RatingPill rating={a.rating} /> : null}
      </div>
      {quick && !sentNow && !selectMode ? (
        <button className="ui-btn is-block crm-card-action" type="button" onClick={(e) => { e.stopPropagation(); actions.current.send(a, quick); }} onKeyDown={(e) => e.stopPropagation()}>
          <Icon name="mail" />{SEND_META[quick].button}
        </button>
      ) : null}
    </div>
  );
});

/** End of a long column: loads the next batch when scrolled into view (or on click). */
function MoreCards({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const more = useRef(onMore);
  useEffect(() => { more.current = onMore; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) more.current(); }, { root: el.closest(".crm-col-body"), rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <button ref={ref} type="button" className="crm-more" onClick={() => more.current()}>Show {Math.min(remaining, COLUMN_PAGE)} more</button>;
}

export function Crm({ onReady }: { onReady?: () => void } = {}) {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // Tell the opening screen once the first load has finished (or failed).
  const readyFired = useRef(false);
  useEffect(() => {
    if (loading || readyFired.current) return;
    readyFired.current = true;
    onReady?.();
  }, [loading, onReady]);
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
  const [settings, setSettings] = useState<PortalSettings>(DEFAULT_SETTINGS);
  const [settingsMeta, setSettingsMeta] = useState<SettingsMeta>({ updatedAt: "", updatedBy: "", missingTable: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [me, setMe] = useState("");
  const [view, setView] = useState<"board" | "insights" | "health">("board");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const [theme, setTheme] = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  // Long columns draw COLUMN_PAGE cards at a time and add more as you scroll to the bottom.
  const [limits, setLimits] = useState<Partial<Record<StageId, number>>>({});
  // Cards are memoised; they reach the board's handlers through this ref so hovering or typing
  // elsewhere doesn't re-render every card.
  const cardActions = useRef<CardActions>({ open: () => {}, toggle: () => {}, peekEnter: () => {}, peekLeave: () => {}, dragStart: () => {}, dragEnd: () => {}, send: () => {} });

  // ⌘K / Ctrl+K opens the command menu from anywhere (pressing it again closes it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // Live connection: "down" shows a Reconnecting pill in the top bar.
  const [connection, setConnection] = useState<"ok" | "down">("ok");
  // After a failed load, retry automatically with a growing delay (5s, 10s, 20s, max 30s).
  const [retryIn, setRetryIn] = useState(0);
  const attempts = useRef(0);

  // "/" jumps to search, like most tools people already use.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable], [role=dialog], .ui-pop")) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
      attempts.current += 1;
      setRetryIn(Math.min(30, 5 * 2 ** (attempts.current - 1)));
    } else {
      setApplicants((a.data ?? []).map(applicantFromRow));
      setLoadError("");
      attempts.current = 0;
      setRetryIn(0);
    }
    setLoading(false);
  }, []);

  const reload = useCallback(() => { setLoading(true); return load(); }, [load]);

  // Count down to the next automatic retry, then try again.
  useEffect(() => {
    if (!loadError || retryIn <= 0) return;
    const t = setTimeout(() => {
      if (retryIn === 1) load();
      setRetryIn((n) => Math.max(0, n - 1));
    }, 1000);
    return () => clearTimeout(t);
  }, [loadError, retryIn, load]);

  // The browser going offline / online.
  useEffect(() => {
    const down = () => setConnection("down");
    const up = () => setConnection("ok");
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    return () => { window.removeEventListener("offline", down); window.removeEventListener("online", up); };
  }, []);

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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnection(navigator.onLine === false ? "down" : "ok");
          if (connects++ > 0) load();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection("down");
        }
      });
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
      if (f === "needs-my-vote" && !needsMyVote(a, me)) return false;
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

  // Who else is here, and who's looking at which applicant.
  const { online, viewers } = usePresence(me, openId);
  // Hover previews (not while selecting or dragging).
  const { peek, enter: peekEnter, leave: peekLeave } = usePeek(!selectMode && !dragging && !openId && view === "board");
  // Cards slide to their new place when they move.
  const flipSignature = visible.map((a) => a.id + ":" + a.status + ":" + a.updatedAt).join("|") + "|" + view;
  useFlip(boardRef, flipSignature);

  // Board shortcuts: R refresh, S select mode (only with no panel or dialog open).
  const shortcuts = useRef({ reload: () => {}, toggleSelect: () => {} });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable='true']") || document.querySelector('[aria-modal="true"], .ui-pop')) return;
      const k = e.key.toLowerCase();
      if (k === "r") { e.preventDefault(); shortcuts.current.reload(); }
      else if (k === "s") { e.preventDefault(); shortcuts.current.toggleSelect(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    cardActions.current = {
      open: (id, rect) => { peekLeave(); setOrigin(rect); setOpenId(id); },
      toggle: (id) => toggle(id),
      peekEnter,
      peekLeave,
      dragStart: (id) => { peekLeave(); setDragging(id); },
      dragEnd: () => setDragging(null),
      send: (a, kind) => openSend(a, kind),
    };
  });
  useEffect(() => {
    shortcuts.current = {
      reload: () => { if (view === "board") reload(); },
      toggleSelect: () => { if (view !== "board") return; if (selectMode) { setSelectMode(false); setSelected(new Set()); } else setSelectMode(true); },
    };
  });

  async function addNote(id: string, text: string, type: "auto" | "manual" | "interview") {
    const { error } = await portalClient().from("application_notes").insert({ application_id: id, type, text });
    if (error) toast("Couldn't save note: " + error.message);
  }

  async function moveTo(id: string, status: StageId, opts: { undoable?: boolean } = { undoable: true }) {
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
    if (opts.undoable) {
      toast(`${a.name || "Applicant"} moved to ${STAGE_BY_ID[status].label}`, {
        action: { label: "Undo", onClick: () => { moveTo(id, prev, { undoable: false }); } },
      });
    }
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

  /** Moves several applicants at once. `from` restores each one's own previous stage (Undo). */
  async function bulkMove(status: StageId | null, from?: Map<string, StageId>) {
    const targets = from
      ? [...from.entries()]
      : selectedApplicants.filter((a) => a.status !== status).map((a) => [a.id, status as StageId] as [string, StageId]);
    if (!targets.length) return;
    const previous = new Map(targets.map(([id]) => [id, applicants.find((x) => x.id === id)?.status ?? "applied"] as [string, StageId]));
    const db = portalClient();
    // Optimistic: move the cards now; the database catches up below.
    setApplicants((l) => l.map((x) => { const t = targets.find(([id]) => id === x.id); return t ? { ...x, status: t[1], updatedAt: new Date().toISOString() } : x; }));
    const byStage = new Map<StageId, string[]>();
    for (const [id, st] of targets) byStage.set(st, [...(byStage.get(st) ?? []), id]);
    for (const [st, ids] of byStage) {
      const { data, error } = await db.from("applications").update({ status: st }).in("id", ids).select("id");
      if (error) { toast("Couldn't move them: " + error.message); await refreshIds(targets.map(([id]) => id)); return; }
      const moved = (data ?? []).map((r) => r.id as string);
      if (moved.length) await db.from("application_notes").insert(moved.map((id) => ({ application_id: id, type: "auto", text: "Moved to " + STAGE_BY_ID[st].label })));
    }
    await refreshIds(targets.map(([id]) => id));
    if (!from && status) {
      toast(`Moved ${targets.length} to ${STAGE_BY_ID[status].label}`, {
        action: { label: "Undo", onClick: () => { bulkMove(null, previous); } },
      });
    }
  }

  // ---- Export + end-of-season clean-up -------------------------------------------------

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

  const topbar = (
    <header className="app-bar">
      <div className="app-bar-inner">
        <a className="app-brand" href="/" title="StartUp Link UniMelb website">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand mark */}
          <img className="brand-wordmark" src="/img/logo.png" alt="StartUp Link UniMelb" width={898} height={315} />
        </a>
        <span className="app-bar-slash" aria-hidden="true">/</span>
        {/* Tool switcher: recruitment is the only tool for now; new tools get added here. */}
        <Menu
          label="Switch tool"
          className="app-bar-crumb"
          align="start"
          items={[
            { heading: "Tools" },
            { label: "Recruitment", checked: true, onSelect: () => {} },
          ]}
        >
          Recruitment
          <Icon name="chevronUpDown" size={14} />
        </Menu>
        <nav className="app-tabs" aria-label="Portal view">
          <button type="button" aria-label="Board" aria-current={view === "board" ? "page" : undefined} onClick={() => setView("board")}>
            <Icon name="board" /><span className="tab-label">Board</span>
          </button>
          <button type="button" aria-label="Insights" aria-current={view === "insights" ? "page" : undefined} onClick={() => { exitSelect(); setView("insights"); }}>
            <Icon name="chart" /><span className="tab-label">Insights</span>
          </button>
          <button type="button" aria-label="Health" aria-current={view === "health" ? "page" : undefined} onClick={() => { exitSelect(); setView("health"); }}>
            <Icon name="pulse" /><span className="tab-label">Health</span>
          </button>
        </nav>
        <div className="app-bar-end">
          <button className="cmd-trigger" type="button" aria-label="Search and commands" onClick={() => setCmdOpen(true)}>
            <Icon name="search" size={14} />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          {connection === "down" ? (
            <span className="conn-pill" role="status"><span className="conn-dot" aria-hidden="true" />Reconnecting…</span>
          ) : null}
          <AvatarStack names={online} size={24} label={online.join(", ") + (online.length === 1 ? " is" : " are") + " online"} />
          <Menu
            label="Appearance"
            items={[
              { heading: "Appearance" },
              { label: "System", checked: theme === "system", onSelect: () => setTheme("system") },
              { label: "Light", checked: theme === "light", onSelect: () => setTheme("light") },
              { label: "Dark", checked: theme === "dark", onSelect: () => setTheme("dark") },
            ]}
          >
            <Icon name={theme === "light" ? "sun" : theme === "dark" ? "moon" : "monitor"} />
          </Menu>
          <button
            className="ui-icon-btn"
            type="button"
            data-tip="Settings"
            aria-label="Settings"
            onClick={async () => { await refreshSettings(); setSettingsOpen(true); }}
          >
            <Icon name="sliders" />
          </button>
          <Menu
            label="Account"
            className="app-avatar"
            items={[
              { heading: me || "Signed in" },
              { label: "Sign out", icon: <Icon name="logOut" />, onSelect: () => { portalClient().auth.signOut(); } },
            ]}
          >
            {me ? initials(me) : ""}
          </Menu>
        </div>
      </div>
    </header>
  );

  const shell = (body: React.ReactNode) => (
    <div className={"app" + (view === "board" ? " is-board" : "")}>
      {topbar}
      <div className="app-body">{body}</div>
      {settingsModal}
    </div>
  );

  if (loading) return shell(<BoardSkeleton />);
  if (loadError) {
    return shell(
      <div className="state is-error">
        <Glyph3D kind="network" />
        <h3>Couldn&apos;t reach the database</h3>
        <p>{retryIn > 0 ? `Trying again in ${retryIn}s…` : "Trying again…"}</p>
        <button className="ui-btn ui-btn-primary" type="button" onClick={() => { setRetryIn(0); reload(); }}>Try now</button>
        <code className="state-detail">{loadError}</code>
      </div>,
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
  // Panel navigation follows the board: stage by stage, newest activity first, current filters.
  const order = STAGES.flatMap((stage) => visible.filter((a) => a.status === stage.id).sort((x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || "")).map((a) => a.id));
  const at = open ? order.indexOf(open.id) : -1;
  const nav: PanelNav | undefined = at >= 0 ? { index: at, total: order.length, prev: order[at - 1], next: order[at + 1] } : undefined;
  const sending = send ? applicants.find((a) => a.id === send.id) : undefined;
  const filtering = !!(filters.q || filters.role || filters.rating);
  const myQueue = applicants.filter((a) => needsMyVote(a, me)).length;

  const commands: Command[] = [
    { id: "v:board", group: "Go to", label: "Board", icon: "board", keywords: "pipeline kanban", run: () => setView("board") },
    { id: "v:insights", group: "Go to", label: "Insights", icon: "chart", keywords: "stats analytics", run: () => { exitSelect(); setView("insights"); } },
    { id: "v:health", group: "Go to", label: "Application health", icon: "pulse", keywords: "form funnel drop off", run: () => { exitSelect(); setView("health"); } },
    ...(open ? STAGES.filter((st) => st.id !== open.status).map((st): Command => ({
      id: "m:" + st.id, group: `Move ${open.name || "applicant"}`, label: "Move to " + st.label, dot: st.color, keywords: "stage status",
      run: () => { const id = open.id; setOpenId(null); setOrigin(null); moveTo(id, st.id); },
    })) : []),
    { id: "f:mine", group: "Filter", label: "Needs my vote", icon: "checkSquare", keywords: "screening queue", run: () => { setView("board"); setFilter("rating", "needs-my-vote"); } },
    ...(filtering ? [{ id: "f:clear", group: "Filter", label: "Clear filters", icon: "x" as const, run: () => setFilters({ q: "", role: "", rating: "" }) }] : []),
    { id: "a:refresh", group: "Actions", label: "Refresh", icon: "refresh", hint: <kbd>R</kbd>, run: () => { reload(); } },
    { id: "a:select", group: "Actions", label: selectMode ? "Exit selection" : "Select applicants", icon: "checkSquare", hint: <kbd>S</kbd>, keywords: "bulk", run: () => { setView("board"); if (selectMode) exitSelect(); else setSelectMode(true); } },
    { id: "a:csv", group: "Actions", label: "Export CSV", icon: "download", keywords: "download spreadsheet", run: exportCSV },
    { id: "a:json", group: "Actions", label: "Export JSON backup", icon: "download", keywords: "download", run: exportJSON },
    { id: "a:settings", group: "Actions", label: "Settings", icon: "sliders", keywords: "emails templates sender", run: async () => { await refreshSettings(); setSettingsOpen(true); } },
    { id: "t:light", group: "Appearance", label: "Light theme", icon: "sun", keywords: "mode", run: () => setTheme("light") },
    { id: "t:dark", group: "Appearance", label: "Dark theme", icon: "moon", keywords: "mode", run: () => setTheme("dark") },
    { id: "t:system", group: "Appearance", label: "Match system theme", icon: "monitor", keywords: "mode auto", run: () => setTheme("system") },
    { id: "a:signout", group: "Account", label: "Sign out", icon: "logOut", keywords: "log out", run: () => { portalClient().auth.signOut(); } },
  ];
  const teamOptions: SelectOption[] = [
    { value: "", label: "All teams" },
    ...roles.map((r) => ({ value: r, label: r, group: "Includes 2nd choice" })),
  ];

  return (
    <div className={"app" + (view === "board" ? " is-board" : "")}>
      {topbar}
      <div className="app-body">
        {view === "insights" ? <Insights applicants={applicants} /> : null}
        {view === "health" ? <Health /> : null}
        <div className="board-view" hidden={view !== "board"}>
          <div className="page-head">
            <div>
              <div className="title-row">
                <Glyph3D kind="network" />
                <h1>Pipeline</h1>
              </div>
              {filtering ? <p>{visible.length} of {applicants.length} shown</p> : (
                <p className="greet">
                  {greeting()}{firstName(me) ? `, ${firstName(me)}` : ""}
                  {myQueue ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      <button type="button" className="greet-link" onClick={() => setFilter("rating", "needs-my-vote")}>
                        {myQueue} need{myQueue === 1 ? "s" : ""} your vote
                      </button>
                    </>
                  ) : null}
                </p>
              )}
            </div>
            <dl className="pipe-stats">
              {tiles.map(([l, v]) => <div className="pipe-stat" key={l}><dd><Ticker value={v} /></dd><dt>{l}</dt></div>)}
            </dl>
          </div>

          <div className="toolbar">
            <label className="search">
              <Icon name="search" />
              <input
                ref={searchRef}
                type="search"
                placeholder="Search name, email, team, degree"
                aria-label="Search applicants"
                value={filters.q}
                onChange={(e) => setFilter("q", e.target.value)}
              />
              {filters.q ? null : <kbd aria-hidden="true">/</kbd>}
            </label>
            <Select label="Filter by team" value={filters.role} onChange={(v) => setFilter("role", v)} options={teamOptions} />
            <Select label="Filter applicants" value={filters.rating} onChange={(v) => setFilter("rating", v)} options={FILTERS} />
            {filtering ? (
              <button className="ui-btn ui-btn-ghost" type="button" onClick={() => setFilters({ q: "", role: "", rating: "" })}>Reset</button>
            ) : null}
            <span className="spacer" />
            <button
              className={"ui-btn" + (selectMode ? " is-on" : "")}
              type="button"
              aria-pressed={selectMode}
              data-tip={selectMode ? "Done · S" : "Select · S"}
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            >
              <Icon name="checkSquare" />{selectMode ? "Done" : "Select"}
            </button>
            <Menu
              label="More actions"
              items={[
                { label: "Refresh", icon: <Icon name="refresh" />, hint: <kbd>R</kbd>, onSelect: () => { reload(); } },
                "sep",
                { label: "Export JSON backup", icon: <Icon name="download" />, onSelect: exportJSON },
                { label: "Export CSV", icon: <Icon name="download" />, onSelect: exportCSV },
              ]}
            >
              <Icon name="more" />
            </Menu>
          </div>

          {applicants.length === 0 ? (
            <div className="state is-boxed empty-art">
              <Glyph3D kind="network" />
              <h3>No applicants yet</h3>
              <a className="ui-btn" href="/recruitment-demo" target="_blank" rel="noopener">Open the application form <Icon name="external" /></a>
            </div>
          ) : (
            <div ref={boardRef} className={"crm-board" + (selectMode ? " is-selecting" : "")} id="crm-board">
              {STAGES.map((stage) => {
                const items = visible.filter((a) => a.status === stage.id).sort((x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || ""));
                const allOn = items.length > 0 && items.every((a) => selected.has(a.id));
                return (
                  <section className="crm-col" key={stage.id} style={{ "--col": stage.color } as React.CSSProperties} aria-label={stage.label}>
                    <header className="crm-col-head">
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
                    </header>
                    <div
                      className={"crm-col-body" + (dropTarget === stage.id ? " drop-target" : "")}
                      data-stage={stage.id}
                      onDragOver={(e) => { if (selectMode) return; e.preventDefault(); setDropTarget(stage.id); }}
                      onDragLeave={() => setDropTarget((t) => (t === stage.id ? null : t))}
                      onDrop={(e) => { e.preventDefault(); setDropTarget(null); setDragging(null); moveTo(e.dataTransfer.getData("text/plain"), stage.id); }}
                    >
                      {items.length === 0 ? <div className="crm-col-empty">{selectMode ? "Empty" : "Drop here"}</div> : null}
                      {items.slice(0, limits[stage.id] ?? COLUMN_PAGE).map((a) => (
                        <BoardCard
                          key={a.id}
                          a={a}
                          selectMode={selectMode}
                          isSel={selected.has(a.id)}
                          isDragging={dragging === a.id}
                          viaSecond={!!filters.role && a.role !== filters.role && a.roleSecondary === filters.role}
                          dupes={dupesOf(a).length}
                          viewers={(viewers.get(a.id) ?? []).join(",")}
                          actions={cardActions}
                        />
                      ))}
                      {items.length > (limits[stage.id] ?? COLUMN_PAGE) ? (
                        <MoreCards
                          remaining={items.length - (limits[stage.id] ?? COLUMN_PAGE)}
                          onMore={() => setLimits((l) => ({ ...l, [stage.id]: (l[stage.id] ?? COLUMN_PAGE) + COLUMN_PAGE }))}
                        />
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectMode && view === "board" ? (
        <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
          <span className="bulk-count"><strong>{selected.size}</strong> selected</span>
          <span className="bulk-sep" aria-hidden="true" />
          <Select
            label="Move selected to stage"
            value=""
            placeholder="Move to…"
            disabled={!selected.size}
            options={STAGES.map((st) => ({ value: st.id, label: st.label, dot: st.color }))}
            onChange={(v) => { if (v) bulkMove(v as StageId); }}
          />
          <Menu
            label="Email selected"
            className="ui-btn ui-btn-primary"
            align="start"
            disabled={!selected.size}
            items={[
              { label: "Interview invite", onSelect: () => setBulk("invite") },
              { label: "Offer", onSelect: () => setBulk("offer") },
              { label: "Rejection", onSelect: () => setBulk("reject") },
            ]}
          >
            <Icon name="mail" />Email
          </Menu>
          <span className="bulk-sep" aria-hidden="true" />
          <button className="ui-btn ui-btn-ghost" type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear</button>
          <button className="ui-icon-btn" type="button" aria-label="Exit selection" data-tip="Exit selection" onClick={exitSelect}><Icon name="x" /></button>
        </div>
      ) : null}

      {cmdOpen ? (
        <CommandMenu
          commands={commands}
          applicants={applicants}
          onClose={() => setCmdOpen(false)}
          onOpenApplicant={(id) => { setView("board"); setOrigin(null); setOpenId(id); }}
        />
      ) : null}
      {peek && view === "board" ? (() => { const pa = applicants.find((x) => x.id === peek.id); return pa ? <HoverPreview a={pa} rect={peek.rect} /> : null; })() : null}
      {open ? (
        <ApplicantModal
          key={open.id}
          origin={origin}
          viewers={viewers.get(open.id) ?? []}
          a={open}
          me={me}
          duplicates={dupesOf(open)}
          ratingMovesStage={settings.ratingMovesStage}
          nav={nav}
          onClose={() => { setOpenId(null); setOrigin(null); }}
          onSaved={() => refreshIds([open.id])}
          onSendInvite={(id) => setSend({ id, kind: "invite" })}
          onOpenOther={(id) => { setOrigin(null); setOpenId(id); }}
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
    </div>
  );
}
