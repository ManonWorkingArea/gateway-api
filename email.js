// Import required libraries and modules as needed
const express = require('express');
const nodemailer = require('nodemailer');
const smtpPool = require('nodemailer-smtp-pool');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache'); // For caching
const zlib = require('zlib'); // For compression

// Import the MongoClient class from the 'mongodb' library
const { MongoClient } = require('mongodb');

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
  max: 100,
});

// Cache setup with a 10-minute TTL (adjust as needed)
const emailCache = new NodeCache({ stdTTL: 600 });

// Define an async function for sending emails
async function sendEmail({
  fromEmail,
  fromName,
  toEmail,
  toName,
  subject,
  text,
  html,
}) {
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: `"${toName}" <${toEmail}>`,
    subject: subject,
    text: text,
    html: html,
  };

  console.log('Email Data:', mailOptions);

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
    return { success: true, message: 'Email sent successfully' };
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Error sending email');
  }
}

// Define a function for adding log data to the queue (MongoDB)
async function addToLogQueue(logData) {
  const mongoClient = new MongoClient(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await mongoClient.connect();
    const db = mongoClient.db('API');
    const queueCollection = db.collection('queue');
    const result = await queueCollection.insertOne(logData);
    return result;
  } catch (err) {
    console.error('Failed to insert log data into the queue', err);
    throw err;
  } finally {
    await mongoClient.close();
  }
}

// Define a function for adding email data to the queue
async function addToEmailQueue(emailData, logData) {
  const emailQueue = new NodeCache({ stdTTL: 600 }); // Adjust the TTL as needed

  try {
    // Check if the email content is already in the queue
    const cacheKey = `${emailData.toEmail}:${emailData.subject}:${emailData.text}:${emailData.html}`;
    const cachedResult = emailQueue.get(cacheKey);

    if (cachedResult) {
      return cachedResult;
    }

    // Add the email data to the queue (you may need to adjust the implementation here)
    // For example, you can push the emailData object into an array or save it to a database
    // For demonstration purposes, we'll simulate adding it to an array
    const emailQueueArray = emailQueue.get('emailQueue') || [];
    emailQueueArray.push(emailData);
    emailQueue.set('emailQueue', emailQueueArray);

    // Now, also add the logData to the log queue (MongoDB)
    await addToLogQueue(logData);

    return { success: true, message: 'Email added to the queue' };
  } catch (error) {
    console.error('Error adding email to the queue:', error);
    throw new Error('Error adding email to the queue');
  }
}

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

      // Create logData for the request
      const logData = {
        client: {
          token: req.headers['client-token-key'],
        },
        request: {
          url: req.url,
          baseUrl: req.baseUrl,
          method: "EMAIL",
          parameters: req.params,
          query: req.body,
          optional: null,
        },
        agent: {
          userAgent: req.headers['user-agent'],
          ip: req.ip,
        },
        status: 'wait',
        type: 'log',
      };

      // Parse user-agent and add OS and browser information to logData
      const useragent = require('useragent');
      const agent = useragent.parse(logData.agent.userAgent);
      logData.agent.os = agent.os.toString();
      logData.agent.browser = agent.toAgent();

      // Include request body data for certain HTTP methods
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        logData.agent.requestBodyData = req.body;
      }

      // Add email data to the email queue and log data to the log queue (MongoDB)
      await addToEmailQueue({
        toEmail,
        subject,
        text,
        html,
      }, logData);

      // Cache the result with a 10-minute TTL
      emailCache.set(cacheKey, result);

      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: 'Error sending email' });
    }
  }
});

module.exports = router;
