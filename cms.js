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

router.post('/page', async (req, res) => {
    try {
        const { page, post, site } = req.body; // Read page, post, and site from the request body
        const client = req.client; // MongoDB client is attached by authenticateClient middleware

        if (!site) {
            return res.status(400).json({ status: false, message: 'Site ID is required' });
        }

        if (!page) {
            return res.status(400).json({ status: false, message: 'Page is required' });
        }

        const { postCollection } = await getSiteSpecificDb(client, site);

        // Retrieve the page document
        const pageDoc = await postCollection.findOne({
            slug: page,
            owner: site,
            type: 'page',
            status: true,
        });

        if (!pageDoc) {
            return res.status(404).json({ status: false, message: 'Page not found' });
        }

        // If a specific post is requested
        if (typeof post === 'string' && post.trim() !== '') {
            const postDoc = await postCollection.findOne({
                slug: post,
                owner: site,
                parent: pageDoc._id.toString(),
                type: 'post',
                status: true,
            });

            if (!postDoc) {
                return res.status(404).json({ status: false, message: 'Post not found for the given page' });
            }

            // Retrieve the last 5 posts
            const lastPosts = await postCollection
                .find({
                    owner: site,
                    parent: pageDoc._id.toString(),
                    type: 'post',
                    status: true,
                })
                .sort({ createdAt: -1 }) // Assuming you have a `createdAt` field for sorting
                .limit(5)
                .toArray();

            // Return page, specific post, and last 5 posts
            return res.status(200).json({
                status: true,
                message: 'Data retrieved successfully',
                page: pageDoc,
                post: postDoc,
                last: lastPosts,
            });
        }

        // Check if the page's display is 'group'
        if (pageDoc.display === 'group') {
            // Retrieve all child posts
            const childPosts = await postCollection.find({
                owner: site,
                parent: pageDoc._id.toString(),
                type: 'post',
                status: true,
            }).toArray();

            return res.status(200).json({
                status: true,
                message: 'Page and group posts retrieved successfully',
                page: pageDoc,
                posts: childPosts,
            });
        }

        // Return only the page data if no post is requested
        return res.status(200).json({
            status: true,
            message: 'Page retrieved successfully',
            page: pageDoc,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: 'An error occurred while retrieving the data' });
    }
});


// Use error handling middleware
router.use(errorHandler);

module.exports = router;
