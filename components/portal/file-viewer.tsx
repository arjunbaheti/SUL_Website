"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { portalClient } from "@/lib/supabase";
import { fmtSize, type AppFile } from "@/lib/portal";

// Shows an applicant's resume or attachment inside the portal, over the applicant window.
// PDFs and images preview inline; Word/PowerPoint files can't be previewed in a browser
// without sending them to a third-party viewer, so those get Open / Download buttons instead.

const kindOf = (f: AppFile) => {
  const mime = f.mime || "";
  const ext = (f.name || f.path).split(".").pop()?.toLowerCase() || "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg"].includes(ext)) return "image";
  return "other";
};

async function sign(path: string, download?: string) {
  const res = await portalClient().storage.from("resumes").createSignedUrl(path, 600, download ? { download } : undefined);
  if (res.error || !res.data) throw new Error(res.error?.message || "not found");
  return res.data.signedUrl;
}

export function FileViewer({ files, startPath, applicantName, onClose }: {
  files: AppFile[]; startPath: string; applicantName: string; onClose: () => void;
}) {
  const [path, setPath] = useState(startPath);
  const [state, setState] = useState<{ path: string; url?: string; error?: string } | null>(null);
  const file = files.find((f) => f.path === path) ?? files[0];
  const kind = kindOf(file);
  const url = state?.path === path ? state.url : undefined;
  const error = state?.path === path ? state.error : undefined;

  useEffect(() => {
    let alive = true;
    sign(path)
      .then((u) => { if (alive) setState({ path, url: u }); })
      .catch((e: Error) => { if (alive) setState({ path, error: e.message }); });
    return () => { alive = false; };
  }, [path]);

  // Escape closes just the viewer, not the applicant window underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function download() {
    try {
      const u = await sign(file.path, file.name || "file");
      const a = document.createElement("a");
      a.href = u; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      setState({ path, error: (e as Error).message });
    }
  }

  return createPortal(
    <div className="crm-viewer" role="dialog" aria-modal="true" aria-label={"File from " + applicantName}>
      <div className="crm-viewer-bar">
        <div className="crm-viewer-title">
          <strong>{applicantName}</strong>
          <span>{file.kind === "resume" ? "Resume" : "Attachment"} · {file.name || "file"}{file.size ? " · " + fmtSize(file.size) : ""}</span>
        </div>
        {files.length > 1 ? (
          <div className="crm-seg" role="group" aria-label="Files" style={{ margin: 0 }}>
            {files.map((f) => (
              <button key={f.path} type="button" aria-pressed={f.path === path} onClick={() => setPath(f.path)}>
                {f.kind === "resume" ? "Resume" : "Attachment"}
              </button>
            ))}
          </div>
        ) : null}
        <span className="spacer" />
        {url ? <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noopener noreferrer">Open in new tab</a> : null}
        <button className="btn btn-secondary btn-sm" type="button" onClick={download}>Download</button>
        <button className="crm-close" type="button" aria-label="Close file" onClick={onClose}>×</button>
      </div>
      <div className="crm-viewer-body" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {error ? (
          <div className="crm-viewer-msg"><p>Couldn&apos;t open this file: {error}</p></div>
        ) : !url ? (
          <div className="crm-viewer-msg"><p>Loading…</p></div>
        ) : kind === "pdf" ? (
          <iframe key={url} className="crm-viewer-frame" src={url} title={file.name || "Resume"} />
        ) : kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
          <img className="crm-viewer-img" src={url} alt={file.name || "Attachment"} />
        ) : (
          <div className="crm-viewer-msg">
            <p>Word and PowerPoint files can&apos;t be previewed here.</p>
            <div className="crm-settings-actions" style={{ justifyContent: "center" }}>
              <button className="btn btn-primary btn-sm" type="button" onClick={download}>Download {file.name || "file"}</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
