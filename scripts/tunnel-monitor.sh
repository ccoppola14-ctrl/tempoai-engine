#!/bin/bash
# TempoAi Tunnel Monitor
# Watches for tunnel URL changes and updates the Vercel deployment
# Run this alongside pm2

DASHBOARD_DIR="/Users/soren/Projects/tempoai"
ENGINE_DIR="/Users/soren/Projects/tempoai-engine"
LAST_URL_FILE="$ENGINE_DIR/.tunnel-url"

get_tunnel_url() {
  # Parse cloudflared logs for the tunnel URL
  pm2 logs tempoai-tunnel --lines 50 --nostream 2>/dev/null | \
    grep -o 'https://[a-z-]*.trycloudflare.com' | tail -1
}

update_dashboard() {
  local new_url="$1"
  echo "[$(date)] Updating dashboard to use: $new_url"
  
  # Update .env.local
  echo "NEXT_PUBLIC_API_URL=$new_url" > "$DASHBOARD_DIR/.env.local"
  
  # Build and deploy
  cd "$DASHBOARD_DIR"
  npx next build 2>&1 | tail -3
  npx vercel --prod --yes 2>&1 | tail -3
  
  # Save current URL
  echo "$new_url" > "$LAST_URL_FILE"
  echo "[$(date)] Dashboard deployed with new URL"
}

echo "[$(date)] Tunnel monitor started"

while true; do
  CURRENT_URL=$(get_tunnel_url)
  SAVED_URL=$(cat "$LAST_URL_FILE" 2>/dev/null)
  
  if [ -n "$CURRENT_URL" ] && [ "$CURRENT_URL" != "$SAVED_URL" ]; then
    echo "[$(date)] Tunnel URL changed: $CURRENT_URL"
    update_dashboard "$CURRENT_URL"
  fi
  
  # Check every 30 seconds
  sleep 30
done
