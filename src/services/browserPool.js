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

    if (!fsSync.existsSync(this.chromiumPath)) {
      throw new Error(`❌ Chromium NOT FOUND: ${this.chromiumPath}`);
    }
    console.log(`✅ Chromium: ${this.chromiumPath}`);

    this.activeBrowsers = new Map();
    this.usedPorts = new Set();
    this.portStart = 9222;
  }

  async getFreePort() {
    for (let port = 8000; port < 8100; port++) {
      if (!this.usedPorts.has(port)) {
        try {
          await new Promise((resolve, reject) => {
            const tester = createServer()
              .once('error', reject)
              .once('listening', () => {
                tester.close(() => resolve(port));
              });
            tester.listen(port, '0.0.0.0');
          });
          this.usedPorts.add(port);
          return port;
        } catch {
          continue;
        }
      }
    }
    throw new Error('No free ports 8000-8100');
  }

  async createBrowser(headful = false, proxyServer) {

    if (this.activeBrowsers.size >= this.maxBrowsers) {
      throw new Error(`Max ${this.maxBrowsers} browsers reached`);
    }

    const uuid = uuidv4();
    const domain = config.domain ;
    const domainPrefix = domain ? `${domain.replace(/[^a-zA-Z0-9]/g, '-')}_` : '';
    const id = `${domainPrefix}${uuid}`;


    const ports = portNumbers(8000, 8100);
    const port = await getPort({ port: ports });
    const dataDir = join(tmpdir(), `browser-${id}`);

    await fs.mkdir(dataDir, { recursive: true });


    const args = [
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dataDir}`,
      `--no-first-run`,
      `--no-default-browser-check`,
      `--disable-dev-shm-usage`,
      `--no-sandbox`,
      `--password-store=basic`,
      `--window-size=1346,766`,
      headful ? '--disable-headless' : '--headless=new',
      `--disk-cache-size=67108864`,
      `--media-cache-size=33554432`
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
              id, process: browserProcess, port, dataDir, wss: realWss, headful,
              createdAt: Date.now()
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
    browser.process.kill('SIGTERM');
    await this.cleanup(id);
    return true;
  }

  async cleanup(id) {
    const browser = this.activeBrowsers.get(id);
    if (browser) {
      this.usedPorts.delete(browser.port);
      try {
        await fs.rm(browser.dataDir, { recursive: true, force: true });
      } catch { }
      this.activeBrowsers.delete(id);
    }
  }

  listBrowsers() {
    return Array.from(this.activeBrowsers.values()).map(b => ({
      id: b.id, wss: b.wss, port: b.port, headful: b.headful,
      uptime: Date.now() - b.createdAt, pid: b.process.pid
    }));
  }

  getBrowser(id) {
    return this.activeBrowsers.get(id);
  }
}

export default BrowserPool;
