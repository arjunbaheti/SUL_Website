/* StartUp Link UniMelb — Recruitment CRM
 *
 * A committee-only pipeline tracker: applicants move Applied -> Under review ->
 * Interview invited -> Interview booked -> Interviewed -> Offer / Rejected.
 *
 * DATA: stored in the browser via localStorage (key SUL_CRM.KEY) — a
 * single-browser tool for now, data does NOT sync between people or devices.
 * Use Export/Import to back up or hand a snapshot to someone else. The next
 * step for a shared, multi-user CRM (with real resume uploads and applicants
 * flowing in automatically from the application form) is a backend such as
 * Supabase; the record shape below is designed to migrate cleanly.
 */
(function () {
  "use strict";

  var root = document.getElementById("crm-root");
  if (!root) return;

  var KEY = "sul-recruitment-v1";

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
  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.applicants)) {
          parsed.settings = parsed.settings || {};
          parsed.settings.bookingSlots = Array.isArray(parsed.settings.bookingSlots) ? parsed.settings.bookingSlots : [];
          return parsed;
        }
      }
    } catch (e) { /* fall through to fresh state */ }
    return { applicants: [], settings: { bookingSlots: [] } };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { alert("Could not save — browser storage may be full or blocked."); }
  }

  // ---- Small helpers -------------------------------------------------------
  function uid() {
    return "a-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }
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
        var hay = (a.name + " " + (a.email || "") + " " + (a.role || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // ---- Render: shell -------------------------------------------------------
  function render() {
    root.innerHTML = "";
    root.appendChild(buildHead());
    root.appendChild(buildStats());
    root.appendChild(buildToolbar());
    if (state.applicants.length === 0) {
      root.appendChild(buildEmpty());
    } else {
      root.appendChild(buildBoard());
    }
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
      type: "search", placeholder: "Search name, email, role…", value: filters.q,
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
        item("Export as JSON (backup)", exportJSON),
        item("Import JSON", importJSONPrompt),
        item("Export as CSV", exportCSV),
        item("Import from CSV", importCSVPrompt),
        h("div", { class: "sep" }),
        item("Manage booking links", openBookingSlotsModal),
        item("Load sample data", loadSample),
        h("div", { class: "sep" }),
        item("Clear all data", clearAll, "danger"),
      ]),
    ]);
    return menu;
    function closeMenu() { menu.removeAttribute("open"); }
  }

  function buildEmpty() {
    return h("div", { class: "crm-empty" }, [
      h("h3", { text: "No applicants yet" }),
      h("p", { text: "Applications will land here automatically once the form is connected to this portal. In the meantime, import an existing spreadsheet as CSV, or load sample data to see how the board works." }),
      h("div", { class: "cta-row" }, [
        h("button", { class: "btn btn-primary", type: "button", text: "Import from CSV", onclick: importCSVPrompt }),
        h("button", { class: "btn btn-secondary", type: "button", text: "Load sample data", onclick: loadSample }),
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
    if (a.resume) meta.push(h("span", { class: "crm-icon", title: "Resume attached", text: "📄" }));
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
    a.status = status;
    a.updatedAt = nowISO();
    a.notes = a.notes || [];
    a.notes.unshift({ ts: nowISO(), text: "Moved to " + STAGE_BY_ID[status].label, type: "auto" });
    save();
    refreshBoard();
  }

  function resolveLink(a) {
    if (a.booking && a.booking.trim()) return a.booking.trim();
    var slots = state.settings.bookingSlots || [];
    if (slots.length === 1) return slots[0].url;
    return "";
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
        a.notes = a.notes || [];
        a.notes.unshift({ ts: nowISO(), text: SEND_META[kind].logged, type: "auto" });
        if (kind === "invite" && a.status === "review") a.status = "invited";
        a.updatedAt = nowISO();
        save();
        toast(SEND_META[kind].logged);
        closeSend();
        closeModal();
        render();
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

  function sendEmail(to, subject, text) {
    return fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: to, subject: subject, text: text }),
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

  function openModal(id) {
    var a = byId(id);
    if (!a) return;

    // Working copy so Cancel discards changes.
    var draft = JSON.parse(JSON.stringify(a));
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
          h("div", { class: "t", text: fmtDateTime(n.ts) }),
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
        draft.notes = draft.notes || [];
        draft.notes.unshift({ ts: nowISO(), text: t, type: "manual" });
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
          h("div", { class: "t", text: fmtDateTime(n.ts) }),
          h("div", { class: "b", text: n.text }),
        ]));
      });
    }

    var body = h("div", { class: "crm-panel-body" }, [
      h("div", { class: "crm-row" }, [ field("name", "Full name", { required: true }), field("email", "Email", { type: "email" }) ]),
      h("div", { class: "crm-row" }, [ field("phone", "Phone"), field("role", "Role applied for", { placeholder: "e.g. Marketing officer" }) ]),
      h("div", { class: "crm-row" }, [
        h("div", { class: "crm-field" }, [ h("label", { text: "Assigned to" }), assigneeSel ]),
        field("resume", "Resume link", { type: "url", placeholder: "Drive / link" }),
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

    var foot = h("div", { class: "crm-panel-foot" }, [
      h("button", { class: "link-danger", type: "button", text: "Delete", onclick: function () {
        if (confirm("Delete " + (draft.name || "this applicant") + "? This cannot be undone.")) {
          state.applicants = state.applicants.filter(function (x) { return x.id !== id; });
          save(); closeModal(); render();
        }
      } }),
      h("span", { class: "spacer" }),
      h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Cancel", onclick: closeModal }),
      h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Save", onclick: function () {
        if (!draft.name.trim()) { f.name.focus(); f.name.style.borderColor = "#e0607a"; return; }
        draft.updatedAt = nowISO();
        var idx = state.applicants.findIndex(function (x) { return x.id === id; });
        state.applicants[idx] = draft;
        save(); closeModal(); render();
      } }),
    ]);

    var panel = h("div", { class: "crm-panel", role: "dialog", "aria-modal": "true" }, [
      h("div", { class: "crm-panel-head" }, [
        h("h3", { text: "Applicant" }),
        h("button", { class: "crm-close", type: "button", "aria-label": "Close", text: "×", onclick: closeModal }),
      ]),
      body, foot,
    ]);

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
      (a.role ? " as " + a.role : "") + ". We were really impressed with you throughout the process " +
      "and think you'll be a great addition to the team.\n\n" +
      "We'll be in touch shortly with next steps. Welcome aboard!\n\nStartUp Link UniMelb";
  }
  function rejectionMessage(a) {
    return "Hi " + firstName(a.name) + ",\n\n" +
      "Thank you for taking the time to apply" + (a.role ? " for " + a.role : "") +
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

  // ---- Settings: booking links ----------------------------------------------
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
            state.settings.bookingSlots = (state.settings.bookingSlots || []).filter(function (x) { return x.id !== s.id; });
            save(); paintList();
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
      if (!urlInput.getAttribute("value") && !urlInput.value) { urlInput.focus(); return; }
      var url = urlInput.value || urlInput.getAttribute("value") || "";
      if (!url.trim()) { urlInput.focus(); return; }
      state.settings.bookingSlots = state.settings.bookingSlots || [];
      state.settings.bookingSlots.push({
        id: uid(), label: (labelInput.value || "").trim() || "Interview slot",
        day: parseInt(daySel.value, 10) || 0, start: startInput.value || "00:00", end: endInput.value || "",
        url: url.trim(),
      });
      save(); paintList();
      labelInput.value = ""; urlInput.value = "";
    } });

    var panel = h("div", { class: "crm-panel", role: "dialog", "aria-modal": "true" }, [
      h("div", { class: "crm-panel-head" }, [
        h("h3", { text: "Booking links" }),
        h("button", { class: "crm-close", type: "button", "aria-label": "Close", text: "×", onclick: closeBS }),
      ]),
      h("div", { class: "crm-panel-body" }, [
        h("p", { class: "crm-help", text: "Add a link for each recurring interview slot — useful if different days use different zcal links. Picking a slot on an applicant auto-fills the link and suggests an interview time." }),
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

  function exportJSON() {
    download("sul-recruitment-" + stamp() + ".json", JSON.stringify(state, null, 2), "application/json");
  }

  function importJSONPrompt() { pickFile(".json,application/json", function (text) {
    try {
      var parsed = JSON.parse(text);
      var incoming = Array.isArray(parsed) ? { applicants: parsed, settings: {} } : parsed;
      if (!incoming || !Array.isArray(incoming.applicants)) { alert("That file doesn't look like a CRM export."); return; }
      if (!confirm("Import " + incoming.applicants.length + " applicant(s)? This replaces your current data. Export a backup first if unsure.")) return;
      var settings = incoming.settings || state.settings || {};
      settings.bookingSlots = Array.isArray(settings.bookingSlots) ? settings.bookingSlots : [];
      state = {
        applicants: incoming.applicants.map(normalise),
        settings: settings,
      };
      save(); render(); toast("Imported " + state.applicants.length + " applicant(s)");
    } catch (e) { alert("Could not read that JSON file."); }
  }); }

  var CSV_COLS = ["name", "email", "phone", "role", "assignee", "status", "rating", "resume", "booking", "interviewAt", "createdAt"];

  function exportCSV() {
    var rows = [CSV_COLS.concat(["notes"]).join(",")];
    state.applicants.forEach(function (a) {
      var line = CSV_COLS.map(function (c) {
        if (c === "assignee") return csvCell(assigneeLabel(a.assignee));
        return csvCell(a[c]);
      });
      var notes = (a.notes || []).map(function (n) { return fmtDateTime(n.ts) + ": " + n.text; }).join(" | ");
      line.push(csvCell(notes));
      rows.push(line.join(","));
    });
    download("sul-recruitment-" + stamp() + ".csv", rows.join("\n"), "text/csv");
  }
  function csvCell(v) {
    v = v == null ? "" : String(v);
    if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function importCSVPrompt() { pickFile(".csv,text/csv", function (text) {
    var rows = parseCSV(text);
    if (rows.length < 2) { alert("No data rows found in that CSV."); return; }
    var header = rows[0].map(function (c) { return c.trim().toLowerCase(); });
    var records = rows.slice(1).filter(function (r) { return r.join("").trim() !== ""; }).map(function (r) {
      var get = function (name) { var i = header.indexOf(name); return i === -1 ? "" : (r[i] || "").trim(); };
      var status = normaliseStatus(get("status") || get("stage"));
      var rating = normaliseRating(get("rating"));
      return normalise({
        name: get("name") || get("full name") || get("applicant"),
        email: get("email"),
        phone: get("phone") || get("mobile"),
        role: get("role") || get("position") || get("role applied for"),
        assignee: assigneeIdFromLabel(get("assignee") || get("assigned to")),
        resume: get("resume") || get("resume link") || get("cv"),
        booking: get("booking") || get("booking link"),
        status: status,
        rating: rating,
        notes: get("notes") ? [{ ts: nowISO(), text: get("notes"), type: "manual" }] : [],
      });
    }).filter(function (a) { return a.name; });
    if (!records.length) { alert("Couldn't find any rows with a name. Make sure there's a 'name' column."); return; }
    if (!confirm("Import " + records.length + " applicant(s) from CSV? They'll be added to your current data.")) return;
    state.applicants = state.applicants.concat(records);
    save(); render(); toast("Imported " + records.length + " applicant(s)");
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
  function normalise(a) {
    return {
      id: a.id || uid(),
      name: a.name || "",
      email: a.email || "",
      phone: a.phone || "",
      role: a.role || "",
      assignee: ASSIGNEE_BY_ID[a.assignee] ? a.assignee : "",
      resume: a.resume || "",
      booking: a.booking || "",
      bookingSlotId: a.bookingSlotId || "",
      interviewAt: a.interviewAt || "",
      status: STAGE_BY_ID[a.status] ? a.status : normaliseStatus(a.status),
      rating: ["yes", "maybe", "no"].indexOf(a.rating) !== -1 ? a.rating : "",
      notes: Array.isArray(a.notes) ? a.notes.map(function (n) {
        return { ts: n.ts || nowISO(), text: n.text || "", type: n.type === "auto" ? "auto" : "manual" };
      }) : [],
      createdAt: a.createdAt || nowISO(),
      updatedAt: a.updatedAt || nowISO(),
    };
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

  function clearAll() {
    if (!confirm("Delete ALL applicant data from this browser? Export a backup first if you might need it.")) return;
    state = { applicants: [], settings: state.settings || { bookingSlots: [] } };
    save(); render(); toast("All data cleared");
  }

  function loadSample() {
    if (state.applicants.length && !confirm("Add sample applicants to your current data?")) return;
    var samples = [
      { name: "Maya Chen", email: "maya.chen@student.unimelb.edu.au", role: "Marketing officer", assignee: "md1", status: "applied", resume: "https://example.com/resume", createdAt: daysAgo(1) },
      { name: "Tom Nguyen", email: "tom.n@student.unimelb.edu.au", role: "Events officer", assignee: "ed", status: "review", createdAt: daysAgo(3) },
      { name: "Priya Sharma", email: "priya.s@student.unimelb.edu.au", role: "Partnerships officer", assignee: "erd", status: "invited", booking: "https://zcal.co/i/sample", createdAt: daysAgo(5) },
      { name: "Jack Wilson", email: "jack.w@student.unimelb.edu.au", role: "Projects officer", assignee: "pd1", status: "booked", interviewAt: inDays(2), createdAt: daysAgo(6) },
      { name: "Aisha Rahman", email: "aisha.r@student.unimelb.edu.au", role: "Marketing officer", assignee: "md2", status: "interviewed", rating: "yes", createdAt: daysAgo(8), notes: [{ ts: daysAgo(1), text: "Strong portfolio, great culture fit. Lean yes.", type: "manual" }] },
      { name: "Liam O'Brien", email: "liam.o@student.unimelb.edu.au", role: "Events officer", assignee: "ed", status: "offer", rating: "yes", createdAt: daysAgo(10) },
      { name: "Sofia Rossi", email: "sofia.r@student.unimelb.edu.au", role: "People & culture officer", assignee: "pcd", status: "rejected", rating: "no", createdAt: daysAgo(9), notes: [{ ts: daysAgo(2), text: "Not enough availability this semester.", type: "manual" }] },
    ].map(normalise);
    state.applicants = state.applicants.concat(samples);
    save(); render(); toast("Sample data loaded");
  }
  function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString(); }
  function inDays(n) { return new Date(Date.now() + n * 86400000).toISOString(); }

  // ---- Go ------------------------------------------------------------------
  window.SUL_CRM = { render: render };
  render();
})();
