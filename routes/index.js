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
  const connections = {};
  const sourceFile = sourceMap.mongodb;
  const sourceRoutes = require(sourceFile);
  app.use(`/api`, sourceRoutes(connections.mongodb));
}
module.exports = setupRoutes;