# zo-dashboard

Personalized command center for Zo Computer — visualizes your skills, automations, and activity as an interactive force-directed graph.

Live at: https://samcohn.zo.space/dashboard

## Structure

- `skill/` — the Zo Skill: Python context collectors, suggestion engine, Bun HTTP server (port 3456), and a standalone React app
- `space/` — integration files for the Zo Space (the page + API proxy routes that embed the dashboard natively)
- `supervisor/` — supervisord config entry that keeps the dashboard server running
- `deploy.sh` — one-shot deploy from this repo into a fresh Zo Computer

## Architecture

```
┌─────────────────────────────────────────────┐
│ samcohn.zo.space/dashboard (Zo Space page)  │
│   └── space/routes/pages/dashboard.tsx      │
│         fetches from                        │
│   └── /api/zo-* proxies                     │
│         forward to                          │
└──────────────┬──────────────────────────────┘
               │ localhost:3456
┌──────────────▼──────────────────────────────┐
│ skill/scripts/server.ts (Bun HTTP server)   │
│   runs collectors + suggestion engine       │
│   reads /home/workspace state               │
└─────────────────────────────────────────────┘
```

## Deploy

```bash
./deploy.sh
```

See `deploy.sh` for what it does — copies files into the right places, registers routes, rebuilds the space.
