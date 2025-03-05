/**
 * WebMCP - Snippet to add MCP functionality to any website
 *
 * Shows as a small blue square in bottom right corner
 * On click, expands to allow connection with token
 * Auto-disconnects after 5 minutes of inactivity
 */

class WebMCP {
    constructor(options = {}) {
        // Options with defaults
        this.options = {
            color: '#007bff',
            position: 'bottom-right',
            size: '30px',
            padding: '20px',
            inactivityTimeout: 5 * 60 * 1000, // 5 minutes in milliseconds
            ...options
        };

        // State variables
        this.isConnected = false;
        this.isExpanded = false;
        this.socket = null;
        this.inactivityTimer = null;
        this.availableTools = new Map();
        this.availablePrompts = new Map();
        this.availableResources = new Map();
        this.samplingCallbacks = new Map(); // For storing sampling callbacks
        this.currentToken = '';
        this.currentServer = '';
        this.currentChannel = '';
        this.elementId = 'webmcp-widget-' + Math.random().toString(36).substr(2, 9);
        this.registeredTools = new Set();
        this.registeredPrompts = new Set();
        this.registeredResources = new Set();

        // Storage keys for sessionStorage
        this.SESSION_STORAGE_KEY = 'webmcp_token';
        this.TOOLS_STORAGE_KEY = 'webmcp_tools';
        this.PROMPTS_STORAGE_KEY = 'webmcp_prompts';
        this.RESOURCES_STORAGE_KEY = 'webmcp_resources';

        // Constants
        this.REGISTER_PATH = '/register';

        // Initialize
        this._init();
    }

    _format(s) {
        return s.replace(/[.:]/g, '_');
    }

    /**
     * Initialize the WebMCP widget
     * @private
     */
    _init() {
        // Check if already initialized on this page
        if (document.querySelector('[data-webmcp-widget]')) {
            console.warn('WebMCP widget already initialized on this page');
            return;
        }

        // Create and inject the widget
        this._createWidget();

        // Set up event listeners
        this._setupEventListeners();

        // Start inactivity timer
        this._resetInactivityTimer();

        // Check for stored token and connect if available
        this._checkStoredToken();
    }

    /**
     * Check for stored connection info in sessionStorage and connect if found
     * @private
     */
    _checkStoredToken() {
        const storedConnectionInfo = sessionStorage.getItem(this.SESSION_STORAGE_KEY);

        if (storedConnectionInfo) {
            try {
                const connectionInfo = JSON.parse(storedConnectionInfo);
                if (connectionInfo.token) {
                    console.log('Found stored connection info, attempting to connect');

                    // Set the connection properties directly
                    this.currentServer = connectionInfo.server;
                    this.currentChannel = `/${connectionInfo.channelHost || this._format(window.location.host)}`;

                    // Set the current token from connection info
                    if (connectionInfo.token.includes('{')) {
                        // It's already parsed JSON
                        const tokenData = JSON.parse(connectionInfo.token);
                        this.currentToken = tokenData.token;
                    } else {
                        // It's a base64 encoded string
                        try {
                            const jsonStr = atob(connectionInfo.token);
                            const tokenData = JSON.parse(jsonStr);
                            this.currentToken = tokenData.token;
                        } catch (e) {
                            this.currentToken = connectionInfo.token;
                        }
                    }

                    // Load stored items before connecting
                    this._loadStoredItems();

                    // Connect using the stored token
                    this.connect(connectionInfo.token);
                }
            } catch (error) {
                console.error('Error parsing stored connection info:', error);
                sessionStorage.removeItem(this.SESSION_STORAGE_KEY);
                this._clearStoredItems();
            }
        }
    }

    /**
     * Save tools, prompts, and resources to session storage
     * @private
     */
    _saveItemsToStorage() {
        try {
            // Save tools
            const toolsData = {};
            this.availableTools.forEach((tool, name) => {
                toolsData[name] = {
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    // We don't store the execution function as it can't be serialized
                };
            });
            sessionStorage.setItem(this.TOOLS_STORAGE_KEY, JSON.stringify(toolsData));

            // Save prompts
            const promptsData = {};
            this.availablePrompts.forEach((prompt, name) => {
                promptsData[name] = {
                    name: prompt.name,
                    description: prompt.description,
                    arguments: prompt.arguments,
                    // We don't store the execution function as it can't be serialized
                };
            });
            sessionStorage.setItem(this.PROMPTS_STORAGE_KEY, JSON.stringify(promptsData));

            // Save resources
            const resourcesData = {};
            this.availableResources.forEach((resource, name) => {
                resourcesData[name] = {
                    name: resource.name,
                    description: resource.description,
                    uri: resource.uri,
                    uriTemplate: resource.uriTemplate,
                    isTemplate: resource.isTemplate,
                    mimeType: resource.mimeType,
                    // We don't store the provide function as it can't be serialized
                };
            });
            sessionStorage.setItem(this.RESOURCES_STORAGE_KEY, JSON.stringify(resourcesData));

            console.log('Saved items to session storage:', {
                tools: Object.keys(toolsData).length,
                prompts: Object.keys(promptsData).length,
                resources: Object.keys(resourcesData).length
            });
        } catch (error) {
            console.error('Error saving items to session storage:', error);
        }
    }

