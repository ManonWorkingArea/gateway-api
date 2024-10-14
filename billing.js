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

// Endpoint to handle billing subscriptions
router.post('/subscribe', async (req, res) => {
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
      const { packageID, eventID, price } = req.body; // Expect packageID, eventID, and price in the request body
  
      if (!packageID || !eventID || !price) {
        return res.status(400).json({ status: false, message: 'Package ID, Event ID, and Price are required' });
      }
  
      // Save the billing data in the 'bill' collection
      const billCollection = db.collection('bill');
      const result = await billCollection.insertOne({
        userID: safeObjectId(user), // Use the user ID from the decoded JWT
        packageID: safeObjectId(packageID), // Ensure it's a valid ObjectID
        eventID: safeObjectId(eventID), // Ensure it's a valid ObjectID
        price: parseFloat(price), // Store the price as a float
        timestamp: new Date() // Store the current timestamp
      });
  
      return res.status(200).json({
        status: true,
        message: 'Subscription saved successfully',
        billID: result.insertedId // Return the newly created bill ID
      });
  
    } catch (error) {
      console.error('Error during subscription:', error);
      res.status(500).json({ status: false, message: 'An error occurred while saving the subscription' });
    }
  });
  

// Use error handling middleware
router.use(errorHandler);

module.exports = router;