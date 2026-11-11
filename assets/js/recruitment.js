/* StartUp Link UniMelb — Recruitment CRM (committee portal)
 *
 * A committee-only pipeline tracker: applicants move Applied -> Under review ->
 * Interview invited -> Interview booked -> Interviewed -> Offer / Rejected.
 *
 * DATA: shared Supabase database (see supabase/schema.sql). Applications arrive from the
 * public form on recruitment.html; resumes/attachments live in the private "resumes"
 * bucket and open via short-lived signed links. Access is enforced by Row Level Security
 * (only signed-in users on the committee_members allowlist can read or write anything).
 *
 * portal.html signs the reviewer in, then calls SUL_CRM.start(db). SUL_CRM.stop() tears
 * everything down on sign-out.
 */
(function () {
  "use strict";

  var root = document.getElementById("crm-root");
  if (!root) return;

  var db = null;            // Supabase client, set by start()
  var channel = null;       // realtime subscription
  var reloadTimer = null;
  var running = false;
  var loading = false;
  var loadError = "";

  var STAGES = [
    { id: "applied",     label: "Applied",           color: "#6b7a99" },
    { id: "review",      label: "Under review",       color: "#d9a441" },
    { id: "invited",     label: "Interview invited",  color: "#9b7bd4" },
    { id: "booked",      label: "Interview booked",   color: "#3fb6c9" },
    { id: "interviewed", label: "Interviewed",        color: "#5b8def" },
    { id: "offer",       label: "Offer",              color: "#43c47a" },
    { id: "rejected",    label: "Rejected",           color: "#e0607a" },
  ];
  var STAGE_BY_ID = {};
  STAGES.forEach(function (s) { STAGE_BY_ID[s.id] = s; });

  var RATINGS = [
    { id: "yes",   label: "Yes" },
    { id: "maybe", label: "Maybe" },
    { id: "no",    label: "No" },
  ];

  // Applications aren't assigned to a person by name (names change every
  // handover) — they're assigned to a committee role. Two directors currently
  // share a title, so those get (1)/(2). President/Secretary/Treasurer are
  // included so they *can* pick up an application, even though that's rare.
  var ASSIGNEES = [
    { id: "md1",   label: "Marketing Director (1)",        short: "Marketing Dir. 1" },
    { id: "md2",   label: "Marketing Director (2)",        short: "Marketing Dir. 2" },
    { id: "erd",   label: "External Relations Director",   short: "Ext. Relations Dir." },
    { id: "ipd",   label: "Internal Projects Director",     short: "Internal Projects Dir." },
    { id: "pd1",   label: "Projects Director (1)",          short: "Projects Dir. 1" },
    { id: "pd2",   label: "Projects Director (2)",          short: "Projects Dir. 2" },
    { id: "pcd",   label: "People & Culture Director",      short: "People & Culture Dir." },
    { id: "ed",    label: "Events Director",                short: "Events Dir." },
    { id: "pres",  label: "President",                      short: "President" },
    { id: "sec",   label: "Secretary",                      short: "Secretary" },
    { id: "treas", label: "Treasurer",                      short: "Treasurer" },
  ];
  var ASSIGNEE_BY_ID = {};
  ASSIGNEES.forEach(function (a) { ASSIGNEE_BY_ID[a.id] = a; });

  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // ---- State ---------------------------------------------------------------
  var state = emptyState();
  function emptyState() { return { applicants: [], settings: { bookingSlots: [] } }; }

  // Applicant fields the committee can edit -> database column. The modal only sends the
  // fields that actually changed, so two reviewers editing different fields don't clobber
  // each other.
  var EDITABLE = {
    name: "name", email: "email", phone: "phone", role: "role", assignee: "assignee",
    resume: "resume_url", booking: "booking", bookingSlotId: "booking_slot_id",
    interviewAt: "interview_at", status: "status", rating: "rating",
  };
  var NULLABLE = { bookingSlotId: true, interviewAt: true };

  function changesBetween(orig, draft) {
    var out = {};
    Object.keys(EDITABLE).forEach(function (k) {
      if ((orig[k] || "") !== (draft[k] || "")) {
        out[EDITABLE[k]] = NULLABLE[k] ? (draft[k] || null) : (draft[k] || "");
      }
    });
    return out;
  }

  function noteFromRow(n) {
    return { id: n.id, ts: n.created_at, text: n.text, type: n.type === "auto" ? "auto" : "manual", author: n.author_email || "" };
  }

  function fromRow(r) {
    return {
      id: r.id,
      name: r.name || "",
      email: r.email || "",
      phone: r.phone || "",
      degree: r.degree || "",
      yearLevel: r.year_level || "",
      role: r.role || "",
      roleSecondary: r.role_secondary || "",
      statement: r.statement || "",
      linkedin: r.linkedin || "",
      files: Array.isArray(r.files) ? r.files : [],
      resume: r.resume_url || "",
      assignee: ASSIGNEE_BY_ID[r.assignee] ? r.assignee : "",
      booking: r.booking || "",
      bookingSlotId: r.booking_slot_id || "",
      interviewAt: r.interview_at || "",
      status: STAGE_BY_ID[r.status] ? r.status : "applied",
      rating: r.rating || "",
      notes: (r.application_notes || []).map(noteFromRow).sort(function (x, y) { return y.ts.localeCompare(x.ts); }),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  function slotFromRow(r) {
    return { id: r.id, label: r.label, day: r.day, start: r.start_time, end: r.end_time || "", url: r.url };
  }

  function loadAll() {
    return Promise.all([
      db.from("applications").select("*, application_notes(*)").order("created_at", { ascending: false }),
      db.from("booking_slots").select("*").order("created_at", { ascending: true }),
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      if (r[1].error) throw r[1].error;
      state.applicants = r[0].data.map(fromRow);
      state.settings.bookingSlots = r[1].data.map(slotFromRow);
      loadError = "";
    }).catch(function (e) {
      loadError = (e && e.message) || "Couldn't load applications.";
    });
  }

  function start(client) {
    db = client;
    running = true;
    loading = true;
    render();
    return loadAll().then(function () {
      loading = false;
      if (!running) return;
      render();
      subscribe();
    });
  }

  function stop() {
    running = false;
    clearTimeout(reloadTimer);
    if (channel && db) { db.removeChannel(channel); }
    channel = null;
    state = emptyState();
    closeModal();
    root.innerHTML = "";
  }

  // Live updates: a new application (or a teammate's edit) shows up without a refresh.
  function subscribe() {
    if (channel || !db) return;
    channel = db.channel("crm-live");
    ["applications", "application_notes", "booking_slots"].forEach(function (t) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, scheduleReload);
    });
    channel.subscribe();
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      loadAll().then(function () {
        if (!running) return;
        // Don't yank the toolbar away while someone is typing in the search box.
        var ae = document.activeElement;
        if (root.contains(ae) && ae.tagName === "INPUT" && document.getElementById("crm-board")) refreshBoard();
        else render();
      });
    }, 500);
  }

  // ---- DB write helpers ------------------------------------------------------
  // Resolves true on success. RLS-denied updates return zero rows with no error, so check both.
  function dbUpdate(id, patch) {
    return db.from("applications").update(patch).eq("id", id).select("id").then(function (res) {
      if (res.error || !res.data || !res.data.length) {
        alert("Couldn't save: " + (res.error ? res.error.message : "you may not have permission, or the applicant was deleted."));
        return false;
      }
      return true;
    });
  }

  function addNote(a, text, type) {
    return db.from("application_notes").insert({ application_id: a.id, type: type, text: text }).select().single()
      .then(function (res) {
        if (res.error) { toast("Couldn't save note: " + res.error.message); return null; }
        var n = noteFromRow(res.data);
        a.notes = a.notes || [];
        a.notes.unshift(n);
        return n;
      });
  }

  // ---- Small helpers -------------------------------------------------------
  function nowISO() { return new Date().toISOString(); }

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "text") { node.textContent = v; }
        else if (k === "html") { node.innerHTML = v; }
        else if (k === "class") { node.className = v; }
        else if (k === "disabled") { if (v) node.setAttribute("disabled", ""); }
        else if (k.slice(0, 2) === "on" && typeof v === "function") {
          node.addEventListener(k.slice(2), v);
        } else if (v === true) { node.setAttribute(k, ""); }
        else { node.setAttribute(k, v); }
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  function fmtDateTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }
  function fmtSize(bytes) {
    if (!bytes) return "";
    return bytes < 1048576 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1048576).toFixed(1) + " MB";
  }
  // datetime-local <-> ISO
  function toLocalInput(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fromLocalInput(v) {
    if (!v) return "";
    var d = new Date(v);
    return isNaN(d) ? "" : d.toISOString();
  }
  // Next date/time matching a given weekday (0=Sun..6=Sat) and "HH:MM", today or later.
  function nextOccurrence(day, hhmm) {
    var parts = (hhmm || "00:00").split(":");
    var hh = parseInt(parts[0], 10) || 0, mm = parseInt(parts[1], 10) || 0;
    var now = new Date();
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    var diff = (day - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    if (d <= now) d.setDate(d.getDate() + 7);
    return d;
  }

  function firstName(name) { return (name || "").trim().split(/\s+/)[0] || "there"; }

  function byId(id) { return state.applicants.filter(function (a) { return a.id === id; })[0]; }

  function assigneeLabel(id) { return ASSIGNEE_BY_ID[id] ? ASSIGNEE_BY_ID[id].label : ""; }
  function assigneeIdFromLabel(v) {
    v = (v || "").trim().toLowerCase();
    if (!v) return "";
    var hit = ASSIGNEES.filter(function (a) { return a.label.toLowerCase() === v || a.short.toLowerCase() === v; })[0];
    return hit ? hit.id : "";
  }
  function hasResume(a) { return (a.files && a.files.length > 0) || !!a.resume; }

  // ---- Filtering -----------------------------------------------------------
  var filters = { q: "", role: "", rating: "", assignee: "" };

  function roleList() {
    var set = {};
    state.applicants.forEach(function (a) { if (a.role) set[a.role] = true; });
    return Object.keys(set).sort();
  }

  function visibleApplicants() {
    var q = filters.q.trim().toLowerCase();
    return state.applicants.filter(function (a) {
      if (filters.role && a.role !== filters.role) return false;
      if (filters.rating && a.rating !== filters.rating) return false;
      if (filters.assignee) {
        if (filters.assignee === "__unassigned") { if (a.assignee) return false; }
        else if (a.assignee !== filters.assignee) return false;
      }
      if (q) {
        var hay = (a.name + " " + (a.email || "") + " " + (a.role || "") + " " + (a.degree || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // ---- Render: shell -------------------------------------------------------
  function render() {
    if (!running) return;
    root.innerHTML = "";
    root.appendChild(buildHead());
    if (loading) {
      root.appendChild(h("div", { class: "crm-empty" }, [h("h3", { text: "Loading applications…" })]));
      return;
    }
    if (loadError) {
      root.appendChild(h("div", { class: "crm-empty" }, [
        h("h3", { text: "Couldn't load applications" }),
        h("p", { text: loadError + " If this is a new setup, check that supabase/schema.sql has been run and your email is in committee_members." }),
        h("div", { class: "cta-row" }, [
          h("button", { class: "btn btn-primary", type: "button", text: "Try again", onclick: reload }),
        ]),
      ]));
      return;
    }
    root.appendChild(buildStats());
    root.appendChild(buildToolbar());
    if (state.applicants.length === 0) {
      root.appendChild(buildEmpty());
    } else {
      root.appendChild(buildBoard());
    }
  }

  function reload() {
    loading = true; render();
    return loadAll().then(function () { loading = false; render(); if (!channel) subscribe(); });
  }

  function buildHead() {
    return h("div", { class: "crm-head" }, [
      h("div", {}, [
        h("h2", { text: "Recruitment" }),
        h("p", { text: "Track every applicant from first application through to offer." }),
      ]),
      h("div", { class: "crm-head-actions" }, [
        h("button", { class: "btn btn-secondary btn-sm", type: "button", "data-portal-logout": true, text: "Sign out" }),
      ]),
    ]);
  }

  function buildStats() {
    var a = state.applicants;
    var active = a.filter(function (x) { return x.status !== "offer" && x.status !== "rejected"; }).length;
    var interviewed = a.filter(function (x) { return ["interviewed", "offer", "rejected"].indexOf(x.status) !== -1; }).length;
    var offers = a.filter(function (x) { return x.status === "offer"; }).length;
    var rejected = a.filter(function (x) { return x.status === "rejected"; }).length;
    var tiles = [
      ["Total", a.length],
      ["In pipeline", active],
      ["Interviewed", interviewed],
      ["Offers", offers],
      ["Rejected", rejected],
    ];
    return h("div", { class: "crm-stats" }, tiles.map(function (t) {
      return h("div", { class: "crm-stat" }, [
        h("div", { class: "n", text: String(t[1]) }),
        h("div", { class: "l", text: t[0] }),
      ]);
    }));
  }

  function buildToolbar() {
    var search = h("input", {
      type: "search", placeholder: "Search name, email, role, degree…", value: filters.q,
      "aria-label": "Search applicants",
      oninput: function (e) { filters.q = e.target.value; refreshBoard(); },
    });

    var roleSel = h("select", {
      "aria-label": "Filter by role",
      onchange: function (e) { filters.role = e.target.value; refreshBoard(); },
    }, [h("option", { value: "", text: "All roles" })].concat(
      roleList().map(function (r) {
        return h("option", { value: r, text: r, selected: filters.role === r });
      })
    ));

    var assigneeSel = h("select", {
      "aria-label": "Filter by assignee",
      onchange: function (e) { filters.assignee = e.target.value; refreshBoard(); },
    }, [
      h("option", { value: "", text: "Everyone" }),
      h("option", { value: "__unassigned", text: "Unassigned", selected: filters.assignee === "__unassigned" }),
    ].concat(
      ASSIGNEES.map(function (a) {
        return h("option", { value: a.id, text: a.label, selected: filters.assignee === a.id });
      })
    ));

    var ratingSel = h("select", {
      "aria-label": "Filter by rating",
      onchange: function (e) { filters.rating = e.target.value; refreshBoard(); },
    }, [h("option", { value: "", text: "Any rating" })].concat(
      RATINGS.map(function (r) {
        return h("option", { value: r.id, text: "Rated: " + r.label, selected: filters.rating === r.id });
      })
    ));

    return h("div", { class: "crm-toolbar" }, [
      h("div", { class: "crm-search" }, [search]),
      roleSel, assigneeSel, ratingSel, buildMenu(),
    ]);
  }

  function buildMenu() {
    function item(label, fn, cls) {
      return h("button", { type: "button", class: cls || "", text: label, onclick: function () {
        closeMenu(); fn();
      } });
    }
    var menu = h("details", { class: "crm-menu" }, [
      h("summary", { "aria-label": "More actions", text: "⋯" }),
      h("div", { class: "crm-menu-list" }, [
        item("Refresh", reload),
        h("div", { class: "sep" }),
        item("Export as JSON (backup)", exportJSON),
        item("Export as CSV", exportCSV),
        item("Import from CSV", importCSVPrompt),
        h("div", { class: "sep" }),
        item("Manage booking links", openBookingSlotsModal),
      ]),
    ]);
    return menu;
    function closeMenu() { menu.removeAttribute("open"); }
  }

  function buildEmpty() {
    return h("div", { class: "crm-empty" }, [
      h("h3", { text: "No applicants yet" }),
      h("p", { text: "Applications land here automatically as soon as someone submits the form on the Recruitment page. You can also import an existing spreadsheet as CSV." }),
      h("div", { class: "cta-row" }, [
        h("a", { class: "btn btn-secondary", href: "recruitment.html", target: "_blank", rel: "noopener", text: "Open the application form" }),
        h("button", { class: "btn btn-primary", type: "button", text: "Import from CSV", onclick: importCSVPrompt }),
      ]),
    ]);
  }

  // ---- Render: board -------------------------------------------------------
  function buildBoard() {
    var board = h("div", { class: "crm-board", id: "crm-board" });
    var visible = visibleApplicants();
    STAGES.forEach(function (stage) {
      var items = visible.filter(function (a) { return a.status === stage.id; })
        .sort(function (x, y) { return (y.updatedAt || "").localeCompare(x.updatedAt || ""); });
      board.appendChild(buildColumn(stage, items));
    });
    return board;
  }

  function refreshBoard() {
    // Re-render just the board + stats (filters live in the toolbar already).
    var oldBoard = document.getElementById("crm-board");
    if (!oldBoard) { render(); return; }
    oldBoard.replaceWith(buildBoard());
    var stats = root.querySelector(".crm-stats");
    if (stats) stats.replaceWith(buildStats());
  }

  function buildColumn(stage, items) {
    var body = h("div", { class: "crm-col-body", "data-stage": stage.id });
    if (items.length === 0) {
      body.appendChild(h("div", { class: "crm-col-empty", text: "Drop here" }));
    } else {
      items.forEach(function (a) { body.appendChild(buildCard(a)); });
    }
    // Drag-and-drop drop target
    body.addEventListener("dragover", function (e) { e.preventDefault(); body.classList.add("drop-target"); });
    body.addEventListener("dragleave", function () { body.classList.remove("drop-target"); });
    body.addEventListener("drop", function (e) {
      e.preventDefault();
      body.classList.remove("drop-target");
      var id = e.dataTransfer.getData("text/plain");
      moveTo(id, stage.id);
    });

    return h("div", { class: "crm-col", style: "--col:" + stage.color }, [
      h("div", { class: "crm-col-head" }, [
        h("span", { class: "dot" }),
        h("span", { class: "label", text: stage.label }),
        h("span", { class: "count", text: String(items.length) }),
      ]),
      body,
    ]);
  }

  function buildCard(a) {
    var meta = [];
    if (hasResume(a)) meta.push(h("span", { class: "crm-icon", title: "Resume attached", text: "📄" }));
    if (a.interviewAt) meta.push(h("span", { class: "crm-icon", title: "Interview: " + fmtDateTime(a.interviewAt), text: "🗓" }));
    meta.push(h("span", { class: "spacer" }));
    if (a.rating) meta.push(ratingPill(a.rating));
    else meta.push(h("span", { text: fmtDate(a.createdAt) }));

    var card = h("div", {
      class: "crm-card", draggable: "true", "data-id": a.id,
      onclick: function () { openModal(a.id); },
    }, [
      h("div", { class: "cn", text: a.name || "Unnamed" }),
      a.role ? h("div", { class: "cr", text: a.role }) : null,
      a.assignee ? h("div", { class: "ca" }, [h("span", { class: "crm-chip", text: ASSIGNEE_BY_ID[a.assignee] ? ASSIGNEE_BY_ID[a.assignee].short : "" })]) : null,
      h("div", { class: "cmeta" }, meta),
    ]);

    var quickAction = { review: "invite", offer: "offer", rejected: "reject" }[a.status];
    if (quickAction) {
      var quickLabel = quickAction === "invite" ? "Send invite" : quickAction === "offer" ? "Send offer" : "Send rejection";
      card.appendChild(h("button", {
        class: "btn btn-primary btn-sm crm-card-action", type: "button", text: quickLabel,
        onclick: function (e) { e.stopPropagation(); openSendModal(a, quickAction); },
      }));
    }

    card.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/plain", a.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", function () { card.classList.remove("dragging"); });
    return card;
  }

  function ratingPill(rating) {
    var label = RATINGS.filter(function (r) { return r.id === rating; })[0];
    return h("span", { class: "rating " + rating }, [
      h("span", { class: "rd" }),
      document.createTextNode(label ? label.label : rating),
    ]);
  }

  // ---- Mutations -----------------------------------------------------------
  function moveTo(id, status) {
    var a = byId(id);
    if (!a || a.status === status) return;
    var prev = a.status;
    // Optimistic: show the move immediately, roll back if the database refuses it.
    a.status = status;
    a.updatedAt = nowISO();
    refreshBoard();
    dbUpdate(id, { status: status }).then(function (ok) {
      if (!ok) { a.status = prev; refreshBoard(); return; }
      return addNote(a, "Moved to " + STAGE_BY_ID[status].label, "auto");
    });
  }

  function resolveLink(a) {
    if (a.booking && a.booking.trim()) return a.booking.trim();
    var slots = state.settings.bookingSlots || [];
    if (slots.length === 1) return slots[0].url;
    return "";
  }

  // ---- Attachments (private bucket -> short-lived signed links) --------------
  function openFile(f) {
    db.storage.from("resumes").createSignedUrl(f.path, 120).then(function (res) {
      if (res.error || !res.data) { alert("Couldn't open that file: " + (res.error ? res.error.message : "not found")); return; }
      var link = h("a", { href: res.data.signedUrl, target: "_blank", rel: "noopener" });
      document.body.appendChild(link); link.click(); link.remove();
    });
  }

  // ---- Send email (invite / offer / rejection) ------------------------------
  var SEND_META = {
    invite: { title: "Send interview invite", logged: "Invite emailed" },
    offer:  { title: "Send offer",            logged: "Offer emailed" },
    reject: { title: "Send rejection",        logged: "Rejection emailed" },
  };

  function emailSubject(kind) {
    if (kind === "invite") return "Interview invite — StartUp Link UniMelb";
    if (kind === "offer") return "Offer — StartUp Link UniMelb Committee";
    return "Your application — StartUp Link UniMelb";
  }

  function openSendModal(a, kind) {
    if (!a.email) { alert("This applicant doesn't have an email address on file."); return; }
    var body;
    if (kind === "invite") {
      var link = resolveLink(a);
      if (!link) { toast("Set an interview link on their profile first"); openModal(a.id); return; }
      body = inviteMessage(a, link);
    } else if (kind === "offer") {
      body = offerMessage(a);
    } else {
      body = rejectionMessage(a);
    }

    function closeSend() { sendOverlay.remove(); document.removeEventListener("keydown", onSendEsc); }
    function onSendEsc(e) { if (e.key === "Escape") closeSend(); }

    var subjectInput = h("input", { type: "text", value: emailSubject(kind) });
    var bodyInput = h("textarea", { value: body, style: "min-height:220px" });

    var sendBtn = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Send email", onclick: function () {
      sendBtn.setAttribute("disabled", "");
      sendBtn.textContent = "Sending…";
      sendEmail(a.email, subjectInput.value, bodyInput.value).then(function (ok) {
        if (!ok) { sendBtn.removeAttribute("disabled"); sendBtn.textContent = "Send email"; return; }
        var chain = addNote(a, SEND_META[kind].logged, "auto");
        if (kind === "invite" && a.status === "review") {
          chain = chain.then(function () {
            return dbUpdate(a.id, { status: "invited" }).then(function (saved) { if (saved) a.status = "invited"; });
          });
        }
        chain.then(function () {
          toast(SEND_META[kind].logged);
          closeSend();
          closeModal();
          render();
        });
      });
    } });
    var copyBtn = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Copy instead", onclick: function () {
      copyText(bodyInput.value);
    } });

    var panel = h("div", { class: "crm-panel", role: "dialog", "aria-modal": "true" }, [
      h("div", { class: "crm-panel-head" }, [
        h("h3", { text: SEND_META[kind].title }),
        h("button", { class: "crm-close", type: "button", "aria-label": "Close", text: "×", onclick: closeSend }),
      ]),
      h("div", { class: "crm-panel-body" }, [
        h("div", { class: "crm-field" }, [ h("label", { text: "To" }), h("input", { type: "email", value: a.email, disabled: true }) ]),
        h("div", { class: "crm-field" }, [ h("label", { text: "Subject" }), subjectInput ]),
        h("div", { class: "crm-field" }, [ h("label", { text: "Message" }), bodyInput ]),
      ]),
      h("div", { class: "crm-panel-foot" }, [ copyBtn, h("span", { class: "spacer" }), h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Cancel", onclick: closeSend }), sendBtn ]),
    ]);
    var sendOverlay = h("div", { class: "crm-modal", onclick: function (e) { if (e.target === sendOverlay) closeSend(); } }, [panel]);
    document.body.appendChild(sendOverlay);
    document.addEventListener("keydown", onSendEsc);
  }

  // The endpoint requires a committee session: we pass the reviewer's access token.
  function sendEmail(to, subject, text) {
    return db.auth.getSession().then(function (s) {
      var token = s.data && s.data.session ? s.data.session.access_token : "";
      return fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ to: to, subject: subject, text: text }),
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data.ok) {
          alert("Couldn't send: " + (data.error || ("HTTP " + res.status)));
          return false;
        }
        return true;
      });
    }, function (err) {
      alert("Couldn't send — check your connection. (" + (err && err.message) + ")");
      return false;
    });
  }

  // ---- Modal (view / edit) --------------------------------------------------
  var overlay = null;

  function closeModal() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.removeEventListener("keydown", onEsc);
  }
  function onEsc(e) { if (e.key === "Escape") closeModal(); }

  // Read-only block showing what the applicant submitted on the public form.
  function buildSubmission(a) {
    var rows = [];
    function row(label, node) {
      rows.push(h("div", { class: "crm-sub-row" }, [h("div", { class: "k", text: label }), h("div", { class: "v" }, [node])]));
    }
    function txt(v) { return document.createTextNode(v); }
    if (a.degree) row("Degree", txt(a.degree));
    if (a.yearLevel) row("Expected graduation", txt(a.yearLevel));
    if (a.roleSecondary) row("Second choice", txt(a.roleSecondary));
    if (a.linkedin) row("Link", h("a", { href: a.linkedin, target: "_blank", rel: "noopener noreferrer", text: a.linkedin }));
    if (a.statement) row("Why join", h("div", { class: "crm-sub-statement", text: a.statement }));
    if (a.files.length) {
      var list = h("div", { class: "crm-files" }, a.files.map(function (f) {
        return h("button", { type: "button", class: "crm-file", onclick: function () { openFile(f); } }, [
          h("span", { class: "fi", text: f.kind === "resume" ? "📄 Resume" : "📎 Attachment" }),
          h("span", { class: "fn", text: f.name || "file" }),
          h("span", { class: "fs", text: fmtSize(f.size) }),
        ]);
      }));
      row("Files", list);
    }
    if (!rows.length) return null;
    row("Submitted", txt(fmtDateTime(a.createdAt)));
    return h("div", { class: "crm-field" }, [
      h("label", { text: "Application" }),
      h("div", { class: "crm-sub" }, rows),
    ]);
  }

  function openModal(id) {
    var a = byId(id);
    if (!a) return;

    // Working copy so Cancel discards changes.
    var draft = JSON.parse(JSON.stringify(a));
    var pendingNotes = [];   // manual notes typed in this session, inserted on Save
    var slots = state.settings.bookingSlots || [];

    var f = {};
    function field(key, label, attrs) {
      attrs = attrs || {};
      attrs.value = draft[key] || "";
      attrs.oninput = function (e) { draft[key] = e.target.value; };
      var input = h(attrs.tag || "input", attrs);
      f[key] = input;
      return h("div", { class: "crm-field" }, [h("label", { text: label }), input]);
    }

    // Assignee select
    var assigneeSel = h("select", { onchange: function (e) { draft.assignee = e.target.value; } },
      [h("option", { value: "", text: "Unassigned", selected: !draft.assignee })].concat(
        ASSIGNEES.map(function (a2) { return h("option", { value: a2.id, text: a2.label, selected: draft.assignee === a2.id }); })
      ));

    // Status select
    var statusSel = h("select", { onchange: function (e) { draft.status = e.target.value; } },
      STAGES.map(function (s) { return h("option", { value: s.id, text: s.label, selected: draft.status === s.id }); }));

    // Rating buttons
    var ratingWrap = h("div", { class: "rating-btns" });
    function paintRating() {
      [].forEach.call(ratingWrap.children, function (btn) {
        btn.setAttribute("aria-pressed", btn.getAttribute("data-r") === (draft.rating || "") ? "true" : "false");
      });
    }
    [{ id: "", label: "—" }].concat(RATINGS).forEach(function (r) {
      ratingWrap.appendChild(h("button", {
        type: "button", "data-r": r.id, text: r.label,
        onclick: function () { draft.rating = r.id; paintRating(); },
      }));
    });
    paintRating();

    // Interview datetime + autofill from a booking slot
    var interviewInput = h("input", {
      type: "datetime-local", value: toLocalInput(draft.interviewAt),
      onchange: function (e) { draft.interviewAt = fromLocalInput(e.target.value); },
    });
    var autofillBtn = h("button", {
      class: "btn btn-secondary btn-sm", type: "button", text: "Autofill from slot",
      onclick: function () {
        var slot = slots.filter(function (s) { return s.id === draft.bookingSlotId; })[0];
        if (!slot) { toast("Pick an interview slot below first"); return; }
        draft.interviewAt = nextOccurrence(slot.day, slot.start).toISOString();
        interviewInput.value = toLocalInput(draft.interviewAt);
      },
    });

    // Booking link, driven by a configured slot or a one-off custom link
    var bookingInput = h("input", {
      type: "url", placeholder: "https://zcal.co/…", value: draft.booking || "",
      oninput: function (e) { draft.booking = e.target.value; },
    });
    function paintBookingMode() {
      var usingSlot = !!draft.bookingSlotId;
      bookingInput.disabled = usingSlot;
    }
    var slotSel = h("select", {
      onchange: function (e) {
        var v = e.target.value;
        draft.bookingSlotId = v;
        if (v) {
          var slot = slots.filter(function (s) { return s.id === v; })[0];
          if (slot) {
            draft.booking = slot.url;
            bookingInput.value = slot.url;
            if (!draft.interviewAt) {
              draft.interviewAt = nextOccurrence(slot.day, slot.start).toISOString();
              interviewInput.value = toLocalInput(draft.interviewAt);
            }
          }
        }
        paintBookingMode();
      },
    }, [h("option", { value: "", text: "Custom link", selected: !draft.bookingSlotId })].concat(
      slots.map(function (s) {
        return h("option", { value: s.id, text: s.label + " — " + DAY_NAMES[s.day] + " " + s.start, selected: draft.bookingSlotId === s.id });
      })
    ));
    paintBookingMode();

    var copyInviteBtn = h("button", {
      class: "btn btn-secondary btn-sm", type: "button", text: "Copy invite",
      onclick: function () {
        var link = resolveLink(draft);
        if (!link) { alert("Add a booking link or pick an interview slot first."); return; }
        copyText(inviteMessage(draft, link));
      },
    });

    // Interview notes (manual, newest first) — kept separate from the auto activity log below.
    var notesWrap = h("div", { class: "crm-notes" });
    function paintNotes() {
      notesWrap.innerHTML = "";
      var manual = (draft.notes || []).filter(function (n) { return n.type !== "auto"; });
      if (manual.length === 0) {
        notesWrap.appendChild(h("div", { class: "crm-note-empty", text: "No interview notes yet." }));
        return;
      }
      manual.forEach(function (n) {
        notesWrap.appendChild(h("div", { class: "crm-note-item" }, [
          h("div", { class: "t", text: (n.author ? n.author + " · " : "") + fmtDateTime(n.ts) }),
          h("div", { class: "b", text: n.text }),
        ]));
      });
    }
    paintNotes();
    var noteInput = h("textarea", { placeholder: "Add an interview note, impression, next step…" });
    var addNoteBtn = h("button", {
      class: "btn btn-secondary btn-sm", type: "button", text: "Add note",
      onclick: function () {
        var t = noteInput.value.trim();
        if (!t) return;
        var n = { ts: nowISO(), text: t, type: "manual", author: "" };
        draft.notes = draft.notes || [];
        draft.notes.unshift(n);
        pendingNotes.push(n);
        noteInput.value = "";
        paintNotes();
      },
    });

    // Activity log (auto-generated: stage moves, invites sent) — read-only, sits below notes.
    var activityWrap = h("div", { class: "crm-notes" });
    var autoEntries = (draft.notes || []).filter(function (n) { return n.type === "auto"; });
    if (autoEntries.length === 0) {
      activityWrap.appendChild(h("div", { class: "crm-note-empty", text: "No activity yet." }));
    } else {
      autoEntries.forEach(function (n) {
        activityWrap.appendChild(h("div", { class: "crm-note-item crm-note-auto" }, [
          h("div", { class: "t", text: (n.author ? n.author + " · " : "") + fmtDateTime(n.ts) }),
          h("div", { class: "b", text: n.text }),
        ]));
      });
    }

    var body = h("div", { class: "crm-panel-body" }, [
      buildSubmission(a),
      h("div", { class: "crm-row" }, [ field("name", "Full name", { required: true }), field("email", "Email", { type: "email" }) ]),
      h("div", { class: "crm-row" }, [ field("phone", "Phone"), field("role", "Team applied for", { placeholder: "e.g. Marketing" }) ]),
      h("div", { class: "crm-row" }, [
        h("div", { class: "crm-field" }, [ h("label", { text: "Assigned to" }), assigneeSel ]),
        field("resume", "Resume link (optional)", { type: "url", placeholder: "Only for imported applicants" }),
      ]),
      h("div", { class: "crm-field" }, [
        h("label", { text: "Interview slot" }),
        slotSel,
        h("div", { class: "crm-inline", style: "margin-top:0.5rem" }, [ h("div", { class: "crm-field", style: "margin:0" }, [bookingInput]), copyInviteBtn ]),
        h("div", { class: "crm-help", text: slots.length
          ? "Pick a recurring slot to auto-fill the link and suggest an interview time, or use Custom link to paste a one-off."
          : "No recurring slots set up yet — add some from the ⋯ menu (Manage booking links), or paste a one-off link below." }),
      ]),
      h("div", { class: "crm-row" }, [
        h("div", { class: "crm-field" }, [
          h("label", { text: "Interview time" }),
          h("div", { class: "crm-inline" }, [ h("div", { class: "crm-field", style: "margin:0" }, [interviewInput]), autofillBtn ]),
        ]),
        h("div", { class: "crm-field" }, [ h("label", { text: "Stage" }), statusSel ]),
      ]),
      h("div", { class: "crm-field" }, [ h("label", { text: "Interview rating" }), ratingWrap ]),
      h("div", { class: "crm-field" }, [
        h("label", { text: "Interview notes" }),
        notesWrap,
        h("div", { class: "crm-inline" }, [ h("div", { class: "crm-field", style: "margin:0" }, [noteInput]), addNoteBtn ]),
      ]),
      h("div", { class: "crm-field" }, [
        h("label", { text: "Activity" }),
        activityWrap,
      ]),
    ]);

    var saveBtn = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Save", onclick: function () {
      if (!draft.name.trim()) { f.name.focus(); f.name.style.borderColor = "#e0607a"; return; }
      var patch = changesBetween(a, draft);
      var hasPatch = Object.keys(patch).length > 0;
      saveBtn.setAttribute("disabled", "");
      saveBtn.textContent = "Saving…";
      (hasPatch ? dbUpdate(id, patch) : Promise.resolve(true)).then(function (ok) {
        if (!ok) { saveBtn.removeAttribute("disabled"); saveBtn.textContent = "Save"; return; }
        var inserts = pendingNotes.map(function (n) { return { application_id: id, type: "manual", text: n.text }; });
        if (patch.status) inserts.push({ application_id: id, type: "auto", text: "Moved to " + STAGE_BY_ID[patch.status].label });
        var q = inserts.length ? db.from("application_notes").insert(inserts) : Promise.resolve({});
        return q.then(function (res) {
          if (res && res.error) toast("Saved, but notes failed: " + res.error.message);
          closeModal();
          return loadAll().then(render);
        });
      });
    } });

    var foot = h("div", { class: "crm-panel-foot" }, [
      h("button", { class: "link-danger", type: "button", text: "Delete", onclick: function () {
        var n = a.files.length;
        if (!confirm("Delete " + (draft.name || "this applicant") + (n ? " and their " + n + " attached file" + (n > 1 ? "s" : "") : "") + "? This cannot be undone.")) return;
        var paths = a.files.map(function (x) { return x.path; });
        (paths.length ? db.storage.from("resumes").remove(paths) : Promise.resolve({})).then(function () {
          return db.from("applications").delete().eq("id", id).select("id");
        }).then(function (res) {
          if (res.error || !res.data || !res.data.length) { alert("Couldn't delete: " + (res.error ? res.error.message : "no permission")); return; }
          closeModal();
          return loadAll().then(render);
        });
      } }),
      h("span", { class: "spacer" }),
      h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Cancel", onclick: closeModal }),
      saveBtn,
    ]);

    var panel = h("div", { class: "crm-panel", role: "dialog", "aria-modal": "true" }, [
      h("div", { class: "crm-panel-head" }, [
        h("h3", { text: "Applicant" }),
        h("button", { class: "crm-close", type: "button", "aria-label": "Close", text: "×", onclick: closeModal }),
      ]),
      body, foot,
    ]);

    closeModal();
    overlay = h("div", { class: "crm-modal", onclick: function (e) { if (e.target === overlay) closeModal(); } }, [panel]);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onEsc);
    setTimeout(function () { f.name && f.name.focus(); }, 30);
  }

  // ---- Message templates -----------------------------------------------------
  function inviteMessage(a, link) {
    return "Hi " + firstName(a.name) + ",\n\n" +
      "Thanks for applying to StartUp Link UniMelb — we'd love to meet you. " +
      "Please book an interview time that suits you here:\n" + link + "\n\n" +
      "Looking forward to chatting,\nStartUp Link UniMelb";
  }
  function offerMessage(a) {
    return "Hi " + firstName(a.name) + ",\n\n" +
      "Congratulations! We'd love to offer you a position on the StartUp Link UniMelb committee" +
      (a.role ? " in the " + a.role + " team" : "") + ". We were really impressed with you throughout the process " +
      "and think you'll be a great addition to the team.\n\n" +
      "We'll be in touch shortly with next steps. Welcome aboard!\n\nStartUp Link UniMelb";
  }
  function rejectionMessage(a) {
    return "Hi " + firstName(a.name) + ",\n\n" +
      "Thank you for taking the time to apply" + (a.role ? " to the " + a.role + " team" : "") +
      " and for chatting with us during the interview process. After a lot of consideration, " +
      "we won't be moving forward with your application on this occasion.\n\n" +
      "This was a genuinely competitive round and we'd encourage you to apply again in future. " +
      "Thanks again for your interest in StartUp Link UniMelb, and we wish you all the best.\n\nStartUp Link UniMelb";
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast("Invite copied to clipboard"); },
        function () { fallbackCopy(text); }
      );
    } else { fallbackCopy(text); }
  }
  function fallbackCopy(text) {
    var ta = h("textarea", { value: text, style: "position:fixed;opacity:0;top:0" });
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Invite copied to clipboard"); }
    catch (e) { window.prompt("Copy this invite:", text); }
    ta.remove();
  }

  var toastEl = null, toastTimer = null;
  function toast(text) {
    if (!toastEl) {
      toastEl = h("div", { style:
        "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:200;" +
        "background:#101a30;border:1px solid rgba(255,255,255,0.22);color:#f4f7ff;" +
        "padding:0.6rem 1rem;border-radius:10px;font-size:0.85rem;box-shadow:0 12px 30px rgba(0,0,0,0.5)" });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (toastEl) toastEl.style.opacity = "0"; }, 2200);
  }

  // ---- Settings: booking links (shared across the committee) -------------------
  function openBookingSlotsModal() {
    function closeBS() { bsOverlay.remove(); document.removeEventListener("keydown", onBSEsc); }
    function onBSEsc(e) { if (e.key === "Escape") closeBS(); }

    var listWrap = h("div", { class: "crm-notes" });
    function paintList() {
      listWrap.innerHTML = "";
      var slots = state.settings.bookingSlots || [];
      if (!slots.length) { listWrap.appendChild(h("div", { class: "crm-note-empty", text: "No booking links yet. Add one below." })); return; }
      slots.forEach(function (s) {
        listWrap.appendChild(h("div", { class: "crm-note-item" }, [
          h("div", { class: "b", text: s.label + " — " + DAY_NAMES[s.day] + " " + s.start + (s.end ? "–" + s.end : "") }),
          h("div", { class: "t", text: s.url }),
          h("button", { class: "link-danger", type: "button", text: "Remove", style: "margin-top:0.4rem", onclick: function () {
            db.from("booking_slots").delete().eq("id", s.id).then(function (res) {
              if (res.error) { alert("Couldn't remove: " + res.error.message); return; }
              state.settings.bookingSlots = (state.settings.bookingSlots || []).filter(function (x) { return x.id !== s.id; });
              paintList();
            });
          } }),
        ]));
      });
    }
    paintList();

    var labelInput = h("input", { type: "text", placeholder: "e.g. Weekday afternoons" });
    var daySel = h("select", {}, DAY_NAMES.map(function (d, i) { return h("option", { value: String(i), text: d }); }));
    var startInput = h("input", { type: "time", value: "14:00" });
    var endInput = h("input", { type: "time", value: "16:00" });
    var urlInput = h("input", { type: "url", placeholder: "https://zcal.co/…" });

    var addBtn = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Add link", onclick: function () {
      var url = (urlInput.value || "").trim();
      if (!url) { urlInput.focus(); return; }
      db.from("booking_slots").insert({
        label: (labelInput.value || "").trim() || "Interview slot",
        day: parseInt(daySel.value, 10) || 0,
        start_time: startInput.value || "00:00",
        end_time: endInput.value || "",
        url: url,
      }).select().single().then(function (res) {
        if (res.error) { alert("Couldn't add: " + res.error.message); return; }
        state.settings.bookingSlots.push(slotFromRow(res.data));
        paintList();
        labelInput.value = ""; urlInput.value = "";
      });
    } });

    var panel = h("div", { class: "crm-panel", role: "dialog", "aria-modal": "true" }, [
      h("div", { class: "crm-panel-head" }, [
        h("h3", { text: "Booking links" }),
        h("button", { class: "crm-close", type: "button", "aria-label": "Close", text: "×", onclick: closeBS }),
      ]),
      h("div", { class: "crm-panel-body" }, [
        h("p", { class: "crm-help", text: "Add a link for each recurring interview slot — useful if different days use different zcal links. Shared with the whole committee. Picking a slot on an applicant auto-fills the link and suggests an interview time." }),
        listWrap,
        h("div", { class: "crm-row" }, [
          h("div", { class: "crm-field" }, [ h("label", { text: "Label" }), labelInput ]),
          h("div", { class: "crm-field" }, [ h("label", { text: "Day" }), daySel ]),
        ]),
        h("div", { class: "crm-row" }, [
          h("div", { class: "crm-field" }, [ h("label", { text: "Start" }), startInput ]),
          h("div", { class: "crm-field" }, [ h("label", { text: "End" }), endInput ]),
        ]),
        h("div", { class: "crm-field" }, [ h("label", { text: "Booking link (zcal)" }), urlInput ]),
        addBtn,
      ]),
      h("div", { class: "crm-panel-foot" }, [ h("span", { class: "spacer" }), h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Done", onclick: closeBS }) ]),
    ]);
    var bsOverlay = h("div", { class: "crm-modal", onclick: function (e) { if (e.target === bsOverlay) closeBS(); } }, [panel]);
    document.body.appendChild(bsOverlay);
    document.addEventListener("keydown", onBSEsc);
  }

  // ---- Import / export -----------------------------------------------------
  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  // Snapshot of everything in the board (file metadata only, not the files themselves).
  function exportJSON() {
    download("sul-recruitment-" + stamp() + ".json", JSON.stringify(state, null, 2), "application/json");
  }

  var CSV_COLS = ["name", "email", "phone", "degree", "yearLevel", "role", "roleSecondary", "assignee", "status",
    "rating", "linkedin", "statement", "resume", "booking", "interviewAt", "createdAt"];

  function exportCSV() {
    var rows = [CSV_COLS.concat(["attachments", "notes"]).join(",")];
    state.applicants.forEach(function (a) {
      var line = CSV_COLS.map(function (c) {
        if (c === "assignee") return csvCell(assigneeLabel(a.assignee));
        return csvCell(a[c]);
      });
      line.push(csvCell(a.files.map(function (x) { return x.name; }).join(" | ")));
      var notes = (a.notes || []).map(function (n) { return fmtDateTime(n.ts) + ": " + n.text; }).join(" | ");
      line.push(csvCell(notes));
      rows.push(line.join(","));
    });
    download("sul-recruitment-" + stamp() + ".csv", rows.join("\n"), "text/csv");
  }
  function csvCell(v) {
    v = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(v)) v = "'" + v; // stop spreadsheet formula injection from applicant-typed text
    if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  // Adds rows to the shared board (never replaces). Handy for migrating an old spreadsheet.
  function importCSVPrompt() { pickFile(".csv,text/csv", function (text) {
    var rows = parseCSV(text);
    if (rows.length < 2) { alert("No data rows found in that CSV."); return; }
    var header = rows[0].map(function (c) { return c.trim().toLowerCase(); });
    var records = rows.slice(1).filter(function (r) { return r.join("").trim() !== ""; }).map(function (r) {
      var get = function (name) { var i = header.indexOf(name); return i === -1 ? "" : (r[i] || "").trim(); };
      return {
        name: get("name") || get("full name") || get("applicant"),
        email: get("email"),
        phone: get("phone") || get("mobile"),
        role: get("role") || get("position") || get("role applied for"),
        assignee: assigneeIdFromLabel(get("assignee") || get("assigned to")),
        resume: get("resume") || get("resume link") || get("cv"),
        booking: get("booking") || get("booking link"),
        status: normaliseStatus(get("status") || get("stage")),
        rating: normaliseRating(get("rating")),
        note: get("notes"),
      };
    }).filter(function (a) { return a.name; });
    if (!records.length) { alert("Couldn't find any rows with a name. Make sure there's a 'name' column."); return; }
    if (!confirm("Import " + records.length + " applicant(s) from CSV? They'll be added to the shared board.")) return;

    db.from("applications").insert(records.map(function (r) {
      return { name: r.name, email: r.email, phone: r.phone, role: r.role, assignee: r.assignee,
        resume_url: r.resume, booking: r.booking, status: r.status, rating: r.rating, consent: false };
    })).select("id").then(function (res) {
      if (res.error) { alert("Import failed: " + res.error.message); return; }
      var notes = [];
      res.data.forEach(function (row, i) {
        if (records[i] && records[i].note) notes.push({ application_id: row.id, type: "manual", text: records[i].note });
      });
      return (notes.length ? db.from("application_notes").insert(notes) : Promise.resolve({})).then(function () {
        toast("Imported " + records.length + " applicant(s)");
        return loadAll().then(render);
      });
    });
  }); }

  function normaliseStatus(v) {
    v = (v || "").trim().toLowerCase();
    if (!v) return "applied";
    if (STAGE_BY_ID[v]) return v;
    var hit = STAGES.filter(function (s) { return s.label.toLowerCase() === v; })[0];
    if (hit) return hit.id;
    if (v.indexOf("reject") !== -1) return "rejected";
    if (v.indexOf("offer") !== -1) return "offer";
    if (v.indexOf("interview") !== -1) return v.indexOf("book") !== -1 ? "booked" : (v.indexOf("invit") !== -1 ? "invited" : "interviewed");
    if (v.indexOf("review") !== -1) return "review";
    return "applied";
  }
  function normaliseRating(v) {
    v = (v || "").trim().toLowerCase();
    if (v === "y" || v === "yes") return "yes";
    if (v === "n" || v === "no") return "no";
    if (v === "maybe" || v === "m") return "maybe";
    return "";
  }

  // RFC-4180-ish CSV parser (handles quotes, escaped quotes, commas, newlines).
  function parseCSV(text) {
    var rows = [], row = [], val = "", i = 0, inQ = false;
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    while (i < text.length) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { val += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        val += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(val); val = ""; i++; continue; }
      if (c === "\n") { row.push(val); rows.push(row); row = []; val = ""; i++; continue; }
      val += c; i++;
    }
    row.push(val); rows.push(row);
    return rows;
  }

  function pickFile(accept, cb) {
    var input = h("input", { type: "file", accept: accept, style: "display:none" });
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { cb(String(reader.result)); input.remove(); };
      reader.readAsText(file);
    });
    document.body.appendChild(input); input.click();
  }

  // ---- Go ------------------------------------------------------------------
  // portal.html calls start(db) after a committee member signs in, and stop() on sign-out.
  window.SUL_CRM = { start: start, stop: stop };
})();
