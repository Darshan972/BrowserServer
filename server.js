// server.js — Redis-backed broker (multi-worker safe)
require("dotenv").config({ path: "./config.env" });
const { chromium } = require("playwright");
const { createServer } = require("http");
const WebSocket = require("ws");
const { redis, prefix, closeRedis } = require("./redis");

// ------- env -------
const PORT = Number(process.env.PORT || 9080);
const MAX_BROWSERS = Number(process.env.MAX_BROWSERS || 350);
console.log(MAX_BROWSERS, "MAX_BROWSERS on starting");
console.log(PORT, "PORT on starting");
const BROWSER_TTL_MS = Number(process.env.BROWSER_TTL_MS || 60000); // hard cap
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS || 30000); // idle cap
const API_KEY = process.env.API_KEY || "";
const EXTRA_ARGS = (
  process.env.EXTRA_ARGS ||
  "--disable-dev-shm-usage --no-sandbox --disable-gpu --disable-blink-features=AutomationControlled"
)
  .split(" ")
  .filter(Boolean);
const BASE_PATH = (process.env.BASE_PATH || "/").replace(/\/+$/, ""); // "/playwright-9080" or ""

// ------- redis keys -------
const K_COUNT = prefix("count");
const K_SET = prefix("ids");
const K_INFO = (id) => prefix(`b:${id}`);
const K_LOCK = (id) => prefix(`lock:${id}`);

// Local map only keeps handles for browsers launched by THIS worker
const local = new Map(); // id -> { server }

// Simple touch throttle (reduce redis writes from chatty tunnels)
const lastTouch = new Map();
const TOUCH_MIN_MS = Number(process.env.TOUCH_MIN_MS || 3000);

const LOG = (...a) => console.log(...a);
const now = () => Date.now();

async function withLock(id, ttlMs, fn) {
  const token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const ok = await redis.set(K_LOCK(id), token, "NX", "PX", ttlMs);
  if (!ok) return false;
  try {
    await fn();
  } finally {
    const val = await redis.get(K_LOCK(id));
    if (val === token) await redis.del(K_LOCK(id));
  }
  return true;
}

async function saveInfo(id, info) {
  await redis.set(K_INFO(id), JSON.stringify(info), "PX", IDLE_TIMEOUT_MS);
  await redis.sadd(K_SET, id);
}

async function loadInfo(id) {
  const s = await redis.get(K_INFO(id));
  return s ? JSON.parse(s) : null;
}

async function touch(id) {
  const t = now();
  const last = lastTouch.get(id) || 0;
  if (t - last < TOUCH_MIN_MS) return;
  lastTouch.set(id, t);

  try {
    const info = await loadInfo(id);
    if (info) {
      info.lastActiveAt = t;
      await redis.set(K_INFO(id), JSON.stringify(info), "PX", IDLE_TIMEOUT_MS);
    }
  } catch {}
}

async function decCountSafe() {
  const n = await redis.decr(K_COUNT);
  if (n < 0) await redis.set(K_COUNT, 0);
}

async function closeById(id, reason = "close") {
  await withLock(id, 15000, async () => {
    const info = await loadInfo(id);

    // try local fast-path either way
    const localEntry = local.get(id);
    if (localEntry?.server) {
      try {
        await localEntry.server.close();
      } catch {}
      local.delete(id);
    }

    // if info exists, try cross-worker close
    if (info?.wsEndpoint) {
      try {
        const browser = await chromium.connect(info.wsEndpoint, {
          timeout: 10000,
        });
        await browser.close();
      } catch {}
    }

    // always clean Redis metadata + counters
    await redis.del(K_INFO(id));
    await redis.srem(K_SET, id);
    await decCountSafe();

    LOG(`[broker] closed ${id} (${reason})`);
  });
}

