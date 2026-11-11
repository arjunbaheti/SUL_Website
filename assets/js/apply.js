/* StartUp Link UniMelb — public recruitment application form (recruitment.html)
 *
 * Flow: validate -> upload resume (+ optional extra file) to the private "resumes" bucket
 * -> insert ONE row into public.applications referencing those files. The committee portal
 * (portal.html) reads the same table, so applications appear on the Applied column.
 * The anon key can insert but never read, so nothing here can expose other applicants' data.
 */
(function () {
  "use strict";

  var form = document.getElementById("apply-form");
  if (!form) return;

  // Teams recruiting for Semester 1 2027. Applicants pick from these; the portal's role
  // filter is built from whatever they submit, so changing this list is all that's needed.
  var ROLES = [
    "Events",
    "Projects",
    "External Relations",
    "Marketing",
  ];

  var MAX_BYTES = 3 * 1024 * 1024; // matches the bucket's file_size_limit in schema.sql
  var RESUME_TYPES = { pdf: "application/pdf", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  var EXTRA_TYPES = Object.assign({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }, RESUME_TYPES);

  var statusEl = document.getElementById("apply-status");
  var submitBtn = document.getElementById("apply-submit");
  var unavailable = document.getElementById("apply-unavailable");
  var roleSel = document.getElementById("a-role");
  var role2Sel = document.getElementById("a-role2");
  var statement = document.getElementById("a-statement");
  var counter = document.getElementById("a-statement-count");

  function opt(value, text) {
    var o = document.createElement("option");
    o.value = value; o.textContent = text;
    return o;
  }
  var gradSel = document.getElementById("a-year");
  gradSel.appendChild(opt("", "Select…"));
  ["Mid 2027", "End 2027", "Mid 2028", "End 2028", "Mid 2029", "End 2029", "2030 or later"]
    .forEach(function (g) { gradSel.appendChild(opt(g, g)); });
  roleSel.appendChild(opt("", "Select…"));
  role2Sel.appendChild(opt("", "Only interested in my first preference"));
  ROLES.forEach(function (r) { roleSel.appendChild(opt(r, r)); role2Sel.appendChild(opt(r, r)); });

  statement.addEventListener("input", function () { counter.textContent = String(statement.value.length); });

  if (!window.SUL_DB) {
    unavailable.hidden = false;
    unavailable.textContent = "Applications aren't open on this page yet. Please email info@startuplinkunimelb.net. (" +
      (window.SUL_DB_ERROR || "Backend unavailable.") + ")";
    submitBtn.disabled = true;
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#ff8a8a" : "";
  }

  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  }

  // Returns an error string, or "" if the file is acceptable.
  function checkFile(file, allowed, label) {
    if (!file) return "";
    if (!allowed[extOf(file.name)]) return label + ": unsupported file type.";
    if (file.size > MAX_BYTES) return label + " is larger than 3 MB.";
    if (file.size === 0) return label + " is empty.";
    return "";
  }

  function safeName(name) {
    var ext = extOf(name);
    var base = name.replace(/\.[^.]*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    return (base || "file") + (ext ? "." + ext : "");
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  function upload(folder, file, kind, types) {
    var path = folder + "/" + Date.now() + "-" + safeName(file.name);
    var mime = types[extOf(file.name)];
    return window.SUL_DB.storage.from("resumes")
      .upload(path, file, { contentType: mime, upsert: false })
      .then(function (res) {
        if (res.error) throw new Error("Couldn't upload " + file.name + ": " + res.error.message);
        return { path: path, name: file.name, size: file.size, mime: mime, kind: kind };
      });
  }

  form.addEventListener("submit", function (evt) {
    evt.preventDefault();
    setStatus("");
    if (!window.SUL_DB) return;

    var fd = new FormData(form);
    var val = function (k) { return String(fd.get(k) || "").trim(); };

    // Honeypot tripped: pretend it worked, store nothing.
    if (val("website")) { showSuccess(val("name")); return; }

    var resume = form.elements.resume.files[0];
    var extra = form.elements.extra.files[0];

    var problem = "";
    if (!val("name")) problem = "Please enter your full name.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val("email"))) problem = "Please enter a valid email address.";
    else if (!val("degree")) problem = "Please enter your degree.";
    else if (!val("year")) problem = "Please select your expected graduation date.";
    else if (!val("role")) problem = "Please choose a first-choice team.";
    else if (!val("statement")) problem = "Please tell us why you want to join.";
    else if (!resume) problem = "Please attach your resume.";
    else if (val("linkedin") && !/^https?:\/\//i.test(val("linkedin"))) problem = "Links should start with https://";
    else if (!form.elements.consent.checked) problem = "Please tick the consent box to continue.";
    problem = problem || checkFile(resume, RESUME_TYPES, "Resume") || checkFile(extra, EXTRA_TYPES, "Extra attachment");
    if (problem) { setStatus(problem, true); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    setStatus("Uploading your files…");

    var id = newId();
    var uploads = [upload(id, resume, "resume", RESUME_TYPES)];
    if (extra) uploads.push(upload(id, extra, "other", EXTRA_TYPES));

    Promise.all(uploads).then(function (files) {
      setStatus("Saving your application…");
      return window.SUL_DB.from("applications").insert({
        id: id,
        name: val("name"),
        email: val("email").toLowerCase(),
        phone: val("phone"),
        degree: val("degree"),
        year_level: val("year"),
        role: val("role"),
        role_secondary: val("role2") === val("role") ? "" : val("role2"),
        statement: val("statement"),
        linkedin: val("linkedin"),
        files: files,
        consent: true,
      });
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      showSuccess(val("name"));
    }).catch(function (err) {
      console.error(err);
      setStatus((err && err.message ? err.message : "Something went wrong") +
        ". Please try again, or email info@startuplinkunimelb.net.", true);
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit application";
    });
  });

  function showSuccess(name) {
    form.hidden = true;
    document.getElementById("apply-success-name").textContent = (name || "").split(/\s+/)[0] || "";
    document.getElementById("apply-success").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
})();
