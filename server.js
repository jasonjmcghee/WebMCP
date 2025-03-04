import { WebSocketServer } from 'ws';
import { createServer } from 'http';

// Create HTTP server with CORS headers
const server = createServer((req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    // Handle preflight requests
    res.writeHead(204);
    res.end();
    return;
  }
  
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running');
});

// Create WebSocket server instance
const wss = new WebSocketServer({ server });

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to WebSocket server'
  }));
  
  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data);
      
      // Handle message types
      if (data.type === 'ping') {
        ws.send(JSON.stringify({
          type: 'pong',
          id: data.id,
          timestamp: Date.now()
        }));
      } else {
        // Echo back any other message
        ws.send(JSON.stringify({
          type: 'echo',
          original: data,
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log('Client disconnected');
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Start the server
const PORT = 4797;
server.listen(PORT, () => {
  console.log(`WebSocket server running at http://localhost:${PORT}`);
  console.log('Press CTRL+C to stop the server');
});

// Handle server shutdown for both SIGINT (CTRL+C) and SIGTERM
const shutdownGracefully = (signal) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  wss.close(() => {
    console.log('WebSocket server closed');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
};

// Handle CTRL+C (SIGINT)
process.on('SIGINT', () => shutdownGracefully('SIGINT'));

// Handle SIGTERM
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));

// Enable keyboard input handling for CTRL+C on Windows
if (process.platform === 'win32') {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (data) => {
    // Check for CTRL+C (03 in hex)
    if (data.length === 1 && data[0] === 0x03) {
      shutdownGracefully('CTRL+C');
    }
  });
}

export default server;
