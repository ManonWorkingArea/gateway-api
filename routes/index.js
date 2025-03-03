const sourceMap = {
  mongodb: './mongodb',
};

const { MongoClient } = require('mongodb');
const CryptoJS = require('crypto-js'); // Import CryptoJS library

async function addToQueue(dataToInsert) {
  // const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  //   useNewUrlParser: true,
  //   useUnifiedTopology: true,
  // });

  // try {
  //   await mongoClient.connect();
  //   const db = mongoClient.db('API');
  //   const queueCollection = db.collection('queue');
  //   const result = await queueCollection.insertOne(dataToInsert);
  //   return result;
  // } catch (err) {
  //   console.error('Failed to insert data into the queue', err);
  //   throw err;
  // } finally {
  //   await mongoClient.close();
  // }
}

function setupRoutes(app) {
  app.use('/api', (req, res, next) => {
    const clientToken = req.headers['client-token-key'] || '04ZQdW5sGA9C9eXXXk6x';
    const headerToken = req.headers['x-content-token'];

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
          return {}; // Return an empty object or handle the error as needed
        }
      }
    
    if (headerToken) {
      const salt    = 'dF5NQqK4lBpncFdVNBwzEnJz8hWgEUEH';
      const key     = CryptoJS.enc.Hex.parse(req.headers['x-content-key']);
      const iv      = CryptoJS.enc.Hex.parse(req.headers['x-content-sign']);
      const result  = decryptToken(headerToken, key, iv, salt);

      //console.log("Client Key", result);
      //console.log("Client Timestamp", result.timestamp);
      
      const currentTimestamp      = Date.now();
      const maxAllowedDifference  = 60 * 1000;
      const timeDifference        = currentTimestamp - result.timestamp;
      
      if (timeDifference > maxAllowedDifference) {
        console.log("AUT :: Expired");
        return res.status(500).json({ message: 'Authenticated expired' });
      } else {
        console.log("AUT :: Valid");
      }
    }

    if (!clientToken) {
      res.status(500).json({ message: 'Not authenticated client' });
    } else {
      next();
    }
  });

  app.use('/api', async (req, res, next) => {
    try {
      const logData = {
        client: {
          token: req.headers['client-token-key'],
        },
        request: {
          url: req.url,
          baseUrl: req.baseUrl,
          method: req.method,
          parameters: req.params,
          query: req.body,
          optional: null,
        },
        agent: {
          userAgent: req.headers['user-agent'],
          ip: req.ip,
        },
        status: 'wait',
        type: 'log',
      };

      const useragent = require('useragent');
      const agent = useragent.parse(logData.request.userAgent);

      logData.agent.os = agent.os.toString();
      logData.agent.browser = agent.toAgent();

      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        logData.agent.requestBodyData = req.body;
      }

      await addToQueue(logData);

      next();
    } catch (err) {
      console.error('Failed to log data to the queue', err);
      res.status(500).json({ message: 'Failed to log data to the queue' });
    }
  });

  const connections = {};
  const sourceFile = sourceMap.mongodb;
  const sourceRoutes = require(sourceFile);
  app.use(`/api`, sourceRoutes(connections.mongodb));
}

module.exports = setupRoutes;