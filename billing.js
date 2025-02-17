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
        packageID: packageID, // Ensure it's a valid ObjectID
        eventID: safeObjectId(eventID), // Ensure it's a valid ObjectID
        price: parseFloat(price), // Store the price as a float
        status: 'pending',
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


  // New endpoint to get the billing data by billID with userID from the auth token
router.post('/filter', async (req, res) => {
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
  
      const { db } = req; // MongoDB connection is attached by authenticateClient middleware
      const { billID } = req.body; // Extract billID from the request body
  
      // Extract userID from the decoded token
      const { user } = decodedToken.decoded; // Extract user ID from the token
  
      if (!billID) {
        return res.status(400).json({ status: false, message: 'billID is required' });
      }
  
      // Use aggregate to find the bill by _id and userID
      const billCollection = db.collection('bill');
      const bill = await billCollection.aggregate([
        {
          $match: {
            _id: safeObjectId(billID), // Match the billID
            userID: safeObjectId(user) // Match the userID from the token
          }
        },
        {
          $lookup: {
            from: 'users', // Assuming 'users' collection holds user information
            localField: 'userID',
            foreignField: '_id',
            as: 'userDetails'
          }
        },
        {
          $unwind: {
            path: '$userDetails',
            preserveNullAndEmptyArrays: true // Include the bill even if no user details are found
          }
        }
      ]).toArray();
  
      if (bill.length === 0) {
        return res.status(404).json({ status: false, message: 'Bill not found' + userID });
      }
  
      return res.status(200).json({
        status: true,
        message: 'Bill retrieved successfully',
        bill: bill[0] // Return the first (and only) result from the aggregation
      });
    } catch (error) {
      console.error('Error retrieving bill:', error);
      res.status(500).json({ status: false, message: 'An error occurred while retrieving the bill' });
    }
  });

 // Endpoint to update bill data after verification and update wallet balance
router.post('/update', async (req, res) => {
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
      const { billID, transaction } = req.body; // Expect billID and transaction details in the request body
  
      if (!billID || !transaction) {
        return res.status(400).json({ status: false, message: 'Bill ID and transaction details are required' });
      }
  
      const { db } = req; // MongoDB connection is attached by authenticateClient middleware
      const billCollection = db.collection('bill');
      const walletCollection = db.collection('wallet');
      const walletTransactionCollection = db.collection('wallet_transaction');
  
      // Update the bill with the transaction data
      const result = await billCollection.updateOne(
        {
          _id: safeObjectId(billID), // Match the bill by its ID
          userID: safeObjectId(user) // Ensure the bill belongs to the authenticated user
        },
        {
          $set: {
            'transaction.success': transaction.transaction.success,
            'transaction.transRef': transaction.transaction.transRef,
            'transaction.transDate': transaction.transaction.transDate,
            'transaction.transTime': transaction.transaction.transTime,
  
            'sender.displayName': transaction.sender.displayName,
            'sender.name': transaction.sender.name,
  
            'receiver.displayName': transaction.receiver.displayName,
            'receiver.name': transaction.receiver.name,
  
            'bill.amount': transaction.bill.amount,
            'bill.qrcodeData': transaction.bill.qrcodeData,
            'bill.slip': transaction.slipUrl,
            'status': 'confirm',
            updatedAt: new Date() // Optionally update a timestamp for when the document was modified
          }
        }
      );
  
      if (result.matchedCount === 0) {
        return res.status(404).json({ status: false, message: 'Bill not found or user not authorized' });
      }
  
      // Retrieve the user's wallet
      let wallet = await walletCollection.findOne({ userID: safeObjectId(user) });
  
      if (!wallet) {
        return res.status(404).json({ status: false, message: 'Wallet not found' });
      }
  
      const balanceBefore = wallet.balance;
      const amountToIncrease = parseFloat(transaction.bill.amount);
      const updatedBalance = balanceBefore + amountToIncrease;
  
      // Update the wallet balance
      await walletCollection.updateOne(
        { userID: safeObjectId(user) },
        { $set: { balance: updatedBalance, updatedAt: new Date() } }
      );
  
      // Log the wallet transaction
      await walletTransactionCollection.insertOne({
        userID: safeObjectId(user),
        action: 'increase',
        amount: amountToIncrease,
        balanceBefore: balanceBefore,
        balanceAfter: updatedBalance,
        timestamp: new Date(),
      });
  
      return res.status(200).json({
        status: true,
        message: 'Bill updated and wallet balance increased successfully',
        updatedCount: result.modifiedCount,
        newBalance: updatedBalance,
      });
  
    } catch (error) {
      console.error('Error updating bill and wallet:', error);
      res.status(500).json({ status: false, message: 'An error occurred while updating the bill and wallet' });
    }
  });
  
// Endpoint to check if qrcodeData exists in the bill collection
router.post('/check_qrcode', async (req, res) => {
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
  
      const { db } = req; // MongoDB connection is attached by authenticateClient middleware
      const { qrcodeData } = req.body; // Extract qrcodeData from the request body
  
      if (!qrcodeData) {
        return res.status(400).json({ status: false, message: 'QR code data is required' });
      }
  
      // Query the bill collection to check if qrcodeData exists
      const billCollection = db.collection('bill');
      const existingBill = await billCollection.findOne({ 'bill.qrcodeData': qrcodeData });
  
      if (existingBill) {
        // If the QR code exists in the bill collection
        return res.status(200).json({
          status: true,
          message: 'QR code data already exists in the bill collection',
          billID: existingBill._id // Return the bill ID if found
        });
      }
  
      // If no bill is found with the same QR code data, return status false but with a 200 status code
      return res.status(200).json({
        status: false,
        message: 'QR code data does not exist in the bill collection'
      });
  
    } catch (error) {
      console.error('Error checking QR code:', error);
      res.status(500).json({ status: false, message: 'An error occurred while checking the QR code' });
    }
  });
  
  
  
  
  
  

// Use error handling middleware
router.use(errorHandler);

module.exports = router;