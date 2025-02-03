const express = require('express');
const nodemailer = require('nodemailer'); // Import nodemailer for SMTP

const router = express.Router();

// SMTP configuration
const SMTP_HOST = "smtp.dreamhost.com";
const SMTP_PORT = 465; // SSL/TLS
const SMTP_USER = "fti.academy@website-backend.email";
const SMTP_PASS = "@5C4jQp@v5fPCDe!";

// Create a reusable transporter using SMTP configuration
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: true, // Use SSL/TLS
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

// Define an async function for sending emails via SMTP
async function sendEmail({ from, to, subject, plain, html, attachments }) {
  const emailData = {
    from,
    to,
    subject,
    text: plain,   // plain text version
    html,          // HTML version
    attachments,   // Attachments if provided
  };

  try {
    // Send email using the transporter
    const info = await transporter.sendMail(emailData);

    console.log('Email sent:', info.messageId);
    return { status: true, message: 'Email sent successfully', messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { status: false, message: 'Error sending email', error: error.message };
  }
}

// Define a route for sending emails
router.post('/send', async (req, res) => {
  const { from, to, subject, plain, html, attachments } = req.body;

  // Check if all required fields are present
  if (!from || !to || !subject || !plain || !html) {
    return res.status(400).json({ error: 'Missing required fields: from, to, subject, plain, html' });
  }

  try {
    const result = await sendEmail({
      from,
      to,
      subject,
      plain,
      html,
      attachments, // Pass attachments to the sendEmail function
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error sending email' });
  }
});

module.exports = router;
