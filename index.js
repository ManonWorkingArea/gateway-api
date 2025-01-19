const express       = require('express');
const bodyParser    = require('body-parser');
const cors          = require('cors');
const dotenv        = require('dotenv');
const setupRoutes   = require('./routes');
const socketRouter  = require('./socket');
const emailRouter   = require('./email');
const accountRouter    = require('./account');  // Updated to 'authen'
const authRouter    = require('./auth');  // Import the auth router
const voteRouter    = require('./vote');  // Updated to 'authen'
const billingRouter    = require('./billing');  // Updated to 'authen'
const filemanagerRouter    = require('./filemanager');  // Updated to 'authen'

const cmsRouter    = require('./cms');  // Updated to 'authen'
const certificationRouter    = require('./certification');  // Updated to 'authen'
const aiRouter = require('./ai'); // Import the AI router

const http          = require('http');
const socketio      = require('socket.io');
const verifySlipRouter = require('./routes/verifySlip'); 

const authenRouter    = require('./authen');  // Import the auth router
const lessonRouter    = require('./lesson');  // Import the auth router
const messageRouter    = require('./message');  // Import the auth router

const addressRouter    = require('./address');  // Import the auth router

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
app.use(cors());
app.use((req, res, next) => {
  console.log(`REQ :: [${req.hostname}] ${req.method} ${req.url}`);
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
    app.use('/vote', voteRouter);  // Updated route to 'authen'
    app.use('/billing', billingRouter);  // Updated route to 'authen'
    app.use('/account', accountRouter);  // Updated route to 'authen'
    app.use('/slip', verifySlipRouter);
    app.use('/filemanager', filemanagerRouter);
    app.use('/cms', cmsRouter);
    app.use('/certification', certificationRouter);
    app.use('/ai', aiRouter); // Add the /ai route
    app.use('/authen', authenRouter); // Add the /ai route
    app.use('/lesson', lessonRouter); // Add the /ai route
    app.use('/message', messageRouter); // Add the /ai route
    app.use('/address', addressRouter); // Add the /ai route

    server.listen(process.env.PORT, () => {
      console.log(`PRT :: ${process.env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to fetch client configurations from MongoDB', err);
  }
}

initializeApp();