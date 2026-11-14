"use client";

import { useEffect, useRef, useState } from "react";
import { applyClient } from "@/lib/supabase";
import { resetFormSession, trackForm } from "@/lib/form-tracking";
import { TEAMS } from "@/components/chrome";

// Same markup and class names as the original recruitment form, so the original stylesheet
// applies unchanged. Flow: validate -> upload resume (+ optional extra file) to the private
// "resumes" bucket -> insert ONE row into public.applications referencing those files.

const GRADUATION = ["Mid 2027", "End 2027", "Mid 2028", "End 2028", "Mid 2029", "End 2029", "2030 or later"];
const MAX_BYTES = 3 * 1024 * 1024; // matches the bucket's file_size_limit in supabase/schema.sql
const RESUME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const EXTRA_TYPES: Record<string, string> = {
  ...RESUME_TYPES,
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
// 200-word answers; a little slack (5 words) so nobody is blocked over a stray word.
const WORD_LIMIT = 200;
const WORD_SLACK = 5;

const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const extOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name || "")?.[1].toLowerCase() ?? "";

function checkFile(file: File | undefined, allowed: Record<string, string>, label: string) {
  if (!file) return "";
  if (!allowed[extOf(file.name)]) return label + ": unsupported file type.";
  if (file.size > MAX_BYTES) return label + " is larger than 3 MB.";
  if (file.size === 0) return label + " is empty.";
  return "";
}

