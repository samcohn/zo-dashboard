#!/bin/bash
# Guardian: ensures the dashboard's space integration files are always present.
# The zo platform regenerates routes/pages/index.ts and routes/api/index.ts,
# and sometimes wipes loose files it doesn't recognize. This script checks
# every 30 seconds and re-runs deploy.sh from a local git checkout when
# anything critical is missing.
#
# Runs under supervisord. Safe to re-run forever — deploy.sh is idempotent.

set -u

REPO_DIR="/tmp/zo-dashboard-guardian"
REPO_URL="https://github.com/samcohn/zo-dashboard.git"

# Files whose absence triggers a heal
CRITICAL_FILES=(
  "/__substrate/space/routes/pages/dashboard.tsx"
  "/__substrate/space/routes/api/api-zo-projects.ts"
  "/__substrate/space/routes/api/api-zo-runs.ts"
  "/__substrate/space/routes/api/api-zo-context.ts"
)

# Manifest entries whose absence triggers a heal
CRITICAL_MANIFEST_STRINGS=(
  "/api/zo-projects"
  "/dashboard"
)

ensure_repo() {
  if [ ! -d "$REPO_DIR/.git" ]; then
    rm -rf "$REPO_DIR"
    git clone --depth 1 "$REPO_URL" "$REPO_DIR" 2>&1 | tail -3
  else
    ( cd "$REPO_DIR" && git fetch --depth 1 origin master -q && git reset --hard origin/master -q ) 2>&1 | tail -3
  fi
}

need_heal() {
  for f in "${CRITICAL_FILES[@]}"; do
    [ -f "$f" ] || { echo "missing: $f"; return 0; }
  done
  for s in "${CRITICAL_MANIFEST_STRINGS[@]}"; do
    if [ -f /__substrate/space/routes/pages/index.ts ] && [ -f /__substrate/space/routes/api/index.ts ]; then
      grep -q "$s" /__substrate/space/routes/pages/index.ts /__substrate/space/routes/api/index.ts 2>/dev/null || { echo "missing manifest: $s"; return 0; }
    fi
  done
  # Check dashboard server is running
  curl -sf http://localhost:3456/health > /dev/null 2>&1 || { echo "dashboard server (3456) down"; return 0; }
  return 1
}

heal() {
  echo "$(date -Iseconds) HEAL: restoring dashboard from repo"
  ensure_repo
  (cd "$REPO_DIR" && bash deploy.sh 2>&1) | tail -20
}

# Do an initial ensure_repo so first heal is fast
ensure_repo

while true; do
  if reason=$(need_heal); then
    echo "$(date -Iseconds) DETECTED: $reason"
    heal
  fi
  sleep 30
done