// Hard TTL janitor
setInterval(async () => {
  try {
    const ids = await redis.smembers(K_SET);
    const t = now();

    for (const id of ids) {
      const info = await loadInfo(id);

      // 3a) Ghost: metadata expired, but set/count still held
      if (!info) {
        const localEntry = local.get(id);
        if (localEntry?.server) {
          try {
            await localEntry.server.close();
          } catch {}
          local.delete(id);
        }
        await redis.srem(K_SET, id);
        await decCountSafe();
        LOG(`[broker] reaped ghost ${id}`);
        continue;
      }

      // 3b) Idle timeout
      const last = info.lastActiveAt || info.createdAt || 0;
      if (t - last > IDLE_TIMEOUT_MS) {
        await closeById(id, "idle");
        continue;
      }

      // 3c) Hard TTL
      if (t - (info.createdAt || 0) > BROWSER_TTL_MS) {
        await closeById(id, "ttl");
      }
    }
  } catch (e) {
    LOG("[broker] janitor error", e.message);
  }
}, 30000);

// In your handleReserve function, update the launchOptions:
async function handleReserve(ws, payload) {
  const { apiKey, proxy, customArgs, headless = true } = payload || {};

  if (API_KEY && apiKey !== API_KEY) {
    return ws.send(
      JSON.stringify({ ok: false, code: 401, error: "invalid_api_key" })
    );
  }

  const claimed = await redis.incr(K_COUNT);
  if (claimed > MAX_BROWSERS) {
    await decCountSafe();
    return ws.send(
      JSON.stringify({ ok: false, code: 429, error: "capacity_exhausted" })
    );
  }

  try {
    const launchOptions = {
      headless,
      args: EXTRA_ARGS,
      // Force browser to bind to all interfaces, not just localhost
      wsEndpoint: "0.0.0.0", // This might help
      // Alternative: specify host directly
      host: "0.0.0.0",
    };

    if (Array.isArray(customArgs)) {
      launchOptions.args = [...launchOptions.args, ...customArgs];
    }

    // Add network-related args to ensure browser server works
    const networkArgs = [
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--remote-debugging-address=0.0.0.0", // Force binding to all interfaces
    ];

    launchOptions.args = [...new Set([...launchOptions.args, ...networkArgs])];

    console.log("Launch options:", JSON.stringify(launchOptions, null, 2));

    const server = await chromium.launchServer(launchOptions);
    const wsEndpoint = server.wsEndpoint();

    console.log(`[DEBUG] Browser launched with endpoint: ${wsEndpoint}`);

    // Test the connection immediately to catch issues early
    // In handleReserve, replace the test connection block:
    try {
      // Wait a bit for browser to fully initialize
      await new Promise((r) => setTimeout(r, 1000));

      // Test with retry logic
      let testPassed = false;
      for (let i = 0; i < 3 && !testPassed; i++) {
        try {
          const testConnection = new WebSocket(wsEndpoint, "v1.playwright", {
            headers: {
              "User-Agent": "Playwright-Broker-Test",
            },
          });

          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              testConnection.close();
              reject(new Error("Test connection timeout"));
            }, 3000); // Shorter timeout

            testConnection.once("open", () => {
              clearTimeout(timeout);
              testConnection.close();
              console.log(
                `[DEBUG] Test connection ${i + 1} to ${wsEndpoint} successful`
              );
              testPassed = true;
              resolve();
            });

            testConnection.once("error", (err) => {
              clearTimeout(timeout);
              if (i === 2) {
                // Last attempt
                reject(err);
              } else {
                console.log(
                  `[DEBUG] Test connection ${i + 1} failed, retrying: ${
                    err.message
                  }`
                );
                resolve(); // Continue to next attempt
              }
            });
          });

          if (testPassed) break;
        } catch (e) {
          if (i === 2) throw e; // Last attempt failed
          await new Promise((r) => setTimeout(r, 500)); // Wait before retry
        }
      }

      if (!testPassed) {
        throw new Error("Browser test connection failed after 3 attempts");
      }
    } catch (testErr) {
      console.error(
        `[ERROR] Cannot connect to browser endpoint ${wsEndpoint}:`,
        testErr.message
      );
      try {
        await server.close();
      } catch {}
      throw new Error(`Browser endpoint unreachable: ${testErr.message}`);
    }

    const id = Math.random().toString(36).slice(2);
    local.set(id, { server });

    const info = { wsEndpoint, createdAt: now(), lastActiveAt: now() };
    await saveInfo(id, info);

    const publicWs = `${BASE_PATH || ""}/pw/${id}`;
    ws.send(
      JSON.stringify({
        ok: true,
        id,
        publicWs,
        ttlMs: BROWSER_TTL_MS,
        idleTimeoutMs: IDLE_TIMEOUT_MS,
        pingEveryMs: Number(process.env.PING_INTERVAL_MS || 20000),
      })
    );
    LOG(`[broker] started browser ${id} at ${wsEndpoint}`);
  } catch (e) {
    await decCountSafe();
    console.error("[ERROR] Browser launch failed:", e.message);
    ws.send(
      JSON.stringify({
        ok: false,
        code: 500,
        error: e.message || "launch_failed",
      })
    );
  }
}

