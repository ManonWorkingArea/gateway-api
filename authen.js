const express = require('express');
const CryptoJS = require('crypto-js');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const builderRender = require('./builderRender');
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware'); // Import your middleware

const axios = require('axios'); // For making HTTP requests

const router = express.Router();

// Secret key for signing JWT (You should store this securely)
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn'; // Replace with your own secret key

// Use authenticateClient to manage the MongoDB connection based on the client key
router.use(authenticateClient);

// Function to verify token
function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return reject({ status: false, message: 'Invalid or expired token' });
      }
      resolve({ status: true, message: 'Token is valid', decoded });
    });
  });
}

// Function to generate JWT with adjustable expiration time
function generateJWT(userResponse, key, rememberMe) {
  // Set token expiration based on the "Remember Me" flag
  const expiration = rememberMe ? '30d' : '24h'; // 30 days or 1 hour
  
  // JWT payload
  const data = {
    user: userResponse._id,   // User ID
    role: userResponse.role,  // User role
    site: key,                // Client key (from query parameter)
  };

  // Generate the JWT token
  const token = jwt.sign(data, JWT_SECRET, { expiresIn: expiration });

  return { token, data };
}

/**
 * Helper function to get site-specific database, user collection, and site data
 * @param {Object} client - MongoDB client
 * @param {String} site - Site ID
 * @returns {Object} - { targetDb, userCollection, siteData }
 * @throws {Error} - If site is invalid or not found
 */
async function getSiteSpecificDb(client, site) {
  // Connect to the 'API' database
  const apiDb = client.db('API');
  const siteCollection = apiDb.collection('hostname');

  // Fetch site data by site ID
  const siteData = await siteCollection.findOne({ _id: safeObjectId(site) });
  if (!siteData) {
    throw new Error(`Invalid site ID. Site not found: ${site}`);
  }

  // Use site data to determine the target database
  const targetDb = client.db(siteData.key); // Connect to the site-specific database
  const userCollection = targetDb.collection('user'); // Target user collection

  return { targetDb, userCollection, siteData };
}

// Function to retrieve hostname data from MongoDB
const getHostname = async (hostname) => {
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await mongoClient.connect();
    const db = mongoClient.db('API');
    const clientsCollection = db.collection('hostname');
    const clientData = await clientsCollection.findOne({ hostname });
    return clientData || null;
  } catch (error) {
    console.error('Error retrieving hostname:', error);
    throw error;
  }
};

// Helper function to send a message via LINE Messaging API
const sendMessage = async (channelAccessToken, userId, messageText) => {
  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [
          {
            type: 'text',
            text: messageText,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message);
    }

    console.log('Message sent successfully');
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
};
// Endpoint to handle LINE login callback and send a welcome message
router.post('/callback', async (req, res) => {
    const { code, site, host } = req.body;
  
    try {
      // Validate input
      if (!code || !site) {
        return res.status(400).json({ error: 'Code and site are required' });
      }
  
      // Get site-specific database, user collection, and site data
      const { client } = req; // MongoDB client from middleware
      const { siteData, userCollection } = await getSiteSpecificDb(client, host);
  
      // Exchange the authorization code for an access token
      const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: siteData.line.callback,
          client_id: siteData.line.client_id,
          client_secret: siteData.line.client_secret,
        }),
      });
  
      const tokenData = await tokenResponse.json();
  
      if (!tokenResponse.ok) {
        throw new Error(tokenData.error_description || 'Failed to exchange code for token');
      }
  
      // Fetch user profile using the access token
      const profileResponse = await fetch('https://api.line.me/v2/profile', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });
      const userData = await profileResponse.json();
  
      // Check if the user exists
      const existingUser = await userCollection.findOne({
        channel: 'line',
        userId: userData.userId,
      });
  
      let userResponse;
      if (!existingUser) {
        // If the user does not exist, register them with `active` status
        const newUser = {
          firstname: userData.displayName || 'Unknown',
          lastname: '',
          email: null,
          username: userData.userId,
          phone: null,
          password: null,
          salt: null,
          role: 'user',
          avatar_img: userData.pictureUrl || null,
          status: 'active',
          channel: 'line',
          userId: userData.userId,
          parent: site,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
  
        const result = await userCollection.insertOne(newUser);
        userResponse = { ...newUser, _id: result.insertedId };
      } else {
        userResponse = existingUser;
      }
  
      // Handle single-session login by removing any existing sessions
      const sessionCollection = client.db(siteData.key).collection('sessions');
      await sessionCollection.deleteOne({ userID: userResponse._id });
  
      // Generate JWT for the user
      const { token } = generateJWT(userResponse, siteData.key, false);
  
      // Save the new session in the database
      const newSession = {
        userID: userResponse._id,
        token,
        login: true,
        role: userResponse.role,
        channel: 'line',
        key: siteData.key,
        createdAt: new Date(),
      };
  
      await sessionCollection.insertOne(newSession);
  
      // Send a welcome message
      const welcomeMessage = `Welcome to ${siteData.siteName || 'our service'}!`;
      await sendMessage(siteData.line.channel_access_token, userData.userId, welcomeMessage);
  
      // Respond with session data, token, and user data
      res.status(200).json({
        success: true,
        token,
        userData: {
          username: userResponse.username,
          email: userResponse.email,
          role: userResponse.role,
          status: userResponse.status || 'active',
        },
        message: 'Welcome message sent successfully.',
      });
    } catch (error) {
      console.error('Error during LINE callback:', error);
      res.status(500).json({ error: 'An error occurred during LINE callback.' });
    }
  });
  
  

// Endpoint to send custom messages
router.post('/send-message', async (req, res) => {
  const { hostname, userId, messageText } = req.body;

  try {
    // Retrieve hostname data from MongoDB
    const hostnameData = await getHostname(hostname);

    if (!hostnameData) {
      return res.status(404).json({ error: 'Hostname not found' });
    }

    await sendMessage(hostnameData.line.channel_access_token, userId, messageText);

    res.json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
