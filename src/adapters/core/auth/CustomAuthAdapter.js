/**
 * CustomAuthAdapter - Implementation for custom authentication systems
 *
 * Use this for:
 * - Cookie-based sessions
 * - Custom JWT implementations
 * - Third-party auth not covered by other adapters
 * - Legacy authentication systems
 */

import { AuthAdapter } from '../AuthAdapter.js';

export class CustomAuthAdapter extends AuthAdapter {
    constructor(config) {
        super();

        // Custom functions to implement your auth logic
        this.getCurrentUserFn = config.getCurrentUser;
        this.validateTokenFn = config.validateToken;
        this.getUserContextFn = config.getUserContext;

        if (!this.getCurrentUserFn) {
            throw new Error('CustomAuthAdapter requires getCurrentUser function');
        }
    }

    /**
     * Get current user using custom logic
     * @param {Object} context - Request context
     * @returns {Promise<User|null>}
     */
    async getCurrentUser(context) {
        return this.getCurrentUserFn(context);
    }

    /**
     * Validate token using custom logic
     * @param {string} token - Token to validate
     * @returns {Promise<boolean>}
     */
    async validateToken(token) {
        if (!this.validateTokenFn) {
            return false;
        }
        return this.validateTokenFn(token);
    }

    /**
     * Get user context using custom logic
     * @param {string} userId - User ID
     * @returns {Promise<Object>}
     */
    async getUserContext(userId) {
        if (!this.getUserContextFn) {
            return {
                tier: 'free',
                permissions: ['read']
            };
        }
        return this.getUserContextFn(userId);
    }
}

/**
 * Example: Cookie-based session auth
 *
 * const authAdapter = new CustomAuthAdapter({
 *   getCurrentUser: async (context) => {
 *     // Extract session cookie
 *     const sessionId = context.cookies?.sessionId;
 *     if (!sessionId) {
 *       return { id: 'anonymous', authenticated: false, metadata: {} };
 *     }
 *
 *     // Validate session against your database
 *     const session = await db.sessions.findOne({ id: sessionId });
 *     if (!session || session.expiresAt < Date.now()) {
 *       return { id: 'anonymous', authenticated: false, metadata: {} };
 *     }
 *
 *     // Fetch user
 *     const user = await db.users.findOne({ id: session.userId });
 *     return {
 *       id: user.id,
 *       email: user.email,
 *       name: user.name,
 *       authenticated: true,
 *       metadata: { createdAt: user.createdAt }
 *     };
 *   },
 *
 *   validateToken: async (token) => {
 *     const session = await db.sessions.findOne({ id: token });
 *     return session && session.expiresAt > Date.now();
 *   },
 *
 *   getUserContext: async (userId) => {
 *     const user = await db.users.findOne({ id: userId });
 *     return {
 *       tier: user.subscriptionTier,
 *       permissions: user.permissions,
 *       preferences: user.preferences
 *     };
 *   }
 * });
 */

/**
 * Example: JWT-based auth
 *
 * import jwt from 'jsonwebtoken';
 *
 * const authAdapter = new CustomAuthAdapter({
 *   getCurrentUser: async (context) => {
 *     const token = context.headers?.authorization?.replace('Bearer ', '');
 *     if (!token) {
 *       return { id: 'anonymous', authenticated: false, metadata: {} };
 *     }
 *
 *     try {
 *       const decoded = jwt.verify(token, process.env.JWT_SECRET);
 *       return {
 *         id: decoded.userId,
 *         email: decoded.email,
 *         name: decoded.name,
 *         authenticated: true,
 *         metadata: { claims: decoded }
 *       };
 *     } catch (error) {
 *       return { id: 'anonymous', authenticated: false, metadata: {} };
 *     }
 *   },
 *
 *   validateToken: async (token) => {
 *     try {
 *       jwt.verify(token, process.env.JWT_SECRET);
 *       return true;
 *     } catch {
 *       return false;
 *     }
 *   },
 *
 *   getUserContext: async (userId) => {
 *     const user = await db.users.findOne({ id: userId });
 *     return {
 *       tier: user.role === 'admin' ? 'premium' : 'free',
 *       permissions: user.permissions
 *     };
 *   }
 * });
 */
