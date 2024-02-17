const express       = require('express');
const bodyParser    = require('body-parser');
const cors          = require('cors');
const dotenv        = require('dotenv');
const http = require('http');

const setupRoutes   = require('./routes');
const socketRouter  = require('./socket'); // Import the socket router
const emailRouter   = require('./email'); // Import the socket router
const authRouter = require('./auth'); // Import the auth router

const wsRouter = require('./socketRouter'); // Import the socket router


dotenv.config();

const app = express();
app.set('trust proxy', true);
app.use(bodyParser.json());
app.use(cors());
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// Create HTTP server
const server = http.createServer(app);

async function initializeApp() {
  try {
    setupRoutes(app);
    // Mount the socket router under the "/socket" route
    app.use('/socket', socketRouter);
    app.use('/email', emailRouter);
    app.use('/auth', authRouter);

    wsRouter(server);
    
    app.listen(process.env.PORT, () => {
      console.log(`Server is running on port ${process.env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to fetch client configurations from MongoDB', err);
  }
}

initializeApp();