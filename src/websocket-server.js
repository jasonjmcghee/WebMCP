import * as fs from 'fs/promises';
import {WebSocketServer, WebSocket} from 'ws';
import {createServer} from 'http';
import {parse} from 'url';
import {fork} from 'child_process';
import {runMcpServer} from './server.js';
import {
    clearTokens,
    deleteToken, generateNewRegistrationToken,
    generateToken,
    getToken,
    loadAuthorizedTokens,
    saveAuthorizedTokens, saveServerTokenToEnv,
    setToken
} from "./tokens.js";
import {
    CONFIG,
    HOST,
    PID_FILE,
    SERVER_TOKEN,
    ensureConfigDir,
    formatChannel,
    setConfig,
    configureMcpClient,
} from './config.js';

let serverToken = SERVER_TOKEN;

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

// Function to send notifications to a client and MCP (if connected)
function sendNotification(clientWs, channelPath, notificationType, data, mcpOnly = false) {
    // Send to the client that initiated the action
    if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        if (!mcpOnly) {
            clientWs.send(JSON.stringify({
                type: notificationType,
                ...data
            }));
        }
    }

    // Also send to MCP if connected
    if (channels[MCP_PATH] && channels[MCP_PATH].size > 0) {
        channels[MCP_PATH].values().forEach((mcpClient) => {
            if (mcpClient && mcpClient.readyState === WebSocket.OPEN) {
                // For MCP, prefix names with the channel path
                const mcpData = {...data};
                if (mcpData.name && channelPath) {
                    mcpData.name = `${channelPath.slice(1)}-${mcpData.name}`;
                }

                mcpClient.send(JSON.stringify({
                    type: notificationType,
                    ...mcpData
                }));
            }
        });
    }
}

// Track all available tools, prompts, and resources across all channels
const toolsRegistry = {};
const promptsRegistry = {};
const resourcesRegistry = {};

// Request counter for unique IDs
let requestIdCounter = 1;

// Map to store pending requests
const pendingRequests = {};


// Function to verify client token during WebSocket handshake
async function verifyClientToken(info, callback) {
    const url = new URL(`https://${HOST}${info.req.url}`);
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
    if (getToken(path) === clientToken) {
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
                if (token !== getToken(serverChannel)) {
                    console.error('Invalid token provided');
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid token provided'
                    }));
                    ws.close(1008, 'Invalid token');
                    return;
                }

                // Throw away registration token and make a session token.
                deleteToken(serverChannel);
                const sessionToken = generateToken();

                // Authorize the channel-token pair
                setToken(channelPath, sessionToken);
                await saveAuthorizedTokens();

                // Send success response
                ws.send(JSON.stringify({
                    type: 'registerSuccess',
                    channel: channelPath,
                    message: `Registration successful for ${channelPath}`,
                    token: sessionToken
                }));

                console.error(`Registered channel: ${channelPath} with token: ${token}`);

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

                case 'registerPrompt':
                    handleRegisterPrompt(ws, clientChannel, data);
                    break;

                case 'registerResource':
                    handleRegisterResource(ws, clientChannel, data);
                    break;

                case 'listTools':
                    handleListTools(ws, clientChannel, data);
                    break;

                case 'listPrompts':
                    handleListPrompts(ws, clientChannel, data);
                    break;

                case 'listResources':
                    handleListResources(ws, clientChannel, data);
                    break;

                case 'callTool':
                    handleCallTool(ws, clientChannel, data);
                    break;

                case 'getPrompt':
                    handleGetPrompt(ws, clientChannel, data);
                    break;

                case 'readResource':
                    handleReadResource(ws, clientChannel, data);
                    break;

                case 'createSamplingMessage':
                    handleCreateSamplingMessage(ws, clientChannel, data);
                    break;

                case 'toolResponse':
                    handleToolResponse(data);
                    break;

                case 'promptResponse':
                    handlePromptResponse(data);
                    break;

                case 'resourceResponse':
                    handleResourceResponse(data);
                    break;

                case 'samplingResponse':
                    handleSamplingResponse(data);
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

                        // Clean up tools, prompts, and resources for this channel
                        const itemsToRemove = {
                            tools: [],
                            prompts: [],
                            resources: []
                        };

                        for (const [toolId, toolInfo] of Object.entries(toolsRegistry)) {
                            if (toolInfo.channel === clientChannel) {
                                itemsToRemove.tools.push(toolId);
                            }
                        }

                        for (const [promptId, promptInfo] of Object.entries(promptsRegistry)) {
                            if (promptInfo.channel === clientChannel) {
                                itemsToRemove.prompts.push(promptId);
                            }
                        }

                        for (const [resourceId, resourceInfo] of Object.entries(resourcesRegistry)) {
                            if (resourceInfo.channel === clientChannel) {
                                itemsToRemove.resources.push(resourceId);
                            }
                        }

                        itemsToRemove.tools.forEach(toolId => {
                            delete toolsRegistry[toolId];
                            console.error(`Removed tool: ${toolId} from path: ${clientChannel}`);
                        });

                        itemsToRemove.prompts.forEach(promptId => {
                            delete promptsRegistry[promptId];
                            console.error(`Removed prompt: ${promptId} from path: ${clientChannel}`);
                        });

                        itemsToRemove.resources.forEach(resourceId => {
                            delete resourcesRegistry[resourceId];
                            console.error(`Removed resource: ${resourceId} from path: ${clientChannel}`);
                        });

                        // Remove the authorized token for this channel if not MCP
                        if (clientChannel !== MCP_PATH) {
                            deleteToken(clientChannel);
                            await saveAuthorizedTokens();
                            console.error(`Removed authorized token for channel: ${clientChannel}`);
                        }

                        // Update them all
                        sendNotification(ws, undefined, 'toolRegistered', {}, true);
                        sendNotification(ws, undefined, 'promptRegistered', {}, true);
                        sendNotification(ws, undefined, 'resourceRegistered', {}, true);
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

    // Send registration notification to both client and MCP
    sendNotification(ws, channelPath, 'toolRegistered', {
        name,
        toolId
    });

    console.error(`Tool registered: ${toolId}`);
}

