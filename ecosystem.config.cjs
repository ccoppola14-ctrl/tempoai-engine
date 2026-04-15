module.exports = {
  apps: [{
    name: 'tempoai-engine',
    script: './dist/src/index.js',
    cwd: '/opt/tempoai-engine',
    env: {
      NODE_ENV: 'production',
      PORT: '3001'
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
