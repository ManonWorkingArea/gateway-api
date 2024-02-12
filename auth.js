const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// Endpoint to handle LINE login redirection and code exchange
router.post('/line', async (req, res) => {
  const { code } = req.body;
  try {
    // Exchange the authorization code for an access token
    const response = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:8080/user/auth',
        client_id: '2003469499',
        client_secret: '1bf0da65b5a6b09eba0a045e73128026',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error_description || 'Failed to exchange code for token');
    }

    // Optionally, fetch user profile using the access token
    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: {
        'Authorization': `Bearer ${data.access_token}`,
      },
    });
    const userData = await profileResponse.json();

    res.json({ accessToken: data.access_token, userData });
  } catch (error) {
    console.error('LINE Login error:', error);
    res.status(500).json({ error: 'Internal server error during LINE login' });
  }
});

module.exports = router;
