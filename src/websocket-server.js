import {WebSocketServer} from 'ws';
import {createServer} from 'http';
import {parse} from 'url';
import fs from 'fs/promises';
import {fork} from 'child_process';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import {fileURLToPath} from 'url';

// Get directory name for current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Process ID file path
const PID_FILE = path.join(__dirname, '..', '.webmcp-server.pid');
// Environment file path
const ENV_FILE = path.join(__dirname, '..', '.env');
// Tokens file path
const TOKENS_FILE = path.join(__dirname, '..', '.webmcp-tokens.json');

const HOST = "localhost";
// Updated later...
let CONFIG = {};

// Load environment variables
dotenv.config({path: ENV_FILE});

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

    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('MCP WebSocket server is running');
});

// Create WebSocket server instance
const wss = new WebSocketServer({
    server: httpServer,
    clientTracking: true,
    verifyClient: verifyClientToken
});

// Store active WebSocket connections by channel
const channels = {};

// Special channel paths
const MCP_PATH = '/mcp';
const REGISTER_PATH = '/register';

// Track all available tools across all channels
const toolsRegistry = {};

// Request counter for unique IDs
let requestIdCounter = 1;

// Map to store pending requests
const pendingRequests = {};

// Server master token (never shared, used to authenticate admin commands)
let serverToken = process.env.WEBMCP_SERVER_TOKEN || '';

// Authorized channel-token pairs - Only channels with valid tokens can connect
// Format: { "/channel1": "token123" }
let authorizedTokens = {};

// Load authorized tokens from disk
async function loadAuthorizedTokens() {
    try {
        const data = await fs.readFile(TOKENS_FILE, 'utf8');
        authorizedTokens = JSON.parse(data || "{}");

        console.error(`Loaded ${Object.keys(authorizedTokens).length} authorized channel-token pairs from ${TOKENS_FILE}`);
        return true;
    } catch (error) {
        // If file doesn't exist, start with empty tokens
        if (error.code === 'ENOENT') {
            authorizedTokens = {};
            return true;
        }
        console.error('Error loading authorized tokens:', error);
        return false;
    }
}

// Save authorized tokens to disk
async function saveAuthorizedTokens() {
    try {
        // Convert Map to object for JSON serialization
        const stringified = JSON.stringify(authorizedTokens, null, 2);
        await fs.writeFile(TOKENS_FILE, stringified, 'utf8');
        console.error(`Saved ${stringified} authorized channel-token pairs to ${TOKENS_FILE}`);
        return true;
    } catch (error) {
        console.error('Error saving authorized tokens:', error);
        return false;
    }
}

// Function to verify client token during WebSocket handshake
async function verifyClientToken(info, callback) {
    const url = new URL(`http://${HOST}${info.req.url}`);
    const clientToken = url.searchParams.get('token');
    const path = url.pathname || '/';

    // Special case for MCP path - use server token from .env
    if (path === MCP_PATH) {
        // For MCP connections, we use the token from the .env file
        if (clientToken === process.env.WEBMCP_SERVER_TOKEN) {
            return callback(true);
        }
        console.error('Invalid MCP token provided');
        return callback(false, 401, 'Unauthorized - Invalid MCP token');
    }

    // Special case for registration path - allow all connections for now
    // The actual authorization will happen in the connection handler
    if (path === REGISTER_PATH) {
        return callback(true);
    }

    // For other paths, check if the channel-token pair is authorized
    if (!clientToken) {
        console.error('No token provided for path:', path);
        return callback(false, 401, 'Unauthorized - No token provided');
    }

    await loadAuthorizedTokens();

    // Check if this channel has a valid token and it matches
    if (authorizedTokens[path] === clientToken) {
        return callback(true);
    }

    console.error(`Unauthorized connection attempt to ${path}`);
    return callback(false, 401, 'Unauthorized - Invalid channel-token pair');
}

