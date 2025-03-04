import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { parse } from 'url';

// Create HTTP server with CORS headers
const httpServer = createServer((req, res) => {
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
  res.end('MCP WebSocket server is running');
});

// Create WebSocket server instance
const wss = new WebSocketServer({
  server: httpServer,
  clientTracking: true
});

// Store active WebSocket connections by channel
const channels = new Map();

// Special MCP channel path
const MCP_PATH = '/mcp';

// Track all available tools across all channels
const toolsRegistry = new Map();

// Request counter for unique IDs
let requestIdCounter = 1;

// Map to store pending requests
const pendingRequests = new Map();

// Helper function to get or create a channel
function getOrCreateChannel(channelPath) {
  if (!channels.has(channelPath)) {
    channels.set(channelPath, new Set());
    console.error(`Created new channel for path: ${channelPath}`);
  }
  return channels.get(channelPath);
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  // Extract the path from the URL
  const parsedUrl = parse(req.url);
  const path = parsedUrl.pathname;

  // Set channel based on connection path
  const clientChannel = path || '/';

  console.error(`Client connected from ${req.socket.remoteAddress} to path: ${clientChannel}`);

  // Add client to the channel based on path
  const channel = getOrCreateChannel(clientChannel);
  channel.add(ws);

  // Send welcome message with channel info
  ws.send(JSON.stringify({
    type: 'welcome',
    channel: clientChannel,
    message: `Connected to path: ${clientChannel}`
  }));

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.error(`Received message: ${data.type} on ${clientChannel}`);

      // Process message based on type
      switch (data.type) {
        case 'ping':
          handlePing(ws, data);
          break;

        case 'registerTool':
          handleRegisterTool(ws, clientChannel, data);
          break;

        case 'listTools':
          handleListTools(ws, clientChannel, data);
          break;

        case 'callTool':
          handleCallTool(ws, clientChannel, data);
          break;

        case 'toolResponse':
          handleToolResponse(data);
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: `Unknown message type: ${data.type}`
          }));
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      try {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        }));
      } catch (sendError) {
        console.error('Error sending error response:', sendError);
      }
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.error(`Client disconnected from path: ${clientChannel}`);

    // Remove from channel
    const channel = channels.get(clientChannel);
    if (channel) {
      channel.delete(ws);

      // Clean up empty channels
      if (channel.size === 0) {
        channels.delete(clientChannel);
        console.error(`Removed empty channel for path: ${clientChannel}`);

        // Clean up tools for this channel
        const toolsToRemove = [];
        for (const [toolId, toolInfo] of toolsRegistry.entries()) {
          if (toolInfo.channel === clientChannel) {
            toolsToRemove.push(toolId);
          }
        }

        toolsToRemove.forEach(toolId => {
          toolsRegistry.delete(toolId);
          console.error(`Removed tool: ${toolId} from path: ${clientChannel}`);
        });
      }
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);

    // Remove from channel
    const channel = channels.get(clientChannel);
    if (channel) {
      channel.delete(ws);
    }
  });
});

// Handle ping messages
function handlePing(ws, data) {
  ws.send(JSON.stringify({
    id: data.id,
    type: 'pong',
    timestamp: Date.now()
  }));
}

// Handle tool registration
function handleRegisterTool(ws, channelPath, data) {
  const { name, description, inputSchema } = data;

  if (!name) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Tool name is required'
    }));
    return;
  }

  // Create a unique tool ID for internal tracking
  const toolId = `${channelPath.slice(1)}-${name}`;

  // Register the tool
  toolsRegistry.set(toolId, {
    channel: channelPath,
    name,
    description: description || `Tool: ${name}`,
    inputSchema,
    originalName: name
  });

  ws.send(JSON.stringify({
    type: 'toolRegistered',
    name,
    toolId
  }));

  console.error(`Tool registered: ${toolId}`);
}

