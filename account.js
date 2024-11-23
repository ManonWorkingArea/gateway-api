const express = require('express');
const CryptoJS = require('crypto-js');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const builderRender = require('./builderRender');
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

/**
 * Helper function to get site-specific database, user collection, and site data
 * @param {Object} client - MongoDB client
 * @param {String} site - Site ID
 * @returns {Object} - { targetDb, userCollection, siteData }
 * @throws {Error} - If site is invalid or not found
 */
async function getSiteSpecificDb(client, site) {
  // Connect to the 'API' database
  const apiDb = client.db('API');
  const siteCollection = apiDb.collection('hostname');

  // Fetch site data by site ID
  const siteData = await siteCollection.findOne({ _id: safeObjectId(site) });
  if (!siteData) {
    throw new Error(`Invalid site ID. Site not found: ${site}`);
  }

  // Use site data to determine the target database
  const targetDb = client.db(siteData.key); // Connect to the site-specific database
  const userCollection = targetDb.collection('user'); // Target user collection

  return { targetDb, userCollection, siteData };
}
/**
 * Endpoint to render builder configuration and view output in the browser.
 */
router.get('/render-builder', async (req, res) => {
  try {
    const { siteId } = req.query; // Assume `siteId` is passed as a query parameter
    const client = req.client; // MongoDB client from middleware
    const postCollection = client.db('DU1eYMDG7j8yb199YDPg3').collection('post');

    // Fetch the email template
    const emailTemplate = await postCollection.findOne({
      _id: safeObjectId(siteId),
    });

    if (!emailTemplate || !emailTemplate.builder) {
      return res.status(404).json({
        status: false,
        message: 'Email template not found.',
      });
    }

    const builder = emailTemplate.builder; // Extract the builder configuration
    const dynamicData = `
      <strong>Password Recovery OTP</strong><br/><br/>
      <br/>
      Your OTP for password recovery is <strong>1234</strong>.<br/><br/>Please use this code within the next 15 minutes.<br/>
      If you didn’t request this, please ignore this email or contact support.
    `;

    // Render the HTML content using the builderRender function
    const htmlContent = builderRender(builder, dynamicData);

    // Wrap the rendered content in basic HTML for browser display
    const fullHTML = `${htmlContent}`;

    // Send the rendered HTML as the response
    res.status(200).send(fullHTML);
  } catch (error) {
    console.error('Error rendering builder:', error);
    res.status(500).send('An error occurred while rendering the builder.');
  }
});

