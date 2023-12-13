// routes/api.js
const { Router } = require('express');
const clientApiRouter = require('../routes/client/client_api');

module.exports = function (clientConfig) {
  const router = Router();
  router.use(clientApiRouter);
  return router;
};
