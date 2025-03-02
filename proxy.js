const express = require('express');
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const { authenticateClient, safeObjectId, errorHandler } = require('./routes/middleware/mongoMiddleware');
const axios = require('axios'); // For making HTTP requests
const { crossOriginResourcePolicy } = require('helmet');
const CryptoJS = require('crypto-js');
const router = express.Router();
const fetch = require('node-fetch'); // Ensure this package is installed
const path = require('path');

const { redisClient } = require('./routes/middleware/redis');  // Import Redis helpers

// Secret key for signing JWT (Use environment variables for security)
const JWT_SECRET = 'ZCOKU1v3TO2flcOqCdrJ3vWbWhmnZNQn';

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

// Middleware to authenticate user and return user ID
async function authenticateUserToken(authen, res) {
    if (!authen) {
        return { status: false, response: res.status(401).json({ status: false, message: 'Authentication token is required.' + authen }) };
    }

    try {
        const decodedToken = await verifyToken(authen.replace('Bearer ', ''));
        if (!decodedToken.status) {
            return { status: false, response: res.status(401).json({ status: false, message: 'Invalid or expired token.' }) };
        }
        return { status: true, user: decodedToken.decoded.user };
    } catch (error) {
        console.warn('Token verification failed:', error.message);
        return { status: false, response: res.status(401).json({ status: false, message: 'Invalid or expired token.' }) };
    }
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

// Define your secret key
const SALT_KEY = '4KLj7y[Am@/}+J{C1S`k*>qts81HV[>>Q|Qk8*gwv./ij#R.%q=gb<TMh>d*Kn-:';

// Decrypt function
const decrypt = (encryptedText) => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, SALT_KEY);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8)); // Parse decrypted JSON
  } catch (error) {
    throw new Error('Decryption failed'); // Handle decryption errors
  }
};

const getDbCollections = async (client, site, collections) => {
    const db = client.db((await client.db('API').collection('hostname').findOne({ hostname: site })).key);
    return collections.reduce((acc, col) => (acc[col] = db.collection(col), acc), {});
};

router.get('/player/:site/:playerID', async (req, res) => {
    const token = req.headers['authorization'];
    const { client } = req; 
    const { site, playerID, authen } = req.params; 
    const { key } = req.query; // Get key from request
    
    console.log("token",token);
    // ตรวจสอบการยืนยันตัวตนผู้ใช้
    const authResult = await authenticateUserToken(token, res);
    if (!authResult.status) return authResult.response;
    const user = authResult.user;

    console.log("user",user);

    if (!playerID || !key) {
        return res.status(400).json({ error: 'Player ID and key are required.' });
    }

    try {
        // Get database details
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);
        if (!siteData) {
            return res.status(404).json({ error: 'Site not found.' });
        }

        // Fetch the original m3u8 URL
        const m3u8Url = await getM3u8Url(playerID, targetDb);
        if (!m3u8Url) {
            return res.status(404).json({ error: 'M3U8 file not found for this player.' });
        }

        console.log("Fetching m3u8 from:", m3u8Url);

        // Fetch the .m3u8 file
        const response = await axios.get(m3u8Url, {
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': m3u8Url,
                'Accept': '*/*'
            }
        });

        if (response.status !== 200) {
            return res.status(response.status).json({ error: `Failed to fetch m3u8: ${response.status}` });
        }

        let m3u8Content = response.data;

        const token_key = generateSecureToken(playerID);
        // 🔥 Rewrite URLs to ensure they include playerID and key
        m3u8Content = m3u8Content.replace(/(.*?\.m3u8)/g, (match, m3u8File) => {
            return `https://gateway.cloudrestfulapi.com/proxy/m3u8/${site}/${playerID}/${m3u8File}?key=${key}&token_key=${token_key}`;
        });

        m3u8Content = m3u8Content.replace(/(.*?\.ts)/g, (match, tsFile) => {
            return `https://gateway.cloudrestfulapi.com/proxy/ts/${site}/${playerID}/${tsFile}?key=${key}&token_key=${token_key}`;
        });

        // Set headers and return updated .m3u8 file
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Content-Disposition', 'inline; filename="playlist.m3u8"');
        res.status(200).send(m3u8Content);

    } catch (error) {
        console.error('Error fetching m3u8 URL:', error.message);
        res.status(500).json({ error: `An error occurred while fetching the m3u8 file: ${error.message}` });
    }
});

// Function to generate a secure token
function generateSecureToken(playerID) {
    const token = CryptoJS.SHA256(playerID + Date.now()).toString();
    const expiry = Date.now() + 30000; // Expire in 30 seconds
    redisClient.set(token, expiry, 'EX', 30); // Store token in Redis with 30 seconds expiry
    return token;
}

// Function to validate a token
async function validateToken(token) {
    const expiry = await redisClient.get(token);
    if (expiry && Date.now() < parseInt(expiry)) {
        return true;
    }
    return false;
}

