#!/bin/bash
# Ensure the zo-dashboard server is running on port 3456.
# Intended to be called by cron every minute.

if ! pgrep -f "zo-dashboard/scripts/server.ts" > /dev/null 2>&1; then
  cd /home/workspace
  nohup bun Skills/zo-dashboard/scripts/server.ts > /tmp/zo-dashboard.log 2>&1 &
  echo "$(date): Dashboard server started (PID $!)" >> /tmp/zo-dashboard-cron.log
fi
