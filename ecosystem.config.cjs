const dotenv = require('dotenv');
const path = require('path');

// Load .env file explicitly
const envPath = path.join(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('Failed to load .env file:', result.error);
} else {
  console.log('.env file loaded successfully from:', envPath);
}

module.exports = {
  apps: [{
    name: 'tempoai-engine',
    script: './dist/src/index.js',
    cwd: '/opt/tempoai-engine',
    env: {
      NODE_ENV: 'production',
      PORT: '3001',
      // Explicitly pass DATABASE_URL from loaded env
      DATABASE_URL: process.env.DATABASE_URL,
      SQUARE_APP_ID: process.env.SQUARE_APP_ID,
      SQUARE_ACCESS_TOKEN: process.env.SQUARE_ACCESS_TOKEN,
      SQUARE_ENVIRONMENT: process.env.SQUARE_ENVIRONMENT,
      JWT_SECRET: process.env.JWT_SECRET,
      REDIS_URL: process.env.REDIS_URL,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      ENGINE_URL: process.env.ENGINE_URL,
      DEMO_MODE: process.env.DEMO_MODE
    },
    instances: 1,
    exec_mode: 'fork',
    restart_delay: 5000,
    max_restarts: 5,
    min_uptime: '30s',
    autorestart: true,
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    log_file: '/var/log/tempoai/combined.log',
    out_file: '/var/log/tempoai/out.log',
    error_file: '/var/log/tempoai/error.log',
    kill_timeout: 5000,
    listen_timeout: 10000,
  }]
};
