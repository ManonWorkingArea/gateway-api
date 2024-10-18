const express = require('express');
const fetch = require('node-fetch'); // To make HTTP requests
const NodeCache = require('node-cache'); // For caching

const router = express.Router();

// CloudMailin API configuration
const EMAIL_ENDPOINT_URL = "https://api.cloudmailin.com/api/v0.1/4c9506dea731b2f9/messages";
const EMAIL_TOKEN_KEY = "JBu4oxNQ3b5AZ55gSN3mvtRt";
const TEST_MODE = false; // Toggle test mode as needed

// Cache setup with a 10-minute TTL (adjust as needed)
const emailCache = new NodeCache({ stdTTL: 600 });

// Define an async function for sending emails using CloudMailin API
async function sendEmail({ from, to, subject, plain, html, attachments }) {
  const emailData = {
    from,
    to,
    test_mode: TEST_MODE,
    subject,
    plain,
    html,
    attachments, // Include attachments if provided
  };

  try {
    const response = await fetch(EMAIL_ENDPOINT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${EMAIL_TOKEN_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Email sent:', data.id);
      return { status: true, message: 'Email sent successfully', messageId: data.id };
    } else {
      const errorText = await response.text();
      console.error('Error sending email:', errorText);
      return { status: false, message: 'Error sending email', error: errorText };
    }
  } catch (error) {
    console.error('Error sending email:', error);
    return { status: false, message: 'Error sending email', error: error.message };
  }
}

// Define a route for sending emails with caching to prevent duplicates
router.post('/send', async (req, res) => {
  const { from, to, subject, plain, html, attachments } = req.body;

  // Check if all required fields are present
  if (!from || !to || !subject || !plain || !html) {
    return res.status(400).json({ error: 'Missing required fields: from, to, subject, plain, html' });
  }

  // Construct cache key from request parameters to prevent duplicate emails being sent
  const cacheKey = `${to}:${subject}:${plain}:${html}:${JSON.stringify(attachments)}`;
  const cachedResult = emailCache.get(cacheKey);

  if (cachedResult) {
    return res.status(200).json(cachedResult);
  } else {
    try {
      const result = await sendEmail({
        from,
        to,
        subject,
        plain,
        html,
        attachments, // Pass attachments to the sendEmail function
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
