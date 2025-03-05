import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import WebSocket from 'ws';
import {
    CallToolRequestSchema,
    CreateMessageRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

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
                listChanged: true
            },
            prompts: {
                listChanged: true
            },
            resources: {
                listChanged: true,
                subscribe: true
            },
            sampling: {}
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
            const {id, result, error} = data;

            // Check if this is a response to a pending request
            if (pendingRequests.has(id)) {
                const {resolve, reject} = pendingRequests.get(id);
                pendingRequests.delete(id);

                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(result);
                }
            } else {
                console.error(`No pending request found for ID: ${id}`);
            }
        } else if (data.type === 'promptResponse') {
            // Handle prompt response from WebSocket server
            const {id, result, error} = data;

            // Check if this is a response to a pending request
            if (pendingRequests.has(id)) {
                const {resolve, reject} = pendingRequests.get(id);
                pendingRequests.delete(id);

                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(result);
                }
            } else {
                console.error(`No pending request found for ID: ${id}`);
            }
        } else if (data.type === 'resourceResponse') {
            // Handle resource response from WebSocket server
            const {id, result, error} = data;

            // Check if this is a response to a pending request
            if (pendingRequests.has(id)) {
                const {resolve, reject} = pendingRequests.get(id);
                pendingRequests.delete(id);

                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(result);
                }
            } else {
                console.error(`No pending request found for ID: ${id}`);
            }
        } else if (data.type === 'samplingResponse') {
            // Handle sampling response from WebSocket server
            const {id, result, error} = data;

            // Check if this is a response to a pending request
            if (pendingRequests.has(id)) {
                const {resolve, reject} = pendingRequests.get(id);
                pendingRequests.delete(id);

                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(result);
                }
            } else {
                console.error(`No pending request found for ID: ${id}`);
            }
        } else if (data.type === 'listToolsResponse') {
            // Handle list tools response from WebSocket server
            const {id, tools, error} = data;

            // Check if this is a response to a pending request
            if (pendingRequests.has(id)) {
                const {resolve, reject} = pendingRequests.get(id);
                pendingRequests.delete(id);

                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(tools);
                }
            } else {
                console.error(`No pending request found for ID: ${id}`);
            }
        } else if (data.type === 'listPromptsResponse') {
            // Handle list prompts response from WebSocket server
            const {id, prompts, error} = data;

            // Check if this is a response to a pending request
            if (pendingRequests.has(id)) {
                const {resolve, reject} = pendingRequests.get(id);
                pendingRequests.delete(id);

                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(prompts);
                }
            } else {
                console.error(`No pending request found for ID: ${id}`);
            }
        } else if (data.type === 'listResourcesResponse') {
            // Handle list resources response from WebSocket server
            const {id, resources, resourceTemplates, error} = data;

            // Check if this is a response to a pending request
            if (pendingRequests.has(id)) {
                const {resolve, reject} = pendingRequests.get(id);
                pendingRequests.delete(id);

                if (error) {
                    reject(new Error(error));
                } else {
                    resolve({resources, resourceTemplates});
                }
            } else {
                console.error(`No pending request found for ID: ${id}`);
            }
        } else if (data.type === 'welcome') {
            // Welcome message from the server, we're already connected to the MCP path
            console.error(`Connected to path: ${data.channel}`);
        } else if (data.type === 'pong') {
            // Pong response
            console.error(`Received pong with timestamp: ${data.timestamp}`);
        } else if (data.type === 'error') {
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
        pendingRequests.set(requestId, {resolve, reject});

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
        return await responsePromise;
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
        return {tools: []};
    }

    // Create a unique request ID
    const requestId = (requestIdCounter++).toString();

    // Create a promise that will be resolved when we get a response
    const responsePromise = new Promise((resolve, reject) => {
        // Store the resolver functions
        pendingRequests.set(requestId, {resolve, reject});

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
        return {tools};
    } catch (error) {
        console.error('Error listing tools:', error);
        return {tools: []}; // Return empty list on error
    }
});

// Set up the MCP server to handle list prompts by querying the WebSocket server
mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
    if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
        return {prompts: []};
    }

    // Create a unique request ID
    const requestId = (requestIdCounter++).toString();

    // Create a promise that will be resolved when we get a response
    const responsePromise = new Promise((resolve, reject) => {
        // Store the resolver functions
        pendingRequests.set(requestId, {resolve, reject});

        // Set a timeout to prevent hanging requests
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject(new Error('List prompts request timed out'));
            }
        }, 10000); // 10 second timeout
    });

    // Send the request to the WebSocket server
    try {
        await sendMessage({
            id: requestId,
            type: 'listPrompts'
        });

        const prompts = await responsePromise;

        // Wait for the response
        return {prompts};
    } catch (error) {
        console.error('Error listing prompts:', error);
        return {prompts: []}; // Return empty list on error
    }
});

