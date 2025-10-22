/**
 * AnalyticsAdapter - Core adapter interface for tracking and analytics
 *
 * All WebMCP implementations MUST provide an analytics adapter.
 * This enables tracking tool usage, conversions, and user behavior.
 */

export class AnalyticsAdapter {
    /**
     * Track a custom event
     * @param {string} eventName - Name of the event
     * @param {Object} properties - Event properties
     * @param {Object} context - User/session context
     * @returns {Promise<void>}
     */
    async trackEvent(eventName, properties = {}, context = {}) {
        throw new Error('AnalyticsAdapter.trackEvent must be implemented');
    }

    /**
     * Track tool usage specifically
     * @param {Object} usage - Tool usage data
     * @returns {Promise<void>}
     *
     * Usage object shape:
     * {
     *   toolName: string,
     *   args: Object,
     *   success: boolean,
     *   duration: number,  // milliseconds
     *   error?: string,
     *   userId: string,
     *   sessionId: string,
     *   timestamp: string
     * }
     */
    async trackToolUsage(usage) {
        return this.trackEvent('tool_usage', usage);
    }

    /**
     * Track a conversion event (e.g., purchase, signup)
     * @param {string} conversionType - Type of conversion
     * @param {Object} data - Conversion data
     * @param {Object} context - User/session context
     * @returns {Promise<void>}
     */
    async trackConversion(conversionType, data = {}, context = {}) {
        return this.trackEvent(`conversion_${conversionType}`, data, context);
    }

    /**
     * Start a new session
     * @param {string} sessionId - Session identifier
     * @param {Object} context - Session context
     * @returns {Promise<void>}
     */
    async startSession(sessionId, context = {}) {
        return this.trackEvent('session_start', { sessionId, ...context });
    }

    /**
     * End a session
     * @param {string} sessionId - Session identifier
     * @param {Object} context - Session context
     * @returns {Promise<void>}
     */
    async endSession(sessionId, context = {}) {
        return this.trackEvent('session_end', { sessionId, ...context });
    }
}

/**
 * ConsoleAnalyticsAdapter - Simple console logging adapter for development
 */
export class ConsoleAnalyticsAdapter extends AnalyticsAdapter {
    async trackEvent(eventName, properties = {}, context = {}) {
        console.log('[Analytics]', eventName, {
            ...properties,
            context,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * NoOpAnalyticsAdapter - No-op adapter when analytics are disabled
 */
export class NoOpAnalyticsAdapter extends AnalyticsAdapter {
    async trackEvent(eventName, properties = {}, context = {}) {
        // Do nothing
    }
}