// Handle list tools requests
function handleListTools(ws, clientChannel, data) {
  const { id } = data;

  // Special handling if the request is from the MCP client
  const isMcpClient = (clientChannel === MCP_PATH);

  let tools;

  if (isMcpClient) {
    // For MCP clients, return all tools across all paths with path prefixes
    tools = Array.from(toolsRegistry.entries()).map(([toolId, toolInfo]) => {
      // Create a path-based fully qualified name - combine path and tool name
      const pathBasedName = `${toolInfo.channel.slice(1)}-${toolInfo.originalName}`;
      return {
        name: pathBasedName,
        description: toolInfo.description,
        inputSchema: toolInfo.inputSchema,
      };
    });
    console.error(`Sending all ${tools.length} tools to MCP client on path ${clientChannel}`);
  } else {
    // For regular clients, return only their own tools without path prefixes
    tools = Array.from(toolsRegistry.entries())
      .filter(([_, toolInfo]) => toolInfo.channel === clientChannel)
      .map(([_, toolInfo]) => ({
        name: toolInfo.originalName,
        description: toolInfo.description,
        inputSchema: toolInfo.inputSchema,
      }));
    console.error(`Sending ${tools.length} tools from path ${clientChannel}`);
  }

  ws.send(JSON.stringify({
    id,
    type: 'listToolsResponse',
    tools
  }));
}

// Handle tool call requests
function handleCallTool(ws, callerChannel, data) {
  const { id, tool, arguments: args } = data;

  // Special handling if the caller is on the MCP path
  const isMcpClient = (callerChannel === MCP_PATH);

  // If the caller is MCP, the tool name might include a path prefix
  let targetChannel;
  let toolName;

  if (isMcpClient && tool.startsWith('/')) {
    // Extract the path and tool name from the fully qualified name
    [targetChannel, toolName] = tool.slice(1).split("-").slice(1);
    targetChannel = `/${targetChannel}`;
  } else {
    // Check if the tool exists in the registry
    if (!toolsRegistry.has(tool)) {
      ws.send(JSON.stringify({
        id,
        type: 'toolResponse',
        error: `Tool not found: ${tool}`
      }));
      return;
    }

    const toolInfo = toolsRegistry.get(tool);
    targetChannel = toolInfo.channel;
    toolName = toolInfo.originalName;
  }

  // Get the target channel
  if (!channels.has(targetChannel) || channels.get(targetChannel).size === 0) {
    ws.send(JSON.stringify({
      id,
      type: 'toolResponse',
      error: `No clients available in channel ${targetChannel} to handle tool: ${toolName}`
    }));
    return;
  }

  // Pick the first client in the target channel (you could implement more sophisticated routing)
  const targetClient = channels.get(targetChannel).values().next().value;

  // Create a unique request ID for tracking
  const requestId = (requestIdCounter++).toString();

  // Store the pending request
  pendingRequests.set(requestId, {
    originalId: id,
    requesterWs: ws,
    timestamp: Date.now()
  });

  // Set up timeout for the request
  setTimeout(() => {
    if (pendingRequests.has(requestId)) {
      const { requesterWs, originalId } = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);

      try {
        requesterWs.send(JSON.stringify({
          id: originalId,
          type: 'toolResponse',
          error: `Tool call timed out: ${toolName}`
        }));
      } catch (error) {
        console.error('Error sending timeout response:', error);
      }
    }
  }, 30000); // 30 second timeout

  // Send the request to the target client
  targetClient.send(JSON.stringify({
    id: requestId,
    type: 'callTool',
    tool: toolName, // Send just the tool name without channel prefix
    arguments: args
  }));

  console.error(`Tool call forwarded: ${toolName} to channel: ${targetChannel}`);
}

// Handle tool response
function handleToolResponse(data) {
  const { id, result, error } = data;

  // Check if this is a response to a pending request
  if (!pendingRequests.has(id)) {
    console.error(`No pending request found for ID: ${id}`);
    return;
  }

  // Get the original requester information
  const { requesterWs, originalId } = pendingRequests.get(id);
  pendingRequests.delete(id);

  // Forward the response to the original requester
  try {
    requesterWs.send(JSON.stringify({
      id: originalId,
      type: 'toolResponse',
      result: result,
      error: error
    }));
  } catch (error) {
    console.error('Error forwarding tool response:', error);
  }
}

// Start the server
const PORT = process.env.PORT || 4797;
httpServer.listen(PORT, () => {
  console.error(`WebSocket server running at http://localhost:${PORT}`);
});

// Handle graceful shutdown
const shutdownGracefully = (signal) => {
  console.error(`\nReceived ${signal}. Shutting down gracefully...`);

  // Close all WebSocket connections in all channels
  for (const channel of channels.values()) {
    for (const ws of channel) {
      try {
        ws.close();
      } catch (error) {
        console.error('Error closing WebSocket connection:', error);
      }
    }
  }

  // Close the HTTP server
  httpServer.close(() => {
    console.error('HTTP server closed');
    process.exit(0);
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

export default httpServer;