// Helper function to get or create a channel
function getOrCreateChannel(channelPath) {
    if (!channels[channelPath]) {
        channels[channelPath] = new Set();
        console.error(`Created new channel for path: ${channelPath}`);
    } else if (channels[channelPath].closeTimeout) {
        // Clear the timeout if it exists (someone is joining an empty channel)
        clearTimeout(channels[channelPath].closeTimeout);
        delete channels[channelPath].closeTimeout;
        console.error(`Cancelled channel closure for ${channelPath} as a new client connected`);
    }
    return channels[channelPath];
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    // Extract the path from the URL
    const parsedUrl = parse(req.url);
    const path = parsedUrl.pathname;

    // Set channel based on connection path
    const clientChannel = path || '/';

    console.error(`Client connected from ${req.socket.remoteAddress} to path: ${clientChannel}`);

    // Special handling for registration endpoint
    if (clientChannel === REGISTER_PATH) {
        console.error(`Registration request received from ${req.socket.remoteAddress}`);

        // Wait for the first message which should contain the registration data
        let registrationTimeout = setTimeout(() => {
            console.error('Registration timeout - closing connection');
            ws.close(1008, 'Registration timeout');
        }, 30000); // 30 second timeout

        // Register message handler specifically for registration
        ws.once('message', async (message) => {
            clearTimeout(registrationTimeout);

            try {
                // The message should be base64 encoded JSON with server and token
                const encodedData = message.toString();
                const decodedJson = Buffer.from(encodedData, 'base64').toString('utf8');
                const connectionData = JSON.parse(decodedJson);

                const {host, token} = connectionData;

                if (!token) {
                    console.error('Invalid registration data format - missing token');
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid registration data format - missing token'
                    }));
                    ws.close(1008, 'Invalid registration data');
                    return;
                }

                // Format the channel path (replace : with _)
                const channelPath = formatChannel(host);

                // Check if this is a valid token from a "--new" command
                if (!token || token.length < 16) {
                    console.error('Invalid token provided');
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid token provided'
                    }));
                    ws.close(1008, 'Invalid token');
                    return;
                }

                const serverChannel = formatChannel(`${HOST}:${CONFIG.port}`);

                await loadAuthorizedTokens();
                if (token !== authorizedTokens[serverChannel]) {
                    console.error('Invalid token provided');
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid token provided'
                    }));
                    ws.close(1008, 'Invalid token');
                    return;
                }

                // Authorize the channel-token pair
                authorizedTokens[channelPath] = token;
                delete authorizedTokens[serverChannel];
                await saveAuthorizedTokens();

                console.error(`Registered channel: ${channelPath} with token: ${token}`);

                // Send success response
                ws.send(JSON.stringify({
                    type: 'registerSuccess',
                    channel: channelPath,
                    message: `Registration successful for ${channelPath}`,
                    token: token
                }));

                // Close the registration connection - they'll reconnect to their channel
                ws.close(1000, 'Registration complete');
            } catch (error) {
                console.error('Registration error:', error);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Registration error'
                }));
                ws.close(1011, 'Registration error');
            }
        });

        return; // Don't proceed with the normal connection handling
    }

    // Add client to the channel based on path (for non-registration paths)
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
    ws.on('close', async () => {
        console.error(`Client disconnected from path: ${clientChannel}`);

        // Remove from channel
        const channel = channels[clientChannel];
        if (channel) {
            channel.delete(ws);

            // Set a timer to clean up empty channels after 1 minute
            if (channel.size === 0) {
                console.error(`Channel ${clientChannel} is empty, will close in 1 minute if no one joins`);

                // Store the timeout in the channel object so we can clear it if needed
                channel.closeTimeout = setTimeout(async () => {
                    // Check if the channel is still empty after 1 minute
                    if (channels[clientChannel] && channels[clientChannel].size === 0) {
                        delete channels[clientChannel];
                        console.error(`Removed empty channel for path: ${clientChannel} after 1 minute inactivity`);

                        // Clean up tools for this channel
                        const toolsToRemove = [];
                        for (const [toolId, toolInfo] of Object.entries(toolsRegistry)) {
                            if (toolInfo.channel === clientChannel) {
                                toolsToRemove.push(toolId);
                            }
                        }

                        toolsToRemove.forEach(toolId => {
                            delete toolsRegistry[toolId];
                            console.error(`Removed tool: ${toolId} from path: ${clientChannel}`);
                        });

                        // Remove the authorized token for this channel if not MCP
                        if (clientChannel !== MCP_PATH) {
                            delete authorizedTokens[clientChannel];
                            await saveAuthorizedTokens();
                            console.error(`Removed authorized token for channel: ${clientChannel}`);
                        }
                    }
                }, 60000); // 1 minute timeout
            }
        }
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);

        // Remove from channel
        const channel = channels[clientChannel];
        if (channel) {
            channel.delete(ws);
        }
    });
});