// Handle prompt registration
function handleRegisterPrompt(ws, channelPath, data) {
    const {name, description, arguments: promptArgs} = data;

    if (!name) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Prompt name is required'
        }));
        return;
    }

    // Create a unique prompt ID for internal tracking
    const promptId = `${channelPath.slice(1)}-${name}`;

    // Register the prompt
    promptsRegistry[promptId] = {
        channel: channelPath,
        name,
        description: description || `Prompt: ${name}`,
        arguments: promptArgs || [],
        originalName: name
    };

    // Send registration notification to both client and MCP
    sendNotification(ws, channelPath, 'promptRegistered', {
        name,
        promptId
    });

    console.error(`Prompt registered: ${promptId}`);
}

// Handle resource registration
function handleRegisterResource(ws, channelPath, data) {
    const {uri, name, description, mimeType, isTemplate, uriTemplate} = data;

    if ((!uri && !uriTemplate) || !name) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Resource URI/template and name are required'
        }));
        return;
    }

    // Create a unique resource ID for internal tracking
    const resourceId = `${channelPath.slice(1)}-${name}`;

    // Register the resource
    resourcesRegistry[resourceId] = {
        channel: channelPath,
        name,
        description: description || `Resource: ${name}`,
        uri: uri,
        uriTemplate: uriTemplate,
        isTemplate: !!isTemplate,
        mimeType,
        originalName: name
    };

    // Send registration notification to both client and MCP
    sendNotification(ws, channelPath, 'resourceRegistered', {
        name,
        resourceId
    });

    console.error(`Resource registered: ${resourceId}`);
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