router.get('/m3u8/:site/:playerID/:quality/:m3u8File', async (req, res) => {
    const token = req.headers['authorization'];
    const { client } = req;
    const { site, playerID, quality, m3u8File, authen } = req.params;
    const { key, token_key } = req.query;

    // Validate the token
    if (!await validateToken(token)) {
        return res.status(403).json({ error: 'Invalid or expired access token' });
    }

    console.log("token",token);
    // ตรวจสอบการยืนยันตัวตนผู้ใช้
    const authResult = await authenticateUserToken(token, res);
    if (!authResult.status) return authResult.response;
    const user = authResult.user;

    console.log("user",user);

    if (!playerID || !key || !quality || !m3u8File) {
        return res.status(400).json({ error: 'Player ID, key, quality, and m3u8 file are required.' });
    }

    try {
        // Get database details
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);
        if (!siteData) {
            return res.status(404).json({ error: 'Site not found.' });
        }

        // Fetch the original m3u8 URL
        const m3u8Url = await getM3u8Url(playerID, targetDb);
        if (!m3u8Url) {
            return res.status(404).json({ error: 'M3U8 file not found for this player.' });
        }

        // Construct the URL for the sub m3u8 file with the specified quality
        const subM3u8Url = new URL(m3u8Url);
        subM3u8Url.pathname = path.join(path.dirname(subM3u8Url.pathname), quality, m3u8File);

        console.log("Fetching sub m3u8 from:", subM3u8Url.toString());

        // Fetch the sub .m3u8 file
        const response = await axios.get(subM3u8Url.toString(), {
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': m3u8Url,
                'Accept': '*/*'
            }
        });

        if (response.status !== 200) {
            return res.status(response.status).json({ error: `Failed to fetch sub m3u8: ${response.status}` });
        }

        let m3u8Content = response.data;
        
        // 🔥 Rewrite URLs to ensure they include playerID, quality, and key
        m3u8Content = m3u8Content.replace(/(.*?\.ts)/g, (match, tsFile) => {
            return `https://gateway.cloudrestfulapi.com/proxy/ts/${site}/${playerID}/${quality}/${tsFile}?key=${key}&token_key=${token_key}`;
        });

        // Set headers and return updated sub .m3u8 file
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Content-Disposition', 'inline; filename="sub.m3u8"');
        res.status(200).send(m3u8Content);

    } catch (error) {
        console.error('Error fetching sub m3u8 URL:', error.message);
        res.status(500).json({ error: `An error occurred while fetching the sub m3u8 file: ${error.message}` });
    }
});

const blockIDM = (req, res, next) => {
    const userAgent = req.headers['user-agent'];
    if (userAgent && /IDMan|Internet Download Manager/i.test(userAgent)) {
        return res.status(403).send('Downloading is not allowed');
    }
    next();
};

router.get('/ts/:site/:playerID/:quality/:tsFile', blockIDM, async (req, res) => {
    const token = req.headers['authorization'];
    const { client } = req;
    const { site, playerID, quality, tsFile, authen } = req.params;
    const { key } = req.query;

    console.log("token",token);
    // ตรวจสอบการยืนยันตัวตนผู้ใช้
    const authResult = await authenticateUserToken(token, res);
    if (!authResult.status) return authResult.response;
    const user = authResult.user;

    console.log("user",user);

    if (!playerID || !key || !quality || !tsFile) {
        return res.status(400).json({ error: 'Player ID, key, quality, and ts file are required.' });
    }

    try {
        // Get database details
        const { targetDb, siteData } = await getSiteSpecificDb(client, site);
        if (!siteData) {
            return res.status(404).json({ error: 'Site not found.' });
        }

        // Fetch the original m3u8 URL
        const m3u8Url = await getM3u8Url(playerID, targetDb);
        if (!m3u8Url) {
            return res.status(404).json({ error: 'M3U8 file not found for this player.' });
        }

        // Construct the URL for the .ts file with the specified quality
        const tsUrl = new URL(m3u8Url);
        tsUrl.pathname = path.join(path.dirname(tsUrl.pathname), quality, tsFile);

        console.log("Fetching .ts file from:", tsUrl.toString());

        // Fetch the .ts file
        const response = await axios.get(tsUrl.toString(), {
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': m3u8Url,
                'Accept': '*/*'
            }
        });

        if (response.status !== 200) {
            return res.status(response.status).json({ error: `Failed to fetch .ts file: ${response.status}` });
        }

        // Set headers and pipe the response
        // Set headers for HLS streaming
        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Prevent IDM from detecting the file
        res.setHeader('Content-Disposition', 'inline'); // Optional, but can help
        res.setHeader('X-Content-Type-Options', 'nosniff'); // Prevent MIME-type sniffing

        response.data.pipe(res);

    } catch (error) {
        console.error('Error fetching .ts file:', error.message);
        res.status(500).json({ error: `An error occurred while fetching the .ts file: ${error.message}` });
    }
});

async function getM3u8Url(playerID, targetDb) {
    const playerCollection = targetDb.collection('player');

    try {
        const specificPlayerId = safeObjectId(playerID);
        if (!specificPlayerId) {
            throw new Error('Invalid player ID format.');
        }

        // Fetch player data
        const player = await playerCollection.findOne({ _id: specificPlayerId });

        if (!player) {
            throw new Error('Player not found.');
        }

        console.log("player",player);
        // Logic to generate m3u8 URL based on player data
        const streamUrl = player.video?.streaming; // Access the streaming URL from the video object
        if (!streamUrl) {
            throw new Error('Stream URL not found for the specified player.');
        }

        // Return the m3u8 URL
        return streamUrl; // Return the streaming URL directly
    } catch (error) {
        console.error('Error retrieving m3u8 URL:', error.message);
        throw error; // Forward the error to be handled by the calling function
    }
}
module.exports = router;
