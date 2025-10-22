/**
 * ShopifyAdapter - Implementation for Shopify e-commerce data
 *
 * Requires: @shopify/shopify-api (for server-side)
 * Or: Shopify Storefront API (for client-side)
 */

import { DataAdapter } from '../DataAdapter.js';

export class ShopifyAdapter extends DataAdapter {
    constructor(config) {
        super();
        this.shopDomain = config.shopDomain; // e.g., 'myshop.myshopify.com'
        this.accessToken = config.accessToken; // Storefront API access token
        this.apiVersion = config.apiVersion || '2024-01';
        this.storefrontApiUrl = `https://${this.shopDomain}/api/${this.apiVersion}/graphql.json`;
    }

    /**
     * Search products in Shopify
     * @param {string} query - Search query
     * @param {Object} filters - Optional filters (price, type, etc.)
     * @returns {Promise<Array>}
     */
    async search(query, filters = {}) {
        const graphqlQuery = `
            query searchProducts($query: String!, $first: Int!) {
                products(first: $first, query: $query) {
                    edges {
                        node {
                            id
                            title
                            description
                            handle
                            priceRange {
                                minVariantPrice {
                                    amount
                                    currencyCode
                                }
                            }
                            images(first: 1) {
                                edges {
                                    node {
                                        url
                                        altText
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;

        const variables = {
            query: query,
            first: filters.limit || 20
        };

        const result = await this._makeGraphQLRequest(graphqlQuery, variables);
        return this._formatProducts(result.data?.products?.edges || []);
    }

    /**
     * Get a single product by ID
     * @param {string} itemId - Product ID or handle
     * @returns {Promise<Object|null>}
     */
    async getItem(itemId) {
        // Check if it's a handle or ID
        const isHandle = !itemId.includes('gid://');

        const graphqlQuery = isHandle ? `
            query getProductByHandle($handle: String!) {
                productByHandle(handle: $handle) {
                    ${this._productFragment}
                }
            }
        ` : `
            query getProduct($id: ID!) {
                product(id: $id) {
                    ${this._productFragment}
                }
            }
        `;

        const variables = isHandle ? { handle: itemId } : { id: itemId };
        const result = await this._makeGraphQLRequest(graphqlQuery, variables);

        const product = isHandle ?
            result.data?.productByHandle :
            result.data?.product;

        return product ? this._formatProduct(product) : null;
    }

    /**
     * Get real-time inventory data
     * @param {string} itemId - Product ID or handle
     * @returns {Promise<Object>}
     */
    async getItemRealTimeData(itemId) {
        const product = await this.getItem(itemId);

        if (!product) {
            return { available: false };
        }

        return {
            available: product.availableForSale,
            variants: product.variants,
            totalInventory: product.totalInventory,
            priceRange: product.priceRange
        };
    }

    /**
     * Get active promotions/discounts
     * @returns {Promise<Array>}
     */
    async getActivePromotions() {
        // Shopify discounts are typically managed server-side
        // This would require Admin API access
        // For now, return empty array
        console.warn('Active promotions require Shopify Admin API access');
        return [];
    }

    /**
     * Get user's orders (requires customer access token)
     * @param {string} userId - Customer access token
     * @param {string} type - Type of user items ('orders')
     * @returns {Promise<Array>}
     */
    async getUserItems(userId, type) {
        if (type !== 'orders') {
            return [];
        }

        const graphqlQuery = `
            query getCustomerOrders($customerAccessToken: String!, $first: Int!) {
                customer(customerAccessToken: $customerAccessToken) {
                    orders(first: $first) {
                        edges {
                            node {
                                id
                                orderNumber
                                totalPrice {
                                    amount
                                    currencyCode
                                }
                                processedAt
                                fulfillmentStatus
                                lineItems(first: 10) {
                                    edges {
                                        node {
                                            title
                                            quantity
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;

        const result = await this._makeGraphQLRequest(graphqlQuery, {
            customerAccessToken: userId,
            first: 10
        });

        return result.data?.customer?.orders?.edges?.map(e => e.node) || [];
    }

    /**
     * Make GraphQL request to Shopify Storefront API
     * @private
     */
    async _makeGraphQLRequest(query, variables = {}) {
        const response = await fetch(this.storefrontApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Storefront-Access-Token': this.accessToken
            },
            body: JSON.stringify({ query, variables })
        });

        if (!response.ok) {
            throw new Error(`Shopify API error: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Product fragment for GraphQL queries
     * @private
     */
    get _productFragment() {
        return `
            id
            title
            description
            handle
            availableForSale
            totalInventory
            priceRange {
                minVariantPrice {
                    amount
                    currencyCode
                }
                maxVariantPrice {
                    amount
                    currencyCode
                }
            }
            variants(first: 10) {
                edges {
                    node {
                        id
                        title
                        price {
                            amount
                            currencyCode
                        }
                        availableForSale
                    }
                }
            }
            images(first: 5) {
                edges {
                    node {
                        url
                        altText
                    }
                }
            }
        `;
    }

    /**
     * Format products array
     * @private
     */
    _formatProducts(edges) {
        return edges.map(edge => this._formatProduct(edge.node));
    }

    /**
     * Format single product
     * @private
     */
    _formatProduct(product) {
        return {
            id: product.id,
            title: product.title,
            description: product.description,
            handle: product.handle,
            availableForSale: product.availableForSale,
            totalInventory: product.totalInventory,
            priceRange: product.priceRange,
            variants: product.variants?.edges?.map(e => e.node) || [],
            images: product.images?.edges?.map(e => e.node) || []
        };
    }
}

/**
 * Example configuration:
 *
 * const dataAdapter = new ShopifyAdapter({
 *   shopDomain: 'myshop.myshopify.com',
 *   accessToken: 'your-storefront-api-access-token',
 *   apiVersion: '2024-01'
 * });
 */
