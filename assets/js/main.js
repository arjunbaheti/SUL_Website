// Shared helpers used by every page. No build step, no dependencies.
// content/*.js files attach data to window.SUL_CONTENT before this runs.
(function () {
  "use strict";

  function initNav() {
    var nav = document.querySelector("[data-nav]");
    var toggle = document.querySelector("[data-nav-toggle]");
    if (!nav || !toggle) return;
    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  var MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  var MONTHS_LONG = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  function parseDateParts(isoDate) {
    var parts = isoDate.split("-").map(Number);
    return { year: parts[0], month: parts[1], day: parts[2] };
  }

  function formatEventDate(isoDate, time) {
    var p = parseDateParts(isoDate);
    var label = MONTHS_LONG[p.month - 1] + " " + p.day + ", " + p.year;
    if (time) label += " · " + formatTime(time);
    return label;
  }

  function formatTime(time24) {
    var bits = time24.split(":");
    var h = parseInt(bits[0], 10);
    var m = bits[1];
    var suffix = h >= 12 ? "pm" : "am";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + m + suffix;
  }

  function upcomingEvents(events) {
    var today = todayISO();
    return events
      .filter(function (e) {
        return e.date >= today;
      })
      .sort(function (a, b) {
        return a.date.localeCompare(b.date);
      });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === "class") node.className = attrs[key];
      else if (key === "html") node.innerHTML = attrs[key];
      else if (key === "text") node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function initials(name) {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (w) {
        return w[0].toUpperCase();
      })
      .join("");
  }

  // ---- .ics generation for "add to calendar", entirely client-side ----
  function icsDate(isoDate, time24) {
    var p = parseDateParts(isoDate);
    var bits = (time24 || "00:00").split(":");
    return (
      p.year +
      pad(p.month) +
      pad(p.day) +
      "T" +
      pad(parseInt(bits[0], 10)) +
      pad(parseInt(bits[1], 10)) +
      "00"
    );
  }

  function downloadIcs(event) {
    var startDate = icsDate(event.date, event.time);
    var endBits = (event.time || "00:00").split(":");
    var endHours = parseInt(endBits[0], 10);
    var endMins = parseInt(endBits[1], 10) + (event.durationMinutes || 60);
    var endDate = new Date(
      parseDateParts(event.date).year,
      parseDateParts(event.date).month - 1,
      parseDateParts(event.date).day,
      endHours,
      endMins
    );
    var endStamp =
      endDate.getFullYear() +
      pad(endDate.getMonth() + 1) +
      pad(endDate.getDate()) +
      "T" +
      pad(endDate.getHours()) +
      pad(endDate.getMinutes()) +
      "00";

    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//StartUp Link UniMelb//Events//EN",
      "BEGIN:VEVENT",
      "UID:" + event.id + "@startuplinkunimelb.net",
      "DTSTART:" + startDate,
      "DTEND:" + endStamp,
      "SUMMARY:" + escapeIcs(event.title),
      "LOCATION:" + escapeIcs(event.location || ""),
      "DESCRIPTION:" + escapeIcs(event.description || ""),
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    var blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function escapeIcs(text) {
    return String(text).replace(/[\\;,]/g, "\\$&").replace(/\n/g, "\\n");
  }

  // ---- Scroll-reveal: fade/slide elements in as they enter the viewport ----
  function initReveal() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    if (!nodes.length) return;

    var reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      nodes.forEach(function (n) { n.classList.add("is-visible"); });
      return;
    }

    // Stagger siblings that share a parent for a gentle cascade.
    nodes.forEach(function (n, i) {
      if (n.style.getPropertyValue("--reveal-delay")) return;
      var idx = Array.prototype.indexOf.call(n.parentNode.children, n);
      n.style.setProperty("--reveal-delay", Math.min(idx, 5) * 80 + "ms");
    });

    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    nodes.forEach(function (n) { obs.observe(n); });
  }

  // ---- Partner node: real logo image when supplied, initials otherwise ----
  function partnerNode(p, opts) {
    opts = opts || {};
    var inner;
    if (p.logo) {
      inner = el("img", {
        src: p.logo,
        alt: p.name + " logo",
        loading: "lazy",
      });
    } else {
      inner = el("div", { class: "partner-logo-fallback", text: initials(p.name) });
    }
    var cls = opts.marquee
      ? "marquee-item"
      : "partner-card" + (opts.headline ? " headline" : "");
    var children = [inner];
    if (!opts.marquee || !p.logo) {
      // marquee shows logo alone; cards (and logo-less marquee items) show the name
      children.push(el("span", { text: p.name }));
    }
    return el(
      "a",
      {
        class: cls,
        href: p.url,
        target: "_blank",
        rel: "noopener",
        "aria-label": p.name + ", opens in a new tab",
      },
      children
    );
  }

  // ---- Marquee: seamless auto-scroll strip (duplicates items for the loop) ----
  function buildMarquee(container, partners) {
    if (!container) return;
    if (!partners.length) {
      container.appendChild(el("div", { class: "empty-state", text: "Partners coming soon." }));
      return;
    }
    var track = el("div", { class: "marquee-track" });
    // Two passes of the list so translateX(-50%) wraps with no visible seam.
    for (var pass = 0; pass < 2; pass++) {
      partners.forEach(function (p) {
        var node = partnerNode(p, { marquee: true });
        if (pass === 1) node.setAttribute("aria-hidden", "true");
        track.appendChild(node);
      });
    }
    // Slow the scroll for longer lists so speed stays readable.
    var duration = Math.max(24, partners.length * 6);
    track.style.setProperty("--marquee-duration", duration + "s");
    container.appendChild(track);
  }

  var prefersReduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Custom cursor: white dot + lerp-trailing ring ----
  function initCursor() {
    var fine = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!fine) return;

    var dot = el("div", { class: "cursor-dot" });
    var ring = el("div", { class: "cursor-ring" });
    document.body.appendChild(dot);
    document.body.appendChild(ring);
    document.body.classList.add("has-custom-cursor");

    var mx = window.innerWidth / 2, my = window.innerHeight / 2;
    var rx = mx, ry = my;

    document.addEventListener("mousemove", function (e) {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = "translate(" + mx + "px," + my + "px) translate(-50%,-50%)";
    });

    (function raf() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.transform = "translate(" + rx + "px," + ry + "px) translate(-50%,-50%)";
      requestAnimationFrame(raf);
    })();

    var hoverSel = "a, button, input, select, textarea, [role='button'], .card, .marquee-item, .partner-card";
    document.addEventListener("mouseover", function (e) {
      if (e.target.closest(hoverSel)) document.body.classList.add("cursor-hover");
    });
    document.addEventListener("mouseout", function (e) {
      if (e.target.closest(hoverSel)) document.body.classList.remove("cursor-hover");
    });
    document.addEventListener("mousedown", function () { document.body.classList.add("cursor-down"); });
    document.addEventListener("mouseup", function () { document.body.classList.remove("cursor-down"); });
    document.addEventListener("mouseleave", function () {
      dot.style.opacity = "0"; ring.style.opacity = "0";
    });
    document.addEventListener("mouseenter", function () {
      dot.style.opacity = "1"; ring.style.opacity = "1";
    });
  }

  // ---- Scroll progress bar (injected, global) ----
  function initScrollProgress() {
    var bar = el("div", { class: "scroll-progress" });
    document.body.appendChild(bar);
    function update() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var pct = max > 0 ? (h.scrollTop || window.pageYOffset) / max * 100 : 0;
      bar.style.width = pct + "%";
    }
    document.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  // ---- Count-up numbers for [data-count] elements ----
  function initCountUp() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-count]"));
    if (!nodes.length) return;
    if (prefersReduced || !("IntersectionObserver" in window)) {
      nodes.forEach(function (n) { n.textContent = n.getAttribute("data-count") + (n.getAttribute("data-suffix") || ""); });
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        obs.unobserve(en.target);
        var node = en.target;
        var target = parseFloat(node.getAttribute("data-count"));
        var suffix = node.getAttribute("data-suffix") || "";
        var dur = 1400, start = null;
        function step(ts) {
          if (start === null) start = ts;
          var p = Math.min((ts - start) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          var val = Math.round(target * eased);
          node.textContent = val + suffix;
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.4 });
    nodes.forEach(function (n) { obs.observe(n); });
  }

  // ---- 3D tilt + cursor sheen for .tilt cards ----
  function initTilt() {
    if (prefersReduced) return;
    var cards = Array.prototype.slice.call(document.querySelectorAll(".tilt"));
    cards.forEach(function (card) {
      card.addEventListener("mousemove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        var rotY = (px - 0.5) * 10;
        var rotX = (0.5 - py) * 10;
        card.style.transform =
          "perspective(700px) rotateX(" + rotX + "deg) rotateY(" + rotY + "deg) translateY(-4px)";
        card.style.setProperty("--mx", px * 100 + "%");
        card.style.setProperty("--my", py * 100 + "%");
      });
      card.addEventListener("mouseleave", function () {
        card.style.transform = "";
      });
    });
  }

  // ---- Magnetic pull on [data-magnetic] elements ----
  function initMagnetic() {
    if (prefersReduced) return;
    var els = Array.prototype.slice.call(document.querySelectorAll("[data-magnetic]"));
    els.forEach(function (m) {
      m.addEventListener("mousemove", function (e) {
        var r = m.getBoundingClientRect();
        var x = e.clientX - (r.left + r.width / 2);
        var y = e.clientY - (r.top + r.height / 2);
        m.style.transform = "translate(" + x * 0.28 + "px," + y * 0.28 + "px)";
      });
      m.addEventListener("mouseleave", function () {
        m.style.transform = "";
      });
    });
  }

  // ---- Kinetic ribbons: JS-driven scroll strips that react to scroll velocity.
  // Base drift runs constantly; scrolling the page adds speed and a skew lean,
  // then it eases back. This is the signature "designed by a studio" motion. ----
  function initKineticRibbons() {
    var tracks = Array.prototype.slice.call(document.querySelectorAll(".ribbon-track"));
    if (!tracks.length) return;

    var lastScroll = window.pageYOffset;
    var velocity = 0;
    window.addEventListener("scroll", function () {
      var y = window.pageYOffset;
      velocity += y - lastScroll;
      lastScroll = y;
    }, { passive: true });

    var states = tracks.map(function (track) {
      return {
        track: track,
        offset: 0,
        base: parseFloat(track.getAttribute("data-speed")) || 0.55,
        dir: track.getAttribute("data-direction") === "right" ? 1 : -1,
        half: track.scrollWidth / 2,
      };
    });

    function remeasure() {
      states.forEach(function (s) { s.half = s.track.scrollWidth / 2; });
    }
    window.addEventListener("load", remeasure);
    window.addEventListener("resize", remeasure);

    (function frame() {
      velocity *= 0.9;
      if (Math.abs(velocity) < 0.01) velocity = 0;
      var skew = Math.max(-4, Math.min(4, velocity * 0.22));
      states.forEach(function (s) {
        if (!s.half) s.half = s.track.scrollWidth / 2;
        var step = prefersReduced ? 0 : (s.base * s.dir) + (velocity * 0.22 * s.dir);
        s.offset += step;
        if (s.offset <= -s.half) s.offset += s.half;
        if (s.offset > 0) s.offset -= s.half;
        s.track.style.transform =
          "translate3d(" + s.offset + "px,0,0) skewX(" + skew + "deg)";
      });
      requestAnimationFrame(frame);
    })();
  }

  // ---- Cursor spotlight: soft light that tracks the pointer over an element ----
  function initSpotlight() {
    if (prefersReduced) return;
    var els = Array.prototype.slice.call(document.querySelectorAll("[data-spotlight]"));
    els.forEach(function (elm) {
      elm.addEventListener("mousemove", function (e) {
        var r = elm.getBoundingClientRect();
        elm.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
        elm.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
      });
    });
  }

  // ---- Live Melbourne time, a small human detail (not marketing chrome) ----
  function initClock() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-clock]"));
    if (!nodes.length) return;
    function tick() {
      var t;
      try {
        t = new Date().toLocaleTimeString("en-AU", {
          timeZone: "Australia/Melbourne",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
      } catch (e) {
        t = new Date().toLocaleTimeString();
      }
      nodes.forEach(function (n) { n.textContent = t; });
    }
    tick();
    setInterval(tick, 20000);
  }

  // ---- Nav gains a denser background once you scroll past the hero ----
  function initNavScroll() {
    var nav = document.querySelector("[data-nav]");
    if (!nav) return;
    function update() {
      nav.classList.toggle("is-scrolled", (window.pageYOffset || 0) > 24);
    }
    document.addEventListener("scroll", update, { passive: true });
    update();
  }

  // ---- Parallax drift on [data-parallax] (hero aurora) ----
  function initParallax() {
    if (prefersReduced) return;
    var els = Array.prototype.slice.call(document.querySelectorAll("[data-parallax]"));
    if (!els.length) return;
    window.addEventListener("scroll", function () {
      var y = window.pageYOffset;
      els.forEach(function (elm) {
        var speed = parseFloat(elm.getAttribute("data-parallax")) || 0.15;
        elm.style.transform = "translateY(" + y * speed + "px)";
      });
    }, { passive: true });
  }

  window.SUL = {
    initNav: initNav,
    todayISO: todayISO,
    formatEventDate: formatEventDate,
    formatTime: formatTime,
    upcomingEvents: upcomingEvents,
    el: el,
    initials: initials,
    downloadIcs: downloadIcs,
    partnerNode: partnerNode,
    buildMarquee: buildMarquee,
    MONTHS: MONTHS,
    parseDateParts: parseDateParts,
  };

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initNavScroll();
    initReveal();
    initCursor();
    initScrollProgress();
    initCountUp();
    initMagnetic();
    initParallax();
    initKineticRibbons();
    initSpotlight();
    initClock();
  });
})();
