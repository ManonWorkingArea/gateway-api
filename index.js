const express     = require('express');
const bodyParser  = require('body-parser');
const cors        = require('cors');
const dotenv      = require('dotenv');
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
    setupRoutes(app);
    app.listen(process.env.PORT, () => {
      console.log(`Server is running on port ${process.env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to fetch client configurations from MongoDB', err);
  }
}

initializeApp();