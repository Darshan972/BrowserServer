import express, { json } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import http from 'http';
import browserRoutes from './src/routes/browsers.js';
import config from './src/config.js';
import { apiKeyAuth } from './src/middleware/auth.js';
import { handleJsonError } from './src/middleware/validation.js';
import { apiLimiter } from './src/middleware/rateLimit.js';
import BrowserPool from './src/services/browserPool.js';
import { execSync } from 'child_process';

const app = express();
const port = config.port;
let pool;

process.env.DISPLAY = ':99';

try {
  execSync('xdpyinfo -display :99', { stdio: 'ignore' });
  console.log('✅ Xvfb display :99 ready');
} catch {
  console.error('❌ Xvfb not running on :99');
  process.exit(1);
}

(async () => {
  try {
    pool = new BrowserPool(config);
    console.log('✅ BrowserPool initialized');
  } catch (error) {
    console.error('❌ BrowserPool failed:', error.message);
    process.exit(1);
  }
})();

app.use(helmet());
app.use(morgan('combined'));
app.use(json({ limit: '10mb' }));
app.use(handleJsonError);
app.use(apiLimiter);

app.get('/health', (req, res) => {
  res.json({
    status: pool ? 'ok' : 'pool_not_ready',
    timestamp: new Date().toISOString(),
    browsers: pool ? pool.activeBrowsers.size : 0,
    maxBrowsers: config.maxBrowsers
  });
});

app.use('/browsers', apiKeyAuth, (req, res, next) => {
  if (!pool) return res.status(503).json({ error: 'Service not ready' });
  req.pool = pool;
  next();
}, browserRoutes);

const server = http.createServer(app);

process.on('SIGTERM', async () => {
  console.log('🛑 Graceful shutdown...');
  if (pool) {
    pool.destroy(); // Stop idle cleanup interval
    for (const [id, browser] of pool.activeBrowsers) {
      browser.process.kill('SIGTERM');
    }
  }
  server.close(() => {
    process.exit(0);
  });
});

// ✅ FIXED: Listen on all interfaces (0.0.0.0) instead of just localhost
server.listen(port, '0.0.0.0', () => {
  console.log(`\n🚀 Browser Server: http://0.0.0.0:${port}`);
  console.log(`📊 Max browsers: ${config.maxBrowsers}`);
  console.log(`🔒 API Key: ${config.apiKey ? 'ENABLED' : 'DISABLED'}`);
  console.log(`✅ Ready and accessible from external connections!\n`);
});
