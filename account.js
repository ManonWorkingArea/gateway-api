const express = require('express');
const CryptoJS = require('crypto-js');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware'); // Import your middleware

const router = express.Router();

// Secret key for signing JWT (You should store this securely)
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn'; // Replace with your own secret key

// Use authenticateClient to manage the MongoDB connection based on the client key
router.use(authenticateClient);

// Function to verify token
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

// Function to generate JWT with adjustable expiration time
function generateJWT(userResponse, key, rememberMe) {
  // Set token expiration based on the "Remember Me" flag
  const expiration = rememberMe ? '30d' : '1h'; // 30 days or 1 hour
  
  // JWT payload
  const data = {
    user: userResponse._id,   // User ID
    role: userResponse.role,  // User role
    site: key,                // Client key (from query parameter)
  };

  // Generate the JWT token
  const token = jwt.sign(data, JWT_SECRET, { expiresIn: expiration });

  return { token, data };
}

router.post('/login', async (req, res) => {
  try {
    const { db } = req; // MongoDB connection is attached by authenticateClient middleware
    const { username, password, rememberMe } = req.body; // Get "rememberMe" flag from request body
    const { key } = req.query; // Extract 'key' from query parameters

    if (!username || !password) {
      return res.status(400).json({ status: false, message: 'Username and password are required' });
    }

    // Find the user in the database
    const collection = db.collection('user'); // Adjust the collection name if necessary
    const userQuery = { username }; // Simplified user query
    const userResponse = await collection.findOne(userQuery);

    if (!userResponse) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Validate password
    const salt = userResponse.salt;
    const inputHash = CryptoJS.SHA256(password + salt).toString();
    const storedHash = userResponse.password;

    if (inputHash !== storedHash) {
      return res.status(401).json({ status: false, message: 'Invalid username or password' });
    }

    // Check user role
    if (userResponse.role !== 'user') {
      return res.status(403).json({ status: false, message: 'Unauthorized to access this site' });
    }

    // Get User Enroll (if necessary)
    const enrollCollection = db.collection('enroll');
    const enrollments = await enrollCollection.find({ userID: userResponse._id }).toArray();

    // Handle single-session login by removing any existing sessions
    const sessionCollection = db.collection('sessions');
    await sessionCollection.deleteOne({ userID: userResponse._id });

    // Generate JWT with "Remember Me" handling
    const { token, data } = generateJWT(userResponse, key, rememberMe);

    // Prepare new session data
    const newSession = {
      userID: userResponse._id,
      token,
      login: true,
      role: userResponse.role,
      enrollments,
      channel: 'web',
      key, // Include 'key' in session
      createdAt: new Date(),
    };

    // Save the new session in the database
    await sessionCollection.insertOne(newSession);

    // Respond with session data and the JWT token
    res.status(200).json({
      status: true,
      message: 'Signin successful',
      token,
    });

  } catch (error) {
    console.error('Error during sign-in:', error);
    res.status(500).json({ status: false, message: 'An error occurred during sign-in' });
  }
});

// Endpoint to check session validity
router.get('/recheck', async (req, res) => {
  const token = req.headers['authorization'];
  if (!token) {
    return res.status(400).json({ status: false, message: 'Token is required' });
  }

  try {
    // Verify token without regenerating/removing the session
    const decodedToken = await verifyToken(token); // Decode the token
    if (!decodedToken.status) {
      return res.status(401).json({ status: false, message: 'Invalid or expired token' });
    }

    const { user, expire } = decodedToken.decoded;

    // Check if the session exists in the database
    const sessionCollection = req.db.collection('sessions');
    const session = await sessionCollection.findOne({ userID: safeObjectId(user), token });

    if (!session) {
      return res.status(401).json({ status: false, message: 'Session not found or invalid' });
    }

    // Respond with session data and decoded token information
    res.status(200).json({
      status: true,
      message: 'Session is valid',
      session,
      tokenData: decodedToken.decoded, // Include token data in the response
    });

  } catch (error) {
    console.error('Error during session check:', error);
    res.status(500).json({ status: false, message: 'An error occurred during session check' });
  }
});

// Endpoint to refresh JWT token and regenerate session data
router.get('/refresh', async (req, res) => {
  const token = req.headers['authorization'];

  if (!token) {
    return res.status(400).json({ status: false, message: 'Token is required' });
  }

  try {
    // Verify the current token
    const decodedToken = await verifyToken(token);
    if (!decodedToken.status) {
      return res.status(401).json({ status: false, message: 'Invalid or expired token' });
    }

    const { user } = decodedToken.decoded; // Extract user from the decoded token

    // Check if the session exists in the database
    const sessionCollection = req.db.collection('sessions');
    const session = await sessionCollection.findOne({ userID: safeObjectId(user), token });

    if (!session) {
      return res.status(401).json({ status: false, message: 'Session not found or invalid' });
    }

    // Extract the userID and site (key) from session
    const userID = session.userID.$oid || session.userID; // Handle MongoDB BSON format
    const site = session.key; // Use 'key' from session as 'site'

    // Prepare user data for JWT regeneration
    const userResponse = {
      _id: userID,         // Use the extracted userID
      role: session.role,  // Use the role from the session
    };

    // Generate a new JWT token with the existing session data
    const { token: newToken, data } = generateJWT(userResponse, site); // 'site' is the key

    // Update the session with the new token
    await sessionCollection.updateOne(
      { userID: safeObjectId(user), token }, // Find the session by userID and old token
      { $set: { token: newToken } } // Update only the token with the new one
    );

    // Respond with the new token and session data
    res.status(200).json({
      status: true,
      message: 'Token refreshed successfully',
      token: newToken, // Return the new token
      //data,  // Return the session data used for JWT generation
    });

  } catch (error) {
    console.error('Error during token refresh:', error);
    res.status(500).json({ status: false, message: 'An error occurred during token refresh' });
  }
});

