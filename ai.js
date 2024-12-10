const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// Function to upload image to Gemini and get the file URI
const uploadImageToGemini = async (imageUrl, apiKey) => {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image. Status: ${response.status}`);
    }

    const imageBuffer = await response.buffer();
    const uploadResponse = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: imageBuffer,
    });

    const uploadData = await uploadResponse.json();
    if (uploadResponse.ok) {
      return uploadData.file.uri; // Extract the file URI
    } else {
      console.error("Error uploading image to Gemini:", uploadData);
      throw new Error("Failed to upload image to Gemini.");
    }
  } catch (error) {
    console.error("Error in uploadImageToGemini:", error);
    throw error;
  }
};

// Function to generate content using the file URI
const generateContentWithFileUri = async (fileUri, prompt, apiKey) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
          { fileData: { mimeType: 'image/jpeg', fileUri } },
        ],
      },
    ],
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const data = await response.json();
    if (response.ok) {
      return data.result || "Sorry, I couldn't process the image.";
    } else {
      console.error("Error generating content with file URI:", data);
      return "Sorry, I couldn't generate content from the image.";
    }
  } catch (error) {
    console.error("Network error generating content:", error);
    return "Sorry, I couldn't generate content from the image.";
  }
};

// Define /ai POST endpoint
router.post('/', async (req, res) => {
  const { imageUrl, prompt } = req.body;
  const apiKey = "AIzaSyB_DNNNAbBpaQ41rKHgDeL-zzGpQmjcRH4"; // Replace with your actual API key

  if (!imageUrl || !prompt) {
    return res.status(400).json({
      error: "Both 'imageUrl' and 'prompt' fields are required.",
    });
  }

  try {
    // Step 1: Upload the image to Gemini and get the URI
    const fileUri = await uploadImageToGemini(imageUrl, apiKey);

    // Step 2: Use the file URI to generate content
    const result = await generateContentWithFileUri(fileUri, prompt, apiKey);

    res.status(200).json({ result });
  } catch (error) {
    console.error("Error in /ai endpoint:", error);
    res.status(500).json({ error: "An error occurred while processing the image." });
  }
});

module.exports = router;
