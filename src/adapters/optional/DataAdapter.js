/**
 * DataAdapter - Optional adapter interface for business data access
 *
 * This adapter is OPTIONAL and can be used for:
 * - E-commerce: Products, inventory, pricing
 * - Content sites: Articles, videos, documents
 * - SaaS: Projects, tasks, reports
 * - Any domain-specific data
 *
 * Implement only the methods your application needs.
 */

export class DataAdapter {
    /**
     * Search for items in your data store
     * @param {string} query - Search query
     * @param {Object} filters - Optional filters
     * @returns {Promise<Array>} Array of matching items
     */
    async search(query, filters = {}) {
        throw new Error('DataAdapter.search not implemented');
    }

    /**
     * Get a single item by ID
     * @param {string} itemId - Item identifier
     * @returns {Promise<Object|null>} Item object or null
     */
    async getItem(itemId) {
        throw new Error('DataAdapter.getItem not implemented');
    }

    /**
     * Get multiple items by IDs
     * @param {Array<string>} itemIds - Array of item identifiers
     * @returns {Promise<Array>} Array of items
     */
    async getItems(itemIds) {
        return Promise.all(itemIds.map(id => this.getItem(id)));
    }

    /**
     * Get real-time data for an item (e.g., stock levels, pricing, availability)
     * @param {string} itemId - Item identifier
     * @returns {Promise<Object>} Real-time data object
     */
    async getItemRealTimeData(itemId) {
        throw new Error('DataAdapter.getItemRealTimeData not implemented');
    }

    /**
     * Get current promotions/offers
     * @returns {Promise<Array>} Array of active promotions
     */
    async getActivePromotions() {
        return [];
    }

    /**
     * Create or update an item (if your app supports mutations)
     * @param {Object} itemData - Item data
     * @returns {Promise<Object>} Created/updated item
     */
    async saveItem(itemData) {
        throw new Error('DataAdapter.saveItem not implemented');
    }

    /**
     * Get items specific to a user (e.g., user's orders, favorites, cart)
     * @param {string} userId - User identifier
     * @param {string} type - Type of user items (e.g., 'orders', 'favorites')
     * @returns {Promise<Array>} Array of user items
     */
    async getUserItems(userId, type) {
        throw new Error('DataAdapter.getUserItems not implemented');
    }
}

/**
 * NoOpDataAdapter - Default implementation when no data adapter is needed
 */
export class NoOpDataAdapter extends DataAdapter {
    async search(query, filters = {}) {
        return [];
    }

    async getItem(itemId) {
        return null;
    }

    async getItemRealTimeData(itemId) {
        return {};
    }

    async getActivePromotions() {
        return [];
    }

    async saveItem(itemData) {
        throw new Error('Data mutations not supported');
    }

    async getUserItems(userId, type) {
        return [];
    }
}
