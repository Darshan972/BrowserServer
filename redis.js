// redis.js — shared Redis Cloud client for the broker (ioredis + TLS)
// Usage: const { redis, prefix, closeRedis } = require('./redis');

require('dotenv').config({ path: './config.env' });
const Redis = require('ioredis');

// Prefer REDIS_URL (e.g. rediss://default:<password>@<host>:<port/0>)
// Else fall back to discrete vars (TLS on by default for Redis Cloud).
const {
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  REDIS_NAMESPACE = 'broker:prod' // namespace to avoid key collisions across envs
} = process.env;

let redis;

  // Discrete config (Redis Cloud)
  redis = new Redis({
    host: REDIS_HOST,
    port: Number(REDIS_PORT),
    password: REDIS_PASSWORD
  });

redis.on('connect', () => console.log('[redis] connect'));
redis.on('ready',   () => console.log('[redis] ready'));
redis.on('error',   (e) => console.error('[redis] error:', e.message));
redis.on('close',   () => console.warn('[redis] close'));
redis.on('reconnecting', (d) => console.log('[redis] reconnecting in', d));

function prefix(k) {
  return `${REDIS_NAMESPACE}:${k}`;
}

async function closeRedis() {
  try { await redis.quit(); } catch { try { await redis.disconnect(); } catch {} }
}

module.exports = { redis, prefix, closeRedis };
