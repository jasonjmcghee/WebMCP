# WebMCP

WebMCP allows websites to share tools, resources, prompts, etc. to LLMs. In other words, WebMCP allows a website to be  an MCP server.

It comes in the form of a widget that a website owner can put on their site and give client-side LLMs what they need to provide a great UX for the user or agent.

To initiate a connection, the user generates a token with an unique identifier and connection information and provides it to the input in the widget. The widget then talks to the locally hosted websocket using that information and the server validates the information and establishes a connection. If the user navigates away, they have a grace period to reconnect without needing to reauthenticate (especially useful for multi-page apps / navigation).

## The System

There's three pieces.

1. [src/websocket-server.js](./src/websocket-server.js) which handles the transferring information between the website widget, and the MCP server. It also handles authentication and session data.

2. [src/server.js](./src/server.js) which is the actual MCP server that the MCP client will talk to - it just proxies information to the websocket server.

3. [src/webmcp.js](./src/webmcp.js) which is the website widget. It contains the class `WebMCP` which the website developer uses to share capabilities with the MCP Client. They could be resources like website documentation, tools to make taking actions on the site easy for models, or prompts for specialized / unique tasks to the platform / site.

## Getting started

- Install and build:

```shell
npm install && npm run build
```

## Setup

Start the server (it's a daemon, so you can start it anywhere)

```shell
node build/index.js
```

The first time this happens, it will initialize a `.env` file which contains `MCP_SERVER_TOKEN`.

Update your MCP client's config to point at `build/server.cjs`. Feel free to move it wherever you want. It's single self-contained file. Also, add `MCP_SERVER_TOKEN` with its value as an environment variable.

When you're ready to connect to a website, it'll ask you for a token. This is how you generate one.
(If your server was not running, this will also start it.)

```
node build/index.js --new
```

Copy the token and paste it to the website's input. As soon as the website registers with it, it cannot be used for subsequent registrations (just generate a new one, when you need to).

To disconnect, you can close the browser tab, click "disconnect", or shut down the server.

For more information on the server, feel free to run:

```
node build/index.js --help
```

Also, again, single self-contained file. Feel free to move it, rename it, etc. Note that it'll lose track of any tokens, the `MCP_SERVER_TOKEN` and the currently running server if you don't move the appropriate files, as these are stored next to the server (this is dumb and should be in `~/.webmcp` or something), but they'll get recreated (you'll need to update mcp client config).

## How It Works

1. The server generates a registration token with the `--new` command
2. Web clients connect to the `/register` endpoint with this token and its domain.
3. Web pages connect to their assigned channel based on their domain.
4. The MCP client connects to the `/mcp` path using the server token from `.env` (auto-generated)
5. When an LLM wants to use a tool / resource / prompt, the request flows from:
   - MCP Client → MCP Server → WebSocket Server → Web Page with the tool / resource / prompt
   - (similar for requesting a list of tools / resources / prompts)
6. The web page performs the request (e.g. call tool) and sends the result back through the same path
7. Multiple web pages can be connected simultaneously, each with their own set of tools and tokens
8. The MCP client sees all tools as a unified list, with channel prefixes to avoid name collisions
