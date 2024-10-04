// routes/verifySlip.js
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch'); // Use node-fetch to make API requests

// Function to call the verify-slip API
async function verifySlip(qrCodeData) {
  const apiUrl = 'https://api.slipok.com/api/line/apikey/30155';
  const authorizationKey = 'SLIPOKU15TREP'; // Replace with your actual API key

  const requestBody = {
    data: qrCodeData,
    log: true,
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'x-authorization': authorizationKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error('Error in API call:', error);
    return { success: false, message: 'Error verifying slip' };
  }
}

// Define the POST route to handle QR code data
router.post('/verify', async (req, res) => {
    const { data: qrCodeData, log } = req.body; // Access the data field
  
    if (!qrCodeData) {
      return res.status(400).json({ message: 'QR code data is required', requestBody: req.body });
    }
  
    try {
      const result = await verifySlip(qrCodeData); // Pass the data field (qrCodeData) to your verifySlip function
      if (result.success) {
        return res.status(200).json(result.data);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error verifying slip:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
  

module.exports = router;
