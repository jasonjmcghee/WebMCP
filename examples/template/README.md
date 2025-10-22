# WebMCP Template Example

A complete, production-ready template demonstrating WebMCP integration with all new features:

- ✅ Vendor-agnostic adapter architecture
- ✅ Auto-reconnection with exponential backoff
- ✅ Session persistence with user consent
- ✅ Capability announcements
- ✅ Health monitoring

## Quick Start

### 1. Start WebMCP Server

```bash
npx @jason.today/webmcp --mcp
```

### 2. Open the Example

```bash
# From the WebMCP repository root
cd examples/template
python3 -m http.server 8000
# Or use any local web server
```

Visit: `http://localhost:8000`

### 3. Connect to Claude Desktop

1. In Claude Desktop, ask: "Get me a WebMCP token"
2. Copy the token that Claude provides
3. Click the blue WebMCP widget in the bottom-right corner
4. Paste the token and click "Connect"

### 4. Try the Features

Ask Claude:
- "Search for 'example items'"
- "What's the current status?"
- "Show me the products data"
- "What can you do on this site?"

## Features Demonstrated

### Client-Side Features

#### 1. Auto-Reconnect

Automatically reconnects if connection is lost:

```javascript
const webmcp = new WebMCP({
    autoReconnect: true,          // Enable auto-reconnect
    maxReconnectAttempts: 5       // Try up to 5 times
});
```

**Test it:**
- Stop the WebMCP server (`Ctrl+C`)
- Notice the "Reconnecting..." message
- Restart the server: `npx @jason.today/webmcp --mcp`
- Connection automatically resumes!

#### 2. Session Persistence

Remember connections across browser sessions:

```javascript
const webmcp = new WebMCP({
    persistSessions: true         // Enable localStorage persistence
});
```

**Test it:**
- Connect to WebMCP
- Click "Yes, Remember" in the consent dialog
- Close and reopen your browser
- Visit the page again - automatically connected!

#### 3. Capability Announcements

Beautiful console output showing what's available:

```javascript
const webmcp = new WebMCP({
    announceCapabilities: true    // Show in console
});
```

**Test it:**
- Open browser DevTools (F12)
- Click the Console tab
- Connect to WebMCP
- See the formatted capability announcement!

#### 4. Health Monitoring

Keep-alive pings to detect connection issues:

```javascript
const webmcp = new WebMCP({
    healthCheckInterval: 30000    // Ping every 30 seconds
});
```

## Example Tools

This template registers three example tools:

### 1. Search Tool

```javascript
webmcp.registerTool(
    'search',
    'Search for items in the example system',
    {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' }
        },
        required: ['query']
    },
    async (args) => {
        // Your search logic here
        return { query: args.query, results: [...] };
    }
);
```

**Claude Usage:**
```
User: Search for "example"
Claude: [Uses search tool] Found 3 results for "example"...
```

### 2. Status Tool

Check system health and configuration:

```javascript
webmcp.registerTool(
    'get_status',
    'Get the current system status',
    { type: 'object', properties: {} },
    async () => ({
        status: 'operational',
        uptime: '99.9%',
        version: '1.0.0'
    })
);
```

### 3. Data Retrieval Tool

Fetch different types of data:

```javascript
webmcp.registerTool(
    'get_example_data',
    'Retrieve example data from the system',
    {
        type: 'object',
        properties: {
            dataType: {
                type: 'string',
                enum: ['users', 'products', 'orders']
            }
        }
    },
    async (args) => {
        // Return data based on type
        return { dataType: args.dataType, items: [...] };
    }
);
```

## Integrating with Real Backends

This template uses mock data. To integrate with real backends, use adapters:

### With Authentication (Auth0 Example)

```javascript
import { createAdapterRegistry } from '../../src/adapters/AdapterRegistry.js';
import { Auth0Adapter } from '../../src/adapters/core/auth/Auth0Adapter.js';

const adapters = createAdapterRegistry({
    auth: new Auth0Adapter({
        domain: 'your-tenant.auth0.com',
        clientId: 'your-client-id'
    })
});

// Register tools that use auth
const user = await adapters.auth.getCurrentUser(context);

if (user.authenticated) {
    webmcp.registerTool('my_orders', 'View your orders', {}, async () => {
        // Only available to authenticated users
        return await fetchOrders(user.id);
    });
}
```

### With Analytics (Segment Example)

```javascript
import { SegmentAdapter } from '../../src/adapters/core/analytics/SegmentAdapter.js';

const adapters = createAdapterRegistry({
    analytics: new SegmentAdapter({
        writeKey: 'your-segment-write-key'
    })
});

// Track tool usage
webmcp.registerTool('search', 'Search products', schema, async (args) => {
    // Track the search
    await adapters.analytics.trackToolUsage({
        toolName: 'search',
        args,
        userId: user.id,
        timestamp: new Date().toISOString()
    });

    // Perform search
    return await performSearch(args.query);
});
```

### With Data Backend (Shopify Example)