// Set up the MCP server to handle get prompt by querying the WebSocket server
mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
        throw new Error("Not connected to WebSocket server");
    }

    // Create a unique request ID
    const requestId = (requestIdCounter++).toString();

    // Create a promise that will be resolved when we get a response
    const responsePromise = new Promise((resolve, reject) => {
        // Store the resolver functions
        pendingRequests.set(requestId, {resolve, reject});

        // Set a timeout to prevent hanging requests
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject(new Error(`Get prompt request timed out: ${request.params.name}`));
            }
        }, 30000); // 30 second timeout
    });

    // Send the request to the WebSocket server
    try {
        await sendMessage({
            id: requestId,
            type: 'getPrompt',
            name: request.params.name,
            arguments: request.params.arguments
        });

        // Wait for the response
        return await responsePromise;
    } catch (error) {
        console.error('Error getting prompt:', error);
        throw error;
    }
});

// Set up the MCP server to handle list resources by querying the WebSocket server
mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
    if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
        return {resources: []};
    }

    // Create a unique request ID
    const requestId = (requestIdCounter++).toString();

    // Create a promise that will be resolved when we get a response
    const responsePromise = new Promise((resolve, reject) => {
        // Store the resolver functions
        pendingRequests.set(requestId, {resolve, reject});

        // Set a timeout to prevent hanging requests
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject(new Error('List resources request timed out'));
            }
        }, 10000); // 10 second timeout
    });

    // Send the request to the WebSocket server
    try {
        await sendMessage({
            id: requestId,
            type: 'listResources'
        });

        const {resources} = await responsePromise;

        // Wait for the response
        return {resources};
    } catch (error) {
        console.error('Error listing resources:', error);
        return {resources: []}; // Return empty list on error
    }
});

// Set up the MCP server to handle list resource templates by querying the WebSocket server
mcpServer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
        return {resourceTemplates: []};
    }

    // Create a unique request ID
    const requestId = (requestIdCounter++).toString();

    // Create a promise that will be resolved when we get a response
    const responsePromise = new Promise((resolve, reject) => {
        // Store the resolver functions
        pendingRequests.set(requestId, {resolve, reject});

        // Set a timeout to prevent hanging requests
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject(new Error('List resource templates request timed out'));
            }
        }, 10000); // 10 second timeout
    });

    // Send the request to the WebSocket server
    try {
        await sendMessage({
            id: requestId,
            type: 'listResources'
        });

        const {resourceTemplates} = await responsePromise;

        // Wait for the response
        return {resourceTemplates};
    } catch (error) {
        console.error('Error listing resource templates:', error);
        return {resourceTemplates: []}; // Return empty list on error
    }
});

// Set up the MCP server to handle read resource by querying the WebSocket server
mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
        throw new Error("Not connected to WebSocket server");
    }

    // Create a unique request ID
    const requestId = (requestIdCounter++).toString();

    // Create a promise that will be resolved when we get a response
    const responsePromise = new Promise((resolve, reject) => {
        // Store the resolver functions
        pendingRequests.set(requestId, {resolve, reject});

        // Set a timeout to prevent hanging requests
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject(new Error(`Read resource request timed out: ${request.params.uri}`));
            }
        }, 30000); // 30 second timeout
    });

    // Send the request to the WebSocket server
    try {
        await sendMessage({
            id: requestId,
            type: 'readResource',
            uri: request.params.uri
        });

        // Wait for the response
        return await responsePromise;
    } catch (error) {
        console.error('Error reading resource:', error);
        throw error;
    }
});

// Set up the MCP server to handle sampling by querying the WebSocket server
mcpServer.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
        throw new Error("Not connected to WebSocket server");
    }

    // Create a unique request ID
    const requestId = (requestIdCounter++).toString();

    // Create a promise that will be resolved when we get a response
    const responsePromise = new Promise((resolve, reject) => {
        // Store the resolver functions
        pendingRequests.set(requestId, {resolve, reject});

        // Set a timeout to prevent hanging requests
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                reject(new Error(`Sampling request timed out`));
            }
        }, 120000); // 120 second timeout (sampling can take longer)
    });

    // Send the request to the WebSocket server with all parameters from the request
    try {
        await sendMessage({
            id: requestId,
            type: 'createSamplingMessage',
            messages: request.params.messages,
            systemPrompt: request.params.systemPrompt,
            includeContext: request.params.includeContext,
            temperature: request.params.temperature,
            maxTokens: request.params.maxTokens,
            stopSequences: request.params.stopSequences,
            metadata: request.params.metadata,
            modelPreferences: request.params.modelPreferences
        });

        // Wait for the response
        return await responsePromise;
    } catch (error) {
        console.error('Error creating sampling message:', error);
        throw error;
    }
});

async function main() {
    // Connect to the WebSocket server
    connectToWebSocketServer();
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error("MCP server running with stdio transport");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
