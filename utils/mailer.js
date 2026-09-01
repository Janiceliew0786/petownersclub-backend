require('dotenv').config();

// Switched from SMTP (nodemailer) to Brevo's HTTP API. Railway blocks
// outbound SMTP ports (25/465/587) on some plans to prevent spam abuse —
// that's what was causing the "Connection timeout" even after forcing
// IPv4. The HTTP API sends over regular HTTPS (port 443), which is never
// blocked, so this sidesteps the problem entirely. Uses Node's built-in
// fetch (Node 18+, no new dependency needed).

// Parses EMAIL_FROM in the format: "Name" <email@example.com>
function parseFrom(raw) {
  const match = raw?.match(/^"?([^"<]*)"?\s*<(.+)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  // Fallback if EMAIL_FROM is just a bare email address
  return { name: 'A Pet Owners Club', email: raw };
}

async function sendResetCodeEmail(toEmail, code) {
  const sender = parseFrom(process.env.EMAIL_FROM);

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender,
      to: [{ email: toEmail }],
      subject: 'Your password reset code',
      textContent: `Your A Pet Owners Club password reset code is: ${code}\n\nThis code expires in 15 minutes. If you didn't request this, you can safely ignore this email.`,
      htmlContent: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
          <h2>Password Reset Code</h2>
          <p>Use this code in the app to reset your password:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #1e3a5f;">${code}</p>
          <p style="color: #666; font-size: 13px;">This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo API error (${response.status}): ${errorBody}`);
  }
}

module.exports = { sendResetCodeEmail };