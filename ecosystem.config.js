module.exports = {
  apps: [
    {
      name: "playwright-broker",
      script: "server.js",
      exec_mode: "cluster",
      instances: "max",
      max_memory_restart: "900M",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 9080,
        BASE_PATH: "/playwright-9080",

        // capacity & lifecycle
        MAX_BROWSERS: "350",
        BROWSER_TTL_MS: "1800000",   // 30m hard cap
        IDLE_TIMEOUT_MS: "600000",   // 10m idle cap
        PING_INTERVAL_MS: "20000",

        // security + chromium
        API_KEY: "APIKEY",
        EXTRA_ARGS: "--disable-dev-shm-usage --no-sandbox --disable-gpu --disable-blink-features=AutomationControlled",

        // Redis Cloud (pick ONE style)
        REDIS_URL: "rediss://default:<PASSWORD>@<HOST>:<PORT>/0",
        // REDIS_HOST: "<HOST>",
        // REDIS_PORT: "<PORT>",
        // REDIS_USERNAME: "default",
        // REDIS_PASSWORD: "<PASSWORD>",
        // REDIS_DB: "0",
        // REDIS_TLS: "true",

        REDIS_NAMESPACE: "broker:prod",
        LOG_LEVEL: "info"
      }
    }
  ]
};
