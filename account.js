const express = require('express');
const CryptoJS = require('crypto-js');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware'); // Import your middleware

const axios = require('axios'); // For making HTTP requests

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
  const expiration = rememberMe ? '30d' : '24h'; // 30 days or 1 hour
  
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

router.post('/register', async (req, res) => {
  try {
    const { db } = req; // MongoDB connection from middleware
    const { firstname, lastname, password, email, phone } = req.body;

    // Validate required fields
    if (!firstname || !lastname || !password || !email || !phone) {
      return res.status(400).json({ status: false, message: 'All fields are required (firstname, lastname, password, email, phone)' });
    }

    // Check if email or phone already exists
    const userCollection = db.collection('user');
    const existingUser = await userCollection.findOne({ $or: [{ phone }, { email }] });

    if (existingUser) {
      return res.status(409).json({
        status: false,
        message: 'Username or email already exists',
      });
    }

    // Generate a unique salt
    const salt = CryptoJS.lib.WordArray.random(16).toString();
    // Hash the password with the salt
    const hashedPassword = CryptoJS.SHA256(password + salt).toString();

    // Generate a 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000);

    // Create a new user object with status = 'unactive'
    const newUser = {
      firstname,
      lastname,
      email,
      username:email,
      phone,
      password: hashedPassword,
      salt,
      role: 'user', // Default role
      avatar_img: null, // Default avatar
      status: 'unactive', // User is inactive until OTP is verified
      otp, // Store OTP for verification
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert the new user into the database
    const result = await userCollection.insertOne(newUser);

    // Prepare email content
    const emailData = {
      from: "Your Service <noreply@cloud-service.email>",
      to: [`Recipient <info@manonsanoi.com>`],
      //to: [`Recipient <${email}>`],
      subject: "Your OTP Code",
      plain: `Your OTP code is ${otp}`,
      html: `<h1>Your OTP code is ${otp}</h1>`,
    };

    // Send email via API
    try {
      await axios.post('https://request.cloudrestfulapi.com/email/send', emailData, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (emailError) {
      console.error('Error sending email:', emailError.response?.data || emailError.message);
      return res.status(500).json({
        status: false,
        message: 'User registered, but failed to send OTP email. Please contact support.',
      });
    }

    // Respond with success message
    res.status(201).json({
      status: true,
      message: 'User registered successfully. Please verify your OTP to activate your account.',
      userId: result.insertedId,
    });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ status: false, message: 'An error occurred during registration' });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { db } = req; // MongoDB connection from middleware
    const { email, otp } = req.body;

    // Validate input
    if (!email || !otp) {
      return res.status(400).json({ status: false, message: 'Email and OTP are required' });
    }

    // Find the user by email
    const userCollection = db.collection('user');
    const user = await userCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    if (user.status === 'active') {
      return res.status(400).json({ status: false, message: 'User is already active' });
    }

    // Check if the OTP matches
    if (user.otp !== parseInt(otp, 10)) {
      return res.status(401).json({ status: false, message: 'Invalid OTP' });
    }

    // Update user status to 'active' and remove the OTP
    await userCollection.updateOne(
      { email },
      { $set: { status: 'active' }, $unset: { otp: "" }, $currentDate: { updatedAt: true } }
    );

    res.status(200).json({
      status: true,
      message: 'Account verified successfully. You can now log in.',
    });
  } catch (error) {
    console.error('Error during OTP verification:', error);
    res.status(500).json({ status: false, message: 'An error occurred during OTP verification' });
  }
});


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
    /*
    // Check user role
    if (userResponse.role !== 'user') {
      return res.status(403).json({ status: false, message: 'Unauthorized to access this site' });
    }
    */

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
        uid: userData._id,
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

// Endpoint to update user profile
router.post('/update', async (req, res) => {
  const token = req.headers['authorization'];

  if (!token) {
    return res.status(400).json({ status: false, message: 'Token is required' });
  }

  try {
    // Verify the token to get the user ID
    const decodedToken = await verifyToken(token);
    if (!decodedToken.status) {
      return res.status(401).json({ status: false, message: 'Invalid or expired token' });
    }

    const { user } = decodedToken.decoded; // Extract user ID from the decoded token
    const { firstname, lastname, phone, email } = req.body; // Extract the updated fields from the request body

    // Validate input data
    if (!firstname || !lastname || !phone || !email) {
      return res.status(400).json({ status: false, message: 'All fields (firstname, lastname, phone, email) are required' });
    }

    // Fetch the user data from the database
    const userCollection = req.db.collection('user');
    const userData = await userCollection.findOne({ _id: safeObjectId(user) });

    if (!userData) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Update the user profile in the database
    await userCollection.updateOne(
      { _id: safeObjectId(user) },
      { $set: { firstname, lastname, phone, email, updatedAt: new Date() } }
    );

    // Respond with success message
    res.status(200).json({
      status: true,
      message: 'Profile updated successfully',
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ status: false, message: 'An error occurred while updating profile' });
  }
});


// Endpoint to update user avatar
router.post('/avatar', async (req, res) => {
  const token = req.headers['authorization'];

  if (!token) {
    return res.status(400).json({ status: false, message: 'Token is required' });
  }

  try {
    // Verify the token to get the user ID
    const decodedToken = await verifyToken(token);
    if (!decodedToken.status) {
      return res.status(401).json({ status: false, message: 'Invalid or expired token' });
    }

    const { user } = decodedToken.decoded; // Extract user ID from the decoded token
    const { avatar_img } = req.body; // Extract the updated avatar image from the request body

    // Validate input data
    if (!avatar_img) {
      return res.status(400).json({ status: false, message: 'Avatar image is required' });
    }

    // Fetch the user data from the database
    const userCollection = req.db.collection('user');
    const userData = await userCollection.findOne({ _id: safeObjectId(user) });

    if (!userData) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Update the user's avatar image in the database
    await userCollection.updateOne(
      { _id: safeObjectId(user) },
      { $set: { avatar_img, updatedAt: new Date() } }
    );

    // Respond with success message
    res.status(200).json({
      status: true,
      message: 'Avatar updated successfully',
    });

  } catch (error) {
    console.error('Error updating avatar:', error);
    res.status(500).json({ status: false, message: 'An error occurred while updating avatar' });
  }
});


// Endpoint to reset the user's password
router.post('/password', async (req, res) => {
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

    const { user } = decodedToken.decoded; // Extract user ID from the decoded token
    const { currentPassword, newPassword, confirmPassword } = req.body; // Extract the current password, new password, and confirm password

    // Validate all required fields
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ status: false, message: 'Current password, new password, and confirmation are required' });
    }

    // Validate new password and confirm password
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ status: false, message: 'Passwords do not match' });
    }

    // Fetch the user's current password and salt from the database
    const userCollection = req.db.collection('user');
    const userData = await userCollection.findOne({ _id: safeObjectId(user) });

    if (!userData) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Verify the current password
    const currentHash = CryptoJS.SHA256(currentPassword + userData.salt).toString();
    if (currentHash !== userData.password) {
      return res.status(401).json({ status: false, message: 'Current password is incorrect' });
    }

    // Generate a new salt and hash the new password
    const salt = CryptoJS.lib.WordArray.random(16).toString();
    const newHash = CryptoJS.SHA256(newPassword + salt).toString();

    // Update the user's password in the user collection
    await userCollection.updateOne(
      { _id: safeObjectId(user) }, // Use the user ID from the token
      {
        $set: {
          password: newHash, // Set the new hashed password
          salt: salt, // Set the new salt
          updatedAt: new Date(), // Optionally update the `updatedAt` field
        }
      }
    );

    // Respond with a success message
    res.status(200).json({
      status: true,
      message: 'Password reset successfully',
    });

  } catch (error) {
    console.error('Error during password reset:', error);
    res.status(500).json({ status: false, message: 'An error occurred during password reset' });
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
    const walletTransactionCollection = req.db.collection('wallet_transaction'); // Collection for transactions
    let wallet = await walletCollection.findOne({ userID: safeObjectId(user) });

    // Handle 'get' mode and create a new wallet if it doesn't exist
    if (!wallet) {
      if (mode === 'get') {
        wallet = { balance: 0 };
        await walletCollection.insertOne({
          userID: safeObjectId(user),
          balance: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Record wallet creation transaction
        await walletTransactionCollection.insertOne({
          userID: safeObjectId(user),
          action: 'create',
          amount: 0,
          balanceBefore: 0, // Initially, balance before is 0
          balanceAfter: 0,  // Balance after is also 0
          timestamp: new Date(),
        });

        return res.status(200).json({
          status: true,
          message: 'New wallet created successfully',
          balance: wallet.balance,
          transactions: [], // No transactions for a new wallet
        });
      } else {
        return res.status(404).json({ status: false, message: 'Wallet not found' });
      }
    }

    // Mode to get wallet balance along with last 5 transactions
    if (mode === 'get') {
      // Fetch the last 5 transactions from the transaction log for this user
      const lastTransactions = await walletTransactionCollection.find({ userID: safeObjectId(user) })
        .sort({ timestamp: -1 }) // Sort by the most recent first
        .limit(5) // Limit to 5 transactions
        .toArray();

      return res.status(200).json({
        status: true,
        message: 'Wallet fetched successfully',
        balance: wallet.balance,
        transactions: lastTransactions, // Return the last 5 transactions
      });
    }

    // Perform update operations (increase, decrease, adjust)
    if (['increase', 'decrease', 'adjust'].includes(mode)) {
      if (!amount || isNaN(amount)) {
        return res.status(400).json({ status: false, message: 'A valid amount is required' });
      }

      const balanceBefore = wallet.balance; // Capture the balance before the operation
      let updatedBalance = balanceBefore;
      let actionType = '';

      if (mode === 'increase') {
        updatedBalance += parseFloat(amount);
        actionType = 'increase';
      } else if (mode === 'decrease') {
        updatedBalance -= parseFloat(amount);
        if (updatedBalance < 0) {
          return res.status(400).json({ status: false, message: 'Insufficient funds' });
        }
        actionType = 'decrease';
      } else if (mode === 'adjust') {
        updatedBalance = parseFloat(amount); // Set the balance to the new amount
        actionType = 'adjust';
      }

      // Update the wallet balance in the database
      await walletCollection.updateOne(
        { userID: safeObjectId(user) },
        { $set: { balance: updatedBalance, updatedAt: new Date() } }
      );

      // Record the transaction in the wallet_transaction collection
      await walletTransactionCollection.insertOne({
        userID: safeObjectId(user),
        action: actionType,
        amount: parseFloat(amount),
        balanceBefore: balanceBefore, // Log the balance before the transaction
        balanceAfter: updatedBalance, // Log the balance after the transaction
        timestamp: new Date(),
      });

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
