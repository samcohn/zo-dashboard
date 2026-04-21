#!/usr/bin/env python3
"""
Sync worker: runs on the zo-computer under supervisord.

Every SYNC_INTERVAL seconds:
  1. Collect context (skills, jobs, commits, etc.) via collect_context.py
  2. Generate suggestions via generate_suggestions.py
  3. POST both to the cloud backend
  4. Pull any pending runs from the cloud queue
  5. Execute them locally via executor.py
  6. PATCH results back to the cloud

When the zo-computer is offline, the dashboard still works (read-only) off
the last pushed snapshot. When the computer comes back online, it drains
any queued runs that accumulated while it was down.

Environment:
  ZO_DASHBOARD_CLOUD_URL   — e.g. https://samcohn-zo.vercel.app
  ZO_SYNC_SECRET           — shared secret for write endpoints
  ZO_CLIENT_IDENTITY_TOKEN — for zo/ask calls (used by executor.py)
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SKILL_DIR = Path("/home/workspace/Skills/zo-dashboard/scripts")
DASHBOARD_DIR = Path("/home/workspace/.zo-dashboard")
CLOUD_URL = os.environ.get("ZO_DASHBOARD_CLOUD_URL", "").rstrip("/")
SECRET = os.environ.get("ZO_SYNC_SECRET", "")
SYNC_INTERVAL = int(os.environ.get("ZO_SYNC_INTERVAL", "300"))  # 5 min default


def log(*args):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}]", *args, flush=True)


def http(method: str, path: str, body=None, timeout=30):
    if not CLOUD_URL:
        return None
    url = f"{CLOUD_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if SECRET:
        headers["x-zo-secret"] = SECRET
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        log(f"HTTP {e.code} on {method} {path}: {e.read().decode()[:200]}")
        return None
    except Exception as e:
        log(f"Request failed: {method} {path}: {e}")
        return None


def run_cmd(cmd, timeout=120):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd="/home/workspace")
    except Exception as e:
        log(f"Command failed: {cmd}: {e}")
        return None


def collect_and_push_context():
    log("collecting context...")
    p = run_cmd(["python3", str(SKILL_DIR / "collect_context.py")])
    if not p or p.returncode != 0:
        log("collect_context failed")
        return False
    try:
        with open(DASHBOARD_DIR / "context.json") as f:
            ctx = json.load(f)
    except Exception as e:
        log(f"read context.json failed: {e}")
        return False
    log("pushing context to cloud...")
    r = http("POST", "/api/context", ctx)
    return r is not None and r.get("ok")


def collect_and_push_suggestions():
    log("generating suggestions...")
    p = run_cmd(["python3", str(SKILL_DIR / "generate_suggestions.py"), "--ai"], timeout=180)
    if not p or p.returncode != 0:
        log("generate_suggestions failed (non-AI fallback)")
        # Try non-AI
        p = run_cmd(["python3", str(SKILL_DIR / "generate_suggestions.py")])
        if not p or p.returncode != 0:
            return False
    try:
        with open(DASHBOARD_DIR / "suggestions.json") as f:
            sug = json.load(f)
    except Exception:
        return False
    log("pushing suggestions to cloud...")
    r = http("POST", "/api/suggestions", sug)
    return r is not None and r.get("ok")


def drain_run_queue():
    log("checking for queued runs...")
    r = http("GET", "/api/queue")
    if not r:
        return
    runs = r.get("runs", [])
    if not runs:
        log("queue empty")
        return
    log(f"draining {len(runs)} queued runs")
    for run in runs:
        execute_run(run)


def execute_run(run):
    """Run an executor locally and PATCH the result back to the cloud."""
    run_id = run.get("id")
    executor = run.get("executor") or {}
    etype = executor.get("type")
    config = executor.get("config") or {}

    log(f"executing {run_id} ({etype})")
    # Mark running
    http("PATCH", f"/api/runs/{run_id}", {"patch": {"status": "running"}})

    try:
        if etype == "ask_zo":
            output = _exec_ask_zo(config.get("prompt") or config.get("question", ""))
            http("PATCH", f"/api/runs/{run_id}", {"patch": {"status": "success", "output": output}})
        elif etype == "run_script":
            output = _exec_script(config)
            http("PATCH", f"/api/runs/{run_id}", {"patch": {"status": "success", "output": output}})
        elif etype == "spawn_agent":
            output = _exec_agent(config.get("task") or config.get("prompt", ""))
            http("PATCH", f"/api/runs/{run_id}", {"patch": {"status": "success", "output": output}})
        else:
            http("PATCH", f"/api/runs/{run_id}", {"patch": {"status": "failed", "error": f"unknown executor: {etype}"}})
    except Exception as e:
        http("PATCH", f"/api/runs/{run_id}", {"patch": {"status": "failed", "error": str(e)}})


def _exec_ask_zo(prompt: str) -> str:
    if not prompt:
        raise ValueError("missing prompt")
    token = os.environ.get("ZO_CLIENT_IDENTITY_TOKEN")
    if not token:
        raise RuntimeError("ZO_CLIENT_IDENTITY_TOKEN not set")
    req = urllib.request.Request(
        "https://api.zo.computer/zo/ask",
        data=json.dumps({"input": prompt}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode()).get("output", "") or "(empty)"


def _exec_script(config: dict) -> str:
    script = config.get("script", "")
    args = config.get("args", [])
    if not script:
        raise ValueError("missing script")
    path = Path("/home/workspace/Skills") / script
    path = path.resolve()
    if not str(path).startswith("/home/workspace/Skills/"):
        raise ValueError("script outside Skills/")
    if path.suffix == ".py":
        cmd = ["python3", str(path)] + list(args)
    elif path.suffix in (".sh", ""):
        cmd = ["bash", str(path)] + list(args)
    elif path.suffix == ".ts":
        cmd = ["bun", str(path)] + list(args)
    else:
        cmd = [str(path)] + list(args)
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=300, cwd="/home/workspace")
    output = p.stdout + (f"\n[stderr]\n{p.stderr}" if p.stderr else "")
    if p.returncode != 0:
        raise RuntimeError(f"script exit {p.returncode}: {output}")
    return output


def _exec_agent(task: str) -> str:
    if not task:
        raise ValueError("missing task")
    p = subprocess.run(["claude", "-p", task], capture_output=True, text=True, timeout=600, cwd="/home/workspace")
    output = p.stdout + (f"\n[stderr]\n{p.stderr}" if p.stderr else "")
    if p.returncode != 0:
        raise RuntimeError(f"agent exit {p.returncode}: {output}")
    return output


def main():
    if not CLOUD_URL:
        log("ZO_DASHBOARD_CLOUD_URL not set; nothing to sync. sleeping forever.")
        while True:
            time.sleep(3600)

    log(f"starting sync worker → {CLOUD_URL} every {SYNC_INTERVAL}s")
    while True:
        try:
            collect_and_push_context()
            collect_and_push_suggestions()
            drain_run_queue()
        except Exception as e:
            log(f"cycle error: {e}")
        time.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    main()
