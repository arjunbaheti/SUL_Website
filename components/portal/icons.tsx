// Small stroke icon set for the committee portal. 16px grid, 1.5px stroke, drawn to sit on the
// text baseline at 13–14px type. Kept in one place so every surface uses the same weight.

const PATHS = {
  search: <><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" /></>,
  chevronDown: <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />,
  chevronUpDown: <><path d="m5.25 6 2.75-2.75L10.75 6" /><path d="m5.25 10 2.75 2.75L10.75 10" /></>,
  check: <path d="m3.75 8.25 2.75 2.75 5.75-6" />,
  x: <><path d="m4.5 4.5 7 7" /><path d="m11.5 4.5-7 7" /></>,
  more: <><circle cx="3.75" cy="8" r=".6" fill="currentColor" /><circle cx="8" cy="8" r=".6" fill="currentColor" /><circle cx="12.25" cy="8" r=".6" fill="currentColor" /></>,
  sliders: <><path d="M2.75 5h6.5M12.25 5h1" /><circle cx="10.75" cy="5" r="1.5" /><path d="M2.75 11h1M6.75 11h6.5" /><circle cx="5.25" cy="11" r="1.5" /></>,
  sun: <><circle cx="8" cy="8" r="2.75" /><path d="M8 1.75v1.25M8 13v1.25M1.75 8H3M13 8h1.25M3.6 3.6l.9.9M11.5 11.5l.9.9M3.6 12.4l.9-.9M11.5 4.5l.9-.9" /></>,
  moon: <path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85Z" />,
  monitor: <><rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5" /><path d="M5.75 14h4.5M8 11.25V14" /></>,
  logOut: <><path d="M6.25 2.75h-2a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h2" /><path d="M10.25 5.25 13 8l-2.75 2.75M13 8H6.25" /></>,
  refresh: <><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" /><path d="M13.25 2.75v2.5h-2.5" /></>,
  download: <><path d="M8 2.75v7.5M4.75 7 8 10.25 11.25 7" /><path d="M2.75 12.75h10.5" /></>,
  file: <><path d="M9.25 1.75H4.75a1.5 1.5 0 0 0-1.5 1.5v9.5a1.5 1.5 0 0 0 1.5 1.5h6.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z" /><path d="M9.25 1.75v3.5h3.5" /></>,
  paperclip: <path d="m12.6 7.6-4.95 4.95a3 3 0 0 1-4.24-4.24l5.3-5.3a2 2 0 0 1 2.83 2.83l-5.3 5.3a1 1 0 0 1-1.42-1.41l4.6-4.6" />,
  star: <path d="m8 2.25 1.75 3.6 3.95.55-2.87 2.77.69 3.93L8 11.25 4.48 13.1l.69-3.93L2.3 6.4l3.95-.55Z" />,
  mail: <><rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" /><path d="m2.25 4.25 5.75 4.5 5.75-4.5" /></>,
  alert: <><path d="M8 2.25 14.25 13H1.75Z" /><path d="M8 6.5v2.75" /><circle cx="8" cy="11.1" r=".55" fill="currentColor" /></>,
  lock: <><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" /></>,
  copy: <><rect x="5.25" y="5.25" width="8" height="8" rx="1.5" /><path d="M10.75 5.25v-1a1.5 1.5 0 0 0-1.5-1.5h-4.5a1.5 1.5 0 0 0-1.5 1.5v4.5a1.5 1.5 0 0 0 1.5 1.5h1" /></>,
  external: <><path d="M9.25 2.75h4v4M13.25 2.75 7.5 8.5" /><path d="M11.75 9.25v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></>,
  users: <><circle cx="6" cy="5.5" r="2.25" /><path d="M1.75 13.25a4.25 4.25 0 0 1 8.5 0" /><path d="M10.5 3.4a2.25 2.25 0 0 1 0 4.2M12 9.4a4.25 4.25 0 0 1 2.25 3.85" /></>,
  board: <><rect x="1.75" y="2.75" width="3.5" height="10.5" rx="1" /><rect x="6.25" y="2.75" width="3.5" height="7" rx="1" /><rect x="10.75" y="2.75" width="3.5" height="8.75" rx="1" /></>,
  chart: <><path d="M2.75 2.75v10.5h10.5" /><path d="M5.5 10.5V8M8.5 10.5V5.5M11.5 10.5v-3.5" /></>,
  checkSquare: <><rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" /><path d="m5.25 8.25 2 2 3.75-4" /></>,
  trash: <><path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5" /><path d="M4 4.25l.6 8.6a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4l.6-8.6" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={"ui-icon" + (className ? " " + className : "")}
      width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
