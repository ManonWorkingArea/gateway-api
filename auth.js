const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// Replace 'Your_Channel_Access_Token_Here' with your actual LINE Messaging API Channel Access Token.
// In a production environment, it's important to store this token securely, e.g., in environment variables or a secret manager.
const CHANNEL_ACCESS_TOKEN = '3e4256c1c7fb0f88429a58a86def8f62';

// Helper function to send messages using the LINE Messaging API
const sendMessage = async (userId, messageText) => {
  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
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
  const { code } = req.body;
  try {
    // Exchange the authorization code for an access token
    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:8080/user/auth',
        client_id: '2003469499', // Replace with your LINE Login Channel ID
        client_secret: '1bf0da65b5a6b09eba0a045e73128026', // Replace with your LINE Login Channel Secret
        // The code_verifier is necessary if you're using PKCE. Otherwise, omit it.
        // code_verifier: 'your_code_verifier_here',
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
    const welcomeMessage = "Welcome to our service! Glad to have you on board.";
    await sendMessage(userData.userId, welcomeMessage);

    res.json({ accessToken: tokenData.access_token, userData, message: "Welcome message sent." });
  } catch (error) {
    console.error('LINE Login error:', error);
    res.status(500).json({ error: 'Internal server error during LINE login or messaging' });
  }
});

module.exports = router;
