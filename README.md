# WebMCP

A proposal and code for websites to support client side LLMs

![NPM Version](https://img.shields.io/npm/v/%40jason.today%2Fwebmcp) ![MIT licensed](https://img.shields.io/npm/l/%40jason.today%2Fwebmcp)

WebMCP allows websites to share tools, resources, prompts, etc. to LLMs. In other words, WebMCP allows a website to be  an MCP server. No sharing API Keys. Use any model you want.

[Here's a simple website I built that is WebMCP-enabled](https://webmcp.jason.today)

It comes in the form of a widget that a website owner can put on their site and give client-side LLMs what they need to provide a great UX for the user or agent.

To initiate a connection, the user generates a token with an unique identifier and connection information and provides it to the input in the widget. The widget then talks to the locally hosted websocket using that information and the server validates the information and establishes a connection. If the user navigates away, they have a grace period to reconnect without needing to reauthenticate (especially useful for multi-page apps / navigation).

You can connect to any number of websites at a time - and tools are "scoped" (by name) based on the domain to simplify organization.

_The look, feel, how it's used, and security are all absolutely open for contribution / constructive criticism. MCP Clients directly building WebMCP functionality seems like an ideal outcome._

# Demo (Sound on 🔊)

### Super Quick Demo (20 seconds)

https://github.com/user-attachments/assets/61229470-1242-401e-a7d9-c0d762d7b519


### Full Demo (3 minutes)

https://github.com/user-attachments/assets/43ad160a-846d-48ad-9af9-f6d537e78473


## Getting started (adding WebMCP to your website)

To use WebMCP, simply include [`webmcp.js`](https://github.com/jasonjmcghee/WebMCP/releases) on your page (via src or directly):

```
<script src="webmcp.js"></script>
```

The WebMCP widget will automatically initialize and appear in the bottom right corner of your page.


## Getting started (using your LLM with websites using WebMCP)

Install + start the server (it's a daemon, so you can start it anywhere - run this again if you ever want to update the package)

```bash
npx @jason.today/webmcp@latest
```

Update your MCP client's config to execute the mcp server by passing `--mcp` to the main binary.

For example, in claude desktop config:

```json
{
  "mcpServers": {
    "webmcp": {
      "command": "npx",
      "args": [
        "-y @jason.today/webmcp --mcp"
      ]
    }
  }
}
```

When you're ready to connect to a website, it'll ask you for a token. This is how you generate one.
(If your server was not running, this will also start it.)

```bash
npx @jason.today/webmcp --new
```

Copy the token and paste it to the website's input. As soon as the website registers with it, it cannot be used for subsequent registrations (just generate a new one, when you need to).

To disconnect, you can close the browser tab, click "disconnect", or shut down the server.

For more information on the server, feel free to run:

```bash
npx @jason.today/webmcp --help
```

All configuration files are stored in `~/.webmcp` directory.

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