async function handlePing(ws, payload) {
  const id = payload?.id;
  if (id) await touch(id);
  ws.send(JSON.stringify({ ok: true, type: "pong" }));
}

async function handleRelease(ws, payload) {
  const id = payload?.id;
  if (!id)
    return ws.send(
      JSON.stringify({ ok: false, code: 400, error: "missing_id" })
    );
  await closeById(id, "release");
  ws.send(JSON.stringify({ ok: true, type: "released" }));
}

// ---------- HTTP + WS servers ----------
const httpServer = createServer();
const controlWss = new WebSocket.Server({ noServer: true });
const tunnelWss = new WebSocket.Server({
  noServer: true,
  handleProtocols: (protocols) => {
    // Prefer Playwright’s protocol; fall back to first if different client
    if (protocols?.includes("v1.playwright")) return "v1.playwright";
    return protocols?.[0];
  },
});

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  const rawPath = url.pathname;
  const path =
    BASE_PATH && BASE_PATH !== "/" && rawPath.startsWith(BASE_PATH)
      ? rawPath.slice(BASE_PATH.length) || "/"
      : rawPath;

  if (path === "/") {
    controlWss.handleUpgrade(req, socket, head, (ws) =>
      controlWss.emit("connection", ws, req)
    );
    return;
  }

  const m = path.match(/^\/pw\/([a-z0-9]+)/i);
  if (m) {
    // forward the requested subprotocol (e.g., 'v1.playwright')
    const requestedProto = req.headers["sec-websocket-protocol"];
    tunnelWss.handleUpgrade(req, socket, head, (ws) =>
      tunnelWss.emit("connection", ws, req, m[1], requestedProto)
    );
    return;
  }

  socket.destroy();
});

// control channel
controlWss.on("connection", (ws) => {
  ws.on("message", async (buf) => {
    let msg = {};
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    const { type, payload } = msg;

    try {
      if (type === "reserve") await handleReserve(ws, payload);
      else if (type === "ping") await handlePing(ws, payload);
      else if (type === "release") await handleRelease(ws, payload);
      else
        ws.send(
          JSON.stringify({
            ok: false,
            code: 400,
            error: `unknown_type:${type}`,
          })
        );
    } catch (e) {
      ws.send(JSON.stringify({ ok: false, code: 500, error: e.message }));
    }
  });
});

// tunnel channel — lookup id in Redis (works across workers)
// Enhanced tunnel connection handler with better error handling and debugging

