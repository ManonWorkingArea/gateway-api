const express = require('express');
const nodemailer = require('nodemailer');
const smtpPool = require('nodemailer-smtp-pool'); // For connection pooling
const rateLimit = require('express-rate-limit'); // For rate limiting
const router = express.Router();

// SMTP configuration
const smtpConfig = {
  host: 'smtp.dreamhost.com',
  port: 465,
  secure: true, // Use SSL/TLS
  auth: {
    user: 'noreply@website-backend.email',
    pass: 'uSMmKhRv8j#ukUPy',
  },
  maxConnections: 5, // Adjust the number of connections based on your server's capacity
};

// Create a transporter using SMTP with connection pooling
const transporter = nodemailer.createTransport(smtpPool(smtpConfig));

// Apply rate limiting middleware
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Adjust the maximum number of requests per minute
});

// Define a route for sending emails with rate limiting
router.post('/send', limiter, (req, res) => {
  const { to, subject, text, html } = req.body;

  // Email configuration
  const mailOptions = {
    from: 'noreply@website-backend.email',
    to: to,
    subject: subject,
    text: text,
    html: html,
  };

  // Send the email
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
      // Log the error and handle it appropriately
      res.status(500).json({ error: 'Error sending email' });
    } else {
      console.log('Email sent:', info.response);
      // Log successful email sending
      res.status(200).json({ message: 'Email sent successfully' });
    }
  });
});

module.exports = router;
