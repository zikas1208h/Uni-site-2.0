const nodemailer = require('nodemailer');

// Google App Passwords are displayed as "xxxx xxxx xxxx xxxx" — strip spaces defensively
const smtpPass = () => (process.env.SMTP_PASS || '').replace(/\s+/g, '');

// Build a transporter from env vars.
const createTransporter = () => {
  if (process.env.SMTP_SERVICE === 'gmail') {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      family: 4,           // ← force IPv4 — Railway blocks outbound IPv6
      auth: {
        user: process.env.SMTP_USER,
        pass: smtpPass(),
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }
  // Generic SMTP
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    family: 4,             // ← force IPv4
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPass(),
    },
    tls: { rejectUnauthorized: false },
  });
};

/**
 * Send an OTP email to a staff member setting up their credentials.
 * @param {string} toEmail  – destination address (the NEW email they entered)
 * @param {string} name     – first name
 * @param {string} otp      – 6-digit code
 */
const sendOtpEmail = async (toEmail, name, otp) => {
  const transporter = createTransporter();

  const html = `
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
                You requested to verify your email address for your HNU Portal staff account.
                Use the code below — it expires in <strong>10 minutes</strong>.
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

  await transporter.sendMail({
    from: `"HNU Portal" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: `🔐 Your HNU Portal verification code: ${otp}`,
    html,
    text: `Your HNU Portal verification code is: ${otp}. It expires in 10 minutes.`,
  });
};

module.exports = { sendOtpEmail };


