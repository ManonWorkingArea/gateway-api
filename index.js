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
app.set('trust proxy', true);
app.use(bodyParser.json());
app.use(cors());
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// Create a server using http module and pass express app to it
const server = http.createServer(app);

// Allow all origins in Socket.IO
const io = socketio(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Socket.IO logic goes here
io.on('connection', (socket) => {
  console.log('New client connected');

  // Handle events from clients
  socket.on('event-from-client', (data) => {
    console.log('Received data from client:', data);
    // Handle the data or emit back to clients
  });
  // Send a push notification to the client
  setTimeout(() => {
    socket.emit('push-notification', { message: 'Hello from the server!' });
  }, 5000); // Sending after 5 seconds

  // More event handlers can be added here
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
