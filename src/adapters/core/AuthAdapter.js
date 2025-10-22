/**
 * AuthAdapter - Core adapter interface for user authentication and context
 *
 * All WebMCP implementations MUST provide an authentication adapter.
 * This enables user-aware tool registration and personalized experiences.
 */

export class AuthAdapter {
    /**
     * Get the current user from a request context
     * @param {Object} context - Request context (e.g., cookies, headers, session)
     * @returns {Promise<User|null>} User object or null if not authenticated
     *
     * User object shape:
     * {
     *   id: string,
     *   email?: string,
     *   name?: string,
     *   authenticated: boolean,
     *   metadata?: any  // Custom user properties
     * }
     */
    async getCurrentUser(context) {
        throw new Error('AuthAdapter.getCurrentUser must be implemented');
    }

    /**
     * Validate an authentication token
     * @param {string} token - The token to validate
     * @returns {Promise<boolean>} True if valid
     */
    async validateToken(token) {
        throw new Error('AuthAdapter.validateToken must be implemented');
    }

    /**
     * Get user context/metadata for personalization
     * @param {string} userId - The user ID
     * @returns {Promise<Object>} User context object with custom properties
     *
     * Example return:
     * {
     *   tier: 'VIP' | 'premium' | 'free',
     *   preferences: {...},
     *   permissions: [...],
     *   any other custom fields
     * }
     */
    async getUserContext(userId) {
        throw new Error('AuthAdapter.getUserContext must be implemented');
    }
}

/**
 * NoAuthAdapter - Default implementation for public sites without authentication
 */
export class NoAuthAdapter extends AuthAdapter {
    async getCurrentUser(context) {
        return {
            id: 'anonymous',
            authenticated: false,
            metadata: {}
        };
    }

    async validateToken(token) {
        return false; // No tokens in public mode
    }

    async getUserContext(userId) {
        return {
            tier: 'free',
            permissions: ['read']
        };
    }
}
