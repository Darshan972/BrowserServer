import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import wssRateLimiter from '../middleware/wssRateLimit.js';

export const createWSSProxy = (server, pool) => {
  const wss = new WebSocketServer({ server, path: '/wss' });

  wss.on('connection', (clientWs, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // ✅ Rate limit check
    const connectionCheck = wssRateLimiter.checkConnection(ip);
    if (!connectionCheck.allowed) {
      clientWs.send(JSON.stringify({
        error: 'WSS rate limit exceeded',
        reason: connectionCheck.reason,
        retryAfter: connectionCheck.retryAfter
      }));
      clientWs.close(1008, 'Rate limit exceeded');
      return;
    }

    // Extract browser ID from query: /wss?browserId=abc123
    const url = new URL(req.url, `http://${req.headers.host}`);
    const browserId = url.searchParams.get('browserId');

    if (!browserId) {
      clientWs.send(JSON.stringify({ error: 'Missing browserId parameter' }));
      clientWs.close(1008, 'Missing browserId');
      wssRateLimiter.releaseConnection(ip);
      return;
    }

    const browser = pool.getBrowser(browserId);
    if (!browser) {
      clientWs.send(JSON.stringify({ error: 'Browser not found' }));
      clientWs.close(1008, 'Browser not found');
      wssRateLimiter.releaseConnection(ip);
      return;
    }

    // Connect to actual Chromium WebSocket
    const browserWs = new WebSocket(browser.wss);

    browserWs.on('open', () => {
      console.log(`✅ WSS Proxy: ${ip} → Browser ${browserId.slice(0, 8)}`);
    });

    // Client → Browser (with message rate limiting)
    clientWs.on('message', (data) => {
      const messageCheck = wssRateLimiter.checkMessage(ip);
      if (!messageCheck.allowed) {
        clientWs.send(JSON.stringify({
          error: 'Message rate limit exceeded',
          reason: messageCheck.reason,
          retryAfter: messageCheck.retryAfter
        }));
        return;
      }
      
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(data);
      }
    });

    // Browser → Client
    browserWs.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    });

    // Cleanup on disconnect
    const cleanup = () => {
      wssRateLimiter.releaseConnection(ip);
      browserWs.close();
      clientWs.close();
      console.log(`❌ WSS Proxy closed: ${ip} → Browser ${browserId.slice(0, 8)}`);
    };

    clientWs.on('close', cleanup);
    browserWs.on('close', cleanup);
    clientWs.on('error', cleanup);
    browserWs.on('error', cleanup);
  });

  console.log('✅ WSS Proxy enabled on /wss');
  return wss;
};
