// Vercel serverless function — sends an email via Gmail SMTP.
// Credentials come from environment variables (set in the Vercel dashboard:
// Project Settings -> Environment Variables), never from source. This is the
// only piece of the site that isn't static: everything else is still plain
// HTML/CSS/JS with no build step.
const nodemailer = require("nodemailer");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
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
    res.status(500).json({ ok: false, error: "Email isn't configured on the server yet (missing GMAIL_USER / GMAIL_APP_PASSWORD)." });
    return;
  }

  try {
    var transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: user, pass: pass },
    });
    await transporter.sendMail({
      from: '"StartUp Link UniMelb" <' + user + ">",
      to: to,
      subject: subject,
      text: text,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err && err.message) || "Send failed" });
  }
};
