// socket.js
//
const express   = require('express');
const Pusher    = require('pusher');
const router    = express.Router();

const pusher = new Pusher({
  appId: '1729042',
  key: '5389701e908eb3724318',
  secret: '889452d43c9845f64a16',
  cluster: 'ap1',
});

// Handle subscribing to Pusher channels
//
router.post('/subscribe', (req, res) => {
  const { channel, socket } = req.body;
  pusher.subscribe(channel, socket);
  res.status(200).json({ message: 'Subscribed to channel' });
});

// Handle broadcasting messages using Pusher
//
router.post('/broadcast', (req, res) => {
  const { channel, event, data } = req.body;
  pusher.trigger(channel, event, data);
  res.status(200).json({ message: 'Event broadcasted' });
});

// Handle unsubscribing from Pusher channels
//
router.post('/unsubscribe', (req, res) => {
  const { channel, socket } = req.body;
  pusher.unsubscribe(channel, socket);
  res.status(200).json({ message: 'Unsubscribed from channel' });
});

// Handle sending a private message to a user
//
router.post('/private-message', (req, res) => {
  const { socket, event, message } = req.body;
  pusher.trigger(`private-${socket}`, event, message);
  res.status(200).json({ message: 'Private message sent' });
});

module.exports = router;