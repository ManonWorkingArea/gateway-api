const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware'); // Import your middleware

const router = express.Router();

// Secret key for signing JWT (You should store this securely)
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn'; // Replace with your own secret key

// Use authenticateClient to manage the MongoDB connection based on the client key
router.use(authenticateClient);

// Function to verify the token
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

/**
 * Helper function to get site-specific database and collection
 * @param {Object} client - MongoDB client from middleware
 * @param {String} site - Site ID
 * @returns {Object} - { db, postCollection, siteData }
 * @throws {Error} - If the site is invalid or not found
 */
async function getSiteSpecificDb(client, site) {
  const apiDb = client.db('API'); // Connect to the API database
  const siteCollection = apiDb.collection('hostname'); // Reference the hostname collection

  // Fetch the site data by site ID
  const siteData = await siteCollection.findOne({ _id: safeObjectId(site) });
  if (!siteData) {
    throw new Error(`Invalid site ID. Site not found: ${site}`);
  }

  // Use the site data to determine the target database
  const targetDb = client.db(siteData.key); // Connect to the site-specific database
  const postCollection = targetDb.collection('post'); // Reference the post collection

  return { db: targetDb, postCollection, siteData };
}

router.post('/retrieve', async (req, res) => {
    try {
      console.log('[DEBUG] Incoming request:', req.body); // Log the incoming request
  
      const { slug, site } = req.body; // Read slug and site from the request body
      const client = req.client; // MongoDB client is attached by authenticateClient middleware
  
      if (!site) {
        console.error('[ERROR] Site ID is missing in the request body.');
        return res.status(400).json({ status: false, message: 'Site ID is required' });
      }
      console.log('[DEBUG] Site ID:', site);
  
      // Fetch site-specific database and post collection
      console.log('[DEBUG] Fetching site-specific database...');
      const { postCollection } = await getSiteSpecificDb(client, site);
      console.log('[DEBUG] Successfully fetched postCollection.');
  
      if (slug) {
        console.log('[DEBUG] Slug provided. Attempting to retrieve specific post...');
        // Retrieve a specific post by slug, owner, type, and status
        const post = await postCollection.findOne({
          slug,
          owner: site,
          type: 'page',
          status: true,
        });
        console.log('[DEBUG] Query for specific post executed.');
  
        if (!post) {
          console.warn('[WARN] No post found with the provided slug:', slug);
          // Explicitly set 404 status for not found
          return res.status(404).json({ status: false, message: 'Post not found' });
        }
  
        console.log('[DEBUG] Post retrieved successfully:', post);
        return res.status(200).json({ status: true, message: 'Post retrieved successfully', post });
      }
  
      console.log('[DEBUG] No slug provided. Retrieving all posts...');
      // Retrieve all posts with owner, type, and status
      const posts = await postCollection
        .find({
          owner: site,
          type: 'page',
          status: true,
        })
        .toArray();
  
      if (posts.length === 0) {
        console.warn('[WARN] No posts found for site:', site);
        // Explicitly set 404 status for empty list
        return res.status(404).json({ status: false, message: 'No posts found' });
      }
  
      console.log('[DEBUG] Query for all posts executed. Posts retrieved:', posts.length);
      res.status(200).json({ status: true, message: 'Posts retrieved successfully', posts });
    } catch (error) {
      console.error('[ERROR] Error retrieving posts:', error);
      res.status(500).json({ status: false, message: 'An error occurred while retrieving posts' });
    }
  });
  
// Use error handling middleware
router.use(errorHandler);

module.exports = router;
