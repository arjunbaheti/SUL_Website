"use client";

import { useEffect } from "react";

let started = false;

// Loads the original site's effects script (public/js/main.js) once the page has finished
// loading and the browser is idle, so every part of the page (layout and page segments hydrate
// separately) is done before the script touches the DOM. Guarded so it only ever runs once per
// page load (React runs effects twice in development).
export function Effects() {
  useEffect(() => {
    if (started) return;
    started = true;
    const inject = () => {
      const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
      idle(() => {
        const s = document.createElement("script");
        s.src = "/js/main.js";
        document.body.appendChild(s);
      });
    };
    if (document.readyState === "complete") inject();
    else window.addEventListener("load", inject, { once: true });
  }, []);
  return null;
}
