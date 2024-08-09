const express = require('express');
const nodemailer = require('nodemailer');
// Removed import of express-rate-limit
const NodeCache = require('node-cache'); // For caching

const router = express.Router();

// SMTP configuration for nodemailer
const smtpConfig = {
  host: 'smtp.cloudmta.net',
  port: 587,
  secure: true, // true for 465, false for other ports
  auth: {
    user: '4c9506dea731b2f9', // your email
    pass: 'JBu4oxNQ3b5AZ55gSN3mvtRt', // your email password
  },
};


// // SMTP configuration for nodemailer
// const smtpConfig = {
//   host: 'smtp.dreamhost.com',
//   port: 465,
//   secure: true, // true for 465, false for other ports
//   auth: {
//     user: 'noreply@website-backend.email', // your email
//     pass: 'uSMmKhRv8j#ukUPy', // your email password
//   },
// };


// Create a transporter for sending emails
const transporter = nodemailer.createTransport(smtpConfig);

// Cache setup with a 10-minute TTL (adjust as needed)
const emailCache = new NodeCache({ stdTTL: 600 });

// Define an async function for sending emails
async function sendEmail({ fromEmail, fromName, toEmail, toName, subject, text, html }) {
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`, // sender address
    to: `"${toName}" <${toEmail}>`, // list of receivers
    subject: subject, // Subject line
    text: text, // plain text body
    html: html, // HTML body content
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    return { status: true, message: 'Email sent successfully', messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { status: false, message: 'Error sending email', error: error };
  }
}

// Define a route for sending emails without rate limiting
router.post('/send', async (req, res) => {
  const { fromEmail, fromName, toEmail, toName, subject, text, html } = req.body;

  // Construct cache key from request parameters to prevent duplicate emails being sent
  const cacheKey = `${toEmail}:${subject}:${text}:${html}`;
  const cachedResult = emailCache.get(cacheKey);

  if (cachedResult) {
    return res.status(200).json(cachedResult);
  } else {
    try {
      const result = await sendEmail({
        fromEmail,
        fromName,
        toEmail,
        toName,
        subject,
        text,
        html,
      });

      // Cache the successful result to prevent resending
      emailCache.set(cacheKey, result);
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: 'Error sending email' });
    }
  }
});

module.exports = router;
