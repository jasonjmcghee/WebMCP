/**
 * GoogleAnalyticsAdapter - Implementation for Google Analytics 4
 *
 * Works with Google Analytics 4 (gtag.js or Google Tag Manager)
 * Also supports Universal Analytics (analytics.js) with fallback
 */

import { AnalyticsAdapter } from '../AnalyticsAdapter.js';

export class GoogleAnalyticsAdapter extends AnalyticsAdapter {
    constructor(config) {
        super();
        this.measurementId = config.measurementId; // GA4 measurement ID (G-XXXXXXXXXX)
        this.trackingId = config.trackingId; // Legacy UA tracking ID (UA-XXXXXXXXX-X)
        this.isClientSide = typeof window !== 'undefined';

        if (this.isClientSide) {
            // Check for gtag (GA4)
            this.gtag = window.gtag;
            // Fallback to ga (Universal Analytics)
            this.ga = window.ga;

            if (!this.gtag && !this.ga) {
                console.warn('Google Analytics not found. Make sure gtag.js or analytics.js is loaded.');
            }
        }
    }

    /**
     * Track an event via Google Analytics
     * @param {string} eventName - Event name
     * @param {Object} properties - Event properties
     * @param {Object} context - User/session context
     * @returns {Promise<void>}
     */
    async trackEvent(eventName, properties = {}, context = {}) {
        if (!this.isClientSide) {
            // Server-side tracking requires Measurement Protocol
            return this._trackViaMeasurementProtocol(eventName, properties, context);
        }

        if (this.gtag) {
            // GA4 event tracking
            this.gtag('event', eventName, {
                ...this._mapPropertiesToGA4(properties),
                ...context
            });
        } else if (this.ga) {
            // Universal Analytics fallback
            this.ga('send', 'event', {
                eventCategory: properties.category || 'WebMCP',
                eventAction: eventName,
                eventLabel: properties.label,
                eventValue: properties.value
            });
        } else {
            console.warn('Google Analytics not initialized');
        }
    }

    /**
     * Track tool usage with Google Analytics
     * @param {Object} usage - Tool usage data
     * @returns {Promise<void>}
     */
    async trackToolUsage(usage) {
        const properties = {
            category: 'WebMCP_Tools',
            tool_name: usage.toolName,
            success: usage.success,
            duration: usage.duration,
            session_id: usage.sessionId
        };

        if (usage.error) {
            properties.error_message = usage.error.substring(0, 100);
        }

        return this.trackEvent('tool_used', properties);
    }

    /**
     * Track a conversion via Google Analytics
     * @param {string} conversionType - Type of conversion
     * @param {Object} data - Conversion data
     * @param {Object} context - User/session context
     * @returns {Promise<void>}
     */
    async trackConversion(conversionType, data = {}, context = {}) {
        // Map to GA4 recommended events when possible
        const eventName = this._mapConversionToGA4Event(conversionType);

        return this.trackEvent(eventName, {
            ...data,
            conversion_type: conversionType
        }, context);
    }

    /**
     * Start a session
     * @param {string} sessionId - Session ID
     * @param {Object} context - Session context
     * @returns {Promise<void>}
     */
    async startSession(sessionId, context = {}) {
        // Set user ID if provided
        if (context.userId && this.gtag) {
            this.gtag('config', this.measurementId, {
                user_id: context.userId,
                session_id: sessionId
            });
        }

        return this.trackEvent('session_start', {
            session_id: sessionId,
            source: 'webmcp'
        }, context);
    }

    /**
     * Map properties to GA4 parameter names
     * @private
     */
    _mapPropertiesToGA4(properties) {
        // GA4 has recommended parameter names
        const mapped = {};

        // Common mappings
        if (properties.value) mapped.value = properties.value;
        if (properties.currency) mapped.currency = properties.currency;
        if (properties.category) mapped.event_category = properties.category;
        if (properties.label) mapped.event_label = properties.label;

        // Pass through other properties
        Object.keys(properties).forEach(key => {
            if (!['value', 'currency', 'category', 'label'].includes(key)) {
                mapped[key] = properties[key];
            }
        });

        return mapped;
    }

    /**
     * Map conversion types to GA4 recommended events
     * @private
     */
    _mapConversionToGA4Event(conversionType) {
        const mappings = {
            'purchase': 'purchase',
            'signup': 'sign_up',
            'add_to_cart': 'add_to_cart',
            'checkout_started': 'begin_checkout',
            'lead': 'generate_lead'
        };

        return mappings[conversionType] || `conversion_${conversionType}`;
    }

    /**
     * Track via Measurement Protocol (server-side)
     * @private
     */
    async _trackViaMeasurementProtocol(eventName, properties, context) {
        if (!this.measurementId) {
            console.warn('Measurement ID required for server-side tracking');
            return;
        }

        try {
            // GA4 Measurement Protocol
            const params = new URLSearchParams({
                measurement_id: this.measurementId,
                client_id: context.clientId || 'server',
                events: JSON.stringify([{
                    name: eventName,
                    params: properties
                }])
            });

            await fetch(`https://www.google-analytics.com/mp/collect?${params}`, {
                method: 'POST'
            });
        } catch (error) {
            console.error('Failed to track via Measurement Protocol:', error);
        }
    }
}

/**
 * Example configuration:
 *
 * GA4:
 * const analyticsAdapter = new GoogleAnalyticsAdapter({
 *   measurementId: 'G-XXXXXXXXXX'
 * });
 *
 * Make sure gtag.js is loaded on your page:
 * <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
 * <script>
 *   window.dataLayer = window.dataLayer || [];
 *   function gtag(){dataLayer.push(arguments);}
 *   gtag('js', new Date());
 *   gtag('config', 'G-XXXXXXXXXX');
 * </script>
 *
 * Legacy Universal Analytics:
 * const analyticsAdapter = new GoogleAnalyticsAdapter({
 *   trackingId: 'UA-XXXXXXXXX-X'
 * });
 */
