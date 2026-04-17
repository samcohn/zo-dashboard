"""
Projects state store.

Persistent, atomic storage for dashboard projects. Schema-versioned for
future migrations. All writes are atomic (temp + rename) to prevent
partial-write corruption. All reads are tolerant of missing/malformed state
— they return an empty store rather than raising.
"""

import json
import os
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

SCHEMA_VERSION = 1

STATE_DIR = Path("/home/workspace/.zo-dashboard/state")
PROJECTS_FILE = STATE_DIR / "projects.json"

StepStatus = Literal["pending", "in_progress", "done", "blocked"]
ProjectStatus = Literal["active", "paused", "done", "archived"]

VALID_STEP_STATUSES = {"pending", "in_progress", "done", "blocked"}
VALID_PROJECT_STATUSES = {"active", "paused", "done", "archived"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(8)}"


def _ensure_dir():
    STATE_DIR.mkdir(parents=True, exist_ok=True)


def _empty_store() -> dict:
    return {"version": SCHEMA_VERSION, "projects": []}


def _read_raw() -> dict:
    """Read the file. Returns an empty store if file doesn't exist or is malformed."""
    if not PROJECTS_FILE.exists():
        return _empty_store()
    try:
        with PROJECTS_FILE.open("r") as f:
            data = json.load(f)
        if not isinstance(data, dict) or "projects" not in data:
            return _empty_store()
        # Future: run migrations here if data.get("version") < SCHEMA_VERSION
        return data
    except (json.JSONDecodeError, OSError):
        return _empty_store()


def _write_raw(data: dict):
    """Atomic write: temp file + rename."""
    _ensure_dir()
    with tempfile.NamedTemporaryFile(
        "w", dir=STATE_DIR, delete=False, suffix=".tmp"
    ) as f:
        json.dump(data, f, indent=2)
        tmp_path = f.name
    os.replace(tmp_path, PROJECTS_FILE)


# ─── Public API ─────────────────────────────────────────────────────────────


def list_projects(include_archived: bool = False) -> list[dict]:
    data = _read_raw()
    projects = data["projects"]
    if not include_archived:
        projects = [p for p in projects if p.get("status") != "archived"]
    # Sort by last_touched_at desc, then created_at desc
    projects.sort(
        key=lambda p: (p.get("last_touched_at", ""), p.get("created_at", "")),
        reverse=True,
    )
    return projects


def get_project(project_id: str) -> Optional[dict]:
    data = _read_raw()
    for p in data["projects"]:
        if p["id"] == project_id:
            return p
    return None


def create_project(
    title: str,
    goal: str,
    plan_steps: Optional[list[dict]] = None,
    linked_node_ids: Optional[list[str]] = None,
    ai_generated: bool = False,
) -> dict:
    if not title or not title.strip():
        raise ValueError("title is required")
    if not goal or not goal.strip():
        raise ValueError("goal is required")

    now = _now()
    project = {
        "id": _new_id("proj"),
        "title": title.strip(),
        "goal": goal.strip(),
        "plan": _normalize_steps(plan_steps or []),
        "linked_node_ids": list(linked_node_ids or []),
        "status": "active",
        "created_at": now,
        "updated_at": now,
        "last_touched_at": now,
        "ai_generated": bool(ai_generated),
    }

    data = _read_raw()
    data["projects"].append(project)
    _write_raw(data)
    return project


def update_project(project_id: str, patch: dict) -> Optional[dict]:
    """Update mutable fields. Returns updated project or None if not found."""
    data = _read_raw()
    for p in data["projects"]:
        if p["id"] != project_id:
            continue

        if "title" in patch and patch["title"]:
            p["title"] = str(patch["title"]).strip()
        if "goal" in patch and patch["goal"]:
            p["goal"] = str(patch["goal"]).strip()
        if "status" in patch and patch["status"] in VALID_PROJECT_STATUSES:
            p["status"] = patch["status"]
        if "linked_node_ids" in patch and isinstance(patch["linked_node_ids"], list):
            p["linked_node_ids"] = list(patch["linked_node_ids"])
        if "plan" in patch and isinstance(patch["plan"], list):
            p["plan"] = _normalize_steps(patch["plan"])

        p["updated_at"] = _now()
        p["last_touched_at"] = p["updated_at"]
        _write_raw(data)
        return p
    return None


def update_step(
    project_id: str, step_id: str, patch: dict
) -> Optional[dict]:
    """Update a single plan step. Returns updated project."""
    data = _read_raw()
    for p in data["projects"]:
        if p["id"] != project_id:
            continue
        for step in p["plan"]:
            if step["id"] != step_id:
                continue
            if "status" in patch and patch["status"] in VALID_STEP_STATUSES:
                step["status"] = patch["status"]
                if patch["status"] == "done":
                    step["completed_at"] = _now()
                elif "completed_at" in step:
                    del step["completed_at"]
            if "label" in patch and patch["label"]:
                step["label"] = str(patch["label"]).strip()
            if "notes" in patch:
                step["notes"] = str(patch["notes"]) if patch["notes"] else None

            # Auto-advance project status: if all steps done, mark project done
            if p["plan"] and all(s["status"] == "done" for s in p["plan"]):
                p["status"] = "done"

            p["updated_at"] = _now()
            p["last_touched_at"] = p["updated_at"]
            _write_raw(data)
            return p
    return None


def archive_project(project_id: str) -> Optional[dict]:
    return update_project(project_id, {"status": "archived"})