// Handle list prompts requests
function handleListPrompts(ws, clientChannel, data) {
    const {id} = data;

    // Special handling if the request is from the MCP client
    const isMcpClient = (clientChannel === MCP_PATH);

    let prompts;

    if (isMcpClient) {
        // For MCP clients, return all prompts across all paths with path prefixes
        prompts = Object.entries(promptsRegistry).map(([promptId, promptInfo]) => {
            // Create a path-based fully qualified name - combine path and prompt name
            const pathBasedName = `${promptInfo.channel.slice(1)}-${promptInfo.originalName}`;
            return {
                name: pathBasedName,
                description: promptInfo.description,
                arguments: promptInfo.arguments,
            };
        });
        console.error(`Sending all ${prompts.length} prompts to MCP client on path ${clientChannel}`);
    } else {
        // For regular clients, return only their own prompts without path prefixes
        prompts = Object.entries(promptsRegistry)
            .filter(([_, promptInfo]) => promptInfo.channel === clientChannel)
            .map(([_, promptInfo]) => ({
                name: promptInfo.originalName,
                description: promptInfo.description,
                arguments: promptInfo.arguments,
            }));
        console.error(`Sending ${prompts.length} prompts from path ${clientChannel}`);
    }

    ws.send(JSON.stringify({
        id,
        type: 'listPromptsResponse',
        prompts
    }));
}

// Handle list resources requests
function handleListResources(ws, clientChannel, data) {
    const {id} = data;

    // Special handling if the request is from the MCP client
    const isMcpClient = (clientChannel === MCP_PATH);

    let resources = [];
    let resourceTemplates = [];

    if (isMcpClient) {
        // For MCP clients, return all resources across all paths with path prefixes
        Object.entries(resourcesRegistry).forEach(([resourceId, resourceInfo]) => {
            // Create a path-based fully qualified name - combine path and resource name
            const pathBasedName = `${resourceInfo.channel.slice(1)}-${resourceInfo.originalName}`;

            if (resourceInfo.isTemplate) {
                resourceTemplates.push({
                    name: pathBasedName,
                    description: resourceInfo.description,
                    uriTemplate: resourceInfo.uriTemplate,
                    mimeType: resourceInfo.mimeType,
                });
            } else {
                resources.push({
                    name: pathBasedName,
                    description: resourceInfo.description,
                    uri: resourceInfo.uri,
                    mimeType: resourceInfo.mimeType,
                });
            }
        });
        console.error(`Sending all ${resources.length} resources and ${resourceTemplates.length} templates to MCP client on path ${clientChannel}`);
    } else {
        // For regular clients, return only their own resources without path prefixes
        Object.entries(resourcesRegistry)
            .filter(([_, resourceInfo]) => resourceInfo.channel === clientChannel)
            .forEach(([_, resourceInfo]) => {
                if (resourceInfo.isTemplate) {
                    resourceTemplates.push({
                        name: resourceInfo.originalName,
                        description: resourceInfo.description,
                        uriTemplate: resourceInfo.uriTemplate,
                        mimeType: resourceInfo.mimeType,
                    });
                } else {
                    resources.push({
                        name: resourceInfo.originalName,
                        description: resourceInfo.description,
                        uri: resourceInfo.uri,
                        mimeType: resourceInfo.mimeType,
                    });
                }
            });
        console.error(`Sending ${resources.length} resources and ${resourceTemplates.length} templates from path ${clientChannel}`);
    }

    ws.send(JSON.stringify({
        id,
        type: 'listResourcesResponse',
        resources,
        resourceTemplates
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

// Handle get prompt requests
function handleGetPrompt(ws, callerChannel, data) {
    const {id, name, arguments: args} = data;

    // Special handling if the caller is on the MCP path
    const isMcpClient = (callerChannel === MCP_PATH);

    // If the caller is MCP, the prompt name might include a path prefix
    let targetChannel;
    let promptName;

    if (isMcpClient && name.startsWith('/')) {
        // Extract the path and prompt name from the fully qualified name
        [targetChannel, promptName] = name.slice(1).split("-").slice(1);
        targetChannel = `/${targetChannel}`;
    } else {
        // Check if the prompt exists in the registry
        const promptInfo = Object.values(promptsRegistry).find(p =>
            p.channel === callerChannel && p.originalName === name);

        if (!promptInfo) {
            ws.send(JSON.stringify({
                id,
                type: 'promptResponse',
                error: `Prompt not found: ${name}`
            }));
            return;
        }

        targetChannel = promptInfo.channel;
        promptName = promptInfo.originalName;
    }

    // Get the target channel
    if (!channels[targetChannel] || channels[targetChannel].size === 0) {
        ws.send(JSON.stringify({
            id,
            type: 'promptResponse',
            error: `No clients available in channel ${targetChannel} to handle prompt: ${promptName}`
        }));
        return;
    }

    // Pick the first client in the target channel
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
                    type: 'promptResponse',
                    error: `Prompt request timed out: ${promptName}`
                }));
            } catch (error) {
                console.error('Error sending timeout response:', error);
            }
        }
    }, 30000); // 30 second timeout

    // Send the request to the target client
    targetClient.send(JSON.stringify({
        id: requestId,
        type: 'getPrompt',
        name: promptName,
        arguments: args
    }));

    console.error(`Prompt request forwarded: ${promptName} to channel: ${targetChannel}`);
}

