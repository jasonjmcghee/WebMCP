import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import WebSocket from 'ws';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Server token for MCP authentication
const serverToken = process.env.WEBMCP_SERVER_TOKEN;

// Check if server token is set
if (!serverToken) {
  console.error('ERROR: WEBMCP_SERVER_TOKEN not found in environment variables.');
  console.error('Please run the WebSocket server first to generate a token.');
  process.exit(1);
}

// Create a central MCP server that communicates over stdio
const mcpServer = new Server(
  {
    name: "mcp-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {
        list: true,
        call: true
      }
    }
  }
);

// WebSocket client connection
let wsClient = null;

// MCP specific channel path
const MCP_PATH = '/mcp';

// Map to store pending requests from WebSocket to MCP
const pendingRequests = new Map();
let requestIdCounter = 1;

// Function to handle WebSocket messages
function handleWebSocketMessage(message) {
  try {
    const data = JSON.parse(message);
    console.error(`Received message: ${data.type}`);

    if (data.type === 'toolResponse') {
      // Handle tool response from WebSocket server
      const { id, result, error } = data;

      // Check if this is a response to a pending request
      if (pendingRequests.has(id)) {
        const { resolve, reject } = pendingRequests.get(id);
        pendingRequests.delete(id);

        if (error) {
          reject(new Error(error));
        } else {
          resolve(result);
        }
      } else {
        console.error(`No pending request found for ID: ${id}`);
      }
    }
    else if (data.type === 'listToolsResponse') {
      // Handle list tools response from WebSocket server
      const { id, tools, error } = data;

      // Check if this is a response to a pending request
      if (pendingRequests.has(id)) {
        const { resolve, reject } = pendingRequests.get(id);
        pendingRequests.delete(id);

        if (error) {
          reject(new Error(error));
        } else {
          resolve(tools);
        }
      } else {
        console.error(`No pending request found for ID: ${id}`);
      }
    }
    else if (data.type === 'welcome') {
      // Welcome message from the server, we're already connected to the MCP path
      console.error(`Connected to path: ${data.channel}`);
    }
    else if (data.type === 'pong') {
      // Pong response
      console.error(`Received pong with timestamp: ${data.timestamp}`);
    }
    else if (data.type === 'error') {
      // Error message
      console.error(`Received error: ${data.message}`);
    }
  } catch (error) {
    console.error('Error processing WebSocket message:', error);
  }
}

// Function to connect to the WebSocket server
function connectToWebSocketServer() {
  // Connect to the MCP path directly with server token
  const serverUrl = `ws://localhost:4797${MCP_PATH}?token=${serverToken}`;
  
  console.error(`Connecting to WebSocket server at ${MCP_PATH} with authentication...`);

  wsClient = new WebSocket(serverUrl);

  // Handle connection opening
  wsClient.on('open', () => {
    console.error(`Connected to WebSocket server on path: ${MCP_PATH}`);
  });

  // Handle incoming messages
  wsClient.on('message', (message) => {
    handleWebSocketMessage(message);
  });

  // Handle connection closing
  wsClient.on('close', (code, reason) => {
    console.error(`WebSocket connection closed: ${code} ${reason}`);
    wsClient = null;

    // Try to reconnect after a delay
    setTimeout(connectToWebSocketServer, 5000);
  });

  // Handle connection errors
  wsClient.on('error', (error) => {
    console.error('WebSocket connection error:', error);
  });
}

// Function to send a message to the WebSocket server
function sendMessage(message) {
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
    console.error('Cannot send message: WebSocket not connected');
    return Promise.reject(new Error('WebSocket not connected'));
  }

  try {
    wsClient.send(JSON.stringify(message));
    return Promise.resolve();
  } catch (error) {
    console.error('Error sending message:', error);
    return Promise.reject(error);
  }
}

// Set up the MCP server to handle tool calls by sending them to the WebSocket server
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
    return {
      content: [{
        type: "text",
        text: "Not connected to WebSocket server"
      }],
      isError: true
    };
  }

  // Create a unique request ID
  const requestId = (requestIdCounter++).toString();

  // Create a promise that will be resolved when we get a response
  const responsePromise = new Promise((resolve, reject) => {
    // Store the resolver functions
    pendingRequests.set(requestId, { resolve, reject });

    // Set a timeout to prevent hanging requests
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Tool call timed out: ${request.params.name}`));
      }
    }, 30000); // 30 second timeout
  });

  // Send the request to the WebSocket server
  try {
    await sendMessage({
      id: requestId,
      type: 'callTool',
      tool: request.params.name,
      arguments: request.params.arguments
    });

    // Wait for the response
    const response = await responsePromise;

    return {
      content: [{
        type: "text",
        text: Array.isArray(response) ? response.join("\n") : response
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
});

// Set up the MCP server to handle list tools by querying the WebSocket server
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
    return { tools: [] };
  }

  // Create a unique request ID
  const requestId = (requestIdCounter++).toString();

  // Create a promise that will be resolved when we get a response
  const responsePromise = new Promise((resolve, reject) => {
    // Store the resolver functions
    pendingRequests.set(requestId, { resolve, reject });

    // Set a timeout to prevent hanging requests
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('List tools request timed out'));
      }
    }, 10000); // 10 second timeout
  });

  // Send the request to the WebSocket server
  try {
    await sendMessage({
      id: requestId,
      type: 'listTools'
    });

    const tools = await responsePromise;

    // Wait for the response
    return { tools };
  } catch (error) {
    console.error('Error listing tools:', error);
    return { tools: [] }; // Return empty list on error
  }
});

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  try {
    // Connect to the WebSocket server
    connectToWebSocketServer();

    // Start the MCP server with stdio transport
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error("MCP server running with stdio transport");
    return true;
  } catch (error) {
    console.error("Error starting MCP client:", error);
    return false;
  }
}

// Only try up to 10 times
const MAX_RETRIES = 10;

// Wait 500ms before each subsequent check
const TIMEOUT = 500;

// Wait 500ms before first check
const INITIAL_DELAY = 500;

(async function() {
  await sleep(INITIAL_DELAY);

  for (let i = 0; i < MAX_RETRIES; i++) {
    const success = await main();
    if (success) {
      break;
    }
    await sleep(TIMEOUT);
  }
})();

// Handle graceful shutdown
const shutdownGracefully = (signal) => {
  console.error(`\nReceived ${signal}. Shutting down gracefully...`);

  // Close WebSocket connection if open
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.close();
  }

  process.exit(0);
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
