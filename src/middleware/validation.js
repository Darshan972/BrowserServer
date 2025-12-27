// src/middleware/validation.js
// Complete request validation with self-documenting error responses

/**
 * Validates POST /browsers request body
 */
export const validateCreateBrowser = (req, res, next) => {
  const { headful } = req.body;
  
  // Check if body exists
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      error: 'Invalid request body',
      message: 'Request body is empty or invalid JSON',
      expectedFormat: {
        headful: 'boolean (optional, default: false)'
      },
      example: {
        headful: false
      }
    });
  }

  // Validate headful if provided
  if (headful !== undefined && typeof headful !== 'boolean') {
    return res.status(400).json({
      error: 'Invalid field: headful',
      message: `Expected boolean, got ${typeof headful}`,
      receivedValue: headful,
      expectedFormat: {
        headful: 'boolean (optional, default: false)'
      },
      example: {
        headful: true
      }
    });
  }

  next();
};

/**
 * Validates POST /browsers/bulk request body
 */
export const validateBulkCreate = (req, res, next) => {
  const { count, headful } = req.body;
  const errors = [];

  // Check if body exists
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      error: 'Invalid request body',
      message: 'Request body is empty or invalid JSON',
      expectedFormat: {
        count: 'number (optional, default: 1, min: 1, max: 50)',
        headful: 'boolean (optional, default: false)'
      },
      example: {
        count: 5,
        headful: false
      }
    });
  }

  // Validate count
  if (count !== undefined) {
    if (typeof count !== 'number') {
      errors.push({
        field: 'count',
        message: `Expected number, got ${typeof count}`,
        received: count
      });
    } else if (count < 1) {
      errors.push({
        field: 'count',
        message: 'Must be at least 1',
        received: count
      });
    } else if (count > 50) {
      errors.push({
        field: 'count',
        message: 'Maximum 50 browsers per request',
        received: count
      });
    }
  }

  // Validate headful
  if (headful !== undefined && typeof headful !== 'boolean') {
    errors.push({
      field: 'headful',
      message: `Expected boolean, got ${typeof headful}`,
      received: headful
    });
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      errors,
      expectedFormat: {
        count: 'number (optional, default: 1, min: 1, max: 50)',
        headful: 'boolean (optional, default: false)'
      },
      example: {
        count: 5,
        headful: false
      }
    });
  }

  next();
};

/**
 * Validates browser ID parameter (UUID v4 format)
 */
export const validateBrowserId = (req, res, next) => {
  const { id } = req.params;
  
  // Accept both pure UUID v4 and domain-prefixed UUID v4
  // Pure: b354e854-b846-4dcb-845f-7219fb5bd08e
  // Prefixed: browser-scrapingdog-com_b354e854-b846-4dcb-845f-7219fb5bd08e
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const prefixedUuidRegex = /^[a-z0-9-]+_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  if (!id || !(uuidRegex.test(id) || prefixedUuidRegex.test(id))) {
    return res.status(400).json({
      error: 'Invalid browser ID',
      message: 'Browser ID must be a valid UUID v4 (with or without domain prefix)',
      receivedValue: id,
      expectedFormat: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx or domain_xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx',
      example: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      tip: 'Get valid IDs from GET /browsers endpoint'
    });
  }

  next();
};

/**
 * Handles JSON parsing errors from express.json()
 */
export const handleJsonError = (err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'Invalid JSON',
      message: 'Request body contains invalid JSON syntax',
      details: err.message,
      tip: 'Check for trailing commas, unquoted keys, or missing quotes',
      expectedFormat: {
        headful: 'boolean (optional, default: false)'
      },
      example: {
        headful: false
      }
    });
  }
  next(err);
};

/**
 * Validates GET /browsers/stats/summary query parameters (optional)
 */
export const validateStatsQuery = (req, res, next) => {
  const { limit, offset } = req.query;
  
  const errors = [];
  
  if (limit !== undefined && !/^\d+$/.test(limit)) {
    errors.push({
      field: 'limit',
      message: 'Must be a positive integer',
      received: limit
    });
  }
  
  if (offset !== undefined && !/^\d+$/.test(offset)) {
    errors.push({
      field: 'offset',
      message: 'Must be a positive integer',
      received: offset
    });
  }
  
  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Invalid query parameters',
      errors,
      expectedFormat: {
        limit: 'positive integer (optional)',
        offset: 'positive integer (optional)'
      },
      example: '?limit=10&offset=0'
    });
  }
  
  next();
};

/**
 * Generic request body validator with custom schema
 */
export const validateSchema = (schema) => {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];
      
      // Check if field is required
      if (rules.required && value === undefined) {
        errors.push({
          field,
          message: 'This field is required'
        });
        continue;
      }
      
      // Skip optional fields that are not provided
      if (value === undefined) continue;
      
      // Validate type
      if (rules.type && typeof value !== rules.type) {
        errors.push({
          field,
          message: `Expected ${rules.type}, got ${typeof value}`,
          received: value
        });
      }
      
      // Validate min/max for numbers
      if (typeof value === 'number' && rules.min !== undefined && value < rules.min) {
        errors.push({
          field,
          message: `Minimum value is ${rules.min}`,
          received: value
        });
      }
      
      if (typeof value === 'number' && rules.max !== undefined && value > rules.max) {
        errors.push({
          field,
          message: `Maximum value is ${rules.max}`,
          received: value
        });
      }
      
      // Validate regex pattern
      if (rules.pattern && !rules.pattern.test(value)) {
        errors.push({
          field,
          message: `Does not match expected pattern`,
          received: value
        });
      }
    }
    
    if (errors.length > 0) {
      const expectedFormat = {};
      const example = {};
      
      for (const [field, rules] of Object.entries(schema)) {
        expectedFormat[field] = `${rules.type}${rules.required ? ' (required)' : ' (optional)'} ${rules.min !== undefined ? `(${rules.min}-${rules.max || '∞'})` : ''}`;
        example[field] = rules.example || (rules.required ? null : undefined);
      }
      
      return res.status(400).json({
        error: 'Validation failed',
        errors,
        expectedFormat,
        example
      });
    }
    
    next();
  };
};

// Pre-configured schemas for reuse
export const schemas = {
  createBrowser: {
    headful: {
      type: 'boolean',
      required: false,
      example: false
    }
  },
  bulkCreate: {
    count: {
      type: 'number',
      required: false,
      min: 1,
      max: 50,
      example: 5
    },
    headful: {
      type: 'boolean',
      required: false,
      example: false
    }
  }
};