function safeName(name: string) {
  const ext = extOf(name);
  const base = name.replace(/\.[^.]*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return (base || "file") + (ext ? "." + ext : "");
}

function Req() {
  return <span className="req" aria-hidden="true">*</span>;
}

function Counter({ id, value }: { id: string; value: string }) {
  const n = wordCount(value);
  return (
    <p className="form-hint" id={`${id}-hint`} style={{ color: n > WORD_LIMIT ? "#ff8a8a" : undefined }}>
      <span id={`${id}-count`}>{n}</span> / 200 words
    </p>
  );
}

export function ApplyForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean }>({ text: "", error: false });
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [experience, setExperience] = useState("");
  const [picked, setPicked] = useState<{ resume: string; extra: string }>({ resume: "", extra: "" });

  // Anonymous progress tracking for the committee's Health dashboard (field names only, no answers).
  useEffect(() => { trackForm("view"); }, []);
  // A field counts as filled in when you leave it with a value (typed fields) or as soon as you
  // pick something (dropdowns, files, the consent box).
  function noteProgress(e: React.SyntheticEvent<HTMLFormElement>) {
    const t = e.target as HTMLInputElement;
    if (!t.name || t.name === "website") return;
    trackForm("start");
    const typed = (t.tagName === "INPUT" && !["checkbox", "file", "radio"].includes(t.type)) || t.tagName === "TEXTAREA";
    if (typed && e.type !== "blur") return;
    const filled = t.type === "checkbox" ? t.checked : t.type === "file" ? !!t.files?.length : !!t.value?.trim();
    if (filled) trackForm("field", t.name);
  }

  function clearInvalid(e: React.FormEvent<HTMLFormElement>) {
    const t = e.target as HTMLElement;
    if (t.getAttribute?.("aria-invalid")) {
      t.removeAttribute("aria-invalid");
      setStatus({ text: "", error: false });
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus({ text: "", error: false });
    const form = e.currentTarget;
    const fd = new FormData(form);
    const val = (k: string) => String(fd.get(k) || "").trim();
    const firstName = () => val("name").split(/\s+/)[0] || "";

    // Honeypot tripped: pretend it worked, store nothing.
    if (val("website")) { done(firstName()); return; }

    const el = form.elements as HTMLFormControlsCollection & Record<string, HTMLInputElement>;
    const resume = el.resume.files?.[0];
    const extra = el.extra.files?.[0];
    let link = val("linkedin");

    let bad: HTMLElement | null = null;
    let problem = "";
    const fail = (node: HTMLElement, msg: string) => { if (!bad) { bad = node; problem = msg; } };
    if (!val("name")) fail(el.name, "Please enter your full name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val("email"))) fail(el.email, "Please enter a valid email address.");
    if (!val("degree")) fail(el.degree, "Please enter your degree.");
    if (!val("year")) fail(el.year, "Please select your expected graduation date.");
    if (!val("role")) fail(el.role, "Please choose a first-choice team.");
    if (!val("statement")) fail(el.statement, "Please tell us why you're interested in joining.");
    if (!val("experience")) fail(el.experience, "Please tell us what skills and experience you could bring.");
    if (wordCount(val("statement")) > WORD_LIMIT + WORD_SLACK) fail(el.statement, "Your first answer is over the 200 word limit. Please shorten it.");
    if (wordCount(val("experience")) > WORD_LIMIT + WORD_SLACK) fail(el.experience, "Your second answer is over the 200 word limit. Please shorten it.");
    if (link && (/\s/.test(link) || !/\./.test(link))) fail(el.linkedin, "That doesn't look like a link. Try linkedin.com/in/yourname");
    if (link && !/^[a-z][a-z0-9+.-]*:\/\//i.test(link)) link = "https://" + link;
    if (!resume) fail(el.resume, "Please attach your resume.");
    const resumeProblem = checkFile(resume, RESUME_TYPES, "Resume");
    if (resumeProblem) fail(el.resume, resumeProblem);
    const extraProblem = checkFile(extra, EXTRA_TYPES, "Extra attachment");
    if (extraProblem) fail(el.extra, extraProblem);
    if (!el.consent.checked) fail(el.consent, "Please tick the consent box to continue.");
    if (bad) {
      trackForm("invalid", (bad as HTMLInputElement).name);
      (bad as HTMLElement).setAttribute("aria-invalid", "true");
      (bad as HTMLElement).focus();
      setStatus({ text: problem, error: true });
      return;
    }

    trackForm("submit");
    setBusy(true);
    setStatus({ text: "Uploading your files…", error: false });
    const db = applyClient();
    const id = crypto.randomUUID();
    const upload = async (file: File, kind: "resume" | "other", types: Record<string, string>) => {
      const path = id + "/" + Date.now() + "-" + safeName(file.name);
      const mime = types[extOf(file.name)];
      const res = await db.storage.from("resumes").upload(path, file, { contentType: mime, upsert: false });
      if (res.error) throw new Error("Couldn't upload " + file.name + ": " + res.error.message);
      return { path, name: file.name, size: file.size, mime, kind };
    };

    let stage = "upload";
    try {
      const uploads = [upload(resume!, "resume", RESUME_TYPES)];
      if (extra) uploads.push(upload(extra, "other", EXTRA_TYPES));
      const files = await Promise.all(uploads);
      stage = "save";
      setStatus({ text: "Saving your application…", error: false });
      const { error } = await db.from("applications").insert({
        id,
        name: val("name"),
        email: val("email").toLowerCase(),
        phone: val("phone"),
        degree: val("degree"),
        year_level: val("year"),
        role: val("role"),
        role_secondary: val("role2") === val("role") ? "" : val("role2"),
        statement: val("statement"),
        experience: val("experience"),
        linkedin: link,
        questions: val("questions"),
        extra_note: val("extra_note"),
        files,
        consent: true,
      });
      if (error) throw new Error(error.message);
      // Ask the server to email a "we've received your application" confirmation. Fire and
      // forget: the application is already saved, so a failed email never shows as an error.
      fetch("/api/application-received", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        keepalive: true,
      }).catch(() => {});
      trackForm("submitted");
      resetFormSession();
      done(firstName());
    } catch (err) {
      console.error(err);
      trackForm("error", stage);
      const msg = err instanceof Error && err.message ? err.message : "Something went wrong";
      setStatus({ text: msg + ". Please try again, or email info@startuplinkunimelb.net.", error: true });
      setBusy(false);
    }
  }

  function done(name: string) {
    setSuccess(name);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <form className="card apply-card" id="apply-form" noValidate ref={formRef} onSubmit={onSubmit} onInput={clearInvalid} onChange={(e) => { clearInvalid(e); noteProgress(e); }} onBlur={noteProgress} hidden={success !== null}>
        <fieldset className="apply-group">
          <legend><span className="step-text">About you<small>Who we&apos;re talking to.</small></span></legend>
          <div className="form-field">
            <label htmlFor="a-name">Full name <Req /></label>
            <input type="text" id="a-name" name="name" required maxLength={120} autoComplete="name" />
          </div>
          <div className="grid grid-2">
            <div className="form-field">
              <label htmlFor="a-email">Email <Req /></label>
              <input type="email" id="a-email" name="email" required maxLength={254} autoComplete="email" placeholder="you@student.unimelb.edu.au" />
            </div>
            <div className="form-field">
              <label htmlFor="a-phone">Phone</label>
              <input type="tel" id="a-phone" name="phone" maxLength={40} autoComplete="tel" />
            </div>
          </div>
          <div className="grid grid-2">
            <div className="form-field">
              <label htmlFor="a-degree">Degree <Req /></label>
              <input type="text" id="a-degree" name="degree" required maxLength={120} placeholder="e.g. Bachelor of Commerce" />
            </div>
            <div className="form-field">
              <label htmlFor="a-year">Expected graduation <Req /></label>
              <select id="a-year" name="year" required defaultValue="">
                <option value="">Select…</option>
                {GRADUATION.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="apply-group">
          <legend><span className="step-text">Your application<small>Where you&apos;d fit and why.</small></span></legend>
          <div className="grid grid-2">
            <div className="form-field">
              <label htmlFor="a-role">First-choice team <Req /></label>
              <select id="a-role" name="role" required defaultValue="">
                <option value="">Select…</option>
                {TEAMS.map(([t]) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="a-role2">Second-choice team</label>
              <select id="a-role2" name="role2" defaultValue="">
                <option value="">No second choice</option>
                {TEAMS.map(([t]) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="a-statement">Why are you interested in joining StartUp Link? <Req /></label>
            <textarea id="a-statement" name="statement" required rows={6} maxLength={3000} value={statement} onChange={(e) => setStatement(e.target.value)} />
            <Counter id="a-statement" value={statement} />
          </div>
          <div className="form-field">
            <label htmlFor="a-experience">What skills and experience could you bring to your role and the broader club? <Req /></label>
            <textarea id="a-experience" name="experience" required rows={6} maxLength={3000} value={experience} onChange={(e) => setExperience(e.target.value)} />
            <Counter id="a-experience" value={experience} />
          </div>
          <div className="form-field">
            <label htmlFor="a-linkedin">LinkedIn</label>
            <input type="text" id="a-linkedin" name="linkedin" maxLength={300} inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="linkedin.com/in/yourname" />
          </div>
        </fieldset>

        <fieldset className="apply-group">
          <legend><span className="step-text">Attachments<small>Your resume and anything that backs you up.</small></span></legend>
          <div className="form-field">
            <label htmlFor="a-resume">Resume <Req /></label>
            <input type="file" id="a-resume" name="resume" required accept=".pdf,.doc,.docx,application/pdf" onChange={(e) => setPicked((s) => ({ ...s, resume: e.target.files?.[0]?.name ?? "" }))} />
            {picked.resume ? <p className="form-hint file-picked">Selected: {picked.resume}</p> : null}
            <p className="form-hint">PDF, DOC or DOCX, up to 3 MB.</p>
          </div>
          <div className="form-field">
            <label htmlFor="a-extra">Anything else? <span className="opt">(optional)</span></label>
            <input type="file" id="a-extra" name="extra" accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg" onChange={(e) => setPicked((s) => ({ ...s, extra: e.target.files?.[0]?.name ?? "" }))} />
            {picked.extra ? <p className="form-hint file-picked">Selected: {picked.extra}</p> : null}
            <p className="form-hint">Cover letter, portfolio or transcript. PDF, DOC, DOCX, PPT, PPTX, PNG or JPG, up to 3 MB.</p>
            <input type="text" id="a-extra-note" name="extra_note" maxLength={200} aria-label="Short note about this attachment (optional)" placeholder="Short note or link (optional)" style={{ marginTop: "0.6rem" }} />
          </div>
        </fieldset>

        <fieldset className="apply-group">
          <legend><span className="step-text">Questions<small>Anything you&apos;d like to ask us.</small></span></legend>
          <div className="form-field">
            <label htmlFor="a-questions">Questions for the committee <span className="opt">(optional)</span></label>
            <textarea id="a-questions" name="questions" rows={4} maxLength={1000} placeholder="About the roles, the time commitment, the process, anything." />
          </div>
        </fieldset>

        {/* Honeypot: real people never see or fill this; bots often do. */}
        <div className="apply-hp" aria-hidden="true">
          <label htmlFor="a-website">Website</label>
          <input type="text" id="a-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>

        <div className="form-field apply-consent">
          <label className="check">
            <input type="checkbox" id="a-consent" name="consent" required />
            <span>
              I agree that StartUp Link UniMelb can store this information and my attachments to assess my application.
              Only committee reviewers can see it, and it won&apos;t be shared with anyone else. <Req />
            </span>
          </label>
        </div>

        <p className="form-hint apply-status" id="apply-status" role="status" aria-live="polite" style={{ color: status.error ? "#ff8a8a" : undefined }}>
          {status.text}
        </p>
        <button className="btn btn-primary btn-block" type="submit" id="apply-submit" disabled={busy}>
          {busy ? "Submitting…" : "Submit application"}
        </button>
      </form>

      <div className="card apply-card apply-success" id="apply-success" hidden={success === null}>
        <h3>Application received</h3>
        <p>
          Thanks{success ? <>, <span id="apply-success-name">{success}</span></> : null}. Your application and resume are with the
          committee. We&apos;ll reply by email with next steps shortly.
        </p>
        <p className="form-hint">Questions? Email <a href="mailto:info@startuplinkunimelb.net">info@startuplinkunimelb.net</a>.</p>
        <a className="btn btn-secondary" href="/">Back to home</a>
      </div>
    </>
  );
}
