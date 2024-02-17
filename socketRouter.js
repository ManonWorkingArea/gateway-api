const { Server } = require('ws'); // Use 'Server' instead of 'WebSocketServer'

const socketRouter = (server) => {
  const wss = new Server({ server }); // Use 'Server' instead of 'WebSocketServer'

  wss.on('connection', function connection(ws) {
    console.log('A new client connected via WebSocket');

    ws.on('message', function incoming(message) {
      console.log('Received: %s', message);
      // Handle incoming WebSocket messages
    });

    // Example of sending a message to the connected client
    ws.send('Welcome! You are now connected to the WebSocket server.');
  });
};

module.exports = socketRouter;
