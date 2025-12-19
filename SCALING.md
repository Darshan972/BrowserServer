# Multi-Server Scaling Architecture

## Overview
When scaling to multiple servers, each browser is tied to the server that created it. The browser ID contains the server identifier for routing.

## Architecture

```
                    Load Balancer (CREATE only)
                            |
            +---------------+---------------+
            |               |               |
      server1.sd.com   server2.sd.com   server3.sd.com
            |               |               |
     Browser Pool      Browser Pool     Browser Pool
```

## Browser ID Format

```
Format: {domain-prefix}_{uuid}

Examples:
- server1-scrapingdog-com_a1b2c3d4-e5f6-4789-a012-3456789abcde
- server2-scrapingdog-com_f9e8d7c6-b5a4-4321-9876-fedcba098765
- browser-scrapingdog-com_12345678-1234-4567-8901-234567890abc (single server)
```

## Setup Steps

### 1. DNS Configuration
```
server1.scrapingdog.com  →  IP1 (e.g., 192.168.1.10)
server2.scrapingdog.com  →  IP2 (e.g., 192.168.1.11)
server3.scrapingdog.com  →  IP3 (e.g., 192.168.1.12)
browser.scrapingdog.com  →  Load Balancer (192.168.1.100)
```

### 2. Server Configuration

Each server's `.env`:
```bash
# Server 1
DOMAIN=server1.scrapingdog.com
PORT=3000
MAX_BROWSERS=50

# Server 2
DOMAIN=server2.scrapingdog.com
PORT=3000
MAX_BROWSERS=50

# Server 3
DOMAIN=server3.scrapingdog.com
PORT=3000
MAX_BROWSERS=50
```

### 3. Load Balancer Configuration (Nginx)

```nginx
# /etc/nginx/nginx.conf

upstream browser_servers {
    # Round-robin for CREATE operations
    server server1.scrapingdog.com:3000;
    server server2.scrapingdog.com:3000;
    server server3.scrapingdog.com:3000;
}

server {
    listen 80;
    server_name browser.scrapingdog.com;

    # Only use load balancer for CREATE operations
    location /browsers {
        if ($request_method = POST) {
            proxy_pass http://browser_servers;
        }
        
        # For GET /browsers (list all) - can go to any server
        if ($request_method = GET) {
            proxy_pass http://browser_servers;
        }
        
        # For other methods, client should route directly to server
        return 400 "Please route DELETE/GET/:id directly to the server subdomain";
    }
    
    location /health {
        proxy_pass http://browser_servers;
    }
}
```

### 4. Client-Side Routing Logic

```javascript
// Extract server URL from browser ID
function getServerUrlFromBrowserId(browserId) {
    const match = browserId.match(/^([a-z0-9-]+)_/);
    if (match) {
        // Convert: server1-scrapingdog-com → https://server1.scrapingdog.com
        const domain = match[1].replace(/-/g, '.');
        return `https://${domain}`;
    }
    // Fallback for single server deployment
    return 'https://browser.scrapingdog.com';
}

// CREATE - Use load balancer
async function createBrowser() {
    const response = await fetch('https://browser.scrapingdog.com/browsers', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY
        },
        body: JSON.stringify({ headful: false })
    });
    
    const browser = await response.json();
    // browser.id = "server2-scrapingdog-com_uuid"
    return browser;
}

