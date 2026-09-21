const nodemailer = require('nodemailer');

const smtpConfigured = () => Boolean(process.env.SMTP_HOST);

let transporter;
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
};

// Returns true if a real email was sent, false if we only logged to the console.
const sendVerificationEmail = async ({ to, username, code, reference }) => {
  if (!smtpConfigured()) {
    console.log(`\n[DEV MAIL] Verification code for ${to} (${username}): ${code}   ref: ${reference}\n`);
    return false;
  }
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || 'Eco Aware <no-reply@ecoaware.org>',
    to,
    subject: 'Your Eco Aware verification code',
    text: `Hi ${username},\n\nYour verification code is ${code}\nReference: ${reference}\n\nIt expires in 10 minutes. If you did not sign up, ignore this email.`,
  });
  return true;
};

module.exports = { sendVerificationEmail, smtpConfigured };
