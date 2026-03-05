const nodemailer = require('nodemailer');

const smtpPass = () => (process.env.SMTP_PASS || '').replace(/\s+/g, '');

// ── HTML template ─────────────────────────────────────────────────────────────
const buildHtml = (name, otp) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(99,102,241,.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;">🎓 HNU Portal</h1>
            <p style="margin:8px 0 0;color:#e0e7ff;font-size:14px;">Staff Account Setup</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <h2 style="margin:0 0 12px;color:#1e293b;font-size:20px;">Hello, ${name}!</h2>
            <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">
              Use the code below to verify your email — it expires in <strong>10 minutes</strong>.
            </p>
            <div style="text-align:center;margin:32px 0;">
              <div style="display:inline-block;background:#f0f4ff;border:2px solid #6366f1;border-radius:14px;padding:20px 48px;">
                <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#6366f1;">${otp}</span>
              </div>
            </div>
            <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">
              If you did not request this, please ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
              © ${new Date().getFullYear()} HNU University Portal. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ── Strategy 1: Resend HTTPS API (works on Railway — no raw SMTP socket) ──────
const sendViaResend = async (toEmail, name, otp) => {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.RESEND_FROM || 'HNU Portal <onboarding@resend.dev>',
    to: toEmail,
    subject: `🔐 Your HNU Portal verification code: ${otp}`,
    html: buildHtml(name, otp),
    text: `Your HNU Portal verification code is: ${otp}. It expires in 10 minutes.`,
  });
};

// ── Strategy 2: nodemailer SMTP fallback (works locally) ─────────────────────
const sendViaSmtp = async (toEmail, name, otp) => {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    family: 4,
    auth: { user: process.env.SMTP_USER, pass: smtpPass() },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
  });
  await transporter.sendMail({
    from: `"HNU Portal" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: `🔐 Your HNU Portal verification code: ${otp}`,
    html: buildHtml(name, otp),
    text: `Your HNU Portal verification code is: ${otp}. It expires in 10 minutes.`,
  });
};

// ── Public API ────────────────────────────────────────────────────────────────
const sendOtpEmail = async (toEmail, name, otp) => {
  // Use Resend if API key is configured (Railway production)
  if (process.env.RESEND_API_KEY) {
    await sendViaResend(toEmail, name, otp);
    return;
  }
  // Fall back to SMTP (local dev)
  await sendViaSmtp(toEmail, name, otp);
};

module.exports = { sendOtpEmail };