tunnelWss.on("connection", async (clientWs, req, id, requestedProtoRaw) => {
  console.log(`[DEBUG] Tunnel connection for browser ${id}`);

  let info = await loadInfo(id);
  console.log(`[DEBUG] Browser info:`, info);

  if (!info) {
    for (let i = 0; i < 5 && !info; i++) {
      await new Promise((r) => setTimeout(r, 100));
      info = await loadInfo(id);
    }
    if (!info) {
      console.log(`[ERROR] No browser info found for ${id}`);
      clientWs.close(1011, "unknown_browser");
      return;
    }
  }

  let requestedProto = (requestedProtoRaw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!requestedProto) requestedProto = "v1.playwright";

  console.log(`[DEBUG] Connecting to upstream: ${info.wsEndpoint} with protocol: ${requestedProto}`);

  const upstream = new WebSocket(info.wsEndpoint, requestedProto);
  let connectionEstablished = false;
  let clientActive = false; // Move outside the upstream.on('open') handler

  const cleanup = async (reason = "unknown") => {
    console.log(`[DEBUG] Cleaning up tunnel connection for ${id}, reason: ${reason}`);
    try { clientWs.close(); } catch {}
    try { upstream.close(); } catch {}
  };

  const connectionTimeout = setTimeout(() => {
    if (!connectionEstablished) {
      console.error(`[ERROR] Upstream connection timeout for ${id}`);
      cleanup("connection_timeout");
    }
  }, 10000);

  upstream.on("open", () => {
    console.log(`[DEBUG] Upstream connection established for ${id}`);
    connectionEstablished = true;
    clearTimeout(connectionTimeout);

    const refresh = () => touch(id).catch(() => {});

    clientWs.on("message", (data) => {
      refresh();
      try {
        upstream.send(data);
      } catch (e) {
        console.error(`[ERROR] Failed to send to upstream:`, e.message);
      }
    });

    upstream.on('message', (data) => {
      refresh();
      
      // Detect meaningful client activity
      try {
        const message = JSON.parse(data.toString());
        // Look for actual Playwright protocol methods that indicate real usage
        if (message.method && (
          message.method.includes('newBrowserContext') ||
          message.method.includes('newPage') ||
          message.method.includes('goto') ||
          message.method.includes('click') ||
          message.method.includes('fill')
        )) {
          clientActive = true;
          console.log(`[DEBUG] Client activity detected for ${id}: ${message.method}`);
        }
      } catch {}
      
      try { 
        clientWs.send(data); 
      } catch (e) {
        console.error(`[ERROR] Failed to send to client:`, e.message);
      }
    });

    // Handle client disconnections
    clientWs.on("close", () => {
      console.log(`[DEBUG] Client disconnected for ${id}`);
      cleanup("client_close");
    });

    clientWs.on("error", (err) => {
      console.error(`[ERROR] Client error:`, err.message);
      cleanup("client_error");
    });

    upstream.on('close', async (code, reason) => {
      console.log(`[DEBUG] Upstream closed for ${id}: code=${code} reason=${reason}`);
      
      // Close browser immediately when upstream closes
      console.log(`[DEBUG] Client work complete, closing browser ${id} immediately`);
      await closeById(id, 'client_disconnected');
    });

    upstream.on("error", (err) => {
      console.error(`[ERROR] Upstream error:`, err.message);
      cleanup("upstream_error");
    });
  });

  upstream.on("error", (err) => {
    clearTimeout(connectionTimeout);
    console.error(`[ERROR] Failed to connect to upstream ${info.wsEndpoint}:`, err.message);
    cleanup("upstream_connection_failed");
  });

  // Handle early client disconnection
  clientWs.on("error", (err) => {
    if (!connectionEstablished) {
      console.error(`[ERROR] Early client error:`, err.message);
      clearTimeout(connectionTimeout);
      cleanup("early_client_error");
    }
  });

  clientWs.on("close", () => {
    if (!connectionEstablished) {
      console.log(`[DEBUG] Client closed before upstream ready`);
      clearTimeout(connectionTimeout);
      cleanup("early_client_close");
    }
  });
});

httpServer.listen(PORT, () =>
  LOG(`[broker] listening on :${PORT} (base=${BASE_PATH})`)
);

// graceful shutdown
process.on("SIGINT", async () => {
  await closeRedis();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await closeRedis();
  process.exit(0);
});
