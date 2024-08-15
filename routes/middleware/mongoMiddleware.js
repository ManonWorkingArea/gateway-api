// mongoMiddleware.js

const { MongoClient, ObjectId } = require('mongodb');
const CryptoJS = require('crypto-js');

// Connection pool to reuse MongoClient instances
let mongoClient;

// Cache for client data with timestamps
const clientDataCache = new Map();

// Maximum age (in milliseconds) for cached client data
const maxCacheAge = 60 * 60 * 1000; // 1 hour

// Middleware function for custom headers and client data retrieval
async function authenticateClient(req, res, next) {
  try {
    const hToken = req.headers['client-token-key'];
    const keyQueryParam = req.query.key; // Check for the ?key=xxxx query parameter
    const clientData = await getClientData(req.headers, keyQueryParam);

    if (!clientData) {
      res.status(404).json({ message: 'Client not found' });
      return;
    }

    // Set the custom X-Client-Token header
    const clientToken = req.headers['client-token-key']; // Fixed variable name
    res.set('X-Client-Token', clientToken);

    // Attach the client and database objects to the request for further middleware and route handlers
    req.client = mongoClient;
    req.db = mongoClient.db(clientData.connection.database);
    req.clientData = clientData;

    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'An error occurred' });
  }
}

// Helper function to safely create an ObjectId
function safeObjectId(id) {
  if (!ObjectId.isValid(id)) {
    return null;
  }
  return new ObjectId(id);
}

// Helper function to decrypt tokens
function decryptToken(headerToken, key, iv, salt) {
  try {
    const saltWordArray = CryptoJS.enc.Utf8.parse(salt);
    const combinedKey = CryptoJS.lib.WordArray.create()
      .concat(key)
      .concat(saltWordArray);
    const decryptedData = CryptoJS.AES.decrypt(headerToken, combinedKey, { iv: iv });
    const decryptedJson = JSON.parse(decryptedData.toString(CryptoJS.enc.Utf8));
    return decryptedJson;
  } catch (error) {
    console.error('Error parsing decrypted data as JSON:', error);
    return {};
  }
}

// Helper function to get client data
async function getClientData(headers, keyQueryParam) {
  let clientToken;
  let channel;

  if (keyQueryParam) {
    // Use the key from the query parameter directly
    clientToken = keyQueryParam;
    channel = 'query';
  } else if (headers['x-content-token']) {
    // Decrypt the token from the headers if no query parameter is provided
    const salt = process.env.TOKEN_SALT;
    if (!salt) {
      throw new Error('TOKEN_SALT environment variable is not set.');
    }

    const key = CryptoJS.enc.Hex.parse(headers['x-content-key']);
    const iv = CryptoJS.enc.Hex.parse(headers['x-content-sign']);
    const result = decryptToken(headers['x-content-token'], key, iv, salt);

    if (!result || !result.key) {
      throw new Error('Token decryption failed or invalid token format.');
    }

    clientToken = result.key;
    channel = 'token';
  } else {
    // Fall back to using the 'client-token-key' header if neither the query parameter nor 'x-content-token' is present
    clientToken = headers['client-token-key'];
    channel = 'header';
  }

  console.log('Channel:', channel);
  console.log('Client Token:', clientToken);

  // Continue with the caching logic and MongoDB operations
  if (clientDataCache.has(clientToken)) {
    const { data, timestamp } = clientDataCache.get(clientToken);
    const currentTime = Date.now();

    // Check if the cached item has exceeded the maximum age
    if (currentTime - timestamp <= maxCacheAge) {
      return data;
    } else {
      clientDataCache.delete(clientToken);
    }
  }

  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    try {
      await mongoClient.connect();
    } catch (err) {
      console.error('Failed to connect to MongoDB', err);
      throw err;
    }
  }

  try {
    const db = mongoClient.db('API');
    const clientsCollection = db.collection('clients');
    const clientData = await clientsCollection.findOne({ clientToken });

    if (clientData) {
      clientDataCache.set(clientToken, { data: clientData, timestamp: Date.now() });
    }

    return clientData;
  } catch (err) {
    console.error('Failed to fetch client data from MongoDB', err);
    throw err;
  }
}


// Error handling middleware
function errorHandler(err, req, res, next) {
    console.error(err);
    res.status(500).json({ message: 'An error occurred' });
}
  
module.exports = {
  authenticateClient,
  safeObjectId,
  errorHandler
};
