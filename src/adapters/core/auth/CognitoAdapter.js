/**
 * CognitoAdapter - Implementation for AWS Cognito authentication
 *
 * Requires: npm install amazon-cognito-identity-js
 * Or: @aws-sdk/client-cognito-identity-provider (server-side)
 */

import { AuthAdapter } from '../AuthAdapter.js';

export class CognitoAdapter extends AuthAdapter {
    constructor(config) {
        super();
        this.userPoolId = config.userPoolId;
        this.clientId = config.clientId;
        this.region = config.region;

        // Optional: custom user context mapping
        this.mapUserContext = config.mapUserContext || this._defaultMapUserContext.bind(this);
    }

    /**
     * Get current user from Cognito session
     * @param {Object} context - Request context with cognito user
     * @returns {Promise<User|null>}
     */
    async getCurrentUser(context) {
        // Expects context.cognitoUser from Cognito SDK
        const cognitoUser = context.cognitoUser || context.user;

        if (!cognitoUser) {
            return {
                id: 'anonymous',
                authenticated: false,
                metadata: {}
            };
        }

        // Extract attributes from Cognito user
        const attributes = this._extractAttributes(cognitoUser);

        return {
            id: cognitoUser.username || attributes.sub,
            email: attributes.email,
            name: attributes.name || attributes.preferred_username,
            authenticated: true,
            metadata: {
                emailVerified: attributes.email_verified === 'true',
                phoneNumber: attributes.phone_number,
                ...attributes
            }
        };
    }

    /**
     * Validate Cognito JWT token
     * @param {string} token - JWT token (ID token or access token)
     * @returns {Promise<boolean>}
     */
    async validateToken(token) {
        try {
            // Verify JWT signature against Cognito's JWKS
            const jwksUrl = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPoolId}/.well-known/jwks.json`;

            // In production, use a JWT library like jsonwebtoken or jose
            // This is simplified for illustration
            const response = await fetch(jwksUrl);
            const jwks = await response.json();

            // Here you would verify the token signature
            // For now, just check if it's a valid JWT format
            const parts = token.split('.');
            return parts.length === 3;

        } catch (error) {
            console.error('Cognito token validation failed:', error);
            return false;
        }
    }

    /**
     * Get user context from Cognito attributes
     * @param {string} userId - User ID (Cognito username)
     * @returns {Promise<Object>}
     */
    async getUserContext(userId) {
        return this.mapUserContext(userId);
    }

    /**
     * Extract attributes from Cognito user object
     * @private
     */
    _extractAttributes(cognitoUser) {
        const attributes = {};

        // Cognito attributes come in different formats depending on SDK
        if (Array.isArray(cognitoUser.attributes)) {
            // Format: [{Name: 'email', Value: 'user@example.com'}]
            cognitoUser.attributes.forEach(attr => {
                attributes[attr.Name] = attr.Value;
            });
        } else if (cognitoUser.attributes) {
            // Format: {email: 'user@example.com'}
            Object.assign(attributes, cognitoUser.attributes);
        } else if (cognitoUser.UserAttributes) {
            // AWS SDK format
            cognitoUser.UserAttributes.forEach(attr => {
                attributes[attr.Name] = attr.Value;
            });
        }

        return attributes;
    }

    /**
     * Default user context mapping
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
 * const authAdapter = new CognitoAdapter({
 *   userPoolId: 'us-east-1_XXXXXXXXX',
 *   clientId: 'your-client-id',
 *   region: 'us-east-1',
 *   mapUserContext: async (userId) => {
 *     // Fetch from your database
 *     const user = await db.users.findOne({ cognitoUsername: userId });
 *     return {
 *       tier: user.plan,
 *       permissions: user.roles,
 *       customData: user.metadata
 *     };
 *   }
 * });
 */
