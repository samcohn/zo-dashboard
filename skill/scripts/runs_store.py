"""
Runs state store.

Each executor invocation (ask_zo, run_script, spawn_agent) creates a Run
record persisted as `.zo-dashboard/runs/run_<id>.json`. Metadata only
lives in these files — project step rows reference them by id.

Kept separate from projects.json so that (a) run output never bloats
project records and (b) the UI can poll a single run without pulling
the whole project graph.
"""

import json
import os
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

STATE_DIR = Path("/home/workspace/.zo-dashboard/state")
RUNS_DIR = STATE_DIR / "runs"
INDEX_FILE = STATE_DIR / "runs_index.json"

RunStatus = Literal["pending", "running", "success", "failed"]
ExecutorType = Literal["ask_zo", "run_script", "spawn_agent", "manual"]

VALID_STATUSES = {"pending", "running", "success", "failed"}
VALID_EXECUTORS = {"ask_zo", "run_script", "spawn_agent", "manual"}

# Cap output so a runaway agent can't blow up disk or UI
MAX_OUTPUT_CHARS = 50_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id() -> str:
    return f"run_{secrets.token_urlsafe(10)}"


def _ensure_dirs():
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


def _run_path(run_id: str) -> Path:
    return RUNS_DIR / f"{run_id}.json"


def _write_atomic(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=path.parent, delete=False, suffix=".tmp"
    ) as f:
        json.dump(data, f, indent=2)
        tmp = f.name
    os.replace(tmp, path)


def _read_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        with path.open() as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _read_index() -> dict:
    """Returns {project_id: {step_id: [run_id, ...]}} mapping."""
    data = _read_json(INDEX_FILE)
    if not isinstance(data, dict):
        return {}
    return data


def _write_index(index: dict):
    _write_atomic(INDEX_FILE, index)


def _index_insert(index: dict, project_id: str, step_id: str, run_id: str):
    proj = index.setdefault(project_id, {})
    lst = proj.setdefault(step_id, [])
    if run_id not in lst:
        lst.append(run_id)


# ─── Public API ─────────────────────────────────────────────────────────────


def create_run(
    project_id: str,
    step_id: str,
    executor_type: str,
    executor_config: dict,
) -> dict:
    if executor_type not in VALID_EXECUTORS:
        raise ValueError(f"Unknown executor type: {executor_type}")

    _ensure_dirs()
    run_id = _new_id()
    now = _now()
    run = {
        "id": run_id,
        "project_id": project_id,
        "step_id": step_id,
        "executor": {"type": executor_type, "config": executor_config or {}},
        "status": "pending",
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "output": None,
        "error": None,
        "pid": None,
    }
    _write_atomic(_run_path(run_id), run)

    index = _read_index()
    _index_insert(index, project_id, step_id, run_id)
    _write_index(index)

    return run


def get_run(run_id: str) -> Optional[dict]:
    return _read_json(_run_path(run_id))


def update_run(run_id: str, patch: dict) -> Optional[dict]:
    run = get_run(run_id)
    if not run:
        return None

    if "status" in patch and patch["status"] in VALID_STATUSES:
        run["status"] = patch["status"]
        if patch["status"] == "running" and not run.get("started_at"):
            run["started_at"] = _now()
        if patch["status"] in ("success", "failed") and not run.get("completed_at"):
            run["completed_at"] = _now()

    if "output" in patch:
        out = patch["output"]
        if out is None:
            run["output"] = None
        else:
            s = str(out)
            if len(s) > MAX_OUTPUT_CHARS:
                s = s[:MAX_OUTPUT_CHARS] + "\n…[truncated]"
            run["output"] = s

    if "error" in patch:
        run["error"] = str(patch["error"]) if patch["error"] else None

    if "pid" in patch:
        run["pid"] = patch["pid"]

    _write_atomic(_run_path(run_id), run)
    return run


def list_runs_for_step(project_id: str, step_id: str) -> list[dict]:
    index = _read_index()
    run_ids = index.get(project_id, {}).get(step_id, [])
    runs = [get_run(rid) for rid in run_ids]
    return [r for r in runs if r is not None][::-1]  # newest first


def latest_run_for_step(project_id: str, step_id: str) -> Optional[dict]:
    runs = list_runs_for_step(project_id, step_id)
    return runs[0] if runs else None


def list_active_runs() -> list[dict]:
    """All runs currently pending or running."""
    if not RUNS_DIR.exists():
        return []
    active = []
    for p in RUNS_DIR.glob("run_*.json"):
        r = _read_json(p)
        if r and r.get("status") in ("pending", "running"):
            active.append(r)
    active.sort(key=lambda r: r.get("created_at", ""))
    return active


# ─── CLI ────────────────────────────────────────────────────────────────────


def _cli():
    import sys

    try:
        raw = sys.stdin.read()
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    op = req.get("op")
    try:
        if op == "create":
            r = create_run(
                project_id=req["project_id"],
                step_id=req["step_id"],
                executor_type=req["executor_type"],
                executor_config=req.get("executor_config", {}),
            )
            result = {"run": r}
        elif op == "get":
            r = get_run(req["run_id"])
            result = {"run": r} if r else {"error": "Not found"}
        elif op == "update":
            r = update_run(req["run_id"], req.get("patch", {}))
            result = {"run": r} if r else {"error": "Not found"}
        elif op == "list_for_step":
            result = {"runs": list_runs_for_step(req["project_id"], req["step_id"])}
        elif op == "latest_for_step":
            r = latest_run_for_step(req["project_id"], req["step_id"])
            result = {"run": r}
        elif op == "active":
            result = {"runs": list_active_runs()}
        else:
            result = {"error": f"Unknown op: {op}"}
    except (KeyError, ValueError) as e:
        result = {"error": str(e)}

    print(json.dumps(result))


if __name__ == "__main__":
    _cli()