function formatChannel(channel) {
    return `/${channel.replace(/[.:]/g, '_')}`
}

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
    const {name, description, inputSchema} = data;

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
    toolsRegistry[toolId] = {
        channel: channelPath,
        name,
        description: description || `Tool: ${name}`,
        inputSchema,
        originalName: name
    };

    ws.send(JSON.stringify({
        type: 'toolRegistered',
        name,
        toolId
    }));

    console.error(`Tool registered: ${toolId}`);
}

// Handle list tools requests
function handleListTools(ws, clientChannel, data) {
    const {id} = data;

    // Special handling if the request is from the MCP client
    const isMcpClient = (clientChannel === MCP_PATH);

    let tools;

    if (isMcpClient) {
        // For MCP clients, return all tools across all paths with path prefixes
        tools = Object.entries(toolsRegistry).map(([toolId, toolInfo]) => {
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
        tools = Object.entries(toolsRegistry)
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
    const {id, tool, arguments: args} = data;

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
        if (!toolsRegistry[tool]) {
            ws.send(JSON.stringify({
                id,
                type: 'toolResponse',
                error: `Tool not found: ${tool}`
            }));
            return;
        }

        const toolInfo = toolsRegistry[tool];
        targetChannel = toolInfo.channel;
        toolName = toolInfo.originalName;
    }

    // Get the target channel
    if (!channels[targetChannel] || channels[targetChannel].size === 0) {
        ws.send(JSON.stringify({
            id,
            type: 'toolResponse',
            error: `No clients available in channel ${targetChannel} to handle tool: ${toolName}`
        }));
        return;
    }

    // Pick the first client in the target channel (you could implement more sophisticated routing)
    const targetClient = channels[targetChannel].values().next().value;

    // Create a unique request ID for tracking
    const requestId = (requestIdCounter++).toString();

    // Store the pending request
    pendingRequests[requestId] = {
        originalId: id,
        requesterWs: ws,
        timestamp: Date.now()
    };

    // Set up timeout for the request
    setTimeout(() => {
        if (pendingRequests[requestId]) {
            const {requesterWs, originalId} = pendingRequests[requestId];
            delete pendingRequests[requestId];

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
    const {id, result, error} = data;

    // Check if this is a response to a pending request
    if (!pendingRequests[id]) {
        console.error(`No pending request found for ID: ${id}`);
        return;
    }

    // Get the original requester information
    const {requesterWs, originalId} = pendingRequests[id];
    delete pendingRequests[id];

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

// Function to generate a secure random token
function generateToken() {
    return crypto.randomBytes(16).toString('hex');
}

// Function to decode a base64 encoded channel-token pair
function decodeChannelTokenPair(encodedPair) {
    try {
        const decodedString = Buffer.from(encodedPair, 'base64').toString('utf8');
        const [channel, token] = decodedString.split(':');

        if (!channel || !token) {
            throw new Error('Invalid format');
        }

        // Ensure channel has leading slash
        const formattedChannel = channel.startsWith('/') ? channel : `/${channel}`;

        return {channel: formattedChannel, token};
    } catch (error) {
        console.error('Error decoding channel-token pair:', error);
        return null;
    }
}

// Function to authorize a new channel-token pair
async function authorizeChannelToken(encodedPair) {
    const decoded = decodeChannelTokenPair(encodedPair);
    if (!decoded) {
        return {success: false, message: 'Invalid encoded channel-token pair'};
    }

    const {channel, token} = decoded;

    // Check if this channel already has an active connection
    if (channels[channel] && channels[channel].size > 0) {
        return {success: false, message: `Channel ${channel} already has an active connection`};
    }

    // Add to authorized tokens
    authorizedTokens[channel] = token;
    await saveAuthorizedTokens();

    return {
        success: true,
        message: `Authorized channel: ${channel}`,
        channel,
        token
    };
}

// Function to save server token to .env file
async function saveServerTokenToEnv(token) {
    try {
        let envContent = '';

        try {
            // Try to read existing .env file
            envContent = await fs.readFile(ENV_FILE, 'utf8');

            // Check if WEBMCP_SERVER_TOKEN is already defined
            if (envContent.includes('WEBMCP_SERVER_TOKEN=')) {
                // Replace the existing token
                envContent = envContent.replace(/WEBMCP_SERVER_TOKEN=.*(\r?\n|$)/g, `WEBMCP_SERVER_TOKEN=${token}$1`);
            } else {
                // Add the token to the end
                envContent += `\nWEBMCP_SERVER_TOKEN=${token}\n`;
            }
        } catch (err) {
            // File doesn't exist, create new content
            envContent = `WEBMCP_SERVER_TOKEN=${token}\n`;
        }

        // Write the content to the .env file
        await fs.writeFile(ENV_FILE, envContent, 'utf8');
        console.error(`Server token saved to ${ENV_FILE}`);
        return true;
    } catch (error) {
        console.error('Error saving server token to .env file:', error);
        return false;
    }
}

// Function to check if server is already running
async function isServerRunning() {
    try {
        // Check if PID file exists
        const pidData = await fs.readFile(PID_FILE, 'utf8');
        const pid = parseInt(pidData.trim(), 10);

        // Check if process with this PID is running
        // This is platform-specific, using a simple approach
        try {
            process.kill(pid, 0); // This doesn't actually kill the process, just checks if it exists
            return {running: true, pid};
        } catch (e) {
            // Process not running, remove stale PID file
            await fs.unlink(PID_FILE);
            return {running: false};
        }
    } catch (error) {
        // PID file doesn't exist or other error
        return {running: false};
    }
}

// Function to save current PID to file
async function savePid() {
    try {
        await fs.writeFile(PID_FILE, process.pid.toString(), 'utf8');
        return true;
    } catch (error) {
        console.error('Error saving PID file:', error);
        return false;
    }
}

// Function to run the server in the background
function daemonize() {
    // If we're already a daemon, just continue
    if (process.env.WEBMCP_DAEMON === 'true') {
        return true;
    }

    // Fork a new process that will become the daemon
    const args = process.argv.slice(2);

    // Add flag to prevent infinite forking
    const child = fork(process.argv[1], [...args], {
        detached: true,
        stdio: 'ignore',
        env: {...process.env, WEBMCP_DAEMON: 'true'}
    });

    // Detach the child process so it can run independently
    child.unref();

    console.log(`Server started as daemon with PID: ${child.pid}`);
    process.exit(0);
}

const parseArgs = () => {
    const args = process.argv.slice(2);
    let port = 4797; // Default port
    let quit = false;
    let newToken = false;
    let cleanTokens = false;
    let encodedPair = null;
    let daemon = !process.env.WEBMCP_DAEMON; // Default to daemonize unless already a daemon

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '-h' || arg === '--help') {
            showHelp();
            process.exit(0);
        } else if (arg === '-p' || arg === '--port') {
            if (i + 1 < args.length) {
                const portArg = parseInt(args[i + 1], 10);
                if (isNaN(portArg) || portArg < 1 || portArg > 65535) {
                    console.error('Error: Port must be a number between 1 and 65535');
                    showHelp();
                    process.exit(1);
                }
                port = portArg;
                i++; // Skip the next argument as we've already processed it
            } else {
                console.error('Error: Port option requires a value');
                showHelp();
                process.exit(1);
            }
        } else if (arg === '-q' || arg === '--quit') {
            quit = true;
        } else if (arg === '-n' || arg === '--new') {
            newToken = true;
            // No need for encoded pair, we'll generate it
        } else if (arg === '-c' || arg === '--clean') {
            cleanTokens = true;
        } else if (arg === '-f' || arg === '--foreground') {
            daemon = false;
        } else {
            console.error(`Error: Unknown option: ${arg}`);
            showHelp();
            process.exit(1);
        }
    }

    return {port, quit, newToken, cleanTokens, encodedPair, daemon};
};

const showHelp = () => {
    console.log(`
Usage: node websocket-server.js [options]

Options:
  -p, --port <number>            Specify the port number (default: 4797)
  -h, --help                     Display this help message
  -q, --quit                     Stop the running server
  -n, --new                      Generate a new token for client registration
  -c, --clean                    Remove all authorized tokens
  -f, --foreground               Run in foreground (don't daemonize)
  
Use --new to generate a token which clients can use to register on the /register endpoint.
Use --clean to remove all authorized tokens when you want to start fresh.
  `);
};

const main = async () => {
    // Load authorized tokens from disk
    await loadAuthorizedTokens();

    CONFIG = parseArgs();

    // Check if server is already running
    const serverStatus = await isServerRunning();

    // Handle clean tokens command
    if (CONFIG.cleanTokens) {
        console.log(`Removing all authorized tokens...`);
        authorizedTokens = {};
        await saveAuthorizedTokens();
        console.log(`All tokens have been removed. Tokens file cleared.`);

        // If server is running, we need to notify it to reload tokens
        if (serverStatus.running) {
            console.log(`Server is running with PID: ${serverStatus.pid}. Please restart it to apply changes.`);
        }

        process.exit(0);
    }

    // Handle quit command
    if (CONFIG.quit) {
        if (serverStatus.running) {
            console.log(`Stopping server with PID: ${serverStatus.pid}`);
            try {
                process.kill(serverStatus.pid, 'SIGTERM');
                console.log('Server stopped successfully');
            } catch (error) {
                console.error('Error stopping server:', error);
            }
        } else {
            console.log('No running server found');
        }
        process.exit(0);
    }

    // Handle new token generation
    if (CONFIG.newToken) {
        // Generate a random token for registration
        const token = generateToken();

        // Create a connection object with server address and token
        const address = `${HOST}:${CONFIG.port}`;
        const serverAddress = `ws://${address}`;
        const connectionData = {
            server: serverAddress,
            token: token
        };

        // Convert to JSON and base64 encode
        const jsonStr = JSON.stringify(connectionData);
        const encodedData = Buffer.from(jsonStr).toString('base64');

        console.log(`\nCONNECTION TOKEN (paste this in your web client):`);
        console.log(`${encodedData}\n`);

        authorizedTokens[formatChannel(address)] = token;
        await saveAuthorizedTokens();

        // If server isn't running, exit
        if (serverStatus.running) {
            console.log(`Server is running with PID: ${serverStatus.pid}`);
            process.exit(0);
        }
    }

    // If server is already running and we're not authorizing a token, just show status and exit
    if (serverStatus.running) {
        console.log(`Server is already running with PID: ${serverStatus.pid}`);
        console.log(`Use 'node websocket-server.js --quit' to stop the server`);
        console.log(`Use 'node websocket-server.js --new <encoded-pair>' to authorize a channel-token pair`);
        process.exit(0);
    }

    // Check if we have a server token, generate one if not
    if (!serverToken) {
        console.log('No server token found, generating a new one...');
        serverToken = generateToken();
        await saveServerTokenToEnv(serverToken);
        console.log(`New server token generated and saved to .env`);
    }

    // Daemonize if requested
    if (CONFIG.daemon) {
        return daemonize();
    }

    // Save PID file
    await savePid();

    // Start the server
    const PORT = CONFIG.port;
    httpServer.listen(PORT, () => {
        console.error(`WebSocket server running at http://${HOST}:${PORT}`);
        console.log(`WebSocket server running at http://${HOST}:${PORT}`);
        console.log(`Server has ${Object.keys(authorizedTokens).length} authorized channels`);
        console.log(`WebMCP client token (for MCP path): ${serverToken}`);
        console.log(`WebMCP client URL: ws://${HOST}:${PORT}${MCP_PATH}?token=${serverToken}`);
        console.log(`Use 'node websocket-server.js --new <encoded-pair>' to authorize a channel-token pair`);
    });

    // Handle graceful shutdown
    const shutdownGracefully = async (signal) => {
        console.error(`\nReceived ${signal}. Shutting down gracefully...`);

        // Save authorized tokens before shutting down
        await saveAuthorizedTokens();

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

            // Remove PID file
            fs.unlink(PID_FILE).catch(err => {
                console.error('Error removing PID file:', err);
            });

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
};

main().catch(error => {
    console.error('Error in main:', error);
    process.exit(1);
});
