import config from '../config.js';

export const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'API key required. Provide via X-API-Key header or apiKey query param' 
    });
  }

  if (apiKey !== config.apiKey) {
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Invalid API key' 
    });
  }

  next();  // Valid API key - proceed
};

// Optional: Multiple API keys support
const validApiKeys = new Set([
  config.apiKey,
  process.env.API_KEY_SECONDARY,
  process.env.API_KEY_READONLY
].filter(Boolean));

export const apiKeyAuthMultiple = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey || !validApiKeys.has(apiKey)) {
    return res.status(403).json({ error: 'Invalid or missing API key' });
  }
  
  next();
};
