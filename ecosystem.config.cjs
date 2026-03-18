module.exports = {
  apps: [
    {
      name: 'tempoai-engine',
      script: 'npx',
      args: 'ts-node-dev --respawn --transpile-only src/index.ts',
      cwd: '/Users/soren/Projects/tempoai-engine',
      env: {
        DEMO_MODE: 'false',
        SQUARE_ACCESS_TOKEN: 'EAAAlys3oCQ6weIeARSxIAJLEA2Qq8B4EP37yFB65sEDaW1-ZfGQhJvn5WiLsa4C',
        SQUARE_ENVIRONMENT: 'sandbox',
        PORT: '3001'
      },
      restart_delay: 2000,
      max_restarts: 50,
      autorestart: true,
    },
    {
      name: 'tempoai-tunnel',
      script: 'cloudflared',
      args: 'tunnel --url http://localhost:3001',
      restart_delay: 5000,
      max_restarts: 100,
      autorestart: true,
    }
  ]
};
