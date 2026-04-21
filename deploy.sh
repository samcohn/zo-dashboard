#!/bin/bash
# Deploy zo-dashboard into a Zo Computer.
# Run from the root of this repo. Idempotent — safe to re-run.

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SPACE_DIR="/__substrate/space"
SKILL_DIR="/home/workspace/Skills/zo-dashboard"
SUPERVISOR_CONF="/etc/zo/supervisord-user.conf"

echo "==> Installing skill to $SKILL_DIR"
mkdir -p "$SKILL_DIR/scripts" "$SKILL_DIR/app"
cp -r "$REPO_DIR/skill/scripts/"* "$SKILL_DIR/scripts/"
cp "$REPO_DIR/skill/SKILL.md" "$SKILL_DIR/"
[ -d "$REPO_DIR/skill/app" ] && cp -r "$REPO_DIR/skill/app/"* "$SKILL_DIR/app/"
chmod +x "$SKILL_DIR/scripts/"*.sh 2>/dev/null || true

echo "==> Installing space integration files"
cp "$REPO_DIR/space/routes/pages/dashboard.tsx" "$SPACE_DIR/routes/pages/"
cp "$REPO_DIR/space/routes/api/api-zo-"*.ts "$SPACE_DIR/routes/api/"
cp "$REPO_DIR/space/public/pegasus.gif" "$SPACE_DIR/public/"
cp "$REPO_DIR/space/public/pegasus.gif" "$SPACE_DIR/assets/" 2>/dev/null || true

echo "==> Registering page route"
if ! grep -q '"/dashboard"' "$SPACE_DIR/routes/pages/index.ts"; then
  python3 -c "
p = '$SPACE_DIR/routes/pages/index.ts'
c = open(p).read()
entry = '''  \"/dashboard\": {
    component: lazy(() => import(\"./dashboard\")),
    public: true,
  },
'''
c = c.replace('  \"/\": {', entry + '  \"/\": {')
open(p, 'w').write(c)
"
fi

echo "==> Registering API routes"
python3 <<'PY'
p = "/__substrate/space/routes/api/index.ts"
c = open(p).read()
routes = [
  ('"/api/zo-context"', '"api-zo-context"'),
  ('"/api/zo-suggestions"', '"api-zo-suggestions"'),
  ('"/api/zo-refresh"', '"api-zo-refresh"'),
  ('"/api/zo-ask"', '"api-zo-ask"'),
  ('"/api/zo-projects"', '"api-zo-projects"'),
  ('"/api/zo-projects/:id"', '"api-zo-projects"'),
  ('"/api/zo-projects/:id/steps/:stepId"', '"api-zo-projects"'),
  ('"/api/zo-projects/:id/steps/:stepId/run"', '"api-zo-projects"'),
  ('"/api/zo-projects/:id/steps/:stepId/runs"', '"api-zo-projects"'),
  ('"/api/zo-projects/:id/link-node"', '"api-zo-projects"'),
  ('"/api/zo-projects/:id/unlink-node"', '"api-zo-projects"'),
  ('"/api/zo-projects/:id/regenerate-plan"', '"api-zo-projects"'),
  ('"/api/zo-projects/:id/run-today"', '"api-zo-projects"'),
  ('"/api/zo-runs/:runId"', '"api-zo-runs"'),
]
entries = ""
for route, file in routes:
    if route not in c:
        entries += f'  {route}: {{ file: {file}, public: true }},\n'
if entries:
    c = c.replace('};\n\nexport const apiRoutes', entries + '};\n\nexport const apiRoutes', 1)
    open(p, 'w').write(c)
PY

echo "==> Installing supervisor entries (zo-dashboard + guardian)"
# zo-dashboard
if ! grep -q "^\[program:zo-dashboard\]" "$SUPERVISOR_CONF"; then
  cat >> "$SUPERVISOR_CONF" <<'EOF'

[program:zo-dashboard]
command=bun /home/workspace/Skills/zo-dashboard/scripts/server.ts
directory=/home/workspace
environment=
autostart=true
autorestart=true
stopsignal=TERM
stopasgroup=true
startretries=20
startsecs=3
stdout_logfile=/dev/shm/zo-dashboard.log
stderr_logfile=/dev/shm/zo-dashboard_err.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
stopwaitsecs=4
killasgroup=true
EOF
fi
# guardian (self-healer)
if ! grep -q "^\[program:zo-dashboard-guardian\]" "$SUPERVISOR_CONF"; then
  cat >> "$SUPERVISOR_CONF" <<'EOF'

[program:zo-dashboard-guardian]
command=bash /home/workspace/Skills/zo-dashboard/scripts/guardian.sh
directory=/home/workspace
environment=
autostart=true
autorestart=true
stopsignal=TERM
stopasgroup=true
startretries=20
startsecs=3
stdout_logfile=/dev/shm/zo-dashboard-guardian.log
stderr_logfile=/dev/shm/zo-dashboard-guardian_err.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
stopwaitsecs=4
killasgroup=true
EOF
fi
supervisorctl -c "$SUPERVISOR_CONF" reread
supervisorctl -c "$SUPERVISOR_CONF" update

echo "==> Building space"
cd "$SPACE_DIR" && bun run build

echo "==> Restarting services"
supervisorctl -c /etc/zo/supervisor.conf restart zo-space
supervisorctl -c "$SUPERVISOR_CONF" restart zo-dashboard 2>/dev/null || true

echo ""
echo "Done. Dashboard live at https://<your-handle>.zo.space/dashboard"