router.post('/register', async (req, res) => {
  try {
    const { client } = req; // MongoDB client from middleware
    const { site, firstname, lastname, password, email, phone } = req.body;

    // Validate required fields
    if (!site || !firstname || !lastname || !password || !email || !phone) {
      return res.status(400).json({ 
        status: false, 
        message: 'Site, firstname, lastname, password, email, and phone are required.' 
      });
    }

    // Get site-specific database, user collection, and site data
    const { siteData } = await getSiteSpecificDb(client, site);

    // Check if email or phone already exists
    const userCollection = client.db(siteData.key).collection('user');
    const existingUser = await userCollection.findOne({
      parent: site, // Match the parent field with the value of site
      $or: [{ phone }, { email }], // Match either phone or email
    });

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
      username: email,
      phone,
      password: hashedPassword,
      salt,
      role: 'user', // Default role
      avatar_img: null, // Default avatar
      status: 'unactive', // User is inactive until OTP is verified
      otp, // Store OTP for verification
      parent:site,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert the new user into the database
    const result = await userCollection.insertOne(newUser);

    // Fetch email template from the 'post' collection using theme configuration
    const postCollection = client.db(siteData.key).collection('post');
    const emailTemplate = await postCollection.findOne({ _id: safeObjectId(siteData.theme.emailTemplates.general) });

    if (!emailTemplate) {
      return res.status(404).json({
        status: false,
        message: 'Email template not found',
      });
    }
    
    // Render the email content using the builderRender plugin
    const builderRender = require('./builderRender'); // Import the builderRender plugin
    const dynamicData = `
      <strong>Activate Your Account</strong><br/>
      <br/>
      Thank you for registering with us! Your OTP for account activation is <strong>${otp}</strong>. Please use this code within the next 15 minutes to activate your account.<br/>
      If you didn’t request this, please ignore this email or contact support.<br/><br/>
      Alternatively, you can activate your account using the following link:<br/>
      <a href="https://${siteData.hostname}/user/activate?email=${encodeURIComponent(email)}&otp=${otp}">
        Activate Account
      </a>
    `;
    const htmlContent = builderRender(emailTemplate.builder, dynamicData);

    // Prepare email content
    const emailData = {
      from: siteData.siteName + " <noreply@cloud-service.email>",
      to: [`Recipient <info@manonsanoi.com>`], // Replace with the user's email for production
      subject: "Your OTP Code",
      plain: `Your OTP code is ${otp}`,
      html: htmlContent,
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
    res.status(500).json({ 
      status: false, 
      message: 'An error occurred during registration.' 
    });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { client } = req; // MongoDB client from middleware
    const { site, email, otp, mode } = req.body;

    // Validate input
    if (!site || !email || !otp) {
      return res.status(400).json({ 
        status: false, 
        message: 'Site, email, and OTP are required' 
      });
    }

    // Get site-specific database, user collection, and site data
    const { siteData } = await getSiteSpecificDb(client, site);
    
    const userCollection = client.db(siteData.key).collection('user');
    // Find the user by email
    const user = await userCollection.findOne({
      parent: site, // Ensure the user belongs to the correct site
      email,        // Match the email
    });
    
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

    // If mode is 'activate', send the welcome email
    if (mode === 'activate') {
      // Fetch email template from the 'post' collection using theme configuration
      const postCollection = client.db(siteData.key).collection('post');
      const emailTemplate = await postCollection.findOne({ _id: safeObjectId(siteData.theme.emailTemplates.general) });

      if (!emailTemplate) {
        return res.status(404).json({
          status: false,
          message: 'Email template not found',
        });
      }
      
      // Render the email content using the builderRender plugin
      const builderRender = require('./builderRender'); // Import the builderRender plugin
      const dynamicData = `<h1>Welcome, ${user.firstname}!</h1><p>We're excited to have you join us. If you have any questions, feel free to reach out to our support team.</p><p>Best regards,<br>Your Service Team</p>`;
      const htmlContent = builderRender(emailTemplate.builder, dynamicData);

      // Send welcome email
      const welcomeEmail = {
        from: siteData.siteName + " <noreply@cloud-service.email>",
        to: [`Recipient <info@manonsanoi.com>`], // Replace with the user's email for production
        subject: "Welcome to Our Service",
        plain: `Hello ${user.firstname},\n\nWelcome to Our Service! We're glad to have you on board.\n\nBest regards,\nYour Service Team`,
        html: htmlContent,
      };

      try {
        await axios.post('https://request.cloudrestfulapi.com/email/send', welcomeEmail, {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (emailError) {
        console.error('Error sending welcome email:', emailError.response?.data || emailError.message);
        return res.status(500).json({
          status: true, // Still returning success for OTP verification
          message: 'Account verified successfully, but welcome email failed to send.',
        });
      }
    }

    res.status(200).json({
      status: true,
      message: 'Account verified successfully. A welcome email has been sent.',
    });
  } catch (error) {
    console.error('Error during OTP verification:', error);
    res.status(500).json({ 
      status: false, 
      message: 'An error occurred during OTP verification' 
    });
  }
});

router.post('/resend-otp', async (req, res) => {
  try {
    const { client } = req; // MongoDB client from middleware
    const { site, email } = req.body;

    if (!site || !email) {
      return res.status(400).json({ 
        status: false, 
        message: 'Site and email are required' 
      });
    }

    // Get site-specific database, user collection, and site data
    const { siteData } = await getSiteSpecificDb(client, site);

    const userCollection = client.db(siteData.key).collection('user');

    // Find the user
    const user = await userCollection.findOne({
      parent: site, // Ensure the user belongs to the correct site
      email,        // Match the email
    });
    
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    if (user.status === 'active') {
      return res.status(400).json({ status: false, message: 'User is already active' });
    }

    // Generate a new OTP
    const newOtp = Math.floor(1000 + Math.random() * 9000);

    // Update the user record with the new OTP
    await userCollection.updateOne(
      { email },
      { $set: { otp: newOtp }, $currentDate: { updatedAt: true } }
    );

    // Fetch email template from the 'post' collection using theme configuration
    const postCollection = client.db(siteData.key).collection('post');
    const emailTemplate = await postCollection.findOne({ _id: safeObjectId(siteData.theme.emailTemplates.general) });

    if (!emailTemplate) {
      return res.status(404).json({
        status: false,
        message: 'Email template not found',
      });
    }
    
    // Render the email content using the builderRender plugin
    const builderRender = require('./builderRender'); // Import the builderRender plugin
    const dynamicData = `
      <strong>Your New OTP Code</strong><br/>
      <br/>
      Your new OTP code is <strong>${newOtp}</strong>. Please use this code within the next 15 minutes to activate your account.<br/>
      If you didn’t request this, please ignore this email or contact support.<br/><br/>
      Alternatively, you can activate your account using the following link:<br/>
      <a href="https://${siteData.hostname}/user/activate?email=${encodeURIComponent(email)}&otp=${newOtp}">
        Activate Account
      </a>
    `;
    
    const htmlContent = builderRender(emailTemplate.builder, dynamicData);

    // Prepare email content
    const emailData = {
      from: siteData.siteName + " <noreply@cloud-service.email>",
      to: [`Recipient <info@manonsanoi.com>`], // Replace with the user's email for production
      subject: "Your New OTP Code",
      plain: `Your new OTP code is ${newOtp}.`,
      html: htmlContent,
    };

    // Send the new OTP to the user's email
    try {
      await axios.post('https://request.cloudrestfulapi.com/email/send', emailData, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (emailError) {
      console.error('Error sending OTP email:', emailError.response?.data || emailError.message);
      return res.status(500).json({
        status: false,
        message: 'Failed to send OTP email. Please try again later.',
      });
    }

    res.status(200).json({ status: true, message: 'OTP sent successfully.' });
  } catch (error) {
    console.error('Error during OTP resend:', error);
    res.status(500).json({ 
      status: false, 
      message: 'An error occurred during OTP resend.' 
    });
  }
});

router.post('/recover-password', async (req, res) => {
  try {
    const { client } = req; // MongoDB client from middleware
    const { site, email } = req.body;

    if (!site || !email) {
      return res.status(400).json({ 
        status: false, 
        message: 'Site and email are required' 
      });
    }

    // Get site-specific database, user collection, and site data
    const { siteData } = await getSiteSpecificDb(client, site);
    const userCollection = client.db(siteData.key).collection('user');
    // Validate if theme and emailTemplates are configured
    if (!siteData.theme?.emailTemplates?.general) {
      return res.status(400).json({ 
        status: false, 
        message: 'Email template configuration not found for this site' 
      });
    }

    // Find the user by email
    const user = await userCollection.findOne({
      parent: site, // Ensure the user belongs to the correct site
      email,        // Match the email
    });
    
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Generate a new OTP for password recovery
    const recoveryOtp = Math.floor(1000 + Math.random() * 9000);

    // Update the user record with the recovery OTP
    await userCollection.updateOne(
      { email },
      { $set: { otp: recoveryOtp, status: 'unactive' }, $currentDate: { updatedAt: true } }
    );

    // Fetch email template from the 'post' collection using theme configuration
    const postCollection = client.db(siteData.key).collection('post');
    const emailTemplate = await postCollection.findOne({ _id: safeObjectId(siteData.theme.emailTemplates.general) });

    if (!emailTemplate) {
      return res.status(404).json({
        status: false,
        message: 'Email template not found',
      });
    }

    // Render the email content using the builderRender plugin
    const builderRender = require('./builderRender'); // Import the builderRender plugin
    // Render the email content using the builderRender plugin
    const dynamicData = `
      <strong>Password Recovery OTP</strong><br/>
      <br/>
      Your OTP for password recovery is <strong>${recoveryOtp}</strong>. Please use this code within the next 15 minutes.<br/>
      If you didn’t request this, please ignore this email or contact support.<br/><br/>
      Alternatively, you can verify your OTP using the following link:<br/>
      <a href="https://${siteData.hostname}/user/recovery?email=${encodeURIComponent(email)}&otp=${recoveryOtp}">
        Verify OTP
      </a>
    `;
    const htmlContent = builderRender(emailTemplate.builder, dynamicData);

    // Prepare the email content
    const emailData = {
      from: `${siteData.siteName} <noreply@cloud-service.email>`,
      to: [`Recipient <info@manonsanoi.com>`], // Send to the user's actual email
      subject: "Password Recovery OTP",
      plain: `Your OTP for password recovery is ${recoveryOtp}.`,
      html: htmlContent, // Use rendered HTML content
    };

    // Send the OTP email
    try {
      await axios.post('https://request.cloudrestfulapi.com/email/send', emailData, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (emailError) {
      console.error('Error sending OTP email:', emailError.response?.data || emailError.message);
      return res.status(500).json({
        status: false,
        message: 'Failed to send OTP email. Please try again later.',
      });
    }

    res.status(200).json({ 
      status: true, 
      message: 'OTP sent successfully to your email.' 
    });
  } catch (error) {
    console.error('Error during password recovery:', error);
    res.status(500).json({ 
      status: false, 
      message: 'An error occurred during password recovery.' 
    });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { client } = req; // MongoDB client from middleware
    const { site, email, newPassword } = req.body;

    if (!site || !email || !newPassword) {
      return res.status(400).json({ 
        status: false, 
        message: 'Site, email, and new password are required.' 
      });
    }

    // Get site-specific database, user collection, and site data
    const { siteData } = await getSiteSpecificDb(client, site);
    const userCollection = client.db(siteData.key).collection('user');
    // Find the user by email
    const user = await userCollection.findOne({
      parent: site, // Ensure the user belongs to the correct site
      email,        // Match the email
    });
    
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Generate a new salt and hash the new password
    const salt = CryptoJS.lib.WordArray.random(16).toString();
    const hashedPassword = CryptoJS.SHA256(newPassword + salt).toString();

    // Update the user's password and remove the OTP
    await userCollection.updateOne(
      { email },
      { $set: { password: hashedPassword, salt }, $unset: { otp: "" }, $currentDate: { updatedAt: true } }
    );

    // Fetch email template from the 'post' collection using theme configuration
    const postCollection = client.db(siteData.key).collection('post');
    const emailTemplate = await postCollection.findOne({ _id: safeObjectId(siteData.theme.emailTemplates.general) });

    if (!emailTemplate) {
      return res.status(404).json({
        status: false,
        message: 'Email template not found',
      });
    }
    
    // Render the email content using the builderRender plugin
    const builderRender = require('./builderRender'); // Import the builderRender plugin
    const dynamicData = `<h1>Password Changed Successfully</h1>
    <p>Hello ${user.firstname},</p>
    <p>Your password has been successfully changed. If you did not request this change, please contact our support team immediately.</p>
    <p>Best regards,<br>Your Service Team</p>`;
    const htmlContent = builderRender(emailTemplate.builder, dynamicData);

    // Prepare a password change confirmation email
    const emailData = {
      from: siteData.siteName + " <noreply@cloud-service.email>",
      to: [`Recipient <info@manonsanoi.com>`], // Replace with the user's email for production
      subject: "Password Changed Successfully",
      plain: `Hello ${user.firstname},\n\nYour password has been successfully changed. If you did not request this change, please contact our support team immediately.\n\nBest regards,\nYour Service Team`,
      html: htmlContent,
    };

    // Send confirmation email
    try {
      await axios.post('https://request.cloudrestfulapi.com/email/send', emailData, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError.response?.data || emailError.message);
      return res.status(500).json({
        status: false,
        message: 'Password reset successfully, but failed to send confirmation email.',
      });
    }

    res.status(200).json({ status: true, message: 'Password reset successfully. Confirmation email sent.' });
  } catch (error) {
    console.error('Error during password reset:', error);
    res.status(500).json({ status: false, message: 'An error occurred during password reset.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { client } = req; // MongoDB client from middleware
    const { site, username, password, rememberMe } = req.body; // Extract fields from request body
    const { key } = req.query; // Extract 'key' from query parameters

    if (!username || !password || !site) {
      return res.status(400).json({
        status: false,
        message: 'Username, password, and site are required',
      });
    }

    // Get site-specific database, user collection, and site data
    const { targetDb, siteData } = await getSiteSpecificDb(client, site);
    const userCollection = client.db(siteData.key).collection('user');
    // Use siteData as needed, for example:
    console.log('Site Data:', siteData);

    // Find the user in the database
    const userQuery = {
      parent: site, // Ensure the user belongs to the correct site
      username,     // Match the username
    };
    const userResponse = await userCollection.findOne(userQuery);

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

    // Fetch user enrollments from the site-specific database
    const enrollCollection = targetDb.collection('enroll');
    const enrollments = await enrollCollection.find({ userID: userResponse._id }).toArray();

    // Handle single-session login by removing any existing sessions
    const sessionCollection = targetDb.collection('sessions');
    await sessionCollection.deleteOne({ userID: userResponse._id });

    // Generate JWT with "Remember Me" handling
    const { token } = generateJWT(userResponse, key, rememberMe);

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

    // Respond with session data, token, user data, and site data
    res.status(200).json({
      status: true,
      message: 'Signin successful',
      token,
      user: {
        username: userResponse.username,
        email: userResponse.email,
        role: userResponse.role,
        status: userResponse.status || 'active',
      }
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
