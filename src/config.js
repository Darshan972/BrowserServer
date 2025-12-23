import { config } from 'dotenv';
config();

const configObj = {
  domain : process.env.DOMAIN || '' ,
  port: process.env.PORT || 3000,
  maxBrowsers: parseInt(process.env.MAX_BROWSERS) || 50,
  browserIdleTimeout: parseInt(process.env.BROWSER_IDLE_TIMEOUT) || 120000, // 2 minutes default for high-volume
  chromiumPath: process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32' ? './Chrome/chrome.exe' : process.platform === 'linux' ? '/usr/bin/Chromium-browser' : null),
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
  apiKey: process.env.API_KEY || '',
  debug: process.env.NODE_ENV === 'development',
  
  // ✅ Rate Limiting Config
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    bulkMax: parseInt(process.env.RATE_LIMIT_BULK_MAX) || 10,
    createMax: parseInt(process.env.RATE_LIMIT_CREATE_MAX) || 50
  },
  
  // ✅ WebSocket Rate Limiting Config
  wssRateLimit: {
    windowMs: parseInt(process.env.WSS_RATE_LIMIT_WINDOW_MS) || 60000,
    maxConnections: parseInt(process.env.WSS_RATE_LIMIT_MAX_CONNECTIONS) || 50,
    maxMessages: parseInt(process.env.WSS_RATE_LIMIT_MAX_MESSAGES) || 1000
  }
};

if (!configObj.apiKey) {
  console.warn('⚠️ WARNING: No API_KEY set in .env - Server is INSECURE!');
}

export default configObj;
