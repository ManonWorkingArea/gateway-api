const express       = require('express');
const bodyParser    = require('body-parser');
const cors          = require('cors');
const dotenv        = require('dotenv');
const setupRoutes   = require('./routes');
const socketRouter  = require('./socket'); // Import the socket router
const emailRouter   = require('./email'); // Import the socket router

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
    // Mount the socket router under the "/socket" route
    app.use('/socket', socketRouter);
    app.use('/email', emailRouter);
    
    app.listen(process.env.PORT, () => {
      console.log(`Server is running on port ${process.env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to fetch client configurations from MongoDB', err);
  }
}

initializeApp();