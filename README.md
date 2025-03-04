# WebMCP

WebMCP is a WebSocket-based implementation of the Model Context Protocol, allowing web pages to expose tools to LLMs through a WebSocket server.

## Architecture

The system consists of three main components:

1. **WebSocket Server** (`src/websocket-server.js`): A central server that manages communication channels between web pages and MCP clients.
   - Maintains multiple channels for different web pages
   - Routes tool calls to the appropriate channel
   - Consolidates tools from different pages for MCP clients
   - Runs as a daemon with token-based authentication

2. **Web Client** (`index.html`): A web page that connects to the WebSocket server and registers tools.
   - Generates a unique channel and token pair
   - Provides tool implementations
   - Can be opened in multiple browser windows with different channel names

3. **MCP Client** (`src/server.js`): A Node.js client that connects to the WebSocket server and acts as an MCP server for LLMs.
   - Connects to the WebSocket server on the special "mcp" channel
   - Aggregates tools from all connected web pages
   - Exposes tools to LLMs through the MCP protocol
   - Uses server token from .env for authentication

## Security Model

WebMCP uses a token-based authentication system:

1. The WebSocket server generates a secure server token on first run
2. The server token is stored in `.env` and is used by the MCP client to connect to the `/mcp` path
3. Web clients generate their own unique channel-token pairs
4. Web clients must have their channel-token pair authorized by the server before they can connect
5. Each channel can only have one active connection
6. When a connection is closed, the channel-token pair is invalidated

This provides several security benefits:
- The server can control which clients are allowed to connect
- Each client has its own unique token
- No shared passwords or credentials
- Tokens are automatically revoked when a client disconnects

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start the WebSocket server as a daemon:
   ```
   npm run start-daemon
   ```

3. Generate a new client registration token:
   ```
   node src/websocket-server.js --new
   ```
   The command will output a base64 encoded connection token that you'll need for the next step.

4. Start the MCP client (in a separate terminal):
   ```
   npm run start-mcp-client
   ```

5. Open `index.html` in a web browser

6. Paste the base64 encoded token from step 3 into the token input field

7. Click "Connect" in the web browser to establish the WebSocket connection
   - The client will first connect to the `/register` endpoint
   - After successful registration, it will connect to its assigned channel

8. Use the MCP client with your favorite LLM that supports MCP

## Server Management

The WebSocket server can run as a daemon with various command options:

- Start the server (daemon mode):
  ```
  npm run start-daemon
  ```

- Run in foreground mode:
  ```
  npm run start-foreground
  ```

- Stop the server:
  ```
  npm run stop-daemon
  ```

- Generate a new client registration token:
  ```
  node src/websocket-server.js --new
  ```
  This generates a base64 encoded token that clients can use to register via the `/register` endpoint.

- Show help:
  ```
  node src/websocket-server.js --help
  ```

## Connection Process

1. **Start the WebSocket Server**:
   - Start the server as a daemon: `npm run start-daemon`
   - Generate a new registration token: `node src/websocket-server.js --new`
   - The server will output a base64 encoded connection token containing:
     - Server address (e.g., `ws://localhost:4797`)
     - A secure random token for registration

2. **Web Client Registration**:
   - Open the web client in your browser
   - Paste the base64 encoded token from the `--new` command
   - The client establishes a connection to the `/register` endpoint
   - The client sends the token as a base64 encoded JSON object
   - The server verifies the token and authorizes the channel
   - Upon successful registration, the client receives a channel path and token

3. **Web Client Connection**:
   - After registration, the client automatically connects to its assigned channel
   - The server verifies the token and allows the connection
   - The client can now register tools with the server
   - When the client disconnects, the token is automatically invalidated

4. **MCP Client**:
   - Uses the server token from `.env` to connect to `/mcp` path
   - Has access to all tools from all connected web clients

## Building for Distribution

To create bundled versions of the WebSocket server and MCP client:

```
npm run build
```

This generates both CommonJS (.cjs) and ES Module (.js) versions in the `build` directory, ready for distribution.

## How It Works

1. The server generates a registration token with the `--new` command
2. Web clients connect to the `/register` endpoint with this token
3. After successful registration, clients receive a unique channel and token
4. Web pages connect to their assigned channel and register tools with the server
5. The MCP client connects to the `/mcp` path using the server token from `.env`
6. When an LLM wants to use a tool, the request flows from:
   - LLM → MCP Client → WebSocket Server → Web Page with the tool
7. The web page executes the tool and sends the result back through the same path
8. Multiple web pages can be connected simultaneously, each with their own set of tools and tokens
9. The MCP client sees all tools as a unified list, with channel prefixes to avoid name collisions

## Tool Naming

Tool names are prefixed with their channel name to prevent naming collisions between different web pages. For example, if a web page on channel "page1" registers a tool called "calculator", the MCP client will see it as "page1-calculator".