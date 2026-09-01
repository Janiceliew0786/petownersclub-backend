const nodemailer = require('nodemailer');
require('dotenv').config();

// Brevo's SMTP relay — free tier, works for any recipient once your sender
// email is verified (unlike some providers that restrict you to your own
// inbox until you verify a whole domain).
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // Brevo uses STARTTLS on port 587, not implicit TLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendResetCodeEmail(toEmail, code) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || '"A Pet Owners Club" <no-reply@petownersclub.app>',
    to: toEmail,
    subject: 'Your password reset code',
    text: `Your A Pet Owners Club password reset code is: ${code}\n\nThis code expires in 15 minutes. If you didn't request this, you can safely ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2>Password Reset Code</h2>
        <p>Use this code in the app to reset your password:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #1e3a5f;">${code}</p>
        <p style="color: #666; font-size: 13px;">This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendResetCodeEmail };
