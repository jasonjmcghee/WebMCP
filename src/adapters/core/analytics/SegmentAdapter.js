/**
 * SegmentAdapter - Implementation for Segment.io analytics
 *
 * Client-side: Segment's Analytics.js is already loaded on the page
 * Server-side: Requires npm install @segment/analytics-node
 */

import { AnalyticsAdapter } from '../AnalyticsAdapter.js';

export class SegmentAdapter extends AnalyticsAdapter {
    constructor(config) {
        super();
        this.writeKey = config.writeKey;
        this.isClientSide = typeof window !== 'undefined';

        if (this.isClientSide) {
            // Use window.analytics if available
            this.analytics = window.analytics;
            if (!this.analytics) {
                console.warn('Segment Analytics.js not found. Make sure it\'s loaded on your page.');
            }
        } else {
            // Server-side: would need to import @segment/analytics-node
            console.warn('Server-side Segment adapter requires @segment/analytics-node');
        }
    }

    /**
     * Track an event via Segment
     * @param {string} eventName - Event name
     * @param {Object} properties - Event properties
     * @param {Object} context - User/session context
     * @returns {Promise<void>}
     */
    async trackEvent(eventName, properties = {}, context = {}) {
        if (!this.analytics) {
            console.warn('Segment analytics not initialized');
            return;
        }

        const userId = context.userId || 'anonymous';
        const segmentContext = this._buildSegmentContext(context);

        if (this.isClientSide) {
            // Client-side tracking
            this.analytics.track(eventName, properties, {
                context: segmentContext
            });
        } else {
            // Server-side would use analytics.track({ userId, event, properties })
            console.log('[Segment]', eventName, properties);
        }
    }

    /**
     * Track tool usage with Segment
     * @param {Object} usage - Tool usage data
     * @returns {Promise<void>}
     */
    async trackToolUsage(usage) {
        const properties = {
            tool_name: usage.toolName,
            success: usage.success,
            duration_ms: usage.duration,
            error: usage.error,
            args: JSON.stringify(usage.args)
        };

        const context = {
            userId: usage.userId,
            sessionId: usage.sessionId
        };

        return this.trackEvent('WebMCP Tool Used', properties, context);
    }

    /**
     * Track a conversion via Segment
     * @param {string} conversionType - Type of conversion
     * @param {Object} data - Conversion data
     * @param {Object} context - User/session context
     * @returns {Promise<void>}
     */
    async trackConversion(conversionType, data = {}, context = {}) {
        // Map to Segment's standard e-commerce events when applicable
        const eventName = this._mapConversionType(conversionType);

        return this.trackEvent(eventName, {
            ...data,
            conversion_type: conversionType
        }, context);
    }

    /**
     * Start a session (identify user in Segment)
     * @param {string} sessionId - Session ID
     * @param {Object} context - Session context
     * @returns {Promise<void>}
     */
    async startSession(sessionId, context = {}) {
        if (!this.analytics) return;

        const userId = context.userId;
        const traits = {
            session_id: sessionId,
            ...context.userTraits
        };

        if (this.isClientSide && userId) {
            // Identify the user
            this.analytics.identify(userId, traits);
        }

        // Track session start
        return this.trackEvent('Session Started', { session_id: sessionId }, context);
    }

    /**
     * Build Segment context object
     * @private
     */
    _buildSegmentContext(context) {
        return {
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : context.userAgent,
            ip: context.ip,
            locale: typeof navigator !== 'undefined' ? navigator.language : context.locale,
            library: {
                name: 'webmcp',
                version: '0.1.0'
            },
            ...context.customContext
        };
    }

    /**
     * Map conversion types to Segment's standard events
     * @private
     */
    _mapConversionType(conversionType) {
        const mappings = {
            'purchase': 'Order Completed',
            'signup': 'Signed Up',
            'add_to_cart': 'Product Added',
            'checkout_started': 'Checkout Started'
        };

        return mappings[conversionType] || `Conversion: ${conversionType}`;
    }
}

/**
 * Example configuration:
 *
 * Client-side (Segment Analytics.js already loaded):
 * const analyticsAdapter = new SegmentAdapter({
 *   writeKey: 'your-segment-write-key'  // Optional if analytics.js already loaded
 * });
 *
 * Server-side:
 * import { Analytics } from '@segment/analytics-node';
 * const serverAnalytics = new Analytics({ writeKey: 'your-write-key' });
 *
 * // Then pass it to adapter...
 */
