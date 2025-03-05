# WebMCP

WebMCP allows websites to share tools, resources, prompts, etc. to LLMs. In other words, WebMCP allows a website to be  an MCP server.

It comes in the form of a widget that a website owner can put on their site and give client-side LLMs what they need to provide a great UX for the user or agent.

To initiate a connection, the user generates a token with an unique identifier and connection information and provides it to the input in the widget. The widget then talks to the locally hosted websocket using that information and the server validates the information and establishes a connection. If the user navigates away, they have a grace period to reconnect without needing to reauthenticate (especially useful for multi-page apps / navigation).

## Getting started

Install + start the server (it's a daemon, so you can start it anywhere)

```shell
npx @jason.today/webmcp
```

The first time this happens, it will initialize a `.env` file in `~/.webmcp` which contains `MCP_SERVER_TOKEN`.

Update your MCP client's config to point at `~/.webmcp/server.cjs`. This file is automatically copied to that location during installation. Add `MCP_SERVER_TOKEN` with its value as an environment variable.

When you're ready to connect to a website, it'll ask you for a token. This is how you generate one.
(If your server was not running, this will also start it.)

```
npx @jason.today/webmcp --new
```

Copy the token and paste it to the website's input. As soon as the website registers with it, it cannot be used for subsequent registrations (just generate a new one, when you need to).

To disconnect, you can close the browser tab, click "disconnect", or shut down the server.

For more information on the server, feel free to run:

```
npx @jason.today/webmcp --help
```

All configuration files (tokens, `.env`, server PID) are now stored in `~/.webmcp` directory, making it easy to maintain state between sessions. The MCP server file is also copied to this directory during installation, so you can reference it directly in your MCP client configuration.

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
