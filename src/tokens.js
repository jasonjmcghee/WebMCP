import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import {ENV_FILE, formatChannel, HOST, TOKENS_FILE,CONFIG} from "./config.js";

// Function to generate a secure random token
function generateToken() {
    return crypto.randomBytes(16).toString('hex');
}


// Authorized channel-token pairs - Only channels with valid tokens can connect
// Format: { "/channel1": "token123" }
let authorizedTokens = {};

function getToken(channel) {
    return authorizedTokens[channel];
}

function setToken(channel, value) {
    authorizedTokens[channel] = value;
}

function deleteToken(channel) {
    delete authorizedTokens[channel];
}

function clearTokens(channel) {
    authorizedTokens = {};
}

// Load authorized tokens from disk
async function loadAuthorizedTokens() {
    try {
        const data = await fs.readFile(TOKENS_FILE, 'utf8');
        authorizedTokens = JSON.parse(data || "{}");

        // console.error(`Loaded ${Object.keys(authorizedTokens).length} authorized channel-token pairs from ${TOKENS_FILE}`);
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
        // console.error(`Saved ${stringified} authorized channel-token pairs to ${TOKENS_FILE}`);
        return true;
    } catch (error) {
        console.error('Error saving authorized tokens:', error);
        return false;
    }
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

async function generateNewRegistrationToken() {
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

    setToken(formatChannel(address), token);
    await saveAuthorizedTokens();

    return encodedData;
}

export {generateToken, getToken, setToken, loadAuthorizedTokens, saveAuthorizedTokens, clearTokens, deleteToken, saveServerTokenToEnv, generateNewRegistrationToken};