// DELETE - Route to specific server
async function deleteBrowser(browserId) {
    const serverUrl = getServerUrlFromBrowserId(browserId);
    
    const response = await fetch(`${serverUrl}/browsers/${browserId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY
        }
    });
    
    return response.json();
}

// GET specific browser - Route to specific server
async function getBrowser(browserId) {
    const serverUrl = getServerUrlFromBrowserId(browserId);
    
    const response = await fetch(`${serverUrl}/browsers/${browserId}`, {
        method: 'GET',
        headers: {
            'X-API-Key': API_KEY
        }
    });
    
    return response.json();
}
```

## API Flow Examples

### Example 1: Create and Delete
```
1. POST https://browser.scrapingdog.com/browsers
   → Load Balancer → server2.scrapingdog.com
   ← Response: { id: "server2-scrapingdog-com_abc123", wss: "wss://..." }

2. Client extracts: server2.scrapingdog.com from browser ID

3. DELETE https://server2.scrapingdog.com/browsers/server2-scrapingdog-com_abc123
   → Direct to server2
   ← Response: { deleted: true }
```

### Example 2: Create Multiple Browsers
```
1. POST https://browser.scrapingdog.com/browsers (Request 1)
   → server1 → { id: "server1-scrapingdog-com_111" }

2. POST https://browser.scrapingdog.com/browsers (Request 2)
   → server2 → { id: "server2-scrapingdog-com_222" }

3. POST https://browser.scrapingdog.com/browsers (Request 3)
   → server3 → { id: "server3-scrapingdog-com_333" }

4. DELETE https://server1.scrapingdog.com/browsers/server1-scrapingdog-com_111
5. DELETE https://server2.scrapingdog.com/browsers/server2-scrapingdog-com_222
6. DELETE https://server3.scrapingdog.com/browsers/server3-scrapingdog-com_333
```

## Alternative Approaches

### Option A: API Gateway (More Complex)
Create a central API gateway that handles routing:

```javascript
// gateway.js
app.all('/browsers/:id', async (req, res) => {
    const browserId = req.params.id;
    const serverUrl = getServerUrlFromBrowserId(browserId);
    
    // Proxy request to correct server
    const response = await fetch(`${serverUrl}${req.path}`, {
        method: req.method,
        headers: req.headers,
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
    });
    
    res.status(response.status).json(await response.json());
});
```

**Pros:** Simpler client code
**Cons:** Extra hop, single point of failure

### Option B: Shared Redis State (Most Complex)
Store all browser metadata in Redis:

```javascript
// On create (any server)
const browser = await pool.createBrowser(headful, proxy);
await redis.set(browser.id, JSON.stringify({
    serverId: os.hostname(),
    serverUrl: process.env.DOMAIN,
    ...browser
}));

// On delete (any server)
const browserData = await redis.get(browserId);
if (browserData.serverId !== os.hostname()) {
    // Forward to correct server
    return await forwardRequest(browserData.serverUrl, ...);
}
```

**Pros:** Any server can handle any request
**Cons:** Redis dependency, complexity, latency

## Recommended: Domain-Based Routing (Your Approach)

✅ **Simple and effective**
✅ **No shared state needed**
✅ **Each server is independent**
✅ **Direct communication (fast)**
✅ **Easy to debug**

## Monitoring & Health Checks

```javascript
// Add server ID to health endpoint
app.get('/health', (req, res) => {
    res.json({
        serverId: process.env.DOMAIN,
        hostname: os.hostname(),
        browsers: pool.activeBrowsers.size,
        maxBrowsers: config.maxBrowsers,
        available: config.maxBrowsers - pool.activeBrowsers.size,
        uptime: process.uptime()
    });
});
```

## Deployment Checklist

- [ ] Set up DNS for each server subdomain
- [ ] Configure unique DOMAIN in each server's .env
- [ ] Update nginx.conf with load balancer config
- [ ] Update client code to extract and route by browser ID
- [ ] Test create → connect → delete flow
- [ ] Set up monitoring for each server
- [ ] Configure SSL certificates for all subdomains
- [ ] Test failover scenarios

## Testing Multi-Server Setup

```javascript
// test-multi-server.js
const servers = [
    'https://server1.scrapingdog.com',
    'https://server2.scrapingdog.com',
    'https://server3.scrapingdog.com'
];

for (const server of servers) {
    console.log(`Testing ${server}...`);
    
    // Create browser
    const browser = await createBrowser(server);
    console.log(`Created: ${browser.id}`);
    
    // Verify it's on correct server
    assert(browser.id.includes(server.replace('https://', '').replace(/\./g, '-')));
    
    // Delete using extracted server
    const targetServer = getServerUrlFromBrowserId(browser.id);
    assert(targetServer === server);
    await deleteBrowser(browser.id);
    
    console.log(`✅ ${server} passed`);
}
```
