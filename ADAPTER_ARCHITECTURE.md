# WebMCP Adapter Architecture

## Overview

WebMCP now supports a plugin architecture that allows integration with any authentication, analytics, and data backend through adapters. This makes WebMCP vendor-agnostic and highly customizable.

## Architecture Principles

### Core Adapters (Required)
- **Authentication** - User identity and context
- **Analytics** - Event tracking and metrics

### Optional Adapters
- **Data** - Business data (products, content, etc.)
- **Custom** - Any domain-specific adapters

## Directory Structure

```
src/adapters/
├── core/
│   ├── AuthAdapter.js              # Auth interface + NoAuthAdapter
│   ├── AnalyticsAdapter.js         # Analytics interface + Console/NoOp adapters
│   ├── auth/
│   │   ├── Auth0Adapter.js         # Auth0 implementation
│   │   ├── CognitoAdapter.js       # AWS Cognito implementation
│   │   └── CustomAuthAdapter.js    # Custom/cookie/JWT auth
│   └── analytics/
│       ├── SegmentAdapter.js       # Segment.io implementation
│       ├── UmamiAdapter.js         # Umami implementation
│       └── GoogleAnalyticsAdapter.js # Google Analytics 4
├── optional/
│   ├── DataAdapter.js              # Data interface + NoOpAdapter
│   └── data/
│       ├── ShopifyAdapter.js       # Shopify implementation
│       ├── WooCommerceAdapter.js   # WooCommerce implementation
│       └── RestApiAdapter.js       # Generic REST API
└── AdapterRegistry.js              # Registry and dependency injection
```

## Quick Start

### 1. Configure Adapters

```javascript
import { createAdapterRegistry } from './src/adapters/AdapterRegistry.js';
import { Auth0Adapter } from './src/adapters/core/auth/Auth0Adapter.js';
import { SegmentAdapter } from './src/adapters/core/analytics/SegmentAdapter.js';
import { ShopifyAdapter } from './src/adapters/optional/data/ShopifyAdapter.js';

const adapters = createAdapterRegistry({
  // Core adapters
  auth: new Auth0Adapter({
    domain: 'your-tenant.auth0.com',
    clientId: 'your-client-id',
    mapUserContext: async (userId) => {
      // Custom logic to determine user tier
      const user = await db.users.findOne({ auth0Id: userId });
      return {
        tier: user.subscriptionTier,
        permissions: user.permissions
      };
    }
  }),

  analytics: new SegmentAdapter({
    writeKey: 'your-segment-write-key'
  }),

  // Optional adapters
  data: new ShopifyAdapter({
    shopDomain: 'myshop.myshopify.com',
    accessToken: 'your-storefront-api-token'
  })
});
```

### 2. Use Adapters in Your Code

```javascript
// Get current user
const user = await adapters.auth.getCurrentUser(requestContext);

// Track an event
await adapters.analytics.trackEvent('page_view', {
  page: '/products',
  referrer: document.referrer
});

// Search products (if data adapter configured)
if (adapters.hasAdapter('data')) {
  const products = await adapters.data.search('red shoes', {
    limit: 10
  });
}
```

### 3. Use with WebMCP

```javascript
// Register tools based on user context
async function registerTools(webmcp, user) {
  // Everyone gets search
  webmcp.registerTool('search', 'Search products', schema, async (args) => {
    await adapters.analytics.trackToolUsage({
      toolName: 'search',
      args,
      userId: user.id,
      timestamp: new Date().toISOString()
    });

    return await adapters.data.search(args.query, args.filters);
  });

  // Authenticated users get orders
  if (user.authenticated) {
    webmcp.registerTool('my_orders', 'View your orders', {}, async () => {
      return await adapters.data.getUserItems(user.id, 'orders');
    });
  }

  // VIP users get special features
  if (user.tier === 'VIP') {
    webmcp.registerTool('vip_preview', 'Preview new releases', {}, async () => {
      return await adapters.data.search('', { collection: 'upcoming' });
    });
  }
}
```

## Available Adapters

### Authentication

| Adapter | Use Case | Dependencies |
|---------|----------|--------------|
| `NoAuthAdapter` | Public sites, no auth | None (built-in) |
| `Auth0Adapter` | Auth0 authentication | `@auth0/auth0-spa-js` |
| `CognitoAdapter` | AWS Cognito | `amazon-cognito-identity-js` |
| `CustomAuthAdapter` | Cookie/JWT/Custom | None (provide your own functions) |

