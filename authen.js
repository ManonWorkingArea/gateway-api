const express = require('express');
const CryptoJS = require('crypto-js');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const builderRender = require('./builderRender');
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const axios = require('axios'); // For making HTTP requests

const router = express.Router();

// Secret key for signing JWT (Use environment variables for security)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';

// Middleware to authenticate client
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
    const expiration = rememberMe ? '30d' : '24h'; // 30 days or 1 day
    const data = {
        user: userResponse._id,
        role: userResponse.role,
        site: key,
    };

    const token = jwt.sign(data, JWT_SECRET, { expiresIn: expiration });
    return { token, data };
}

// Function to get site-specific database and collection
async function getSiteSpecificDb(client, site) {
    const apiDb = client.db('API');
    const siteCollection = apiDb.collection('hostname');
    const siteData = await siteCollection.findOne({ hostname: site });

    if (!siteData) {
        throw new Error(`Invalid site ID. Site not found: ${site}`);
    }

    const targetDb = client.db(siteData.key);
    const userCollection = targetDb.collection('user');
    return { targetDb, userCollection, siteData };
}

// LINE login callback endpoint
router.post('/callback', async (req, res) => {
    const { code, site } = req.body;

    try {
        if (!code || !site) {
            return res.status(400).json({ error: 'Code and site are required' });
        }

        const { client } = req;
        const { siteData, userCollection } = await getSiteSpecificDb(client, site);

        const tokenResponse = await axios.post(
            'https://api.line.me/oauth2/v2.1/token',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: siteData.line.callback,
                client_id: siteData.line.client_id,
                client_secret: siteData.line.client_secret,
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const tokenData = tokenResponse.data;

        const profileResponse = await axios.get('https://api.line.me/v2/profile', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        const userData = profileResponse.data;

        // Extract relevant data from the profile response
        const { userId, displayName, pictureUrl, statusMessage } = userData;

        // Check if the user exists in the database
        let userResponse = await userCollection.findOne({
            channel: 'line',
            userId: userId,
        });

        if (!userResponse) {
            // Register the user if they do not exist
            const newUser = {
                firstname: displayName || 'Unknown',
                lastname: '',
                email: null,
                username: userId,
                phone: null,
                password: null,
                salt: null,
                role: 'user',
                avatar_img: pictureUrl || null,
                statusMessage: statusMessage || null, // Include the status message
                status: 'active',
                channel: 'line',
                userId: userId,
                parent: site,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = await userCollection.insertOne(newUser);
            userResponse = { ...newUser, _id: result.insertedId };
        }

        const sessionCollection = client.db(siteData.key).collection('sessions');
        await sessionCollection.deleteOne({ userID: userResponse._id });

        const { token } = generateJWT(userResponse, siteData.key, false);

        const newSession = {
            userID: userResponse._id,
            token,
            login: true,
            role: userResponse.role,
            channel: 'line',
            key: siteData.key,
            createdAt: new Date(),
        };

        await sessionCollection.insertOne(newSession);

        const welcomeMessage = `Welcome to ${siteData.siteName || 'our service'}!`;
        await sendMessage(siteData.line.channel_access_token, userId, welcomeMessage);

        res.status(200).json({
            success: true,
            token,
            userData: {
                username: userResponse.username,
                email: userResponse.email,
                role: userResponse.role,
                status: userResponse.status || 'active',
            },
            message: 'Welcome message sent successfully.',
        });
    } catch (error) {
        console.error('Error during LINE callback:', error.response?.data || error.message);
        res.status(500).json({ error: 'An error occurred during LINE callback.' });
    }
});

// Endpoint to send custom messages
router.post('/send-message', async (req, res) => {
    const { hostname, userId, messageText } = req.body;

    try {
        const hostnameData = await getHostname(hostname);

        if (!hostnameData) {
            return res.status(404).json({ error: 'Hostname not found' });
        }

        await sendMessage(hostnameData.line.channel_access_token, userId, messageText);

        res.json({ success: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Function to retrieve hostname data
const getHostname = async (hostname) => {
    const client = new MongoClient(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });

    try {
        await client.connect();
        const db = client.db('API');
        const clientsCollection = db.collection('hostname');
        return await clientsCollection.findOne({ hostname });
    } finally {
        await client.close();
    }
};

// Function to send a message via LINE Messaging API
const sendMessage = async (channelAccessToken, userId, messageText) => {
    try {
        const response = await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
                to: userId,
                messages: [{ type: 'text', text: messageText }],
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${channelAccessToken}`,
                },
            }
        );

        if (response.status !== 200) {
            throw new Error('Failed to send message');
        }

        console.log('Message sent successfully');
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
};

module.exports = router;
