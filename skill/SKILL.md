---
name: zo-dashboard
description: |
  Personalized Zo command center and dashboard. Aggregates context from all Zo systems
  (skills, agents, automations, memory, recent activity) and surfaces actionable suggestions
  based on the user's patterns, preferences, and current state. Use when the user asks to
  see their dashboard, check on their Zo, get suggestions for what to do, review agent
  status, or wants an overview of their space. Also triggers on scheduled refresh to
  keep dashboard data current.
compatibility: Created for Zo Computer
metadata:
  author: zo
  category: Core
---

# Zo Dashboard

Personalized command center that answers: "What's happening in my Zo, and what should I do next?"

## Architecture

The dashboard is a **framework for surfacing personalized context**, not a static page. It works through three layers:

### Layer 1: Context Collectors
Gather raw state from every Zo system. Each collector is a module that knows how to query one data source.

```
scripts/collect_context.py  -- Aggregates all collectors into a single snapshot
```

**Data sources collected:**
- Skills inventory (installed, health status)
- Scheduled agents & automations (next run, last result)
- Recent activity (git log, file changes, job history)
- Memory profile (supermemory static + dynamic)
- Job queue status (pending, completed, failed)
- Reflection history (latest self-improvement findings)

### Layer 2: Suggestion Engine
Analyzes collected context and generates personalized recommendations.

```
scripts/generate_suggestions.py  -- Produces ranked suggestions from context snapshot
```

**Suggestion categories:**
- **Act on it**: Things that need attention now (failed jobs, stale agents, unreviewed proposals)
- **Build something**: Capability gaps, skill ideas based on patterns
- **Explore**: Data you have but haven't used, connections between systems
- **Maintain**: Housekeeping tasks (memory hygiene, skill updates, workspace cleanup)

### Layer 3: Dashboard Server
Serves the dashboard UI and provides API endpoints for real-time data.

```
scripts/server.ts  -- Bun HTTP server for dashboard page + API
```

**Endpoints:**
- `GET /` -- Dashboard HTML page
- `GET /api/context` -- Current context snapshot (JSON)
- `GET /api/suggestions` -- Current suggestions (JSON)
- `POST /api/refresh` -- Trigger fresh context collection + suggestion generation
- `POST /api/ask` -- Ask Zo a question about your dashboard data

## Running the Dashboard

### Start the server
```bash
bun /home/workspace/Skills/zo-dashboard/scripts/server.ts
```

### Refresh data manually
```bash
python3 /home/workspace/Skills/zo-dashboard/scripts/collect_context.py
python3 /home/workspace/Skills/zo-dashboard/scripts/generate_suggestions.py
```

### Schedule automatic refresh
Set up a scheduled agent to run the refresh periodically (recommended: every 30 minutes during active hours).

## Generalizing for Any Zo User

The dashboard framework is designed to work for ANY Zo user, not just the creator. The key abstraction:

1. **Collectors are discovery-based**: They scan `/home/workspace/Skills/` for installed skills, check for common automation patterns, and adapt to whatever the user has set up.
2. **Suggestions are context-driven**: The suggestion engine doesn't hardcode what matters -- it infers importance from recency, frequency, and the user's memory profile.
3. **The UI is data-driven**: Dashboard sections render from the context snapshot, so they automatically reflect whatever systems the user has.

To customize for a new user, only the memory profile and preference weights need to change -- the infrastructure discovers everything else.

## Data Storage

Context snapshots and suggestions are cached to:
```
/home/workspace/.zo-dashboard/
  context.json     -- Latest context snapshot
  suggestions.json -- Latest suggestions
  history/         -- Historical snapshots for trend analysis
```
