const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// Function to process document using APYHub API
const processDocumentWithAPYHub = async (documentUrl) => {
  const apyToken = "APT0X8e7iHihh08ipsaIRCOw9Z7e9HDNL8gZITVcdeZthplIS3sIjq"; // Replace with your actual APYHub token
  const body = JSON.stringify({
    url: documentUrl,
    requested_service: "apyhub",
  });

  try {
    const response = await fetch("https://api.apyhub.com/ai/document/extract/invoice/url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apy-token": apyToken,
      },
      body,
    });

    const data = await response.json();
    if (response.ok) {
      return data; // Return the extracted data
    } else {
      console.error("Error processing document with APYHub:", data);
      throw new Error("Failed to process document with APYHub.");
    }
  } catch (error) {
    console.error("Network error processing document:", error);
    throw error;
  }
};

// Define /ai POST endpoint
router.post('/', async (req, res) => {
  const { documentUrl } = req.body;

  if (!documentUrl) {
    return res.status(400).json({
      error: "Field 'documentUrl' is required.",
    });
  }

  try {
    // Process the document with APYHub
    const result = await processDocumentWithAPYHub(documentUrl);

    res.status(200).json({ result });
  } catch (error) {
    console.error("Error in /ai endpoint:", error);
    res.status(500).json({ error: "An error occurred while processing the document." });
  }
});

module.exports = router;
