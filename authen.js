const express = require('express');
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');
const router = express.Router();

// MongoDB Connection URL
let mongoClient;

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
  const { code, hostname } = req.body;

  try {
    // Retrieve hostname data from MongoDB
    const hostnameData = await getHostname(hostname);

    if (!hostnameData) {
      return res.status(404).json({ error: 'Hostname not found' });
    }

    // Exchange the authorization code for an access token
    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: hostnameData.line.callback,
        client_id: hostnameData.line.client_id,
        client_secret: hostnameData.line.client_secret,
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

    // Send a welcome message
    const welcomeMessage = `Welcome back to ${hostnameData.siteName || 'our service'}!`;
    await sendMessage(hostnameData.line.channel_access_token, userData.userId, welcomeMessage);

    res.json({
      success: true,
      accessToken: tokenData.access_token,
      userData,
      message: 'Welcome message sent successfully',
    });
  } catch (error) {
    console.error('Error during LINE callback:', error);
    res.status(500).json({ error: 'Internal server error during LINE callback' });
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
