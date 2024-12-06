const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware'); // Import your middleware

const router = express.Router();

// Secret key for signing JWT (Store securely in env variables for production)
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn'; // Replace with your own secret key

// Use authenticateClient to manage the MongoDB connection
router.use(authenticateClient);

// Function to verify the JWT token
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
 * Helper function to get the appropriate database and collection
 * @param {Object} client - MongoDB client
 * @param {String} site - Site ID
 * @returns {Object} - { db, userCollection, enrollCollection }
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
    const userCollection = targetDb.collection('user'); // Reference the user collection
    const enrollCollection = targetDb.collection('enroll'); // Reference the enroll collection
    const courseCollection = targetDb.collection('course'); // Reference the course collection

    return { userCollection, enrollCollection, courseCollection };
}


// Certification search endpoint
router.post('/search', async (req, res) => {
    try {
        const { keyword, site } = req.body;

        if (!site) {
            return res.status(400).json({ status: false, message: 'Site ID is required' });
        }

        if (!keyword || keyword.trim() === '') {
            return res.status(400).json({ status: false, message: 'Keyword is required for search' });
        }

        const client = req.client;
        const { userCollection, enrollCollection, courseCollection } = await getSiteSpecificDb(client, site);

        // Search for a single user matching the keyword
        const userQuery = {
            $or: [
                { citizen: { $regex: keyword, $options: 'i' } },
                { phone: { $regex: keyword, $options: 'i' } },
                { email: { $regex: keyword, $options: 'i' } },
                { username: { $regex: keyword, $options: 'i' } },
            ],
        };

        const user = await userCollection.findOne(userQuery);

        if (!user) {
            return res.status(404).json({ status: false, message: 'User not found' });
        }

        // Fetch enrollments for the user
        const enrollments = await enrollCollection.find({ userID: user._id.toString() }).toArray();

        // Fetch course details for each enrollment
        const courseIds = enrollments.map((enroll) => enroll.courseID);
        const courses = await courseCollection
            .find({ _id: { $in: courseIds.map((id) => safeObjectId(id)) } })
            .toArray();

        // Add course details to each enrollment
        const enrichedEnrollments = enrollments.map((enroll) => {
            const course = courses.find((c) => c._id.toString() === enroll.courseID);
            return { ...enroll, course };
        });

        // Map enrollments to the user data
        const userWithEnrollments = { ...user, enrollments: enrichedEnrollments };

        return res.status(200).json({
            status: true,
            message: 'User and enrollments with course details retrieved successfully',
            data: userWithEnrollments,
        });
    } catch (error) {
        console.error('Error in /search endpoint:', error);
        return res.status(500).json({
            status: false,
            message: 'An error occurred while processing the request',
        });
    }
});


// Error handling middleware
router.use(errorHandler);

module.exports = router;
