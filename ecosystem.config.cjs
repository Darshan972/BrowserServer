module.exports = {
  apps: [
    {
      name: 'browser-server',
      script: './server.js',
      
      // Instance configuration
      instances: 1,
      exec_mode: 'fork', // Use 'cluster' if you want multiple instances
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        MAX_BROWSERS: 50,
        DISPLAY: ':99',
        
        // Rate limiting
        RATE_LIMIT_WINDOW_MS: 60000,
        RATE_LIMIT_MAX_REQUESTS: 100,
        RATE_LIMIT_BULK_MAX: 10,
        RATE_LIMIT_CREATE_MAX: 50,
        
        // WebSocket rate limiting
        WSS_RATE_LIMIT_WINDOW_MS: 60000,
        WSS_RATE_LIMIT_MAX_CONNECTIONS: 50,
        WSS_RATE_LIMIT_MAX_MESSAGES: 1000
      },
      
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
        MAX_BROWSERS: 10,
        DISPLAY: ':99'
      },
      
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 3000,
        MAX_BROWSERS: 30,
        DISPLAY: ':99'
      },
      
      // Auto-restart configuration
      watch: false, // Set to true for development with file watching
      watch_delay: 1000,
      ignore_watch: [
        'node_modules',
        'logs',
        '*.log',
        '.git'
      ],
      
      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      
      // Resource limits
      max_memory_restart: '2G', // Restart if memory exceeds 2GB
      
      // Logging
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Process management
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      shutdown_with_message: true,
      
      // Advanced features
      exp_backoff_restart_delay: 100,
      increment_var: 'PORT',
      
      // Source map support
      source_map_support: true,
      
      // Interpreter (for ES modules)
      interpreter: 'node',
      interpreter_args: '--experimental-specifier-resolution=node',
      
      // Cron restart (optional - restart daily at 3 AM)
      // cron_restart: '0 3 * * *',
      
      // Post-deployment hooks
      post_update: ['npm install', 'echo "App updated"']
    },
    
    // Optional: Xvfb service management (if needed)
    {
      name: 'xvfb',
      script: 'Xvfb',
      args: ':99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset',
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s',
      restart_delay: 2000,
      kill_timeout: 3000,
      error_file: './logs/xvfb-error.log',
      out_file: './logs/xvfb-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Only enable if Xvfb is not managed by system service
      enabled: false
    }
  ],
  
  // Deployment configuration (optional)
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:Darshan972/BrowserServer.git',
      path: '/var/www/browser-server',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-deploy-local': 'echo "Deploying to production..."',
      'post-deploy-local': 'echo "Deployment complete!"'
    },
    
    staging: {
      user: 'deploy',
      host: 'staging-server.com',
      ref: 'origin/develop',
      repo: 'git@github.com:Darshan972/BrowserServer.git',
      path: '/var/www/browser-server-staging',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env staging'
    }
  }
};
