const sourceMap = {
  mongodb: './mongodb',
};
function setupRoutes(app) {
  app.use('/api', (req, res, next) => {
    const clientToken = req.headers['h-token'] || '04ZQdW5sGA9C9eXXXk6x';
    if (!clientToken) {
      res.status(500).json({ message: 'Not authenticated client' });
    } else {
      next();
    }
  });

  // Add this middleware to log request details
  app.use('/api', (req, res, next) => {
    console.log('Request URL:', req.url);
    console.log('Request Base URL:', req.baseUrl);
    console.log('Request Method:', req.method);
    console.log('Request Parameters:', req.params);

    // Iterate over query parameters and log their names and values
    for (const key in req.query) {
      if (Object.hasOwnProperty.call(req.query, key)) {
        const value = req.query[key];
        console.log(`Query Parameter ${key}:`, value);
      }
    }

    // Get client IP address
    const clientIP = req.ip;
    console.log('Client IP Address:', clientIP);

    // Get client details from user-agent header
    const userAgent = req.headers['user-agent'];
    console.log('User-Agent:', userAgent);

    // You can use a library like `useragent` to parse user-agent string
    const useragent = require('useragent');
    const agent = useragent.parse(userAgent);

    console.log('Operating System:', agent.os.toString());
    console.log('Browser:', agent.toAgent());

    // Log the request body data, including the array elements
    if (req.method === 'POST') {
      console.log('Request Body Data:', JSON.stringify(req.body, null, 2));
    }

    next();
  });

  const connections = {};
  const sourceFile = sourceMap.mongodb;
  const sourceRoutes = require(sourceFile);
  app.use(`/api`, sourceRoutes(connections.mongodb));
}
module.exports = setupRoutes;