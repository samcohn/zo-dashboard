# zo-dashboard (cloud)

24/7 dashboard for a Zo Computer. Next.js + Vercel KV + Edge runtime.
The dashboard stays online whether or not the zo-computer is running.

## Architecture

```
  Browser (anyone)
       │
       ▼
  Vercel (Next.js + Edge Functions)
       │
       ├── Vercel KV  ←── state (projects, runs, context snapshot)
       │
       └── /zo/ask ←── AI calls (plan generation, ask bar)

  [zo-computer, when online]
       │
       ├── sync_to_cloud.py  — pushes context + suggestions every 5 min
       └── drains run queue  — executes pending ask_zo/run_script/spawn_agent
                                and PATCHes results back
```

When the zo-computer is **offline**:
- Dashboard loads instantly from last-pushed snapshot.
- Users can create projects, toggle steps, ask follow-ups — all persisted.
- New runs queue up waiting for the worker.

When the zo-computer **comes back online**:
- Worker reads `/api/queue`, executes everything that piled up.
- PATCHes each run with output/error.
- Dashboard polls and shows results inline.

## Deploy

1. **Connect this repo** to Vercel (point it at `cloud/` as the root directory)
2. **Add Vercel KV** integration (Vercel → Storage → Create KV). This auto-sets `KV_REST_API_URL` + `KV_REST_API_TOKEN`.
3. **Set env vars**:
   - `ZO_CLIENT_IDENTITY_TOKEN` — your Zo API token (for `/zo/ask` calls)
   - `ZO_SYNC_SECRET` — any strong random string. The worker uses this.
4. **Deploy**. You'll get a URL like `https://zo-dashboard-cloud.vercel.app`.

## Connect the zo-computer

On your zo-computer, set env vars (bake into `/home/workspace/.bashrc` or systemd/supervisord):

```bash
export ZO_DASHBOARD_CLOUD_URL="https://your-vercel-url.vercel.app"
export ZO_SYNC_SECRET="the-same-secret-you-set-in-vercel"
```

Then add a supervisor entry (example in `supervisor/supervisord-user.conf`):

```ini
[program:zo-sync]
command=python3 /home/workspace/Skills/zo-dashboard/scripts/sync_to_cloud.py
environment=ZO_DASHBOARD_CLOUD_URL="https://...",ZO_SYNC_SECRET="...",ZO_CLIENT_IDENTITY_TOKEN="%(ENV_ZO_CLIENT_IDENTITY_TOKEN)s"
autostart=true
autorestart=true
```

## UI auth

Writes require the secret. To write from a browser, visit the dashboard
with `?secret=YOUR_SECRET` once — it saves to localStorage. Subsequent
loads include it automatically.

## Local dev

```bash
cd cloud
bun install
bun run dev
```

No KV env vars → uses in-memory storage. Data resets on restart, fine for dev.

## Endpoints

Read (public):
- `GET /api/context` — latest snapshot
- `GET /api/suggestions` — latest suggestions
- `GET /api/projects` — all active projects
- `GET /api/projects/:id` — one project
- `GET /api/runs/:runId` — one run (for polling)

Write (requires `x-zo-secret`):
- `POST /api/context` — worker pushes snapshot
- `POST /api/suggestions` — worker pushes suggestions
- `POST /api/projects` — create project (with optional AI plan)
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id` (archive)
- `PATCH /api/projects/:id/steps/:stepId`
- `POST /api/projects/:id/steps/:stepId/run`
- `POST /api/projects/:id/run-today`
- `POST /api/projects/:id/link-node`
- `POST /api/projects/:id/unlink-node`
- `POST /api/projects/:id/regenerate-plan`
- `PATCH /api/runs/:runId` (worker reports completion)
- `GET /api/queue` (worker reads pending runs)
- `POST /api/ask` — proxy to /zo/ask for the UI
