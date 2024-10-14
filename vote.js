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

// Endpoint to handle vote transactions with token authentication
router.post('/submit', async (req, res) => {
  const token = req.headers['authorization'];
  if (!token) {
    return res.status(400).json({ status: false, message: 'Token is required' });
  }

  try {
    // Verify the token and extract the decoded data
    const decodedToken = await verifyToken(token.replace('Bearer ', ''));
    if (!decodedToken.status) {
      return res.status(401).json({ status: false, message: 'Invalid or expired token' });
    }

    const { user } = decodedToken.decoded; // Extract user ID from the token

    const { db } = req; // MongoDB connection is attached by authenticateClient middleware
    const { influencerId, score } = req.body; // Expect influencerId and score in the request body
    const { key } = req.query; // Extract 'key' from query parameters

    if (!influencerId || !score) {
      return res.status(400).json({ status: false, message: 'Influencer ID and score are required' });
    }

    // Create a new vote transaction with userID from the JWT token
    const voteTransactionCollection = db.collection('vote_transaction');
    await voteTransactionCollection.insertOne({
      influencerId: safeObjectId(influencerId),
      score: parseInt(score, 10), // Ensure score is an integer
      timestamp: new Date(),
      key, // Client key from the query
      userID: safeObjectId(user), // Include the user ID from the decoded JWT
    });

    // Calculate the total score for the influencer
    const totalScore = await voteTransactionCollection.aggregate([
      { $match: { influencerId: safeObjectId(influencerId) } },
      { $group: { _id: null, totalScore: { $sum: '$score' } } },  // Summing up the scores for all transactions
    ]).toArray();

    // Update the influencer's score in the vote_influencer collection
    const voteInfluencerCollection = db.collection('vote_influencer');
    await voteInfluencerCollection.updateOne(
      { _id: safeObjectId(influencerId) },  // Find the influencer by ID
      { $set: { score: totalScore[0]?.totalScore || 0 } }  // Update with the new total score
    );

    return res.status(200).json({
      status: true,
      message: 'Vote submitted and score updated',
      totalScore: totalScore[0]?.totalScore || 0,
    });
  } catch (error) {
    console.error('Error during vote submission:', error);
    res.status(500).json({ status: false, message: 'An error occurred while submitting the vote' });
  }
});

// Endpoint to recheck vote transactions with token authentication
router.get('/recheck', async (req, res) => {
  const token = req.headers['authorization'];
  if (!token) {
    return res.status(400).json({ status: false, message: 'Token is required' });
  }

  try {
    // Verify the token
    const decodedToken = await verifyToken(token.replace('Bearer ', ''));
    if (!decodedToken.status) {
      return res.status(401).json({ status: false, message: 'Invalid or expired token' });
    }

    const { influencerId } = req.query;
    if (!influencerId) {
      return res.status(400).json({ status: false, message: 'Influencer ID is required' });
    }

    // Get the total score for the influencer
    const voteTransactionCollection = req.db.collection('vote_transaction');
    const totalScore = await voteTransactionCollection.aggregate([
      { $match: { influencerId: safeObjectId(influencerId) } },
      { $group: { _id: null, totalScore: { $sum: '$score' } } }
    ]).toArray();

    return res.status(200).json({
      status: true,
      message: 'Vote transactions fetched successfully',
      totalScore: totalScore[0]?.totalScore || 0,
    });
  } catch (error) {
    console.error('Error during vote recheck:', error);
    res.status(500).json({ status: false, message: 'An error occurred during vote recheck' });
  }
});

// Use error handling middleware
router.use(errorHandler);

module.exports = router;