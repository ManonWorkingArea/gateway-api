const express = require('express');
const nodemailer = require('nodemailer');
const smtpPool = require('nodemailer-smtp-pool');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache'); // For caching
const zlib = require('zlib'); // For compression

const router = express.Router();

// SMTP configuration
const smtpConfig = {
  host: 'smtp.dreamhost.com',
  port: 465,
  secure: true,
  auth: {
    user: 'noreply@website-backend.email',
    pass: 'uSMmKhRv8j#ukUPy',
  },
  maxConnections: 5,
};

// Create a transporter using SMTP with connection pooling
const transporter = nodemailer.createTransport(smtpPool(smtpConfig));

// Apply rate limiting middleware
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
});

// Cache setup with a 10-minute TTL (adjust as needed)
const emailCache = new NodeCache({ stdTTL: 600 });

// Define an async function for sending emails
const sendEmail = async ({
  fromEmail,
  fromName,
  toEmail,
  toName,
  subject,
  text,
  html,
}) => {
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: `"${toName}" <${toEmail}>`,
    subject: subject,
    text: text,
    html: html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
    return { success: true, message: 'Email sent successfully' };
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Error sending email');
  }
};

// Define a route for sending emails with rate limiting
router.post('/send', limiter, async (req, res) => {
  const {
    fromEmail,
    fromName,
    toEmail,
    toName,
    subject,
    text,
    html,
  } = req.body;

  // Check if the email content is cached
  const cacheKey = `${toEmail}:${subject}:${text}:${html}`;
  const cachedResult = emailCache.get(cacheKey);

  if (cachedResult) {
    res.status(200).json(cachedResult);
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

      // Cache the result with a 10-minute TTL
      emailCache.set(cacheKey, result);

      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: 'Error sending email' });
    }
  }
});

module.exports = router;