### Analytics

| Adapter | Use Case | Dependencies |
|---------|----------|--------------|
| `ConsoleAnalyticsAdapter` | Development/debugging | None (built-in) |
| `NoOpAnalyticsAdapter` | Disable analytics | None (built-in) |
| `SegmentAdapter` | Segment.io | Segment Analytics.js loaded |
| `UmamiAdapter` | Umami (privacy-focused) | Umami tracker.js loaded |
| `GoogleAnalyticsAdapter` | Google Analytics 4 | gtag.js loaded |

### Data (Optional)

| Adapter | Use Case | Dependencies |
|---------|----------|--------------|
| `NoOpDataAdapter` | No data integration | None (built-in) |
| `ShopifyAdapter` | Shopify stores | Shopify Storefront API |
| `WooCommerceAdapter` | WooCommerce stores | WooCommerce REST API |
| `RestApiAdapter` | Custom REST APIs | None (generic) |

## Creating Custom Adapters

### Example: Custom Authentication

```javascript
import { AuthAdapter } from './src/adapters/core/AuthAdapter.js';

class MyCustomAuthAdapter extends AuthAdapter {
  constructor(config) {
    super();
    this.apiUrl = config.apiUrl;
  }

  async getCurrentUser(context) {
    const sessionId = context.cookies?.sessionId;
    if (!sessionId) {
      return { id: 'anonymous', authenticated: false, metadata: {} };
    }

    const response = await fetch(`${this.apiUrl}/session/${sessionId}`);
    const session = await response.json();

    return {
      id: session.userId,
      email: session.user.email,
      name: session.user.name,
      authenticated: true,
      metadata: session.user.metadata
    };
  }

  async validateToken(token) {
    const response = await fetch(`${this.apiUrl}/validate`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.ok;
  }

  async getUserContext(userId) {
    const response = await fetch(`${this.apiUrl}/users/${userId}/context`);
    return response.json();
  }
}
```

### Example: Custom Data Adapter

```javascript
import { DataAdapter } from './src/adapters/optional/DataAdapter.js';

class ContentAdapter extends DataAdapter {
  constructor(config) {
    super();
    this.cmsApiUrl = config.cmsApiUrl;
  }

  async search(query, filters = {}) {
    const response = await fetch(`${this.cmsApiUrl}/articles/search`, {
      method: 'POST',
      body: JSON.stringify({ query, filters })
    });
    return response.json();
  }

  async getItem(itemId) {
    const response = await fetch(`${this.cmsApiUrl}/articles/${itemId}`);
    return response.json();
  }

  // Implement other methods as needed...
}
```

## Adapter Interface Reference

See individual adapter files for complete interface documentation:
- `src/adapters/core/AuthAdapter.js`
- `src/adapters/core/AnalyticsAdapter.js`
- `src/adapters/optional/DataAdapter.js`

## Testing Adapters

```javascript
// Check which adapters are configured
console.log(adapters.getSummary());
// Output:
// {
//   core: {
//     auth: 'Auth0Adapter',
//     analytics: 'SegmentAdapter'
//   },
//   optional: {
//     data: 'ShopifyAdapter'
//   },
//   custom: []
// }

// Check if specific adapter is available
if (adapters.hasAdapter('data')) {
  // Use data adapter
}

// Safely call adapter method (returns null if adapter not configured)
const result = await adapters.call('data', 'search', 'query', {});
```

## Migration Guide

If you're upgrading from a previous version:

1. **No Breaking Changes** - Existing code continues to work
2. **Optional Feature** - Adapters are opt-in
3. **Gradual Adoption** - Add adapters as needed

## Benefits

✅ **Vendor Agnostic** - Switch auth/analytics providers without changing code
✅ **Type Safe** - Clear interfaces for all adapters
✅ **Testable** - Mock adapters for testing
✅ **Extensible** - Add custom adapters for any service
✅ **Graceful Degradation** - Optional adapters handled safely
✅ **Production Ready** - Built for real-world use cases

## Next Steps

1. Review the example template in `examples/template/`
2. Choose your adapters based on your stack
3. Configure adapters in your application
4. Register tools that use the adapters
5. Deploy and monitor via analytics adapter