def link_node(project_id: str, node_id: str) -> Optional[dict]:
    data = _read_raw()
    for p in data["projects"]:
        if p["id"] != project_id:
            continue
        if node_id not in p["linked_node_ids"]:
            p["linked_node_ids"].append(node_id)
            p["updated_at"] = _now()
            p["last_touched_at"] = p["updated_at"]
            _write_raw(data)
        return p
    return None


def unlink_node(project_id: str, node_id: str) -> Optional[dict]:
    data = _read_raw()
    for p in data["projects"]:
        if p["id"] != project_id:
            continue
        if node_id in p["linked_node_ids"]:
            p["linked_node_ids"].remove(node_id)
            p["updated_at"] = _now()
            p["last_touched_at"] = p["updated_at"]
            _write_raw(data)
        return p
    return None


# ─── Internal helpers ───────────────────────────────────────────────────────


VALID_EXECUTORS = {"ask_zo", "run_script", "spawn_agent", "manual"}


def _normalize_executor(ex: Any) -> Optional[dict]:
    """Validate an executor spec. Returns None if invalid or absent."""
    if not isinstance(ex, dict):
        return None
    etype = ex.get("type")
    if etype not in VALID_EXECUTORS:
        return None
    if etype == "manual":
        return None  # treat as no executor
    config = ex.get("config") if isinstance(ex.get("config"), dict) else {}
    return {"type": etype, "config": config}


def _normalize_steps(steps: list[Any]) -> list[dict]:
    """Normalize incoming step data. Assigns IDs, validates status, trims strings."""
    normalized = []
    for s in steps:
        if isinstance(s, str):
            normalized.append(
                {
                    "id": _new_id("step"),
                    "label": s.strip(),
                    "status": "pending",
                }
            )
        elif isinstance(s, dict):
            step = {
                "id": s.get("id") or _new_id("step"),
                "label": str(s.get("label", "")).strip(),
                "status": s.get("status") if s.get("status") in VALID_STEP_STATUSES else "pending",
            }
            if s.get("notes"):
                step["notes"] = str(s["notes"])
            if s.get("completed_at"):
                step["completed_at"] = s["completed_at"]
            if s.get("last_run_id"):
                step["last_run_id"] = str(s["last_run_id"])
            executor = _normalize_executor(s.get("executor"))
            if executor:
                step["executor"] = executor
            if step["label"]:
                normalized.append(step)
    return normalized


def set_step_last_run(project_id: str, step_id: str, run_id: str) -> Optional[dict]:
    """Mark the most recent run for a step. Called by server after dispatching a run."""
    data = _read_raw()
    for p in data["projects"]:
        if p["id"] != project_id:
            continue
        for step in p["plan"]:
            if step["id"] == step_id:
                step["last_run_id"] = run_id
                p["updated_at"] = _now()
                p["last_touched_at"] = p["updated_at"]
                _write_raw(data)
                return p
    return None


def _cli():
    """
    JSON-in/JSON-out CLI for the Bun server to shell into.
    Reads a JSON command from stdin, writes a JSON response to stdout.

    Commands:
      {"op": "list"}
      {"op": "get", "id": "..."}
      {"op": "create", "title": "...", "goal": "...", "plan_steps": [...], "ai_generated": bool}
      {"op": "update", "id": "...", "patch": {...}}
      {"op": "update_step", "id": "...", "step_id": "...", "patch": {...}}
      {"op": "archive", "id": "..."}
      {"op": "link_node", "id": "...", "node_id": "..."}
      {"op": "unlink_node", "id": "...", "node_id": "..."}
    """
    import sys

    try:
        raw = sys.stdin.read()
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    op = req.get("op")
    try:
        if op == "list":
            result = {
                "projects": list_projects(
                    include_archived=bool(req.get("include_archived"))
                )
            }
        elif op == "get":
            p = get_project(req["id"])
            result = {"project": p} if p else {"error": "Not found"}
        elif op == "create":
            p = create_project(
                title=req["title"],
                goal=req["goal"],
                plan_steps=req.get("plan_steps"),
                linked_node_ids=req.get("linked_node_ids"),
                ai_generated=req.get("ai_generated", False),
            )
            result = {"project": p}
        elif op == "update":
            p = update_project(req["id"], req.get("patch", {}))
            result = {"project": p} if p else {"error": "Not found"}
        elif op == "update_step":
            p = update_step(req["id"], req["step_id"], req.get("patch", {}))
            result = {"project": p} if p else {"error": "Not found"}
        elif op == "archive":
            p = archive_project(req["id"])
            result = {"project": p} if p else {"error": "Not found"}
        elif op == "link_node":
            p = link_node(req["id"], req["node_id"])
            result = {"project": p} if p else {"error": "Not found"}
        elif op == "unlink_node":
            p = unlink_node(req["id"], req["node_id"])
            result = {"project": p} if p else {"error": "Not found"}
        elif op == "set_step_last_run":
            p = set_step_last_run(req["id"], req["step_id"], req["run_id"])
            result = {"project": p} if p else {"error": "Not found"}
        else:
            result = {"error": f"Unknown op: {op}"}
    except (KeyError, ValueError) as e:
        result = {"error": str(e)}

    print(json.dumps(result))


if __name__ == "__main__":
    import sys

    # Legacy debug commands
    if len(sys.argv) > 1 and sys.argv[1] == "list":
        print(json.dumps(list_projects(include_archived=True), indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] == "seed":
        p = create_project(
            title="Ship zo-dashboard v1",
            goal="Get the projects layer production-ready and deployed",
            plan_steps=[
                "Design data model",
                "Build atomic storage",
                "Add API endpoints",
                "Build UI panel",
                "Deploy to zo.space",
            ],
        )
        print(json.dumps(p, indent=2))
    else:
        # Default: JSON stdin/stdout CLI for server integration
        _cli()
