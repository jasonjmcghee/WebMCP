/**
 * RestApiAdapter - Generic REST API adapter for custom backends
 *
 * Use this adapter when you have a custom REST API that doesn't fit
 * into existing platforms like Shopify or WooCommerce.
 */

import { DataAdapter } from '../DataAdapter.js';

export class RestApiAdapter extends DataAdapter {
    constructor(config) {
        super();
        this.baseUrl = config.baseUrl;
        this.headers = config.headers || {};
        this.endpoints = config.endpoints || {};

        // Optional transformers for custom data formats
        this.transformers = config.transformers || {};
    }

    /**
     * Search items via REST API
     * @param {string} query - Search query
     * @param {Object} filters - Optional filters
     * @returns {Promise<Array>}
     */
    async search(query, filters = {}) {
        const endpoint = this.endpoints.search || '/search';
        const params = new URLSearchParams({
            q: query,
            ...filters
        });

        const data = await this._makeRequest(`${endpoint}?${params}`);

        // Apply transformer if provided
        if (this.transformers.search) {
            return this.transformers.search(data);
        }

        // Default: assume data is array or has 'results' property
        return Array.isArray(data) ? data : (data.results || data.items || []);
    }

    /**
     * Get a single item by ID
     * @param {string} itemId - Item ID
     * @returns {Promise<Object|null>}
     */
    async getItem(itemId) {
        const endpoint = this.endpoints.getItem || '/items/{id}';
        const url = endpoint.replace('{id}', itemId);

        try {
            const data = await this._makeRequest(url);

            // Apply transformer if provided
            if (this.transformers.getItem) {
                return this.transformers.getItem(data);
            }

            return data;
        } catch (error) {
            if (error.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Get multiple items by IDs
     * @param {Array<string>} itemIds - Array of item IDs
     * @returns {Promise<Array>}
     */
    async getItems(itemIds) {
        const endpoint = this.endpoints.getItems || '/items';

        // Try batch endpoint first
        if (this.endpoints.getItems) {
            const params = new URLSearchParams();
            itemIds.forEach(id => params.append('ids[]', id));

            const data = await this._makeRequest(`${endpoint}?${params}`);

            if (this.transformers.getItems) {
                return this.transformers.getItems(data);
            }

            return Array.isArray(data) ? data : (data.results || data.items || []);
        }

        // Fallback to individual requests
        return Promise.all(itemIds.map(id => this.getItem(id)));
    }

    /**
     * Get real-time data for an item
     * @param {string} itemId - Item ID
     * @returns {Promise<Object>}
     */
    async getItemRealTimeData(itemId) {
        const endpoint = this.endpoints.getRealTimeData || '/items/{id}/realtime';
        const url = endpoint.replace('{id}', itemId);

        try {
            const data = await this._makeRequest(url);

            if (this.transformers.getRealTimeData) {
                return this.transformers.getRealTimeData(data);
            }

            return data;
        } catch (error) {
            console.error('Error fetching real-time data:', error);
            return {};
        }
    }

    /**
     * Get active promotions
     * @returns {Promise<Array>}
     */
    async getActivePromotions() {
        if (!this.endpoints.getPromotions) {
            return [];
        }

        const endpoint = this.endpoints.getPromotions;
        const data = await this._makeRequest(endpoint);

        if (this.transformers.getPromotions) {
            return this.transformers.getPromotions(data);
        }

        return Array.isArray(data) ? data : (data.promotions || data.results || []);
    }

    /**
     * Create or update an item
     * @param {Object} itemData - Item data
     * @returns {Promise<Object>}
     */
    async saveItem(itemData) {
        const isUpdate = !!itemData.id;
        const endpoint = isUpdate ?
            (this.endpoints.updateItem || '/items/{id}').replace('{id}', itemData.id) :
            (this.endpoints.createItem || '/items');

        const method = isUpdate ? 'PUT' : 'POST';

        const data = await this._makeRequest(endpoint, {
            method,
            body: JSON.stringify(itemData)
        });

        if (this.transformers.saveItem) {
            return this.transformers.saveItem(data);
        }

        return data;
    }

    /**
     * Get user-specific items
     * @param {string} userId - User ID
     * @param {string} type - Type of items (e.g., 'orders', 'favorites')
     * @returns {Promise<Array>}
     */
    async getUserItems(userId, type) {
        const endpointKey = `getUserItems_${type}`;
        const endpoint = this.endpoints[endpointKey] ||
            this.endpoints.getUserItems ||
            '/users/{userId}/{type}';

        const url = endpoint
            .replace('{userId}', userId)
            .replace('{type}', type);

        try {
            const data = await this._makeRequest(url);

            const transformerKey = `getUserItems_${type}`;
            if (this.transformers[transformerKey]) {
                return this.transformers[transformerKey](data);
            }

            return Array.isArray(data) ? data : (data.results || data.items || []);
        } catch (error) {
            console.error(`Error fetching user ${type}:`, error);
            return [];
        }
    }

    /**
     * Make HTTP request to REST API
     * @private
     */
    async _makeRequest(url, options = {}) {
        const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;

        const response = await fetch(fullUrl, {
            headers: {
                'Content-Type': 'application/json',
                ...this.headers
            },
            ...options
        });

        if (!response.ok) {
            const error = new Error(`API error: ${response.status}`);
            error.status = response.status;
            throw error;
        }

        return response.json();
    }
}

/**
 * Example configuration:
 *
 * const dataAdapter = new RestApiAdapter({
 *   baseUrl: 'https://api.example.com/v1',
 *   headers: {
 *     'Authorization': 'Bearer your-api-token',
 *     'X-Custom-Header': 'value'
 *   },
 *   endpoints: {
 *     search: '/products/search',
 *     getItem: '/products/{id}',
 *     getRealTimeData: '/products/{id}/inventory',
 *     getPromotions: '/promotions/active',
 *     getUserItems_orders: '/users/{userId}/orders',
 *     getUserItems_favorites: '/users/{userId}/favorites'
 *   },
 *   transformers: {
 *     search: (data) => {
 *       // Transform API response to common format
 *       return data.products.map(p => ({
 *         id: p.productId,
 *         name: p.productName,
 *         price: p.currentPrice
 *       }));
 *     },
 *     getRealTimeData: (data) => ({
 *       inStock: data.inventory > 0,
 *       quantity: data.inventory,
 *       price: data.price
 *     })
 *   }
 * });
 *
 * Minimal configuration (with sensible defaults):
 * const dataAdapter = new RestApiAdapter({
 *   baseUrl: 'https://api.example.com',
 *   headers: { 'Authorization': 'Bearer token' }
 * });
 */
