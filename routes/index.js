const sourceMap = {
  mongodb: './mongodb',
};

const { MongoClient } = require('mongodb');
const CryptoJS = require('crypto-js'); // Import CryptoJS library


async function addToQueue(dataToInsert) {
  const mongoClient = new MongoClient(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await mongoClient.connect();
    const db = mongoClient.db('API');
    const queueCollection = db.collection('queue');
    const result = await queueCollection.insertOne(dataToInsert);
    return result;
  } catch (err) {
    console.error('Failed to insert data into the queue', err);
    throw err;
  } finally {
    await mongoClient.close();
  }
}

function setupRoutes(app) {
  app.use('/api', (req, res, next) => {
    const clientToken = req.headers['client-token-key'] || '04ZQdW5sGA9C9eXXXk6x';    
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
          query: req.query,
          optional: null,
        },
        agent: {
          userAgent: req.headers['user-agent'],
          ip: req.ip,
        },
        status: 'wait',
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