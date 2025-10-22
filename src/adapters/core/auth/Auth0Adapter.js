/**
 * Auth0Adapter - Implementation for Auth0 authentication
 *
 * Requires: npm install @auth0/auth0-spa-js (client-side)
 * Or: @auth0/nextjs-auth0 (server-side with Next.js)
 */

import { AuthAdapter } from '../AuthAdapter.js';

export class Auth0Adapter extends AuthAdapter {
    constructor(config) {
        super();
        this.domain = config.domain;
        this.clientId = config.clientId;
        this.audience = config.audience;

        // Optional: custom user context mapping
        this.mapUserContext = config.mapUserContext || this._defaultMapUserContext.bind(this);
    }

    /**
     * Get current user from Auth0 session
     * @param {Object} context - Request context with auth0 session
     * @returns {Promise<User|null>}
     */
    async getCurrentUser(context) {
        // Expects context.auth0User from Auth0 SDK
        const auth0User = context.auth0User || context.user;

        if (!auth0User) {
            return {
                id: 'anonymous',
                authenticated: false,
                metadata: {}
            };
        }

        return {
            id: auth0User.sub,
            email: auth0User.email,
            name: auth0User.name || auth0User.nickname,
            authenticated: true,
            metadata: {
                emailVerified: auth0User.email_verified,
                picture: auth0User.picture,
                ...auth0User.user_metadata
            }
        };
    }

    /**
     * Validate Auth0 JWT token
     * @param {string} token - JWT token
     * @returns {Promise<boolean>}
     */
    async validateToken(token) {
        try {
            // In production, use Auth0's token validation
            // This is a simplified example
            const response = await fetch(`https://${this.domain}/userinfo`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            return response.ok;
        } catch (error) {
            console.error('Auth0 token validation failed:', error);
            return false;
        }
    }

    /**
     * Get user context from Auth0 user metadata
     * @param {string} userId - User ID (sub claim)
     * @returns {Promise<Object>}
     */
    async getUserContext(userId) {
        // In practice, this would fetch from Auth0 Management API
        // or from your own database enriched with Auth0 data

        // For now, return a structure that can be customized
        return this.mapUserContext(userId);
    }

    /**
     * Default user context mapping
     * Override this with custom logic in config
     * @private
     */
    _defaultMapUserContext(userId) {
        return {
            tier: 'free',
            permissions: ['read']
        };
    }
}

/**
 * Example configuration:
 *
 * const authAdapter = new Auth0Adapter({
 *   domain: 'your-tenant.auth0.com',
 *   clientId: 'your-client-id',
 *   audience: 'https://your-api.com',
 *   mapUserContext: async (userId) => {
 *     // Fetch from your database
 *     const user = await db.users.findOne({ auth0Id: userId });
 *     return {
 *       tier: user.subscriptionTier,
 *       permissions: user.permissions,
 *       preferences: user.preferences
 *     };
 *   }
 * });
 */
