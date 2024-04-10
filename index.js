const express       = require('express');
const bodyParser    = require('body-parser');
const cors          = require('cors');
const dotenv        = require('dotenv');
const setupRoutes   = require('./routes');
const socketRouter  = require('./socket'); // Import the socket router
const emailRouter   = require('./email'); // Import the email router
const authRouter    = require('./auth');  // Import the auth router
const http          = require('http');    // Import the http module
const socketio      = require('socket.io'); // Import socket.io module

dotenv.config();

const app = express();

const rateLimit = require('express-rate-limit');

// Create the rate limit rule
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 10000, // 15 minutes
  max: 10000, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply the rate limit to all requests
app.use(apiLimiter);
app.set('trust proxy', false);
app.use(bodyParser.json());
app.use(cors());
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: "*"
  }
});

io.on('connection', (socket) => {
  console.log('New client connected');
  socket.on('event-from-client', (data) => {
    console.log('Received data from client:', data);
    socket.emit('push-notification', { message: 'Server : ' + data });
  });
  setTimeout(() => {
    socket.emit('push-notification', { message: 'Hello from the server!' });
  }, 5000);
});

async function initializeApp() {
  try {
    setupRoutes(app);
    app.use('/email', emailRouter);
    app.use('/auth', authRouter);

    server.listen(process.env.PORT, () => {
      console.log(`Server is running on port ${process.env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to fetch client configurations from MongoDB', err);
  }
}

initializeApp();
