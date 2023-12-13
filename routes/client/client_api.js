// routes/client_api.js
const { Router } = require('express');
const axios = require('axios');

const router = Router();

async function sampleRouteHandler(req, res) {
  try {
    const response = await axios.get('https://multisource-api-edsdv.ondigitalocean.app/api/Jzj3YfRMVemRpgfM411D/bills');
    res.status(200).json(response.data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

router.get('/sample', sampleRouteHandler);

module.exports = router;