// Handle read resource requests
function handleReadResource(ws, callerChannel, data) {
    const {id, uri} = data;

    // Find the resource that matches this URI
    let targetChannel;
    let resourceName;
    let resourceInfo;

    // First, try to find an exact match for the URI
    for (const [resId, info] of Object.entries(resourcesRegistry)) {
        if (!info.isTemplate && info.uri === uri) {
            resourceInfo = info;
            targetChannel = info.channel;
            resourceName = info.originalName;
            break;
        }
    }

    // If no exact match, check for templates
    if (!resourceInfo) {
        // This is a simplistic approach; a real implementation would properly parse the URI template
        for (const [resId, info] of Object.entries(resourcesRegistry)) {
            if (info.isTemplate && uri.startsWith(info.uriTemplate.split('{')[0])) {
                resourceInfo = info;
                targetChannel = info.channel;
                resourceName = info.originalName;
                break;
            }
        }
    }

    if (!resourceInfo) {
        ws.send(JSON.stringify({
            id,
            type: 'resourceResponse',
            error: `Resource not found for URI: ${uri}`
        }));
        return;
    }

    // Get the target channel
    if (!channels[targetChannel] || channels[targetChannel].size === 0) {
        ws.send(JSON.stringify({
            id,
            type: 'resourceResponse',
            error: `No clients available in channel ${targetChannel} to handle resource: ${resourceName}`
        }));
        return;
    }

    // Pick the first client in the target channel
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
                    type: 'resourceResponse',
                    error: `Resource request timed out: ${uri}`
                }));
            } catch (error) {
                console.error('Error sending timeout response:', error);
            }
        }
    }, 30000); // 30 second timeout

    // Send the request to the target client
    targetClient.send(JSON.stringify({
        id: requestId,
        type: 'readResource',
        uri: uri
    }));

    console.error(`Resource request forwarded: ${uri} to channel: ${targetChannel}`);
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

// Handle prompt response
function handlePromptResponse(data) {
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
            type: 'promptResponse',
            result: result,
            error: error
        }));
    } catch (error) {
        console.error('Error forwarding prompt response:', error);
    }
}

// Handle resource response
function handleResourceResponse(data) {
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
            type: 'resourceResponse',
            result: result,
            error: error
        }));
    } catch (error) {
        console.error('Error forwarding resource response:', error);
    }
}

// Handle sampling response
function handleSamplingResponse(data) {
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
            type: 'samplingResponse',
            result: result,
            error: error
        }));
    } catch (error) {
        console.error('Error forwarding sampling response:', error);
    }
}

