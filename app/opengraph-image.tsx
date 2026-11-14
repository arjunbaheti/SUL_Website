import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The preview card shown when a link to the site is shared (LinkedIn, Messenger, iMessage,
// Slack, X...). Generated once at build time from the real wordmark and the site's colours.

export const alt = "StartUp Link UniMelb: the most ambitious student club in Australia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const logo = await readFile(join(process.cwd(), "public/img/logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "radial-gradient(circle at 18% 105%, #2e68e0 0%, rgba(46,104,224,0) 55%), radial-gradient(circle at 95% 0%, rgba(150,205,232,0.55) 0%, rgba(150,205,232,0) 45%), #0a0f1a",
          color: "#f4f7ff",
        }}
      >
        <img src={logoSrc} width={300} height={105} alt="" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.05 }}>
            The most <span style={{ color: "#c5e4ec", marginLeft: 20 }}>ambitious</span>
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.05 }}>student club in Australia.</div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#9aa9c4", maxWidth: 900, lineHeight: 1.35 }}>
            Connecting UniMelb students to the startup ecosystem.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
