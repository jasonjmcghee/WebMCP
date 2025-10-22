/**
 * AdapterRegistry - Manages core and optional adapters for WebMCP
 *
 * This registry ensures core adapters are always present and handles
 * optional adapters gracefully when not configured.
 */

import { NoAuthAdapter } from './core/AuthAdapter.js';
import { ConsoleAnalyticsAdapter } from './core/AnalyticsAdapter.js';
import { NoOpDataAdapter } from './optional/DataAdapter.js';

export class AdapterRegistry {
    constructor(config = {}) {
        // Core adapters (required, with fallbacks)
        this.auth = config.auth || new NoAuthAdapter();
        this.analytics = config.analytics || new ConsoleAnalyticsAdapter();

        // Optional adapters
        this.data = config.data || null;

        // Store any custom adapters
        this.custom = config.custom || {};

        // Validate core adapters
        this._validateCoreAdapters();
    }

    /**
     * Ensure core adapters implement required interface
     * @private
     */
    _validateCoreAdapters() {
        // Check auth adapter
        if (typeof this.auth.getCurrentUser !== 'function') {
            throw new Error('AuthAdapter must implement getCurrentUser method');
        }

        // Check analytics adapter
        if (typeof this.analytics.trackEvent !== 'function') {
            throw new Error('AnalyticsAdapter must implement trackEvent method');
        }
    }

    /**
     * Check if a specific adapter is available
     * @param {string} adapterName - Name of the adapter
     * @returns {boolean}
     */
    hasAdapter(adapterName) {
        return this[adapterName] !== null && this[adapterName] !== undefined;
    }

    /**
     * Get an adapter, with fallback
     * @param {string} adapterName - Name of the adapter
     * @returns {Object|null}
     */
    getAdapter(adapterName) {
        return this[adapterName] || null;
    }

    /**
     * Safely execute an adapter method
     * @param {string} adapterName - Name of the adapter
     * @param {string} methodName - Method to call
     * @param {...any} args - Arguments to pass
     * @returns {Promise<any>}
     */
    async call(adapterName, methodName, ...args) {
        const adapter = this.getAdapter(adapterName);

        if (!adapter) {
            console.warn(`Adapter '${adapterName}' not configured, skipping ${methodName}`);
            return null;
        }

        if (typeof adapter[methodName] !== 'function') {
            console.warn(`Adapter '${adapterName}' does not implement ${methodName}`);
            return null;
        }

        try {
            return await adapter[methodName](...args);
        } catch (error) {
            console.error(`Error calling ${adapterName}.${methodName}:`, error);
            throw error;
        }
    }

    /**
     * Get a summary of configured adapters
     * @returns {Object}
     */
    getSummary() {
        return {
            core: {
                auth: this.auth.constructor.name,
                analytics: this.analytics.constructor.name
            },
            optional: {
                data: this.data ? this.data.constructor.name : 'Not configured'
            },
            custom: Object.keys(this.custom)
        };
    }
}

/**
 * Factory function to create a registry from config
 * @param {Object} config - Configuration object
 * @returns {AdapterRegistry}
 */
export function createAdapterRegistry(config) {
    return new AdapterRegistry(config);
}