// Handle create sampling message
function handleCreateSamplingMessage(ws, callerChannel, data) {
    const {
        id,
        messages,
        systemPrompt,
        includeContext,
        temperature,
        maxTokens,
        stopSequences,
        metadata,
        modelPreferences
    } = data;

    // Special handling if the caller is on the MCP path
    const isMcpClient = (callerChannel === MCP_PATH);

    // For non-MCP clients or if no client is available in any channel
    if (!isMcpClient) {
        ws.send(JSON.stringify({
            id,
            type: 'samplingResponse',
            error: `Sampling is only available through MCP path`
        }));
        return;
    }

    // Find a client that can handle sampling - target the first available client
    let targetClient = null;
    let targetChannel = null;

    // Iterate through all channels to find one with clients
    for (const [channel, clients] of Object.entries(channels)) {
        if (channel !== MCP_PATH && clients.size > 0) {
            targetClient = clients.values().next().value;
            targetChannel = channel;
            break;
        }
    }

    if (!targetClient) {
        ws.send(JSON.stringify({
            id,
            type: 'samplingResponse',
            error: 'No clients available to handle sampling request'
        }));
        return;
    }

    // Create a unique request ID for tracking
    const requestId = (requestIdCounter++).toString();

    // Store the pending request
    pendingRequests[requestId] = {
        originalId: id,
        requesterWs: ws,
        timestamp: Date.now()
    };

    // Set up timeout for the request (longer timeout for sampling)
    setTimeout(() => {
        if (pendingRequests[requestId]) {
            const {requesterWs, originalId} = pendingRequests[requestId];
            delete pendingRequests[requestId];

            try {
                requesterWs.send(JSON.stringify({
                    id: originalId,
                    type: 'samplingResponse',
                    error: 'Sampling request timed out'
                }));
            } catch (error) {
                console.error('Error sending timeout response:', error);
            }
        }
    }, 120000); // 120 second timeout for sampling

    // Forward the request to the target client
    targetClient.send(JSON.stringify({
        id: requestId,
        type: 'createSamplingMessage',
        messages,
        systemPrompt,
        includeContext,
        temperature,
        maxTokens,
        stopSequences,
        metadata,
        modelPreferences
    }));

    console.error(`Sampling request forwarded to channel: ${targetChannel}`);
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
    setToken(channel, token);
    await saveAuthorizedTokens();

    return {
        success: true,
        message: `Authorized channel: ${channel}`,
        channel,
        token
    };
}

// Function to check if server is already running
async function isServerRunning() {
    // If using "docker" and "startMCP" just assume the server is running
    if (CONFIG.startMCP && CONFIG.docker) {
        return true;
    }

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
async function daemonize() {
    // Fork a new process that will become the daemon
    const args = process.argv.slice(2);

    // Make sure the --forked flag is included
    if (!args.includes('--forked')) {
        args.push('--forked');
    }

    // Create a detached child process
    const child = fork(process.argv[1], args, {
        detached: true,
        stdio: 'ignore'
    });

    // Detach the child process so it can run independently
    child.unref();

    console.error(`Server started as daemon with PID: ${child.pid}`);
    console.error(`Use 'node websocket-server.js --quit' to stop the server`);
    console.error(`Use 'node websocket-server.js --new <encoded-pair>' to authorize a channel-token pair`);
    console.error(`Put 'npx @jason.today/webmcp --mcp' in your mcp client config`);
    if (!CONFIG.startMCP) {
        process.exit(0);
    }
}

const parseArgs = async () => {
    const args = process.argv.slice(2);
    let port = 4797; // Default port
    let quit = false;
    let newToken = false;
    let startMCP = false;
    let docker = false;
    let cleanTokens = false;
    let encodedPair = null;
    let daemon = true; // Default to daemonize

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
        } else if (arg === '--config') {
            if (i + 1 < args.length) {
                const config = args[i + 1];
                await configureMcpClient(config)
                i++; // Skip the next argument as we've already processed it
            } else {
                console.error('Error: Config option requires a mcp client type or path to json');
                showHelp();
                process.exit(1);
            }
        } else if (arg === '-q' || arg === '--quit') {
            quit = true;
        } else if (arg === '-n' || arg === '--new') {
            newToken = true;
        } else if (arg === '-m' || arg === '--mcp') {
            startMCP = true;
        } else if (arg === '-d' || arg === '--docker') {
            docker = true;
        } else if (arg === '-c' || arg === '--clean') {
            cleanTokens = true;
        } else if (arg === '-f' || arg === '--foreground') {
            daemon = false;
        } else if (arg === '--forked') {
            // This is an internal flag to indicate we're the forked child                                                                                                   │ │
            // No need to do anything with it here, just don't error on it
        } else {
            console.error(`Error: Unknown option: ${arg}`);
            showHelp();
            process.exit(1);
        }
    }

    return {port, quit, newToken, cleanTokens, encodedPair, daemon, startMCP};
};

