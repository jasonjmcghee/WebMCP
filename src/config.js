import * as path from 'path';
import * as dotenv from 'dotenv';
import * as os from 'os';
import * as fs from 'fs/promises';

// Create config directory in user's home folder
const CONFIG_DIR = path.join(os.homedir(), '.webmcp');

// Ensure config directory exists
const ensureConfigDir = async () => {
    try {
        await fs.mkdir(CONFIG_DIR, { recursive: true });
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

export {
  PID_FILE,
  ENV_FILE,
  TOKENS_FILE,
  SERVER_TOKEN,
  ensureConfigDir,
};
