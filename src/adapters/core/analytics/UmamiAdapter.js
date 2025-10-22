/**
 * UmamiAdapter - Implementation for Umami analytics
 *
 * Umami is a privacy-focused, open-source analytics platform.
 * Works with Umami's tracker.js or direct API calls.
 */

import { AnalyticsAdapter } from '../AnalyticsAdapter.js';

export class UmamiAdapter extends AnalyticsAdapter {
    constructor(config) {
        super();
        this.websiteId = config.websiteId;
        this.apiEndpoint = config.apiEndpoint || 'https://analytics.umami.is';
        this.isClientSide = typeof window !== 'undefined';

        if (this.isClientSide) {
            // Check if Umami tracker is loaded
            this.umami = window.umami;
            if (!this.umami) {
                console.warn('Umami tracker not found. Make sure the script is loaded.');
            }
        }
    }

    /**
     * Track an event via Umami
     * @param {string} eventName - Event name
     * @param {Object} properties - Event properties
     * @param {Object} context - User/session context
     * @returns {Promise<void>}
     */
    async trackEvent(eventName, properties = {}, context = {}) {
        if (this.isClientSide && this.umami) {
            // Use Umami's client-side tracker
            this.umami.track(eventName, properties);
        } else {
            // Use Umami's Event API for server-side tracking
            await this._trackViaAPI(eventName, properties, context);
        }
    }

    /**
     * Track tool usage with Umami
     * @param {Object} usage - Tool usage data
     * @returns {Promise<void>}
     */
    async trackToolUsage(usage) {
        const properties = {
            tool: usage.toolName,
            success: usage.success ? 'true' : 'false',
            duration: usage.duration,
            session: usage.sessionId
        };

        if (usage.error) {
            properties.error = usage.error.substring(0, 100); // Limit error length
        }

        return this.trackEvent('webmcp_tool_usage', properties);
    }

    /**
     * Track a conversion via Umami
     * @param {string} conversionType - Type of conversion
     * @param {Object} data - Conversion data
     * @param {Object} context - User/session context
     * @returns {Promise<void>}
     */
    async trackConversion(conversionType, data = {}, context = {}) {
        return this.trackEvent(`webmcp_conversion_${conversionType}`, {
            ...data,
            type: conversionType
        }, context);
    }

    /**
     * Start a session
     * @param {string} sessionId - Session ID
     * @param {Object} context - Session context
     * @returns {Promise<void>}
     */
    async startSession(sessionId, context = {}) {
        // Umami automatically tracks sessions, but we can log the explicit start
        return this.trackEvent('webmcp_session_start', {
            session_id: sessionId,
            source: 'webmcp'
        }, context);
    }

    /**
     * Track event via Umami API (for server-side)
     * @private
     */
    async _trackViaAPI(eventName, properties, context) {
        try {
            const payload = {
                type: 'event',
                payload: {
                    website: this.websiteId,
                    hostname: context.hostname || (typeof window !== 'undefined' ? window.location.hostname : 'server'),
                    language: context.locale || 'en-US',
                    referrer: context.referrer || '',
                    screen: context.screen || '1920x1080',
                    title: context.pageTitle || 'WebMCP Event',
                    url: context.url || '/',
                    name: eventName,
                    data: properties
                }
            };

            const response = await fetch(`${this.apiEndpoint}/api/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': context.userAgent || 'WebMCP/1.0'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                console.error('Umami API error:', response.status);
            }
        } catch (error) {
            console.error('Failed to track event via Umami API:', error);
        }
    }
}

/**
 * Example configuration:
 *
 * Client-side (with Umami tracker loaded):
 * const analyticsAdapter = new UmamiAdapter({
 *   websiteId: 'your-website-id',
 *   apiEndpoint: 'https://your-umami-instance.com'  // Optional, defaults to umami.is
 * });
 *
 * The Umami script tag should be loaded on your page:
 * <script async src="https://analytics.umami.is/script.js"
 *   data-website-id="your-website-id"></script>
 */
