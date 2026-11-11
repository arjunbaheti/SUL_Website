// Vercel serverless function — sends an email via Gmail SMTP.
// Credentials come from environment variables (set in the Vercel dashboard:
// Project Settings -> Environment Variables), never from source. This is the
// only piece of the site that isn't static: everything else is still plain
// HTML/CSS/JS with no build step.
//
// Callers must be signed-in committee members: the portal sends its Supabase access
// token as "Authorization: Bearer <token>", and we ask the database (is_committee(),
// see supabase/schema.sql) whether that token belongs to someone on the allowlist.
// Without this, anyone on the internet could send mail from the club's address.
const nodemailer = require("nodemailer");

async function isCommittee(token) {
  var url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  var anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 500, error: "Missing env var(s) on the server: SUPABASE_URL and/or SUPABASE_ANON_KEY (same values as assets/js/config.js)." };
  if (!token) return { ok: false, status: 401, error: "Sign in to the committee portal first." };
  try {
    var r = await fetch(url + "/rest/v1/rpc/is_committee", {
      method: "POST",
      headers: { apikey: anon, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return { ok: false, status: 401, error: "Your session has expired. Sign in again." };
    return (await r.json()) === true ? { ok: true } : { ok: false, status: 403, error: "This account isn't on the committee reviewer list." };
  } catch (e) {
    return { ok: false, status: 502, error: "Couldn't verify your session: " + ((e && e.message) || "network error") };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  var auth = String(req.headers.authorization || "");
  var check = await isCommittee(auth.indexOf("Bearer ") === 0 ? auth.slice(7).trim() : "");
  if (!check.ok) {
    res.status(check.status).json({ ok: false, error: check.error });
    return;
  }

  var body = req.body || {};
  var to = (body.to || "").trim();
  var subject = (body.subject || "").trim();
  var text = (body.text || "").trim();

  if (!to || !subject || !text) {
    res.status(400).json({ ok: false, error: "Missing to, subject, or text" });
    return;
  }

  var user = process.env.GMAIL_USER;
  var pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    var missing = [];
    if (!user) missing.push("GMAIL_USER");
    if (!pass) missing.push("GMAIL_APP_PASSWORD");
    res.status(500).json({ ok: false, error:
      "Missing env var(s) on the server: " + missing.join(", ") + ". In Vercel: Project Settings -> " +
      "Environment Variables -> make sure both are added with the Production box checked, then trigger " +
      "a fresh deployment (Deployments -> ... -> Redeploy)." });
    return;
  }

  try {
    var transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: user, pass: pass },
    });
    var domain = user.split("@")[1] || "startuplinkunimelb.net";
    await transporter.sendMail({
      from: '"StartUp Link UniMelb" <' + user + ">",
      replyTo: user,
      to: to,
      subject: subject,
      text: text,
      // Nodemailer defaults this to the container's internal hostname, which
      // doesn't match the sending domain and reads as a spam signal.
      messageId: "<" + Date.now() + "." + Math.random().toString(36).slice(2) + "@" + domain + ">",
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err && err.message) || "Send failed" });
  }
};
