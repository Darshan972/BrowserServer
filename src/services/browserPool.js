import { spawn } from 'child_process';
import { createServer } from 'net';
import { join } from 'path';
import { tmpdir } from 'os';
import * as fs from 'fs/promises';
import fsSync from 'fs';
import { v4 as uuidv4 } from 'uuid';
import getPort, { portNumbers } from 'get-port';
import config from '../config.js';

class BrowserPool {
  constructor(config) {
    this.config = config;
    this.chromiumPath = config.chromiumPath;
    this.maxBrowsers = config.maxBrowsers || 50;
    this.idleTimeout = config.browserIdleTimeout || 1800000; // 30 minutes

    if (!fsSync.existsSync(this.chromiumPath)) {
      throw new Error(`❌ Chromium NOT FOUND: ${this.chromiumPath}`);
    }
    console.log(`✅ Chromium: ${this.chromiumPath}`);

    this.activeBrowsers = new Map();
    this.usedPorts = new Set();
    this.portStart = 9222;

    // Start idle browser cleanup - check every 1 minute for high-volume scenarios
    this.cleanupInterval = setInterval(() => this.cleanupIdleBrowsers(), 60000);
    console.log(`✅ Idle browser cleanup enabled (timeout: ${this.idleTimeout / 1000}s, check interval: 60s)`);
  }

  async createBrowser(headful = false, proxyServer) {

    if (this.activeBrowsers.size >= this.maxBrowsers) {
      throw new Error(`Max ${this.maxBrowsers} browsers reached`);
    }

    const uuid = uuidv4();
    const domain = config.domain;
    const domainPrefix = domain ? `${domain.replace(/[^a-zA-Z0-9]/g, '-')}_` : '';
    const id = `${domainPrefix}${uuid}`;


    // ✅ FIXED: Increased port range from 8000-8100 to 9000-19000 (10,000 ports)
    const ports = portNumbers(9000, 19000);
    const port = await getPort({ port: ports });
    const dataDir = join(tmpdir(), `browser-${id}`);

    await fs.mkdir(dataDir, { recursive: true });

    // ✅ OPTIMIZED: Chrome args for Ubuntu server - prevents OOM kills and crashes
    const args = [
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dataDir}`,
      `--window-size=1346,766`,
      headful ? '--disable-headless' : '--headless=new',
      
      // Memory & Performance - CRITICAL for Ubuntu servers
      '--disable-dev-shm-usage',        // CRITICAL: Fixes /dev/shm too small
      '--no-sandbox',                   // CRITICAL for Docker/Ubuntu servers
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-accelerated-2d-canvas',
      '--no-zygote',                    // Reduces memory overhead
      '--single-process',               // Each browser is isolated
      
      // Cache & Disk (reduced for high concurrency)
      '--disk-cache-size=33554432',     // 32MB
      '--media-cache-size=16777216',    // 16MB
      '--disable-application-cache',
      
      // Disable Unnecessary Features
      '--disable-extensions',
      '--disable-plugins',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--disable-notifications',
      '--disable-logging',
      '--disable-permissions-api',
      
      // Font & Rendering (reduces memory)
      '--font-render-hinting=none',
      '--disable-webgl',
      '--disable-webgl2'
    ].filter(Boolean);

    if (proxyServer) {
      try {
        args.push(`--proxy-server=${proxyServer}`);
      } catch (e) {
        console.error(`Invalid proxy format: ${proxyServer}`);
      }
    }

    const browserProcess = spawn(this.chromiumPath, args, {
      stdio: 'ignore',
      // windowsHide: true
    });
    const maxWait = 20000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        const jsonUrl = `http://127.0.0.1:${port}/json/version`;
        const response = await fetch(jsonUrl);
        if (response.ok) {
          const data = await response.json();

          const wsUrl = new URL(data.webSocketDebuggerUrl);
          wsUrl.protocol = 'wss:';
          wsUrl.hostname = process.env.DOMAIN;
          wsUrl.port = (port + 1000).toString();

          const realWss = wsUrl.href;

          if (realWss) {
            console.log(`Browser ${id.slice(0, 8)} ready: ${realWss}`);

            this.activeBrowsers.set(id, {
              id, 
              process: browserProcess, 
              port, 
              dataDir, 
              wss: realWss, 
              headful,
              createdAt: Date.now(),
              lastActivity: Date.now() // Track last activity for idle cleanup
            });

            let portt = port + 1000;
            browserProcess.once('close', () => this.cleanup(id));
            return { id, wss: realWss, portt, headful };
          }
        }
      } catch { }
      await new Promise(r => setTimeout(r, 500));
    }


    browserProcess.kill();
    throw new Error(`Browser ${id} failed to start DevTools in ${maxWait}ms`);
  }

  async deleteBrowser(id) {
    const browser = this.activeBrowsers.get(id);
    if (!browser) return false;

    try {
      browser.process.kill('SIGTERM');
      await Promise.race([
        new Promise(res => browser.process.once('exit', res)),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('Process did not exit')), 5000)
        )
      ]);
    } catch {
      try {
        browser.process.kill('SIGKILL');
      } catch { }
    }

    await this.cleanup(id, browser);
    return true;
  }


  async cleanup(id, browser) {
    try {
      await fs.rm(browser.dataDir, {
        recursive: true,
        force: true
      });
    } catch { }
    this.activeBrowsers.delete(id);
  }


  listBrowsers() {
    const now = Date.now();
    return Array.from(this.activeBrowsers.values()).map(b => ({
      id: b.id, 
      wss: b.wss, 
      port: b.port, 
      headful: b.headful,
      uptime: now - b.createdAt,
      idleTime: now - b.lastActivity,
      pid: b.process.pid
    }));
  }

  getBrowser(id) {
    return this.activeBrowsers.get(id);
  }

  // Update last activity timestamp (call this when browser receives messages)
  updateActivity(id) {
    const browser = this.activeBrowsers.get(id);
    if (browser) {
      browser.lastActivity = Date.now();
    }
  }

  // Cleanup idle browsers that haven't been used recently
  async cleanupIdleBrowsers() {
    const now = Date.now();
    const idleBrowsers = [];

    for (const [id, browser] of this.activeBrowsers) {
      const idleTime = now - browser.lastActivity;
      if (idleTime > this.idleTimeout) {
        idleBrowsers.push({ id, idleTime });
      }
    }

    if (idleBrowsers.length > 0) {
      console.log(`🧹 Cleaning up ${idleBrowsers.length} idle browser(s)...`);
      
      for (const { id, idleTime } of idleBrowsers) {
        console.log(`   Removing idle browser ${id.slice(0, 16)}... (idle for ${Math.round(idleTime / 1000)}s)`);
        try {
          await this.deleteBrowser(id);
        } catch (error) {
          console.error(`   Failed to cleanup browser ${id}:`, error.message);
        }
      }
    }
  }

  // Cleanup interval on shutdown
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

export default BrowserPool;