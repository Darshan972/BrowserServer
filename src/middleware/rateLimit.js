import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { ipKeyGenerator } from 'express-rate-limit';

const safeKeyGenerator = (req) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey || 'anonymous';
  const ip = ipKeyGenerator(req);  
  return `${req.path}-${ip}-${apiKey}`;
};

// General API rate limiter - FIXED: Single keyGenerator
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    error: 'Too many requests',
    message: `Maximum ${config.rateLimit.maxRequests} requests per ${config.rateLimit.windowMs / 1000} seconds`,
    retryAfter: 'Check Retry-After header'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeKeyGenerator,  
  handler: (req, res) => {
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Maximum ${config.rateLimit.maxRequests} requests per ${config.rateLimit.windowMs / 1000} seconds`,
      limit: config.rateLimit.maxRequests,
      windowMs: config.rateLimit.windowMs,
      retryAfter: res.getHeader('Retry-After'),
      clientIp: ipKeyGenerator(req)
    });
  }
});

export const bulkCreateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.bulkMax,
  message: {
    error: 'Bulk create rate limit exceeded',
    message: `Maximum ${config.rateLimit.bulkMax} bulk requests per ${config.rateLimit.windowMs / 1000} seconds`
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] || 'anonymous';
    const ip = ipKeyGenerator(req);  // ✅ IPv6 safe
    return `bulk-${ip}-${apiKey}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Bulk create rate limit exceeded',
      message: `Maximum ${config.rateLimit.bulkMax} bulk requests per ${config.rateLimit.windowMs / 1000} seconds`,
      tip: 'Use single create endpoint or wait before retrying',
      limit: config.rateLimit.bulkMax,
      windowMs: config.rateLimit.windowMs,
      retryAfter: res.getHeader('Retry-After')
    });
  }
});

export const createLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.createMax,
  message: {
    error: 'Create rate limit exceeded',
    message: `Maximum ${config.rateLimit.createMax} create requests per ${config.rateLimit.windowMs / 1000} seconds`
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] || 'anonymous';
    const ip = ipKeyGenerator(req);  
    return `create-${ip}-${apiKey}`;
  }
});