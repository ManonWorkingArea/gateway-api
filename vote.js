const express = require('express');
const { authenticateClient, safeObjectId, errorHandler } = require('./middleware/mongoMiddleware'); // Middleware imports
const router = express.Router();

// Use authenticateClient to manage MongoDB connection based on the client key
router.use(authenticateClient);

// Endpoint to handle vote transactions
router.post('/submit', async (req, res) => {
  try {
    const { db } = req; // MongoDB connection is attached by authenticateClient middleware
    const { influencerId, score } = req.body; // Expect the influencerId and score in the request body
    const { key } = req.query; // Extract 'key' from query parameters

    if (!influencerId || !score) {
      return res.status(400).json({ status: false, message: 'Influencer ID and score are required' });
    }

    // Create a new vote transaction
    const voteTransactionCollection = db.collection('vote_transaction');
    await voteTransactionCollection.insertOne({
      influencerId: safeObjectId(influencerId),
      score: parseInt(score, 10), // Ensure score is an integer
      timestamp: new Date(),
      key, // Client key from the query
    });

    // Calculate the total score for the influencer
    const totalScore = await voteTransactionCollection.aggregate([
      { $match: { influencerId: safeObjectId(influencerId) } },
      { $group: { _id: null, totalScore: { $sum: '$score' } } },
    ]).toArray();

    // Update the influencer's score in the vote_influencer collection
    const voteInfluencerCollection = db.collection('vote_influencer');
    await voteInfluencerCollection.updateOne(
      { _id: safeObjectId(influencerId) },
      { $set: { score: totalScore[0]?.totalScore || 0 } }
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

// Recheck vote transactions (similar to /recheck)
router.get('/recheck', async (req, res) => {
  const { influencerId } = req.query;
  
  if (!influencerId) {
    return res.status(400).json({ status: false, message: 'Influencer ID is required' });
  }

  try {
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
