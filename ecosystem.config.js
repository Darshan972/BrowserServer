module.exports = {
  apps: [
    {
      name: "server",
      script: "server.js",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000,
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_file: "./logs/combined.log",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};