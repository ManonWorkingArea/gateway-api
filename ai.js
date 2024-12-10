const express = require('express');
const fetch = require('node-fetch');

const router = express.Router();

// Function to process the image with a prompt
const processImageWithPrompt = async (imageBase64, prompt) => {
    const apiKey = "AIzaSyB_DNNNAbBpaQ41rKHgDeL-zzGpQmjcRH4"; // Replace with your actual API key
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-pro:analyzeImage?key=${apiKey}`;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const body = JSON.stringify({
    image: { content: imageBase64 },
    prompt: { text: prompt },
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    const data = await response.json();
    if (response.ok) {
      return data.result || "Sorry, I couldn't process the image.";
    } else {
      console.error("Error processing image:", data);
      return "Sorry, I couldn't process the image.";
    }
  } catch (error) {
    console.error("Network error processing image:", error);
    return "Sorry, I couldn't process the image.";
  }
};

// Define /ai POST endpoint
router.post('/', async (req, res) => {
  const { imageBase64, prompt } = req.body;

  if (!imageBase64 || !prompt) {
    return res.status(400).json({
      error: "Both 'imageBase64' and 'prompt' fields are required.",
    });
  }

  try {
    const result = await processImageWithPrompt(imageBase64, prompt);
    res.status(200).json({ result });
  } catch (error) {
    console.error("Error in /ai endpoint:", error);
    res.status(500).json({ error: "An error occurred while processing the image." });
  }
});

module.exports = router;
