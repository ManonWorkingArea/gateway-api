const express       = require('express');
const nodemailer    = require('nodemailer');
const router        = express.Router();

// SMTP configuration
const smtpConfig = {
  host: 'smtp.dreamhost.com',
  port: 465,
  secure: true, // Use SSL/TLS
  auth: {
    user: 'noreply@website-backend.email',
    pass: 'uSMmKhRv8j#ukUPy',
  },
};

// Create a transporter using the SMTP configuration
const transporter = nodemailer.createTransport(smtpConfig);

// Define a route for sending emails
router.post('/send', (req, res) => {
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
      res.status(500).json({ error: 'Error sending email' });
    } else {
      console.log('Email sent:', info.response);
      res.status(200).json({ message: 'Email sent successfully' });
    }
  });
});

module.exports = router;
