const express       = require('express');
const bodyParser    = require('body-parser');
const cors          = require('cors');
const dotenv        = require('dotenv');
const setupRoutes   = require('./routes');
const socketRouter  = require('./socket');
const emailRouter   = require('./email');
const accountRouter    = require('./account');  // Updated to 'authen'
const authRouter    = require('./auth');  // Import the auth router
const http          = require('http');
const socketio      = require('socket.io');
const verifySlipRouter = require('./routes/verifySlip'); 

dotenv.config();

const app = express();

const rateLimit = require('express-rate-limit');

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  standardHeaders: true, 
  legacyHeaders: false,
});

//app.use(apiLimiter);
app.set('trust proxy', false);
app.use(bodyParser.json());
//app.use(cors());
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

const server = http.createServer(app);
const timeoutDuration = 300000;
server.setTimeout(timeoutDuration);

const io = socketio(server, {
  cors: { origin: "*" }
});

io.on('connection', (socket) => {
  console.log('New client connected');
  socket.on('event-from-client', (data) => {
    console.log('Received data from client:', data);
    socket.emit('push-notification', { message: 'Server: ' + data });
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
    app.use('/account', accountRouter);  // Updated route to 'authen'
    app.use('/slip', verifySlipRouter);

    server.listen(process.env.PORT, () => {
      console.log(`Server is running on port ${process.env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to fetch client configurations from MongoDB', err);
  }
}

initializeApp();