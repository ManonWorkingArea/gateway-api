const { MongoClient, ObjectId } = require('mongodb');
const CryptoJS = require('crypto-js');

// Singleton MongoClient instance
let mongoClient;
let isConnecting = false;  // Prevent multiple simultaneous connections

// Cache for client data with timestamps
const clientDataCache = new Map();
const maxCacheAge = 60 * 60 * 1000; // 1 hour

// Establish a stable MongoDB connection
async function connectToMongoDB() {
  if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
    return; // Already connected
  }

  if (isConnecting) {
    // Wait for ongoing connection attempt
    await new Promise(resolve => setTimeout(resolve, 100));
    return connectToMongoDB();
  }

  isConnecting = true;

  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    await mongoClient.connect();
    console.log('MongoDB connected');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    throw err;
  } finally {
    isConnecting = false;
  }
}

// Middleware function for custom headers and client data retrieval
async function authenticateClient(req, res, next) {
  try {
    await connectToMongoDB();  // Ensure connection is active

    const hToken = req.headers['client-token-key'];
    const keyQueryParam = req.query.key;
    let clientData = await getClientData(req.headers, keyQueryParam);

    if (!clientData && keyQueryParam) {
      clientData = await getClientData({ 'client-token-key': keyQueryParam });
    }

    if (!clientData) {
      return res.status(404).json({ message: 'Client not found' });
    }

    const clientToken = hToken || keyQueryParam;
    res.set('X-Client-Token', clientToken);

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
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

// Helper function to decrypt tokens
function decryptToken(headerToken, key, iv, salt) {
  try {
    const saltWordArray = CryptoJS.enc.Utf8.parse(salt);
    const combinedKey = CryptoJS.lib.WordArray.create().concat(key).concat(saltWordArray);
    const decryptedData = CryptoJS.AES.decrypt(headerToken, combinedKey, { iv: iv });
    return JSON.parse(decryptedData.toString(CryptoJS.enc.Utf8));
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
    clientToken = keyQueryParam;
    channel = 'query';
  } else if (headers['x-content-token']) {
    const salt = process.env.TOKEN_SALT;
    if (!salt) throw new Error('TOKEN_SALT environment variable is not set.');

    const key = CryptoJS.enc.Hex.parse(headers['x-content-key']);
    const iv = CryptoJS.enc.Hex.parse(headers['x-content-sign']);
    const result = decryptToken(headers['x-content-token'], key, iv, salt);

    if (!result || !result.key) throw new Error('Token decryption failed or invalid token format.');

    clientToken = result.key;
    channel = 'token';
  } else {
    clientToken = headers['client-token-key'];
    channel = 'header';
  }

  console.log('Channel:', channel);
  console.log('Client Token:', clientToken);

  if (clientDataCache.has(clientToken)) {
    const { data, timestamp } = clientDataCache.get(clientToken);
    if (Date.now() - timestamp <= maxCacheAge) {
      return data;
    }
    clientDataCache.delete(clientToken);
  }

  await connectToMongoDB();  // Ensure the connection is alive before querying

  try {
    const db = mongoClient.db('API');
    const clientsCollection = db.collection('clients');
    const clientData = await clientsCollection.findOne({ clientToken });

    if (clientData) {
      clientDataCache.set(clientToken, { data: clientData, timestamp: Date.now() });
    }

    return clientData;
  } catch (err) {
    console.error('Failed to fetch client data from MongoDB:', err);

    if (err.name === 'MongoTopologyClosedError') {
      console.error('Reconnecting to MongoDB...');
      await connectToMongoDB();  // Attempt reconnection
      return getClientData(headers, keyQueryParam);  // Retry
    }

    throw err;
  }
}

// Error handling middleware
function errorHandler(err, req, res, next) {
  console.error(err);
  res.status(500).json({ message: 'An internal server error occurred' });
}

module.exports = {
  authenticateClient,
  safeObjectId,
  errorHandler,
};
