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
# Add /dashboard to pages/index.ts if not already there
if ! grep -q '"/dashboard"' "$SPACE_DIR/routes/pages/index.ts"; then
  python3 -c "
import re
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
# Add /api/zo-* to api/index.ts if not already there
python3 <<'PY'
import re
p = "/__substrate/space/routes/api/index.ts"
c = open(p).read()
routes = [
  ('"/api/zo-context"', '"api-zo-context"'),
  ('"/api/zo-suggestions"', '"api-zo-suggestions"'),
  ('"/api/zo-refresh"', '"api-zo-refresh"'),
  ('"/api/zo-ask"', '"api-zo-ask"'),
]
entries = ""
for route, file in routes:
    if route not in c:
        entries += f'  {route}: {{ file: {file}, public: true }},\n'
if entries:
    c = c.replace('};\n\nexport const apiRoutes', entries + '};\n\nexport const apiRoutes', 1)
    open(p, 'w').write(c)
PY

echo "==> Installing supervisor entry"
if ! grep -q "zo-dashboard" "$SUPERVISOR_CONF"; then
  cat "$REPO_DIR/supervisor/supervisord-user.conf" | grep -A 15 "zo-dashboard" >> "$SUPERVISOR_CONF"
  supervisorctl -c "$SUPERVISOR_CONF" reread
  supervisorctl -c "$SUPERVISOR_CONF" update
else
  echo "    already present, skipping"
fi

echo "==> Building space"
cd "$SPACE_DIR" && bun run build

echo "==> Restarting services"
supervisorctl -c /etc/zo/supervisor.conf restart zo-space
supervisorctl -c "$SUPERVISOR_CONF" restart zo-dashboard

echo ""
echo "Done. Dashboard live at https://<your-handle>.zo.space/dashboard"
