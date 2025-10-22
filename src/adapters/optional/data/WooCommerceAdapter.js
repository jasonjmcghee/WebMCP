/**
 * WooCommerceAdapter - Implementation for WooCommerce data
 *
 * Uses WooCommerce REST API
 * Requires: Consumer key and consumer secret from WooCommerce settings
 */

import { DataAdapter } from '../DataAdapter.js';

export class WooCommerceAdapter extends DataAdapter {
    constructor(config) {
        super();
        this.siteUrl = config.siteUrl; // e.g., 'https://example.com'
        this.consumerKey = config.consumerKey;
        this.consumerSecret = config.consumerSecret;
        this.apiVersion = config.apiVersion || 'wc/v3';
        this.apiUrl = `${this.siteUrl}/wp-json/${this.apiVersion}`;
    }

    /**
     * Search products in WooCommerce
     * @param {string} query - Search query
     * @param {Object} filters - Optional filters
     * @returns {Promise<Array>}
     */
    async search(query, filters = {}) {
        const params = new URLSearchParams({
            search: query,
            per_page: filters.limit || 20,
            orderby: filters.orderby || 'relevance'
        });

        if (filters.category) {
            params.append('category', filters.category);
        }

        if (filters.minPrice || filters.maxPrice) {
            if (filters.minPrice) params.append('min_price', filters.minPrice);
            if (filters.maxPrice) params.append('max_price', filters.maxPrice);
        }

        const products = await this._makeRequest('/products', params);
        return products.map(p => this._formatProduct(p));
    }

    /**
     * Get a single product by ID
     * @param {string} itemId - Product ID or slug
     * @returns {Promise<Object|null>}
     */
    async getItem(itemId) {
        try {
            // Try as numeric ID first
            if (!isNaN(itemId)) {
                const product = await this._makeRequest(`/products/${itemId}`);
                return this._formatProduct(product);
            }

            // Otherwise search by slug
            const products = await this._makeRequest('/products', new URLSearchParams({
                slug: itemId
            }));

            return products.length > 0 ? this._formatProduct(products[0]) : null;
        } catch (error) {
            console.error('Error fetching product:', error);
            return null;
        }
    }

    /**
     * Get real-time inventory and pricing data
     * @param {string} itemId - Product ID
     * @returns {Promise<Object>}
     */
    async getItemRealTimeData(itemId) {
        const product = await this.getItem(itemId);

        if (!product) {
            return { inStock: false };
        }

        return {
            inStock: product.stock_status === 'instock',
            stockQuantity: product.stock_quantity,
            price: product.price,
            salePrice: product.sale_price,
            regularPrice: product.regular_price,
            onSale: product.on_sale,
            variations: product.variations || []
        };
    }

    /**
     * Get active coupons/promotions
     * @returns {Promise<Array>}
     */
    async getActivePromotions() {
        try {
            const coupons = await this._makeRequest('/coupons', new URLSearchParams({
                per_page: 50,
                status: 'publish'
            }));

            return coupons
                .filter(c => this._isCouponActive(c))
                .map(c => ({
                    code: c.code,
                    description: c.description,
                    discount_type: c.discount_type,
                    amount: c.amount,
                    minimum_amount: c.minimum_amount,
                    expires: c.date_expires
                }));
        } catch (error) {
            console.error('Error fetching promotions:', error);
            return [];
        }
    }

    /**
     * Get user's orders
     * @param {string} userId - Customer ID
     * @param {string} type - Type of user items ('orders')
     * @returns {Promise<Array>}
     */
    async getUserItems(userId, type) {
        if (type !== 'orders') {
            return [];
        }

        try {
            const orders = await this._makeRequest('/orders', new URLSearchParams({
                customer: userId,
                per_page: 20,
                orderby: 'date',
                order: 'desc'
            }));

            return orders.map(o => ({
                id: o.id,
                number: o.number,
                status: o.status,
                total: o.total,
                currency: o.currency,
                date_created: o.date_created,
                items: o.line_items.map(item => ({
                    name: item.name,
                    quantity: item.quantity,
                    total: item.total
                }))
            }));
        } catch (error) {
            console.error('Error fetching orders:', error);
            return [];
        }
    }

    /**
     * Make authenticated request to WooCommerce API
     * @private
     */
    async _makeRequest(endpoint, params = new URLSearchParams()) {
        // Add authentication
        params.append('consumer_key', this.consumerKey);
        params.append('consumer_secret', this.consumerSecret);

        const url = `${this.apiUrl}${endpoint}?${params}`;

        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`WooCommerce API error: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Check if coupon is currently active
     * @private
     */
    _isCouponActive(coupon) {
        if (!coupon.date_expires) {
            return true; // No expiration
        }

        const expiryDate = new Date(coupon.date_expires);
        return expiryDate > new Date();
    }

    /**
     * Format product data
     * @private
     */
    _formatProduct(product) {
        return {
            id: product.id,
            name: product.name,
            slug: product.slug,
            permalink: product.permalink,
            description: product.description,
            short_description: product.short_description,
            price: product.price,
            regular_price: product.regular_price,
            sale_price: product.sale_price,
            on_sale: product.on_sale,
            stock_status: product.stock_status,
            stock_quantity: product.stock_quantity,
            categories: product.categories,
            images: product.images,
            variations: product.variations,
            attributes: product.attributes
        };
    }
}

/**
 * Example configuration:
 *
 * const dataAdapter = new WooCommerceAdapter({
 *   siteUrl: 'https://example.com',
 *   consumerKey: 'ck_xxxxxxxxxxxxxxxxxxxx',
 *   consumerSecret: 'cs_xxxxxxxxxxxxxxxxxxxx',
 *   apiVersion: 'wc/v3'  // Optional, defaults to wc/v3
 * });
 *
 * To get consumer key/secret:
 * 1. Go to WooCommerce > Settings > Advanced > REST API
 * 2. Click "Add key"
 * 3. Set permissions to "Read" (or "Read/Write" if you need mutations)
 * 4. Copy the generated keys
 */