    /**
     * Load tools, prompts, and resources from session storage
     * @private
     */
    _loadStoredItems() {
        try {
            // Load tools
            const storedTools = sessionStorage.getItem(this.TOOLS_STORAGE_KEY);
            if (storedTools) {
                const toolsData = JSON.parse(storedTools);
                Object.entries(toolsData).forEach(([name, tool]) => {
                    // Add to the available tools with placeholder execute function
                    this.availableTools.set(name, {
                        ...tool,
                        execute: function (args) {
                            console.warn(`Tool ${name} was loaded from storage but has not been re-registered with an execution function`);
                            return `Tool ${name} needs to be re-registered`;
                        }
                    });
                });
            }

            // Load prompts
            const storedPrompts = sessionStorage.getItem(this.PROMPTS_STORAGE_KEY);
            if (storedPrompts) {
                const promptsData = JSON.parse(storedPrompts);
                Object.entries(promptsData).forEach(([name, prompt]) => {
                    // Add to the available prompts with placeholder execute function
                    this.availablePrompts.set(name, {
                        ...prompt,
                        execute: function (args) {
                            console.warn(`Prompt ${name} was loaded from storage but has not been re-registered with an execution function`);
                            return {
                                messages: [{
                                    role: "user",
                                    content: {
                                        type: "text",
                                        text: `Prompt ${name} needs to be re-registered`
                                    }
                                }]
                            };
                        }
                    });
                });
            }

            // Load resources
            const storedResources = sessionStorage.getItem(this.RESOURCES_STORAGE_KEY);
            if (storedResources) {
                const resourcesData = JSON.parse(storedResources);
                Object.entries(resourcesData).forEach(([name, resource]) => {
                    // Add to the available resources with placeholder provide function
                    this.availableResources.set(name, {
                        ...resource,
                        provide: function (uri) {
                            console.warn(`Resource ${name} was loaded from storage but has not been re-registered with a provider function`);
                            return {
                                contents: [{
                                    uri: uri,
                                    text: `Resource ${name} needs to be re-registered`,
                                    mimeType: resource.mimeType || "text/plain"
                                }]
                            };
                        }
                    });
                });
            }

            console.log('Loaded items from session storage:', {
                tools: this.availableTools.size,
                prompts: this.availablePrompts.size,
                resources: this.availableResources.size
            });

            // Update the UI
            this._updateToolsList();
            this._updatePromptsList();
            this._updateResourcesList();

        } catch (error) {
            console.error('Error loading items from session storage:', error);
            this._clearStoredItems();
        }
    }

    /**
     * Clear all stored items from session storage
     * @private
     */
    _clearStoredItems() {
        sessionStorage.removeItem(this.TOOLS_STORAGE_KEY);
        sessionStorage.removeItem(this.PROMPTS_STORAGE_KEY);
        sessionStorage.removeItem(this.RESOURCES_STORAGE_KEY);
        console.log('Cleared stored items from session storage');
    }

