const { MongoClient, ObjectId } = require('mongodb');
const CryptoJS = require('crypto-js');
const { redisClient, getCachedData, setCachedData } = require('./redis');  // Import Redis helpers

// Singleton MongoClient instance
let mongoClient;
let isConnecting = false;

const maxCacheAge = 60 * 60; // 1 hour in seconds

// Establish a stable MongoDB connection with Auto-Reconnect and Retry Logic
async function connectToMongoDB(retries = 5) {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }
 
  if (mongoClient) {
    try {
      await mongoClient.db().admin().ping();
      return;
    } catch (err) {
      console.warn('MongoDB ping failed, reconnecting...');
    }
  }

  if (isConnecting) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return connectToMongoDB();
  }

  isConnecting = true;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const maxPoolSize = Number(process.env.MONGODB_MAX_POOL_SIZE) || 100;
      const serverSelectionTimeoutMS = Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 10000;
      const socketTimeoutMS = Number(process.env.MONGODB_SOCKET_TIMEOUT_MS) || 45000;
      const tls = process.env.MONGODB_TLS === 'false' ? false : true; // default true (Atlas requires TLS)
      const tlsInsecure = process.env.MONGODB_TLS_INSECURE === 'true';

      mongoClient = new MongoClient(process.env.MONGODB_URI, {
        // Parser/Topology
        useNewUrlParser: true,
        useUnifiedTopology: true,
        // Pooling/timeouts
        maxPoolSize,
        minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE) || 0,
        serverSelectionTimeoutMS,
        waitQueueTimeoutMS: Number(process.env.MONGODB_WAIT_QUEUE_TIMEOUT_MS) || 5000,
        socketTimeoutMS,
        // Reliability
        retryWrites: true,
        retryReads: true,
        // TLS
        tls,
        tlsInsecure,
        // Metadata
        appName: process.env.MONGODB_APP_NAME || 'gateway-api',
      });
      await mongoClient.connect();
      console.log('MON :: Connected');
      break;
    } catch (err) {
      console.error(`MongoDB connection attempt ${attempt} failed:`, err);
      if (err && err.name === 'MongoServerSelectionError' && err.reason) {
        try {
          const reason = err.reason;
          const serverKeys = reason.servers && typeof reason.servers.keys === 'function'
            ? Array.from(reason.servers.keys())
            : [];
          console.error('MongoDB server selection details:', {
            type: reason.type,
            setName: reason.setName,
            heartbeatFrequencyMS: reason.heartbeatFrequencyMS,
            servers: serverKeys,
          });
        } catch (_) {
          // best-effort logging only
        }
      }
      if (attempt === retries) throw err;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    } finally {
      isConnecting = false;
    }
  }
}

// Middleware function for client authentication
async function authenticateClient(req, res, next) {
  try {
    await connectToMongoDB();
    const hToken = req.headers['client-token-key'];
    const keyQueryParam = req.query.key;
    let clientData = await getClientData(req.headers, keyQueryParam);

    if (!clientData && keyQueryParam) {
      clientData = await getClientData({ 'client-token-key': keyQueryParam });
    }

    if (!clientData) {
      return res.status(404).json({ message: 'Client not found' });
    }

    res.set('X-Client-Token', hToken || keyQueryParam);
    req.client = mongoClient;
    req.db = mongoClient.db(clientData.connection.database);
    req.clientData = clientData;

    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'An error occurred', error: err.message });
  }
}

// Safe ObjectId creation
function safeObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

// Token decryption
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

// Client data retrieval with Redis cache
async function getClientData(headers, keyQueryParam) {
  let clientToken = keyQueryParam || headers['client-token-key'];
  if (!clientToken) return null;

  try {
    const cacheKey = `clientData:${clientToken}`;
    const cachedClientData = await getCachedData(cacheKey);
    if (cachedClientData) {
      return cachedClientData;
    }

    await connectToMongoDB();
    const db = mongoClient.db('API');
    const clientData = await db.collection('clients').findOne({ clientToken });
    if (clientData) {
      await setCachedData(cacheKey, clientData, maxCacheAge);
    }
    return clientData;
  } catch (err) {
    console.error('Failed to fetch client data:', err);
    throw err;
  }
}

// Error handling middleware
function errorHandler(err, req, res, next) {
  console.error(err);
  res.status(500).json({ message: 'An internal server error occurred', error: err.message });
}

module.exports = {
  authenticateClient,
  safeObjectId,
  errorHandler,
};