// Endpoint to revoke a session (logout) using GET method
router.get('/remove', async (req, res) => {
  const token = req.headers['authorization'];

  if (!token) {
    return res.status(400).json({ status: false, message: 'Token is required' });
  }

  try {
    // Verify the current token
    const decodedToken = await verifyToken(token);
    if (!decodedToken.status) {
      return res.status(401).json({ status: false, message: 'Invalid or expired token' });
    }

    const { user } = decodedToken.decoded; // Extract user from the decoded token

    // Check if the session exists in the database
    const sessionCollection = req.db.collection('sessions');
    const session = await sessionCollection.findOne({ userID: safeObjectId(user), token });

    if (!session) {
      return res.status(401).json({ status: false, message: 'Session not found or already revoked' });
    }

    // Delete the session from the database to revoke it
    await sessionCollection.deleteOne({ userID: safeObjectId(user), token });

    // Respond with success message
    res.status(200).json({
      status: true,
      message: 'Session revoked successfully',
    });

  } catch (error) {
    console.error('Error during session revoke:', error);
    res.status(500).json({ status: false, message: 'An error occurred during session revoke' });
  }
});


// Endpoint to get user profile
router.get('/profile', async (req, res) => {
  const token = req.headers['authorization'];
  
  if (!token) {
    return res.status(400).json({ status: false, message: 'Token is required' });
  }

  try {
    const decodedToken = await verifyToken(token);
    if (!decodedToken.status) {
      return res.status(401).json({ status: false, message: 'Invalid or expired token' });
    }

    const { user } = decodedToken.decoded; // Extract user ID from the decoded token

    // Fetch user data from the database
    const userCollection = req.db.collection('user');
    const userData = await userCollection.findOne({ _id: safeObjectId(user) });

    if (!userData) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Respond with the user profile data
    res.status(200).json({
      status: true,
      message: 'Profile fetched successfully',
      profile: {
        firstname: userData.firstname,
        lastname: userData.lastname,
        phone: userData.phone,
        email: userData.email,
        avatar_img: userData.avatar_img,
        role: userData.role,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt,
      }
    });

  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ status: false, message: 'An error occurred while fetching profile' });
  }
});

// Wallet management endpoint
router.post('/wallet', async (req, res) => {
  try {
    const token = req.headers['authorization'];
    if (!token) {
      return res.status(400).json({ status: false, message: 'Token is required' });
    }

    // Verify the token to get the user ID
    const decodedToken = await verifyToken(token);
    if (!decodedToken.status) {
      return res.status(401).json({ status: false, message: 'Invalid or expired token' });
    }

    const { user } = decodedToken.decoded;
    const { mode, amount } = req.body; // mode can be 'get', 'increase', 'decrease', or 'adjust'

    // Fetch wallet data from the database
    const walletCollection = req.db.collection('wallet');
    let wallet = await walletCollection.findOne({ userID: safeObjectId(user) });

    if (!wallet) {
      if (mode !== 'get') {
        // Create a new wallet with a balance of 0 if a user tries to update, but no wallet exists
        wallet = { balance: 0 };
        await walletCollection.insertOne({
          userID: safeObjectId(user),
          balance: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        return res.status(404).json({ status: false, message: 'Wallet not found' });
      }
    }

    // Mode to get wallet balance
    if (mode === 'get') {
      return res.status(200).json({
        status: true,
        message: 'Wallet fetched successfully',
        balance: wallet.balance,
      });
    }

    // Perform update operations (increase, decrease, adjust)
    if (mode === 'increase' || mode === 'decrease' || mode === 'adjust') {
      if (!amount || isNaN(amount)) {
        return res.status(400).json({ status: false, message: 'A valid amount is required' });
      }

      let updatedBalance = wallet.balance;

      if (mode === 'increase') {
        updatedBalance += parseFloat(amount);
      } else if (mode === 'decrease') {
        updatedBalance -= parseFloat(amount);
        if (updatedBalance < 0) {
          return res.status(400).json({ status: false, message: 'Insufficient funds' });
        }
      } else if (mode === 'adjust') {
        updatedBalance = parseFloat(amount); // Set the balance to the new amount
      }

      // Update the wallet balance in the database
      await walletCollection.updateOne(
        { userID: safeObjectId(user) },
        { $set: { balance: updatedBalance, updatedAt: new Date() } }
      );

      return res.status(200).json({
        status: true,
        message: 'Wallet updated successfully',
        balance: updatedBalance,
      });
    } else {
      return res.status(400).json({ status: false, message: 'Invalid mode' });
    }
  } catch (error) {
    console.error('Error in wallet operation:', error);
    res.status(500).json({ status: false, message: 'An error occurred while processing the wallet operation' });
  }
});


// Use error handling middleware
router.use(errorHandler);

module.exports = router;
