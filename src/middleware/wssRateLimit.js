import config from '../config.js';

class WSSRateLimiter {
  constructor() {
    this.connections = new Map();  // IP -> { count, firstConnect, messages }
    this.messages = new Map();     // IP -> { count, firstMessage }
    
    // Cleanup old entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  checkConnection(ip) {
    const now = Date.now();
    const data = this.connections.get(ip);
    
    if (!data) {
      this.connections.set(ip, { 
        count: 1, 
        firstConnect: now,
        messages: 0
      });
      return { allowed: true };
    }

    // Reset if window expired
    if (now - data.firstConnect > config.wssRateLimit.windowMs) {
      this.connections.set(ip, { 
        count: 1, 
        firstConnect: now,
        messages: 0
      });
      return { allowed: true };
    }

    // Check limit
    if (data.count >= config.wssRateLimit.maxConnections) {
      return { 
        allowed: false, 
        reason: `Max ${config.wssRateLimit.maxConnections} WSS connections per ${config.wssRateLimit.windowMs / 1000}s`,
        retryAfter: Math.ceil((data.firstConnect + config.wssRateLimit.windowMs - now) / 1000)
      };
    }

    data.count++;
    return { allowed: true };
  }

  checkMessage(ip) {
    const now = Date.now();
    const data = this.connections.get(ip);
    
    if (!data) {
      this.connections.set(ip, { 
        count: 0, 
        firstConnect: now,
        messages: 1
      });
      return { allowed: true };
    }

    // Reset if window expired
    if (now - data.firstConnect > config.wssRateLimit.windowMs) {
      data.messages = 1;
      data.firstConnect = now;
      return { allowed: true };
    }

    // Check message limit
    if (data.messages >= config.wssRateLimit.maxMessages) {
      return { 
        allowed: false, 
        reason: `Max ${config.wssRateLimit.maxMessages} messages per ${config.wssRateLimit.windowMs / 1000}s`,
        retryAfter: Math.ceil((data.firstConnect + config.wssRateLimit.windowMs - now) / 1000)
      };
    }

    data.messages++;
    return { allowed: true };
  }

  releaseConnection(ip) {
    const data = this.connections.get(ip);
    if (data && data.count > 0) {
      data.count--;
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [ip, data] of this.connections.entries()) {
      if (now - data.firstConnect > config.wssRateLimit.windowMs * 2) {
        this.connections.delete(ip);
      }
    }
  }

  getStats(ip) {
    const data = this.connections.get(ip);
    if (!data) return { connections: 0, messages: 0 };
    return { 
      connections: data.count, 
      messages: data.messages,
      maxConnections: config.wssRateLimit.maxConnections,
      maxMessages: config.wssRateLimit.maxMessages
    };
  }
}

export default new WSSRateLimiter();