const showHelp = () => {
    console.log(`
Usage: node websocket-server.js [options]

Options:
  --config                       Automatically update MCP client configuration to add WebMCP
  -p, --port <number>            Specify the port number (default: 4797)
  -h, --help                     Display this help message
  -q, --quit                     Stop the running server
  -n, --new                      Generate a new token for client registration
  -c, --clean                    Remove all authorized tokens
  -f, --foreground               Run in foreground (don't daemonize)
  -m, --mcp                      Internal WebMCP Server codepath, likely only used in MCP client config
  -d, --docker                   Tell the MCP client that WebMCP is running in docker
  
Use --new to generate a token which clients can use to register on the /register endpoint.
Use --clean to remove all authorized tokens when you want to start fresh.
  `);
};

const main = async () => {
    // Ensure the config directory exists
    await ensureConfigDir();

    // Load authorized tokens from disk
    await loadAuthorizedTokens();

    setConfig(await parseArgs());

    // Check if server is already running
    const serverStatus = await isServerRunning();

    // Handle clean tokens command
    if (CONFIG.cleanTokens) {
        console.log(`Removing all authorized tokens...`);
        clearTokens();
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
        const encodedData = await generateNewRegistrationToken();
        console.log(`\nCONNECTION TOKEN (paste this in your web client):`);
        console.log(`${encodedData}\n`);

        // If server is running, exit
        if (serverStatus.running) {
            process.exit(0);
        }
    }

    // Check if we have a server token, generate one if not
    if (!serverToken) {
        // console.log('No server token found, generating a new one...');
        serverToken = generateToken();
        await saveServerTokenToEnv(serverToken);
        // console.log(`New server token: "${serverToken}". Saved to .env`);
    }

    // If server is already running and we're not authorizing a token, just show status and exit
    if (serverStatus.running) {
        console.error(`Server is already running with PID: ${serverStatus.pid}`);
        console.error(`Use 'node websocket-server.js --quit' to stop the server`);
        console.error(`Use 'node websocket-server.js --new <encoded-pair>' to authorize a channel-token pair`);
        console.error(`Put 'npx @jason.today/webmcp --mcp' in your mcp client config`);
        if (CONFIG.startMCP) {
            return;
        } else {
            process.exit(0);
        }
    }

    // Daemonize if requested
    if (CONFIG.daemon) {
        // We need to add a marker to args to prevent fork bombs
        // If we already have the --forked flag, we're in the child process and should continue
        if (!process.argv.includes('--forked')) {
            // Add the --forked flag to the arguments before daemonizing
            process.argv.push('--forked');
            return daemonize();
        }
    }

    // If we have the --forked flag, we're already the daemon, continue execution
    // Save PID file
    await savePid();

    // Start the server
    const PORT = CONFIG.port;
    httpServer.listen(PORT, () => {
        console.error(`WebSocket server running at http://${HOST}:${PORT}`);
        console.error(`WebSocket server running at http://${HOST}:${PORT}`);
        console.error(`WebMCP client token (for MCP path): ${serverToken}`);
        console.error(`WebMCP client URL: ws://${HOST}:${PORT}${MCP_PATH}?token=${serverToken}`);
        console.error(`Use 'node websocket-server.js --new <encoded-pair>' to authorize a channel-token pair`);
    });

    // Handle graceful shutdown
    const shutdownGracefully = async (signal) => {
        console.error(`\nReceived ${signal}. Shutting down gracefully...`);

        // Save authorized tokens before shutting down
        await saveAuthorizedTokens();

        // Close all WebSocket connections in all channels
        for (const channel of Object.values(channels)) {
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
}).then(() => {
    // Handle starting MCP
    if (CONFIG.startMCP) {
        setTimeout(() => {
            console.error("Starting up MCP Server")
            runMcpServer(serverToken).catch((error) => {
                console.error("Fatal error in main():", error);
                process.exit(1);
            });
        }, 100);
    }
});
