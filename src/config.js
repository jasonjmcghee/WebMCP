import * as path from 'path';
import * as dotenv from 'dotenv';
import * as os from 'os';
import * as fs from 'fs/promises';
import envPaths from 'env-paths';

// Create config directory in user's home folder
const HOME_DIR = os.homedir();
const CONFIG_DIR = path.join(HOME_DIR, '.webmcp');

// Ensure config directory exists
const ensureConfigDir = async () => {
    try {
        await fs.mkdir(CONFIG_DIR, {recursive: true});
    } catch (error) {
        console.error(`Error creating config directory at ${CONFIG_DIR}:`, error);
    }
};

// Process ID file path
const PID_FILE = path.join(CONFIG_DIR, '.webmcp-server.pid');
// Environment file path
const ENV_FILE = path.join(CONFIG_DIR, '.env');
// Tokens file path
const TOKENS_FILE = path.join(CONFIG_DIR, '.webmcp-tokens.json');

// Load environment variables
dotenv.config({path: ENV_FILE});

// Server token for MCP authentication
const SERVER_TOKEN = process.env.WEBMCP_SERVER_TOKEN || '';

const HOST = "localhost";

const CONFIG = {};

function setConfig(args) {
    Object.entries(args).forEach(([key, value]) => {
        CONFIG[key] = value;
    });
}

function formatChannel(channel) {
    return `/${channel.replace(/[.:]/g, '_')}`
}

async function exists(somePath) {
    try {
        await fs.access(somePath);
        return true;
    } catch (e) {
        return false;
    }
}

async function configureMcpClientWithPath(clientConfigPath) {
    const directory = path.dirname(clientConfigPath);
    if (!await exists(directory)) {
        await fs.mkdir(directory, { recursive: true });
    }

    const webmcpConfig = {
        "webmcp": {
            "command": "npx",
            "args": [
                "-y",
                "@jason.today/webmcp@latest",
                "--mcp"
            ]
        }
    };

    let json = { mcpServers: {} };

    // If one already exists, we'll want to update it
    if (await exists(clientConfigPath)) {
        const rawJSON = await fs.readFile(clientConfigPath);
        try {
            json = JSON.parse(rawJSON);
        } catch (e) {
            throw new Error(`Failed to update MCP client configuration: ${e}`);
        }
    }

    json.mcpServers = { ...json.mcpServers, ...webmcpConfig};
    await fs.writeFile(clientConfigPath, JSON.stringify(json, null, 2));
}

const availableClientConfigs = {
    "claude": [envPaths("Claude", { suffix: "" }).data, "claude_desktop_config.json"],
    "cline": [envPaths("Code", { suffix: "" }).data, "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"],
    "cursor": [HOME_DIR, ".cursor", "mcp.json"],
    "windsurf": [HOME_DIR, ".codeium", "windsurf", "mcp_config.json"]
};

async function configureMcpClient(clientType) {
    let clientConfigPath = availableClientConfigs[clientType];
    if (clientConfigPath) {

    } else {
        console.error("Unsupported client - treating it like a path...")
        await configureMcpClientWithPath(clientType);
    }
}

export {
    CONFIG,
    HOST,
    PID_FILE,
    ENV_FILE,
    TOKENS_FILE,
    SERVER_TOKEN,
    ensureConfigDir,
    formatChannel,
    setConfig,
    configureMcpClientWithPath,
    configureMcpClient,
};
