const express = require('express');
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');
const router = express.Router();

// Replace 'Your_Channel_Access_Token_Here' with your actual LINE Messaging API Channel Access Token.
// In a production environment, it's important to store this token securely, e.g., in environment variables or a secret manager.
const CHANNEL_ACCESS_TOKEN = 'FbfaYJGWQHpGXAoYTvrkhIFr60h6qzBjoFWAP+tQ643Sh6dlY3+fqv1v1JX4UiFSW0kEuw7MipxJBj0W76VEzMx68KLAYmPNoomgnNiLNC9p2dXYHp8yESo5ARQMBdL3+mMQXp8uaLvBH/401XCCwgdB04t89/1O/w1cDnyilFU=';
// MongoDB Connection URL
// Connection pool to reuse MongoClient instances
let mongoClient;
// Function to retrieve hostname from MongoDB
const getHostname = async (hostname) => {
    try {
        mongoClient = new MongoClient(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
        await mongoClient.connect();
        const db = mongoClient.db('API');
        const clientsCollection = db.collection('hostname');
        const clientData = await clientsCollection.findOne({ hostname });
        if (clientData) {
            return clientData;
        }
        return null;
    } catch (error) {
      console.error('Error retrieving hostname:', error);
      throw error;
    }
  };

// Helper function to send messages using the LINE Messaging API
const sendMessage = async (channel_access_token, userId, messageText) => {
  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channel_access_token}`,
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
    throw error; // Depending on your use case, you might want to handle this error differently.
  }
};

// Endpoint to handle LINE login redirection and code exchange
router.post('/line', async (req, res) => {
  const { code, hostname } = req.body;

  try {
    // Get hostname data from MongoDB
    const hostnameData = await getHostname(hostname);

    console.log("hostnameData",hostnameData);

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
        client_id: hostnameData.line.client_id, // Replace with your LINE Login Channel ID
        client_secret: hostnameData.line.client_secret, // Replace with your LINE Login Channel Secret
        code_verifier: hostnameData.line.code_verifier,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(tokenData.error_description || 'Failed to exchange code for token');
    }

    // Fetch user profile using the access token
    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });
    const userData = await profileResponse.json();

     // Send a welcome message to the user
     const welcomeMessage = `Welcome to our service, ${hostnameData ? hostnameData.siteName : 'Guest'}!`;
     await sendMessage(hostnameData.line.channel_access_token, userData.userId, welcomeMessage);

    res.json({ accessToken: tokenData.access_token, userData, message: "Welcome message sent." });
  } catch (error) {
    console.error('LINE Login error:', error);
    res.status(500).json({ error: 'Internal server error during LINE login or messaging' });
  }
});

// New endpoint to send a message
router.post('/send-message', async (req, res) => {
    const { hostname, userId, messageText } = req.body;
  
    try {
        // Get hostname data from MongoDB
        const hostnameData = await getHostname(hostname);

        const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${hostnameData.line.channel_access_token}`,
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
    
        res.json({ success: true, message: 'Message sent successfully.' });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ success: false, error: 'Failed to send message.' });
    }
  });

module.exports = router;