    /**
     * Create and inject the WebMCP widget into the DOM
     * @private
     */
    _createWidget() {
        // Create main container
        const container = document.createElement('div');
        container.id = this.elementId;
        container.dataset.webmcpWidget = true;

        // Apply styles
        Object.assign(container.style, {
            position: 'fixed',
            zIndex: '9999',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            transition: 'all 0.3s ease'
        });

        // Set position based on option
        this._setWidgetPosition(container);

        // Create trigger button (blue square)
        const triggerButton = document.createElement('div');
        triggerButton.className = 'webmcp-trigger';
        Object.assign(triggerButton.style, {
            width: this.options.size,
            height: this.options.size,
            backgroundColor: this.options.color,
            borderRadius: '4px',
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            alignSelf: 'flex-end'
        });

        // Create content panel (initially hidden) - positioned above the trigger
        const contentPanel = document.createElement('div');
        contentPanel.className = 'webmcp-content';
        Object.assign(contentPanel.style, {
            backgroundColor: '#ffffff',
            border: '1px solid #e1e1e1',
            borderRadius: '5px',
            padding: '15px',
            marginBottom: '10px',
            boxShadow: '0 5px 15px rgba(0,0,0,0.1)',
            width: '250px',
            display: 'none',
            overflow: 'hidden',
            position: 'absolute',
            bottom: '40px'
        });

        // Add header with title and close button
        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px'
        });

        const title = document.createElement('div');
        title.textContent = 'WebMCP';
        Object.assign(title.style, {
            fontWeight: 'bold',
            fontSize: '16px'
        });

        const closeButton = document.createElement('button');
        closeButton.innerHTML = '&times;'; // × symbol
        closeButton.className = 'webmcp-close';
        Object.assign(closeButton.style, {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '20px',
            padding: '0',
            lineHeight: '1',
            color: '#999'
        });

        header.appendChild(title);
        header.appendChild(closeButton);
        contentPanel.appendChild(header);

        // Add connection form
        this._createConnectionForm(contentPanel);

        // Add status indicator
        const statusIndicator = document.createElement('div');
        statusIndicator.className = 'webmcp-status';
        statusIndicator.textContent = 'Disconnected';
        Object.assign(statusIndicator.style, {
            padding: '8px',
            borderRadius: '3px',
            backgroundColor: '#f8d7da',
            color: '#721c24',
            textAlign: 'center',
            marginBottom: '10px',
            fontSize: '12px'
        });
        contentPanel.appendChild(statusIndicator);

        // Add connection panel
        const connectionPanel = document.createElement('div');
        connectionPanel.className = 'webmcp-connection-panel';
        contentPanel.appendChild(connectionPanel);

        // Create a single container for all registered items
        const registeredItemsContainer = document.createElement('div');
        registeredItemsContainer.className = 'webmcp-registered-items';
        Object.assign(registeredItemsContainer.style, {
            marginTop: '15px',
            fontSize: '12px',
            display: 'none',
            maxHeight: '200px',
            overflow: 'auto',
            border: '1px solid #eee',
            borderRadius: '4px'
        });
        contentPanel.appendChild(registeredItemsContainer);

        // Add features lists (initially empty)
        // Tools list
        const toolsList = document.createElement('div');
        toolsList.className = 'webmcp-tools-list';
        Object.assign(toolsList.style, {
            padding: '10px',
            borderBottom: '1px solid #eee'
        });

        const toolsHeader = document.createElement('div');
        toolsHeader.textContent = 'Registered Tools:';
        Object.assign(toolsHeader.style, {
            fontWeight: 'bold',
            marginBottom: '5px'
        });

        const toolsContainer = document.createElement('ul');
        toolsContainer.className = 'webmcp-tools-container';
        Object.assign(toolsContainer.style, {
            listStyle: 'none',
            padding: '0',
            margin: '0'
        });

        toolsList.appendChild(toolsHeader);
        toolsList.appendChild(toolsContainer);
        registeredItemsContainer.appendChild(toolsList);

        // Prompts list
        const promptsList = document.createElement('div');
        promptsList.className = 'webmcp-prompts-list';
        Object.assign(promptsList.style, {
            padding: '10px',
            borderBottom: '1px solid #eee'
        });

        const promptsHeader = document.createElement('div');
        promptsHeader.textContent = 'Registered Prompts:';
        Object.assign(promptsHeader.style, {
            fontWeight: 'bold',
            marginBottom: '5px'
        });

        const promptsContainer = document.createElement('ul');
        promptsContainer.className = 'webmcp-prompts-container';
        Object.assign(promptsContainer.style, {
            listStyle: 'none',
            padding: '0',
            margin: '0'
        });

        promptsList.appendChild(promptsHeader);
        promptsList.appendChild(promptsContainer);
        registeredItemsContainer.appendChild(promptsList);

        // Resources list
        const resourcesList = document.createElement('div');
        resourcesList.className = 'webmcp-resources-list';
        Object.assign(resourcesList.style, {
            padding: '10px'
        });

        const resourcesHeader = document.createElement('div');
        resourcesHeader.textContent = 'Registered Resources:';
        Object.assign(resourcesHeader.style, {
            fontWeight: 'bold',
            marginBottom: '5px'
        });

        const resourcesContainer = document.createElement('ul');
        resourcesContainer.className = 'webmcp-resources-container';
        Object.assign(resourcesContainer.style, {
            listStyle: 'none',
            padding: '0',
            margin: '0'
        });

        resourcesList.appendChild(resourcesHeader);
        resourcesList.appendChild(resourcesContainer);
        registeredItemsContainer.appendChild(resourcesList);

        // Add to main container and then to document - content panel first so it appears above trigger
        container.appendChild(contentPanel);
        container.appendChild(triggerButton);
        document.body.appendChild(container);
    }

    /**
     * Set widget position based on option
     * @private
     */
    _setWidgetPosition(container) {
        const {position, padding} = this.options;

        switch (position) {
            case 'bottom-right':
                Object.assign(container.style, {
                    bottom: padding,
                    right: padding,
                    alignItems: 'flex-end'
                });
                break;
            case 'bottom-left':
                Object.assign(container.style, {
                    bottom: padding,
                    left: padding,
                    alignItems: 'flex-start'
                });
                break;
            case 'top-right':
                Object.assign(container.style, {
                    top: padding,
                    right: padding,
                    alignItems: 'flex-end'
                });
                break;
            case 'top-left':
                Object.assign(container.style, {
                    top: padding,
                    left: padding,
                    alignItems: 'flex-start'
                });
                break;
            default:
                // Default to bottom-right
                Object.assign(container.style, {
                    bottom: padding,
                    right: padding,
                    alignItems: 'flex-end'
                });
        }
    }

    /**
     * Create the connection form
     * @private
     */
    _createConnectionForm(container) {
        const form = document.createElement('div');
        Object.assign(form.style, {
            marginBottom: '8px',
        });

        // Token input field
        const inputGroup = document.createElement('div');
        Object.assign(inputGroup.style, {
            display: 'flex',
            marginBottom: '8px',
        });

        const tokenInput = document.createElement('input');
        tokenInput.type = 'text';
        tokenInput.className = 'webmcp-token-input';
        tokenInput.placeholder = 'Paste connection token';
        Object.assign(tokenInput.style, {
            flex: '1',
            padding: '8px',
            border: '1px solid #ccc',
            borderRadius: '4px 0 0 4px',
            fontSize: '12px'
        });

        const connectButton = document.createElement('button');
        connectButton.className = 'webmcp-connect-btn';
        connectButton.textContent = 'Connect';
        Object.assign(connectButton.style, {
            padding: '8px 12px',
            backgroundColor: this.options.color,
            color: 'white',
            border: 'none',
            borderRadius: '0 4px 4px 0',
            cursor: 'pointer',
            fontSize: '12px'
        });

        inputGroup.appendChild(tokenInput);
        inputGroup.appendChild(connectButton);

        const disconnectButton = document.createElement('button');
        disconnectButton.className = 'webmcp-disconnect-btn';
        disconnectButton.textContent = 'Disconnect';
        Object.assign(disconnectButton.style, {
            padding: '8px 12px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            width: '100%',
            display: 'none'
        });

        form.appendChild(inputGroup);
        form.appendChild(disconnectButton);
        container.appendChild(form);
    }

    /**
     * Set up event listeners for the widget
     * @private
     */
    _setupEventListeners() {
        const container = document.getElementById(this.elementId);
        if (!container) return;

        // Trigger button click - expand/collapse
        const trigger = container.querySelector('.webmcp-trigger');
        trigger.addEventListener('click', () => {
            this._toggleExpanded();
        });

        // Close button click - collapse
        const closeBtn = container.querySelector('.webmcp-close');
        closeBtn.addEventListener('click', () => {
            this._toggleExpanded(false);
        });

        // Connect button click
        const connectBtn = container.querySelector('.webmcp-connect-btn');
        connectBtn.addEventListener('click', () => {
            const tokenInput = container.querySelector('.webmcp-token-input');
            this.connect(tokenInput.value);
        });

        // Disconnect button click
        const disconnectBtn = container.querySelector('.webmcp-disconnect-btn');
        disconnectBtn.addEventListener('click', () => {
            this.disconnect();
        });

        // User activity detection to reset inactivity timer
        document.addEventListener('mousemove', () => this._resetInactivityTimer());
        document.addEventListener('keypress', () => this._resetInactivityTimer());
        document.addEventListener('click', () => this._resetInactivityTimer());
        document.addEventListener('scroll', () => this._resetInactivityTimer());
    }

    /**
     * Toggle the expanded state of the widget
     * @private
     */
    _toggleExpanded(force = null) {
        const container = document.getElementById(this.elementId);
        if (!container) return;

        const contentPanel = container.querySelector('.webmcp-content');
        this.isExpanded = force !== null ? force : !this.isExpanded;

        if (this.isExpanded) {
            contentPanel.style.display = 'block';
        } else {
            contentPanel.style.display = 'none';
        }

        this._resetInactivityTimer();
    }

    /**
     * Update the status indicator
     * @private
     */
    _updateStatus(status, message) {
        const container = document.getElementById(this.elementId);
        if (!container) return;

        const statusIndicator = container.querySelector('.webmcp-status');
        if (!statusIndicator) return;

        // Clear existing classes
        statusIndicator.classList.remove('connected', 'disconnected', 'connecting', 'pending-auth');

        // Set new status
        statusIndicator.textContent = message || status;

        // Apply styling based on status
        switch (status) {
            case 'connected':
                Object.assign(statusIndicator.style, {
                    backgroundColor: '#d4edda',
                    color: '#155724'
                });
                break;
            case 'disconnected':
                Object.assign(statusIndicator.style, {
                    backgroundColor: '#f8d7da',
                    color: '#721c24'
                });
                break;
            case 'connecting':
                Object.assign(statusIndicator.style, {
                    backgroundColor: '#fff3cd',
                    color: '#856404'
                });
                break;
            case 'pending-auth':
                Object.assign(statusIndicator.style, {
                    backgroundColor: '#d1ecf1',
                    color: '#0c5460'
                });
                break;
        }
    }

    /**
     * Update UI based on connection state
     * @private
     */
    _updateConnectionUI(isConnected) {
        const container = document.getElementById(this.elementId);
        if (!container) return;

        const tokenInput = container.querySelector('.webmcp-token-input');
        const connectBtn = container.querySelector('.webmcp-connect-btn');
        const disconnectBtn = container.querySelector('.webmcp-disconnect-btn');
        const registeredItemsContainer = container.querySelector('.webmcp-registered-items');

        if (isConnected) {
            tokenInput.style.display = 'none';
            connectBtn.style.display = 'none';
            disconnectBtn.style.display = 'block';
            registeredItemsContainer.style.display = 'block';

            // Update the trigger button to show connected state
            const trigger = container.querySelector('.webmcp-trigger');
            trigger.innerHTML = '✓';
            trigger.style.color = 'white';
            trigger.style.fontWeight = 'bold';
        } else {
            tokenInput.style.display = 'block';
            connectBtn.style.display = 'block';
            disconnectBtn.style.display = 'none';
            registeredItemsContainer.style.display = 'none';

            // Reset the trigger button
            const trigger = container.querySelector('.webmcp-trigger');
            trigger.innerHTML = '';
        }
    }

    /**
     * Update tools list in UI
     * @private
     */
    _updateToolsList() {
        const container = document.getElementById(this.elementId);
        if (!container) return;

        const toolsContainer = container.querySelector('.webmcp-tools-container');
        if (!toolsContainer) return;

        // Clear current list
        toolsContainer.innerHTML = '';

        if (this.availableTools.size === 0) {
            const emptyMessage = document.createElement('li');
            emptyMessage.textContent = 'No tools registered';
            emptyMessage.style.fontStyle = 'italic';
            emptyMessage.style.color = '#666';
            toolsContainer.appendChild(emptyMessage);
            return;
        }

        // Add each tool to the list
        this.availableTools.forEach((tool, name) => {
            const toolItem = document.createElement('li');
            Object.assign(toolItem.style, {
                padding: '5px 0',
                borderBottom: '1px solid #eee'
            });

            const toolName = document.createElement('strong');
            toolName.textContent = name;

            const toolDesc = document.createElement('div');
            toolDesc.textContent = tool.description;
            toolDesc.style.fontSize = '10px';
            toolDesc.style.color = '#666';

            toolItem.appendChild(toolName);
            toolItem.appendChild(toolDesc);
            toolsContainer.appendChild(toolItem);
        });
    }

    /**
     * Update prompts list in UI
     * @private
     */
    _updatePromptsList() {
        const container = document.getElementById(this.elementId);
        if (!container) return;

        const promptsContainer = container.querySelector('.webmcp-prompts-container');
        if (!promptsContainer) return;

        // Clear current list
        promptsContainer.innerHTML = '';

        if (this.availablePrompts.size === 0) {
            const emptyMessage = document.createElement('li');
            emptyMessage.textContent = 'No prompts registered';
            emptyMessage.style.fontStyle = 'italic';
            emptyMessage.style.color = '#666';
            promptsContainer.appendChild(emptyMessage);
            return;
        }

        // Add each prompt to the list
        this.availablePrompts.forEach((prompt, name) => {
            const promptItem = document.createElement('li');
            Object.assign(promptItem.style, {
                padding: '5px 0',
                borderBottom: '1px solid #eee'
            });

            const promptName = document.createElement('strong');
            promptName.textContent = name;

            const promptDesc = document.createElement('div');
            promptDesc.textContent = prompt.description;
            promptDesc.style.fontSize = '10px';
            promptDesc.style.color = '#666';

            promptItem.appendChild(promptName);
            promptItem.appendChild(promptDesc);
            promptsContainer.appendChild(promptItem);
        });
    }

    /**
     * Update resources list in UI
     * @private
     */
    _updateResourcesList() {
        const container = document.getElementById(this.elementId);
        if (!container) return;

        const resourcesContainer = container.querySelector('.webmcp-resources-container');
        if (!resourcesContainer) return;

        // Clear current list
        resourcesContainer.innerHTML = '';

        if (this.availableResources.size === 0) {
            const emptyMessage = document.createElement('li');
            emptyMessage.textContent = 'No resources registered';
            emptyMessage.style.fontStyle = 'italic';
            emptyMessage.style.color = '#666';
            resourcesContainer.appendChild(emptyMessage);
            return;
        }

        // Add each resource to the list
        this.availableResources.forEach((resource, name) => {
            const resourceItem = document.createElement('li');
            Object.assign(resourceItem.style, {
                padding: '5px 0',
                borderBottom: '1px solid #eee'
            });

            const resourceName = document.createElement('strong');
            resourceName.textContent = name;

            const resourceDesc = document.createElement('div');
            resourceDesc.textContent = resource.description +
                (resource.isTemplate ? ' (Template)' : '');
            resourceDesc.style.fontSize = '10px';
            resourceDesc.style.color = '#666';

            resourceItem.appendChild(resourceName);
            resourceItem.appendChild(resourceDesc);
            resourcesContainer.appendChild(resourceItem);
        });
    }

    /**
     * Reset the inactivity timer
     * @private
     */
    _resetInactivityTimer() {
        // Clear existing timer
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
        }

        // Set new timer
        this.inactivityTimer = setTimeout(() => {
            this._handleInactivity();
        }, this.options.inactivityTimeout);
    }

    /**
     * Handle user inactivity
     * @private
     */
    _handleInactivity() {
        console.log('Inactivity timeout reached, disconnecting');

        // Disconnect if connected
        if (this.isConnected) {
            this.disconnect();
        }

        // Minimize UI
        this._toggleExpanded(false);

        // Clear the stored token
        sessionStorage.removeItem(this.SESSION_STORAGE_KEY);
    }


    /**
     * Connect to the WebSocket server
     * @public
     * @param {string} connectionToken - The encoded connection token
     */
    async connect(connectionToken) {
        if (!connectionToken) {
            this._updateStatus('disconnected', 'Error: No token provided');
            return;
        }

        // Update UI to show connecting state
        this._updateStatus('connecting', 'Connecting...');

        try {
            // Process the connection token
            if (!this._processConnectionToken(connectionToken)) {
                return;
            }

            // Store the connection info in sessionStorage for page navigations
            const connectionInfo = {
                token: connectionToken,
                server: this.currentServer,
                host: this._format(window.location.host)
            };

            // Check if we have connection data already in sessionStorage
            const storedConnectionInfo = sessionStorage.getItem(this.SESSION_STORAGE_KEY);
            let skipRegistration = false;

            if (storedConnectionInfo) {
                try {
                    const connectionInfo = JSON.parse(storedConnectionInfo);
                    // If we already have a valid token and server, we can skip registration
                    if (connectionInfo.server === this.currentServer &&
                        connectionInfo.host === this._format(window.location.host)) {
                        skipRegistration = true;
                    }
                } catch (error) {
                    console.error('Error parsing stored connection info:', error);
                }
            }

            if (!skipRegistration) {
                // First register with server
                const registered = await this._registerWithServer(connectionToken);

                if (!registered) {
                    this._updateStatus('disconnected', 'Registration failed');
                    return;
                }

                sessionStorage.setItem(this.SESSION_STORAGE_KEY, JSON.stringify(connectionInfo));
            }

            // Now connect to the actual channel
            const serverUrl = `${this.currentServer}${this.currentChannel}?token=${this.currentToken}`;

            // Update UI
            this._updateStatus('connecting', 'Connecting to channel...');

            // Create WebSocket connection with the path and token
            this.socket = new WebSocket(serverUrl);

            // Set up socket event listeners
            this._setupSocketListeners();

            // Reset inactivity timer
            this._resetInactivityTimer();

        } catch (error) {
            console.error('Connection error:', error);
            this._updateStatus('disconnected', `Error: ${error.message}`);
        }
    }

    /**
     * Disconnect from WebSocket server
     * @public
     */
    disconnect() {
        // Close the WebSocket connection if it exists
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        this.isConnected = false;
        this._updateStatus('disconnected', 'Disconnected');
        this._updateConnectionUI(false);

        // Reset state
        this.currentToken = '';
        this.currentServer = '';
        this.currentChannel = '';

        // Remove the token from sessionStorage
        sessionStorage.removeItem(this.SESSION_STORAGE_KEY);

        // Clear items from sessionStorage
        this._clearStoredItems();
    }

    /**
     * Process connection token
     * @private
     * @param {string} encodedToken - The encoded connection token
     * @returns {boolean} - True if processing was successful
     */
    _processConnectionToken(encodedToken) {
        try {
            // Decode the base64 token
            const jsonStr = atob(encodedToken);
            const connectionData = JSON.parse(jsonStr);

            // Extract server and token
            const {server, token} = connectionData;

            if (!server || !token) {
                this._updateStatus('disconnected', 'Invalid token');
                return false;
            }

            // Store connection info
            this.currentServer = server;
            this.currentToken = token;

            // Format channel based on hostname
            this.currentChannel = `/${this._format(window.location.host)}`;

            return true;
        } catch (error) {
            this._updateStatus('disconnected', `Unable to parse token`);
            return false;
        }
    }

    /**
     * Register with server using connection token
     * @private
     * @param {string} encodedToken - The encoded connection token
     * @returns {Promise<boolean>} - Resolves to true if registration was successful
     */
    _registerWithServer(encodedToken) {
        // Update UI
        this._updateStatus('pending-auth', 'Registering...');

        // Connect to the registration endpoint
        const regSocket = new WebSocket(`${this.currentServer}${this.REGISTER_PATH}`);

        return new Promise((resolve, reject) => {
            // Connection opened - send the token
            regSocket.addEventListener('open', (event) => {
                console.log('Registration connection established');

                // Send the original encoded token back to the server
                const jsonStr = atob(encodedToken);
                const connectionData = JSON.parse(jsonStr);
                connectionData.host = this._format(window.location.host);
                regSocket.send(btoa(JSON.stringify(connectionData)));
            });

            // Listen for registration response
            regSocket.addEventListener('message', (event) => {
                try {
                    const message = JSON.parse(event.data);

                    if (message.type === 'registerSuccess') {
                        console.log(`Registration successful: ${message.message}`);

                        // Registration complete, can now connect to channel
                        resolve(true);
                    } else if (message.type === 'error') {
                        console.error(`Registration failed: ${message.message}`);
                        this._updateStatus('disconnected', `Registration failed: ${message.message}`);
                        reject(new Error(message.message));
                    }
                } catch (error) {
                    console.error(`Error parsing registration response: ${error.message}`);
                    this._updateStatus('disconnected', 'Error parsing server response');
                    reject(error);
                }
            });

            // Handle registration errors
            regSocket.addEventListener('error', (event) => {
                console.error('Registration connection error');
                this._updateStatus('disconnected', 'Registration connection error');
                sessionStorage.removeItem(this.SESSION_STORAGE_KEY);
                reject(new Error('Connection error'));
            });

            // Handle registration connection close
            regSocket.addEventListener('close', (event) => {
                console.log(`Registration connection closed: ${event.code} ${event.reason}`);

                if (event.code !== 1000) {
                    // If it wasn't a normal closure, show an error
                    this._updateStatus('disconnected', 'Registration failed');
                    sessionStorage.removeItem(this.SESSION_STORAGE_KEY);
                    reject(new Error('Connection closed'));
                }
            });
        });
    }

    /**
     * Set up WebSocket event listeners for direct connection
     * @private
     */
    _setupSocketListeners() {
        if (!this.socket) {
            console.error('Cannot set up socket listeners: WebSocket not available');
            return;
        }

        // Set up socket open handler
        this.socket.addEventListener('open', () => {
            this.isConnected = true;
            this._updateStatus('connected', `Connected to ${this.currentChannel}`);
            this._updateConnectionUI(true);
            console.log('WebMCP connection established');
            this._registerItemsWithServer();
        });

        // Set up socket close handler
        this.socket.addEventListener('close', (event) => {
            this.isConnected = false;
            this._updateStatus('disconnected', 'Disconnected');
            this._updateConnectionUI(false);
            console.log(`Connection closed: ${event.code} ${event.reason}`);

            // Check if it was an authorization error
            if (event.code === 1001 || event.code === 401) {
                this._updateStatus('disconnected', 'Authorization failed');
                this.currentToken = '';
                this.currentServer = '';
                this.currentChannel = '';
                sessionStorage.removeItem(this.SESSION_STORAGE_KEY);
            }
        });

        // Set up socket error handler
        this.socket.addEventListener('error', () => {
            console.error('WebSocket error');

            if (this.isConnected) {
                this._updateStatus('disconnected', 'Connection error occurred');
            } else {
                this._updateStatus('disconnected', 'Connection failed');
            }

            sessionStorage.removeItem(this.SESSION_STORAGE_KEY);
        });

        // Set up socket message handler
        this.socket.addEventListener('message', (event) => {
            try {
                const message = JSON.parse(event.data);
                this._handleServerMessage(message);
            } catch (error) {
                console.error(`Error parsing message: ${error.message}`);
            }
        });
    }

    /**
     * Handle messages from the server
     * @private
     * @param {Object} message - The parsed message object
     */
    _handleServerMessage(message) {
        switch (message.type) {
            case 'welcome':
                console.log(`Server says: ${message.message}`);
                break;

            case 'toolRegistered':
                console.log(`Tool registered with server: ${message.name}`);
                break;

            case 'promptRegistered':
                console.log(`Prompt registered with server: ${message.name}`);
                break;

            case 'resourceRegistered':
                console.log(`Resource registered with server: ${message.name}`);
                break;

            case 'callTool':
                // Server is asking us to execute a tool
                this._handleToolCall(message);
                break;

            case 'getPrompt':
                // Server is asking us to provide a prompt
                this._handleGetPrompt(message);
                break;

            case 'readResource':
                // Server is asking us to provide a resource
                this._handleReadResource(message);
                break;

            case 'createSamplingMessage':
                // Server is asking us to create a sampling message
                this._handleCreateSamplingMessage(message);
                break;

            case 'listTools':
                // Server is asking for available tools
                this._sendToolsList(message.id);
                break;

            case 'listPrompts':
                // Server is asking for available prompts
                this._sendPromptsList(message.id);
                break;

            case 'listResources':
                // Server is asking for available resources
                this._sendResourcesList(message.id);
                break;

            case 'ping':
                // Respond to ping
                this._sendMessage({
                    type: 'pong',
                    id: message.id,
                    timestamp: Date.now()
                });
                break;

            case 'error':
                console.error(`Server error: ${message.message}`);
                break;

            default:
                console.warn(`Unknown message type: ${message.type}`);
        }
    }

    /**
     * Handle tool call from server
     * @private
     * @param {Object} message - The parsed message object
     */
    _handleToolCall(message) {
        const {id, tool, arguments: args} = message;

        console.log(`Tool call: ${tool} with args:`, args);

        if (!this.availableTools.has(tool)) {
            this._sendMessage({
                id,
                type: 'toolResponse',
                error: `Tool not found: ${tool}`
            });
            return;
        }

        // Execute the tool
        try {
            const toolObj = this.availableTools.get(tool);

            // Call the tool's execute function
            const result = toolObj.execute(args);

            // Handle promises
            if (result instanceof Promise) {
                result
                    .then(resolvedResult => {
                        this._sendMessage({
                            id,
                            type: 'toolResponse',
                            result: resolvedResult
                        });
                    })
                    .catch(error => {
                        this._sendMessage({
                            id,
                            type: 'toolResponse',
                            error: error.message || 'Tool execution error'
                        });
                    });
            } else {
                // Send immediate result
                this._sendMessage({
                    id,
                    type: 'toolResponse',
                    result
                });
            }

            console.log(`Tool response sent for ${tool}`);
        } catch (error) {
            this._sendMessage({
                id,
                type: 'toolResponse',
                error: error.message || 'Tool execution error'
            });
            console.error(`Tool execution error:`, error);
        }
    }

    /**
     * Handle prompt request from server
     * @private
     * @param {Object} message - The parsed message object
     */
    _handleGetPrompt(message) {
        const {id, name, arguments: args} = message;

        console.log(`Prompt request: ${name} with args:`, args);

        if (!this.availablePrompts.has(name)) {
            this._sendMessage({
                id,
                type: 'promptResponse',
                error: `Prompt not found: ${name}`
            });
            return;
        }

        // Execute the prompt
        try {
            const promptObj = this.availablePrompts.get(name);

            // Call the prompt's execute function
            const result = promptObj.execute(args);

            // Handle promises
            if (result instanceof Promise) {
                result
                    .then(resolvedResult => {
                        this._sendMessage({
                            id,
                            type: 'promptResponse',
                            result: resolvedResult
                        });
                    })
                    .catch(error => {
                        this._sendMessage({
                            id,
                            type: 'promptResponse',
                            error: error.message || 'Prompt execution error'
                        });
                    });
            } else {
                // Send immediate result
                this._sendMessage({
                    id,
                    type: 'promptResponse',
                    result
                });
            }

            console.log(`Prompt response sent for ${name}`);
        } catch (error) {
            this._sendMessage({
                id,
                type: 'promptResponse',
                error: error.message || 'Prompt execution error'
            });
            console.error(`Prompt execution error:`, error);
        }
    }

    /**
     * Handle resource request from server
     * @private
     * @param {Object} message - The parsed message object
     */
    _handleReadResource(message) {
        const {id, uri} = message;

        console.log(`Resource request: ${uri}`);

        // Find resource that handles this URI
        let resourceObj = null;

        // First check for direct URI match
        for (const resource of this.availableResources.values()) {
            if (!resource.isTemplate && resource.uri === uri) {
                resourceObj = resource;
                break;
            }
        }

        // If no direct match, check for template match
        if (!resourceObj) {
            for (const resource of this.availableResources.values()) {
                if (resource.isTemplate) {
                    // Simple check - if URI starts with template prefix (before any parameters)
                    const templatePrefix = resource.uriTemplate.split('{')[0];
                    if (uri.startsWith(templatePrefix)) {
                        resourceObj = resource;
                        break;
                    }
                }
            }
        }

        if (!resourceObj) {
            this._sendMessage({
                id,
                type: 'resourceResponse',
                error: `No resource handler found for URI: ${uri}`
            });
            return;
        }

        // Execute the resource provider
        try {
            // Call the resource's provide function
            const result = resourceObj.provide(uri);

            // Handle promises
            if (result instanceof Promise) {
                result
                    .then(resolvedResult => {
                        this._sendMessage({
                            id,
                            type: 'resourceResponse',
                            result: resolvedResult
                        });
                    })
                    .catch(error => {
                        this._sendMessage({
                            id,
                            type: 'resourceResponse',
                            error: error.message || 'Resource read error'
                        });
                    });
            } else {
                // Send immediate result
                this._sendMessage({
                    id,
                    type: 'resourceResponse',
                    result
                });
            }

            console.log(`Resource response sent for ${uri}`);
        } catch (error) {
            this._sendMessage({
                id,
                type: 'resourceResponse',
                error: error.message || 'Resource read error'
            });
            console.error(`Resource read error:`, error);
        }
    }

    /**
     * Send available tools list
     * @private
     * @param {string} requestId - The request ID to respond to
     */
    _sendToolsList(requestId) {
        const toolsList = Array.from(this.availableTools.values()).map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        }));

        this._sendMessage({
            id: requestId,
            type: 'listToolsResponse',
            tools: toolsList
        });

        console.log(`Sent tools list: ${toolsList.length} tools`);
    }

    /**
     * Send available prompts list
     * @private
     * @param {string} requestId - The request ID to respond to
     */
    _sendPromptsList(requestId) {
        const promptsList = Array.from(this.availablePrompts.values()).map(prompt => ({
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments,
        }));

        this._sendMessage({
            id: requestId,
            type: 'listPromptsResponse',
            prompts: promptsList
        });

        console.log(`Sent prompts list: ${promptsList.length} prompts`);
    }

    /**
     * Send available resources list
     * @private
     * @param {string} requestId - The request ID to respond to
     */
    _sendResourcesList(requestId) {
        const resources = [];
        const resourceTemplates = [];

        // Split resources and templates
        this.availableResources.forEach((resource) => {
            if (resource.isTemplate) {
                resourceTemplates.push({
                    name: resource.name,
                    description: resource.description,
                    uriTemplate: resource.uriTemplate,
                    mimeType: resource.mimeType
                });
            } else {
                resources.push({
                    name: resource.name,
                    description: resource.description,
                    uri: resource.uri,
                    mimeType: resource.mimeType
                });
            }
        });

        this._sendMessage({
            id: requestId,
            type: 'listResourcesResponse',
            resources,
            resourceTemplates
        });

        console.log(`Sent resources list: ${resources.length} resources, ${resourceTemplates.length} templates`);
    }

    /**
     * Send a message to the server via direct WebSocket
     * @private
     * @param {Object} message - The message object to send
     */
    _sendMessage(message) {
        if (!this.isConnected || !this.socket) {
            console.error('Cannot send message: not connected');
            return;
        }

        try {
            // Send the message directly through the WebSocket
            this.socket.send(JSON.stringify(message));
            return Promise.resolve();
        } catch (error) {
            console.error(`Error sending message: ${error.message}`);
            return Promise.reject(error);
        }
    }

    /**
     * Register all items with server that were registered while disconnected
     * @private
     */
    _registerItemsWithServer() {
        if (!this.isConnected) return;

        // Clear registration tracking sets - we'll re-register everything
        this.registeredTools = new Set();
        this.registeredPrompts = new Set();
        this.registeredResources = new Set();

        // Register all tools with the server
        this.availableTools.forEach((tool, name) => {
            this._sendMessage({
                type: 'registerTool',
                name,
                description: tool.description,
                inputSchema: tool.inputSchema
            });

            this.registeredTools.add(name);
            console.log(`Registering tool with server: ${name}`);
        });

        // Register all prompts with the server
        this.availablePrompts.forEach((prompt, name) => {
            this._sendMessage({
                type: 'registerPrompt',
                name,
                description: prompt.description,
                arguments: prompt.arguments
            });

            this.registeredPrompts.add(name);
            console.log(`Registering prompt with server: ${name}`);
        });

        // Register all resources with the server
        this.availableResources.forEach((resource, name) => {
            this._sendMessage({
                type: 'registerResource',
                name,
                description: resource.description,
                uri: resource.uri,
                uriTemplate: resource.uriTemplate,
                isTemplate: resource.isTemplate,
                mimeType: resource.mimeType
            });

            this.registeredResources.add(name);
            console.log(`Registering resource with server: ${name}`);
        });
    }

    /**
     * Register a tool
     * @public
     * @param {string} name - The name of the tool
     * @param {string} description - The description of the tool
     * @param {Object} schema - The schema for the tool's input
     * @param {Function} executeFn - The function to execute when the tool is called
     */
    registerTool(name, description, schema, executeFn) {
        if (!name) {
            console.error('Tool name is required');
            return;
        }

        // Add the tool to local registry
        this.availableTools.set(name, {
            name,
            description: description || `Tool: ${name}`,
            execute: executeFn || function (args) {
                return `Default implementation of ${name} with args: ${JSON.stringify(args)}`;
            },
            inputSchema: schema || {
                type: "object",
                properties: {}
            }
        });

        // Register the tool with the server if connected
        if (this.isConnected) {
            this._sendMessage({
                type: 'registerTool',
                name,
                description: description || `Tool: ${name}`,
                inputSchema: schema || {
                    type: "object",
                    properties: {}
                },
            });

            this.registeredTools.add(name);
        }

        // Save to session storage
        this._saveItemsToStorage();

        // Update tools display
        this._updateToolsList();
        console.log(`Tool registered: ${name}`);
    }

    /**
     * Register a prompt
     * @public
     * @param {string} name - The name of the prompt
     * @param {string} description - The description of the prompt
     * @param {Array} promptArgs - The arguments for the prompt
     * @param {Function} executeFn - The function to execute when the prompt is called
     */
    registerPrompt(name, description, promptArgs, executeFn) {
        if (!name) {
            console.error('Prompt name is required');
            return;
        }

        // Add the prompt to local registry
        this.availablePrompts.set(name, {
            name,
            description: description || `Prompt: ${name}`,
            execute: executeFn || function (args) {
                return {
                    messages: [{
                        role: "user",
                        content: {
                            type: "text",
                            text: `Default implementation of prompt ${name} with args: ${JSON.stringify(args)}`
                        }
                    }]
                };
            },
            arguments: promptArgs || []
        });

        // Register the prompt with the server if connected
        if (this.isConnected) {
            this._sendMessage({
                type: 'registerPrompt',
                name,
                description: description || `Prompt: ${name}`,
                arguments: promptArgs || []
            });

            this.registeredPrompts.add(name);
        }

        // Save to session storage
        this._saveItemsToStorage();

        // Update prompts display
        this._updatePromptsList();
        console.log(`Prompt registered: ${name}`);
    }

    /**
     * Register a resource
     * @public
     * @param {string} name - The name of the resource
     * @param {string} description - The description of the resource
     * @param {Object} options - The resource options including uri, uriTemplate, and mimeType
     * @param {Function} provideFn - The function to execute when the resource is requested
     */
    registerResource(name, description, options, provideFn) {
        if (!name) {
            console.error('Resource name is required');
            return;
        }

        if (!options.uri && !options.uriTemplate) {
            console.error('Either uri or uriTemplate is required for a resource');
            return;
        }

        const isTemplate = !!options.uriTemplate;

        // Add the resource to local registry
        this.availableResources.set(name, {
            name,
            description: description || `Resource: ${name}`,
            uri: options.uri,
            uriTemplate: options.uriTemplate,
            isTemplate,
            mimeType: options.mimeType,
            provide: provideFn || function (uri) {
                return {
                    contents: [{
                        uri: uri,
                        text: `Default implementation of resource ${name} for URI: ${uri}`,
                        mimeType: options.mimeType || "text/plain"
                    }]
                };
            }
        });

        // Register the resource with the server if connected
        if (this.isConnected) {
            this._sendMessage({
                type: 'registerResource',
                name,
                description: description || `Resource: ${name}`,
                uri: options.uri,
                uriTemplate: options.uriTemplate,
                isTemplate,
                mimeType: options.mimeType
            });

            this.registeredResources.add(name);
        }

        // Save to session storage
        this._saveItemsToStorage();

        // Update resources display
        this._updateResourcesList();
        console.log(`Resource registered: ${name}`);
    }

    /**
     * Handle sampling message creation request
     * @private
     * @param {Object} message - The parsed message object
     */
    _handleCreateSamplingMessage(message) {
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
        } = message;

        console.log(`Sampling request received with ${messages?.length || 0} messages`);

        // Create a modal dialog to show the sampling request
        const modal = document.createElement('div');
        Object.assign(modal.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: '10000'
        });

        // Create modal content
        const modalContent = document.createElement('div');
        Object.assign(modalContent.style, {
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '5px',
            maxWidth: '500px',
            width: '90%',
            maxHeight: '80%',
            overflow: 'auto'
        });

        // Create header
        const header = document.createElement('h3');
        header.textContent = 'Sampling Request';
        Object.assign(header.style, {
            margin: '0 0 15px 0',
            padding: '0 0 10px 0',
            borderBottom: '1px solid #ddd'
        });

        // Create content area to show messages
        const content = document.createElement('div');
        Object.assign(content.style, {
            marginBottom: '15px',
            maxHeight: '300px',
            overflow: 'auto',
            border: '1px solid #ddd',
            padding: '10px',
            backgroundColor: '#f9f9f9'
        });

        // Display messages
        if (messages && messages.length > 0) {
            messages.forEach(msg => {
                const msgDiv = document.createElement('div');
                Object.assign(msgDiv.style, {
                    marginBottom: '10px',
                    padding: '5px',
                    borderRadius: '3px',
                    backgroundColor: msg.role === 'user' ? '#e1f5fe' : '#f1f8e9'
                });

                const roleSpan = document.createElement('strong');
                roleSpan.textContent = msg.role === 'user' ? 'User: ' : 'Assistant: ';

                const contentSpan = document.createElement('span');
                if (msg.content.type === 'text') {
                    contentSpan.textContent = msg.content.text;
                } else if (msg.content.type === 'image') {
                    contentSpan.textContent = '[Image data]';
                }

                msgDiv.appendChild(roleSpan);
                msgDiv.appendChild(contentSpan);
                content.appendChild(msgDiv);
            });
        } else {
            content.textContent = 'No messages provided in sampling request';
        }

        // System prompt if available
        if (systemPrompt) {
            const sysPromptDiv = document.createElement('div');
            Object.assign(sysPromptDiv.style, {
                marginBottom: '10px',
                padding: '5px',
                backgroundColor: '#fff8e1'
            });

            const sysPromptLabel = document.createElement('strong');
            sysPromptLabel.textContent = 'System Prompt: ';

            const sysPromptContent = document.createElement('span');
            sysPromptContent.textContent = systemPrompt;

            sysPromptDiv.appendChild(sysPromptLabel);
            sysPromptDiv.appendChild(sysPromptContent);
            content.appendChild(sysPromptDiv);
        }

        // Create response input
        const responseLabel = document.createElement('label');
        responseLabel.textContent = 'Assistant Response:';
        Object.assign(responseLabel.style, {
            display: 'block',
            marginBottom: '5px',
            fontWeight: 'bold'
        });

        const responseInput = document.createElement('textarea');
        Object.assign(responseInput.style, {
            width: '100%',
            minHeight: '100px',
            padding: '10px',
            marginBottom: '15px',
            boxSizing: 'border-box'
        });

        // Create buttons
        const buttonContainer = document.createElement('div');
        Object.assign(buttonContainer.style, {
            display: 'flex',
            justifyContent: 'space-between'
        });

        const submitButton = document.createElement('button');
        submitButton.textContent = 'Submit Response';
        Object.assign(submitButton.style, {
            padding: '8px 15px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
        });

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        Object.assign(cancelButton.style, {
            padding: '8px 15px',
            backgroundColor: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
        });

        // Add elements to modal
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(submitButton);

        modalContent.appendChild(header);
        modalContent.appendChild(content);
        modalContent.appendChild(responseLabel);
        modalContent.appendChild(responseInput);
        modalContent.appendChild(buttonContainer);

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // Focus the response input
        responseInput.focus();

        // Setup button handlers
        submitButton.addEventListener('click', () => {
            const responseText = responseInput.value.trim();
            if (responseText) {
                // Send response back to server
                this._sendMessage({
                    id,
                    type: 'samplingResponse',
                    result: {
                        model: 'web-user-input',
                        role: 'assistant',
                        content: {
                            type: 'text',
                            text: responseText
                        }
                    }
                });

                // Remove modal
                document.body.removeChild(modal);
            } else {
                alert('Please enter a response');
            }
        });

        cancelButton.addEventListener('click', () => {
            // Send error response
            this._sendMessage({
                id,
                type: 'samplingResponse',
                error: 'User cancelled sampling request'
            });

            // Remove modal
            document.body.removeChild(modal);
        });
    }
}

// Export for module usage
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = WebMCP;
}
