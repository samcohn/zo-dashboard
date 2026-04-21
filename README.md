# zo-dashboard

Personal command center for a Zo Computer — interactive force-directed graph of your skills, automations, and projects, plus an agent harness that runs work for you.

## Two deployments

### ☁️ Cloud (24/7, anyone can view)

Next.js + Vercel. Stays online whether or not the zo-computer is running. See [`cloud/README.md`](cloud/README.md) for setup.

```
Browser ──► Vercel (Next.js + KV) ◄──── zo-computer sync worker
```

State lives in Vercel KV. The zo-computer pushes context + suggestions and drains the run queue when it's online. Dashboard works in read-mostly mode when it's not.

### 🖥️ Local (zo-space integration)

Runs inside the zo-computer, accessible at `samcohn.zo.space/dashboard` when the computer is up. See [`space/`](space/) + [`skill/`](skill/).

## Structure

- `cloud/` — Next.js app for Vercel (24/7 public dashboard)
- `skill/` — the Zo Skill: Python collectors, Bun local server, sync-to-cloud worker, executor
- `space/` — zo-space native integration (optional, works when computer is on)
- `supervisor/` — supervisord config entries
- `deploy.sh` — local zo-space deploy

## Deploy

**Cloud (recommended for 24/7):**
```bash
# 1. Push this repo to GitHub
# 2. Connect to Vercel, point at cloud/ as root
# 3. Add Vercel KV integration (Storage → Create KV)
# 4. Set ZO_CLIENT_IDENTITY_TOKEN + ZO_SYNC_SECRET env vars
# 5. Deploy — get your .vercel.app URL
```

**Zo-computer sync worker:**
```bash
export ZO_DASHBOARD_CLOUD_URL=https://<your-vercel-url>
export ZO_SYNC_SECRET=<same as in vercel>
python3 skill/scripts/sync_to_cloud.py
# or add as a supervisord program for auto-start
```

**Zo-space local (optional):**
```bash
./deploy.sh
```
