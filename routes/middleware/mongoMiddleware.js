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
    // First, try to get the token from the URL parameter
    let clientToken = req.query.client;
    let channel = 'query';

    // If the token is not in the URL, fall back to checking the headers
    if (!clientToken) {
      const headerToken = req.headers['x-content-token'];
      if (headerToken) {
        const salt = process.env.TOKEN_SALT;
        const key = CryptoJS.enc.Hex.parse(headers['x-content-key']);
        const iv = CryptoJS.enc.Hex.parse(headers['x-content-sign']);
        const result = decryptToken(headerToken, key, iv, salt);
        clientToken = result.key;
        channel = 'token';
      } else {
        clientToken = req.headers['client-token-key'];
        channel = 'header';
      }
    }

    if (!clientToken) {
      res.status(400).json({ message: 'Client token is required' });
      return;
    }

    console.log('Channel', channel);
    console.log('Key', clientToken);

    if (clientDataCache.has(clientToken)) {
      console.log('Data retrieved from cache for clientToken:', clientToken);
      const { data, timestamp } = clientDataCache.get(clientToken);
      const currentTime = Date.now();

      if (currentTime - timestamp <= maxCacheAge) {
        req.client = mongoClient;
        req.db = mongoClient.db(data.connection.database);
        req.clientData = data;
        return next();
      } else {
        clientDataCache.delete(clientToken);
        console.log('Cache entry expired for clientToken:', clientToken);
      }
    }

    if (!mongoClient) {
      mongoClient = new MongoClient(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
    }

    await mongoClient.connect();
    const db = mongoClient.db('API');
    const clientsCollection = db.collection('clients');
    const clientData = await clientsCollection.findOne({ clientToken });

    if (!clientData) {
      res.status(404).json({ message: 'Client not found' });
      return;
    }

    clientDataCache.set(clientToken, { data: clientData, timestamp: Date.now() });
    console.log('Data cached for clientToken:', clientToken);

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
async function getClientData(headers) {
  let clientToken;
  let channel;
  const headerToken = headers['x-content-token'];

  if (headerToken) {
    const salt      = process.env.TOKEN_SALT;
    const key       = CryptoJS.enc.Hex.parse(headers['x-content-key']);
    const iv        = CryptoJS.enc.Hex.parse(headers['x-content-sign']);
    const result    = decryptToken(headerToken, key, iv, salt);
    clientToken     = result.key;
    channel         = 'token';
  } else {
    clientToken     = headers['client-token-key'];
    channel         = 'header';
  }

  console.log('Channel', channel);
  console.log('Key', clientToken);

  if (clientDataCache.has(clientToken)) {
    console.log('Data retrieved from cache for clientToken:', clientToken);
    const { data, timestamp } = clientDataCache.get(clientToken);
    const currentTime = Date.now();

    // Check if the cached item has exceeded the maximum age
    if (currentTime - timestamp <= maxCacheAge) {
      return data;
    } else {
      // Remove the expired item from the cache
      clientDataCache.delete(clientToken);
      console.log('Cache entry expired for clientToken:', clientToken);
    }
  }

  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }

  try {
    await mongoClient.connect();
    const db = mongoClient.db('API');
    const clientsCollection = db.collection('clients');
    const clientData = await clientsCollection.findOne({ clientToken });
    if (clientData) {
      // Cache the retrieved data with a timestamp
      clientDataCache.set(clientToken, { data: clientData, timestamp: Date.now() });
      console.log('Data cached for clientToken:', clientToken);
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
