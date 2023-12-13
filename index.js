const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const { MongoClient } = require('mongodb'); // Import the MongoClient
const setupRoutes = require('./routes');

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors());

app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

async function initializeApp() {
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    await mongoClient.connect();
    const db = mongoClient.db('API');
    const clientConfigs = await db.collection('clients').find().toArray();
    await mongoClient.close();

    global.ClientConfiguration = clientConfigs;

    setupRoutes(app, clientConfigs);

    app.listen(process.env.PORT, () => {
      console.log(`Server is running on port ${process.env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to fetch client configurations from MongoDB', err);
  }
}

initializeApp();