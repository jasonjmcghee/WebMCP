# WebMCP

WebMCP is a WebSocket-based implementation of the Model Context Protocol, allowing web pages to expose tools to LLMs through a WebSocket server.

## Architecture

The system consists of three main components:

1. **WebSocket Server** (`websocket-server.js`): A central server that manages communication channels between web pages and MCP clients.
   - Maintains multiple channels for different web pages
   - Routes tool calls to the appropriate channel
   - Consolidates tools from different pages for MCP clients

2. **Web Client** (`index.html`): A web page that connects to the WebSocket server and registers tools.
   - Registers to a specific channel
   - Provides tool implementations
   - Can be opened in multiple browser windows with different channel names

3. **MCP Client** (`server.js`): A Node.js client that connects to the WebSocket server and acts as an MCP server for LLMs.
   - Connects to the WebSocket server on the special "mcp" channel
   - Aggregates tools from all connected web pages
   - Exposes tools to LLMs through the MCP protocol

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start the WebSocket server:
   ```
   npm run start-ws-server
   ```

3. Start the MCP client (in a separate terminal):
   ```
   npm run start-mcp-client
   ```

   Alternatively, you can start both at once:
   ```
   npm run start-both
   ```

4. Open `index.html` in a web browser (you can open multiple windows with different channel names)

5. Connect web pages to the WebSocket server by clicking "Connect" (each page should use a unique channel name)

6. Use the MCP client with your favorite LLM that supports MCP

## How It Works

1. Web pages connect to the WebSocket server and register tools
2. The MCP client connects to the WebSocket server and queries for available tools
3. When an LLM wants to use a tool, the request flows from:
   - LLM → MCP Client → WebSocket Server → Web Page with the tool
4. The web page executes the tool and sends the result back through the same path
5. Multiple web pages can be connected simultaneously, each with their own set of tools
6. The MCP client sees all tools as a unified list, with channel prefixes to avoid name collisions

## Tool Naming

Tool names are prefixed with their channel name to prevent naming collisions between different web pages. For example, if a web page on channel "page1" registers a tool called "calculator", the MCP client will see it as "page1:calculator".