```javascript
import { ShopifyAdapter } from '../../src/adapters/optional/data/ShopifyAdapter.js';

const adapters = createAdapterRegistry({
    data: new ShopifyAdapter({
        shopDomain: 'myshop.myshopify.com',
        accessToken: 'your-storefront-api-token'
    })
});

// Register search tool
webmcp.registerTool('search_products', 'Search products', schema, async (args) => {
    return await adapters.data.search(args.query, {
        limit: args.limit || 10
    });
});

// Register inventory check
webmcp.registerTool('check_inventory', 'Check product availability', schema, async (args) => {
    return await adapters.data.getItemRealTimeData(args.productId);
});
```

## Complete Integration Example

See `integration-example.html` for a full example using:
- Auth0 for authentication
- Segment for analytics
- Shopify for product data

## Configuration Options

All available WebMCP options:

```javascript
const webmcp = new WebMCP({
    // Visual customization
    color: '#667eea',              // Widget color
    position: 'bottom-right',      // Widget position
    size: '30px',                  // Widget size
    padding: '20px',               // Distance from edge

    // Connection features
    persistSessions: true,         // Enable localStorage persistence
    autoReconnect: true,           // Auto-reconnect on disconnect
    maxReconnectAttempts: 5,       // Max reconnection tries
    healthCheckInterval: 30000,    // Health check interval (ms)

    // User experience
    announceCapabilities: true,    // Show capabilities in console
    inactivityTimeout: 300000      // Auto-disconnect after 5 min
});
```

## Testing

### Manual Testing

1. **Auto-Reconnect:**
   - Connect to WebMCP
   - Stop the server
   - Watch reconnection attempts
   - Restart server
   - Verify automatic reconnection

2. **Session Persistence:**
   - Connect and grant consent
   - Close browser completely
   - Reopen and visit page
   - Verify automatic connection

3. **Capability Announcements:**
   - Open DevTools Console
   - Connect to WebMCP
   - Verify formatted output

4. **Health Monitoring:**
   - Connect to WebMCP
   - Watch Console for ping messages
   - Simulate network issues
   - Verify detection

### Automated Testing

```bash
# Run tests (when available)
npm test examples/template
```

## Deployment

### Production Checklist

- [ ] Configure real authentication adapter
- [ ] Set up analytics tracking
- [ ] Connect to production data backend
- [ ] Test with Claude Desktop thoroughly
- [ ] Set appropriate `inactivityTimeout`
- [ ] Consider `persistSessions` consent requirements
- [ ] Test auto-reconnect behavior
- [ ] Verify error handling

### Environment Variables

Create a `.env` file:

```bash
# Authentication (choose one)
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your-client-id

# Or Cognito
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_CLIENT_ID=your-client-id

# Analytics (choose one)
SEGMENT_WRITE_KEY=your-segment-key
# Or Umami
UMAMI_WEBSITE_ID=your-website-id
# Or Google Analytics
GA_MEASUREMENT_ID=G-XXXXXXXXXX

# Data Backend (optional)
SHOPIFY_SHOP_DOMAIN=myshop.myshopify.com
SHOPIFY_ACCESS_TOKEN=your-token
# Or WooCommerce
WOOCOMMERCE_SITE_URL=https://example.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxx
```

## Troubleshooting

### Connection Issues

**Problem:** "Could not connect to WebMCP server"

**Solutions:**
1. Verify server is running: `npx @jason.today/webmcp --mcp`
2. Check port 4797 isn't blocked
3. Try restarting the server

**Problem:** "Authorization failed"

**Solutions:**
1. Get a fresh token from Claude
2. Clear sessionStorage and try again
3. Check server logs for errors

### Persistence Issues

**Problem:** Connection not persisting across sessions

**Solutions:**
1. Verify `persistSessions: true` is set
2. Check that you clicked "Yes, Remember" in consent dialog
3. Check browser's localStorage isn't disabled
4. Check for private/incognito mode

### Auto-Reconnect Issues

**Problem:** Not reconnecting after disconnect

**Solutions:**
1. Verify `autoReconnect: true` is set
2. Check you haven't exceeded `maxReconnectAttempts`
3. Verify server is actually running
4. Check browser console for errors

## Next Steps

1. **Customize the UI:** Modify `index.html` for your branding
2. **Add Real Tools:** Replace mock tools with real API calls
3. **Integrate Adapters:** Add Auth, Analytics, and Data adapters
4. **Deploy:** Host your site and share with users
5. **Monitor:** Use analytics to track tool usage

## Resources

- [WebMCP Documentation](../../README.md)
- [Adapter Architecture Guide](../../ADAPTER_ARCHITECTURE.md)
- [Main WebMCP Repository](https://github.com/jasonkneen/webmcp)

## Support

Issues or questions? Check:
1. Browser console for errors
2. Server logs for connection issues
3. [GitHub Issues](https://github.com/jasonkneen/webmcp/issues)

---

**Happy Building! 🚀**
