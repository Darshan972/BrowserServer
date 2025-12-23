import { Router } from 'express';
import config from '../config.js';
import pLimit from 'p-limit';
import os  from 'os' ;
import {
  validateCreateBrowser,
  validateBulkCreate,
  validateBrowserId
} from '../middleware/validation.js';
import { bulkCreateLimiter, createLimiter } from '../middleware/rateLimit.js';
import { apiKeyAuth } from '../middleware/auth.js';

const total = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
const num = Math.max(1, total - 2);

const router = Router();
const limit = pLimit(num);

router.post('/', validateCreateBrowser, createLimiter, async (req, res) => {
  try {
    const pool = req.pool;
    const { headful = false, proxy = null } = req.body;
    const browser = await pool.createBrowser(headful, proxy);
    res.json(browser);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/bulk', validateBulkCreate, bulkCreateLimiter, async (req, res) => {
  try {
    const pool = req.pool;
    const { count = 1, headful = false, proxy = null } = req.body;

    // Check available slots
    if (count > config.maxBrowsers - pool.activeBrowsers.size) {
      return res.status(400).json({
        error: `Only ${config.maxBrowsers - pool.activeBrowsers.size} slots available`,
        availableSlots: config.maxBrowsers - pool.activeBrowsers.size,
        maxBrowsers: config.maxBrowsers,
        currentActive: pool.activeBrowsers.size
      });
    }

    const promises = Array(count).fill().map((_, i) =>
      limit(async () => {
        try {
          console.log(`👻 Creating browser ${i + 1}/${count}`);
          const browser = await pool.createBrowser(headful, proxy);
          console.log(`Browser ${i + 1} SUCCESS`);
          return browser;
        } catch (e) {
          console.error(`❌ Browser ${i + 1} FAILED:`, e.message);
          return null;
        }
      })
    );

    const results = await Promise.allSettled(promises);
    const browsers = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    console.log(`📊 Bulk result: ${browsers.length}/${count} succeeded`);

    res.json({
      requested: count,
      created: browsers.length,
      failed: count - browsers.length,
      browsers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', (req, res) => {
  const pool = req.pool;
  res.json({
    total: pool.activeBrowsers.size,
    available: config.maxBrowsers - pool.activeBrowsers.size,
    max: config.maxBrowsers,
    browsers: pool.listBrowsers()
  });
});

router.get('/:id', validateBrowserId, (req, res) => {
  const pool = req.pool;
  const browser = pool.getBrowser(req.params.id);
  if (!browser) {
    return res.status(404).json({
      error: 'Browser not found',
      browserId: req.params.id,
      tip: 'Use GET /browsers to see active browsers'
    });
  }
  res.json(browser);
});

router.get('/:id/ws', validateBrowserId, (req, res) => {
  const pool = req.pool;
  const browser = pool.getBrowser(req.params.id);

  if (!browser) {
    return res.status(404).json({
      error: 'Browser not found',
      browserId: req.params.id
    });
  }

  const publicHost = req.get('host').split(':')[0];
  const publicWs = browser.wss.replace('127.0.0.1', publicHost);
  const portt = browser.port
  res.json({
    wsEndpoint: publicWs,
    directWss: browser.wss,
    browserId: browser.id,
    port: portt,
    headful: browser.headful,
    directWss: browser.wss
  });
});


router.delete('/bulk', async (req, res) => {
  const pool = req.pool;
  const countParam = parseInt(req.query.count, 10);

  try {
    const ids = Array.from(pool.activeBrowsers.keys());
    const total = ids.length;

    if (total === 0) {
      return res.json({
        deleted: 0,
        total: 0,
        message: 'No active browsers to delete'
      });
    }

    const limit = Number.isInteger(countParam)
      ? Math.min(countParam, total)
      : total;

    let deleted = 0;

    for (let i = 0; i < limit; i++) {
      if (await pool.deleteBrowser(ids[i])) deleted++;
    }

    res.json({
      deleted,
      total,
      message: `Deleted ${deleted}/${total} browsers`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.delete('/:id', validateBrowserId, async (req, res) => {
  const pool = req.pool;
  try {
    const deleted = await pool.deleteBrowser(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        error: 'Browser not found',
        browserId: req.params.id,
        tip: 'Browser may have already been deleted or never existed'
      });
    }
    res.json({
      deleted: true,
      browserId: req.params.id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats/summary', (req, res) => {
  const pool = req.pool;
  const browsers = pool.listBrowsers();
  const now = Date.now();
  
  // Calculate idle browsers
  const idleBrowsers = Array.from(pool.activeBrowsers.values()).filter(b => {
    const idleTime = now - b.lastActivity;
    return idleTime > pool.idleTimeout;
  });

  res.json({
    total: pool.activeBrowsers.size,
    available: config.maxBrowsers - pool.activeBrowsers.size,
    max: config.maxBrowsers,
    headful: browsers.filter(b => b.headful).length,
    headless: browsers.filter(b => !b.headful).length,
    idle: idleBrowsers.length,
    idleTimeout: pool.idleTimeout / 1000, // in seconds
    averageUptime: browsers.length > 0
      ? Math.round(browsers.reduce((sum, b) => sum + (now - b.uptime), 0) / browsers.length / 1000)
      : 0,
    oldestBrowser: browsers.length > 0
      ? Math.max(...browsers.map(b => now - b.uptime))
      : 0
  });
});

router.get('/:id/health', validateBrowserId, async (req, res) => {
  const pool = req.pool;
  const browser = pool.getBrowser(req.params.id);

  if (!browser) {
    return res.status(404).json({
      error: 'Browser not found',
      browserId: req.params.id
    });
  }

  try {
    const response = await fetch(`http://127.0.0.1:${browser.port}/json/version`, {
      timeout: 5000
    });

    if (response.ok) {
      const data = await response.json();
      res.json({
        browserId: req.params.id,
        status: 'healthy',
        uptime: Date.now() - browser.createdAt,
        port: browser.port,
        headful: browser.headful,
        version: data['Browser'] || 'unknown'
      });
    } else {
      res.status(503).json({
        browserId: req.params.id,
        status: 'unhealthy',
        error: 'DevTools not responding'
      });
    }
  } catch (error) {
    res.status(503).json({
      browserId: req.params.id,
      status: 'unhealthy',
      error: error.message
    });
  }
});

export default router;