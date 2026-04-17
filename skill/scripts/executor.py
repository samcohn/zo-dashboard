"""
Executor: runs a single Run record to completion, writing output/error back
into the run's JSON file as it progresses.

Designed to be invoked as a subprocess (detached via `nohup` or forked by
the server) so the web request returns immediately and the UI can poll.

Executor types:
  ask_zo       — synchronous HTTP to /zo/ask. Fast (<10s).
  run_script   — run a script from /home/workspace/Skills/. Output captured.
  spawn_agent  — spawn `claude -p <task>` subprocess. Long-running.
  manual       — no-op (user does it themselves).

Safety:
  - run_script paths must be inside /home/workspace/Skills/ (prevents shell
    injection and arbitrary filesystem access)
  - All subprocesses get a hard timeout (default 300s, configurable)
  - Output is truncated by runs_store to MAX_OUTPUT_CHARS
"""

import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

# Add skill scripts dir to path so we can import runs_store
sys.path.insert(0, str(Path(__file__).parent))

from runs_store import get_run, update_run  # noqa: E402

WORKSPACE = Path("/home/workspace")
SKILLS_DIR = WORKSPACE / "Skills"
DEFAULT_TIMEOUT = 300  # 5 minutes


def _mark_running(run_id: str):
    update_run(run_id, {"status": "running", "pid": os.getpid()})


def _mark_success(run_id: str, output: str):
    update_run(run_id, {"status": "success", "output": output})


def _mark_failed(run_id: str, error: str, output: str = ""):
    update_run(run_id, {"status": "failed", "error": error, "output": output})


# ─── Executor implementations ───────────────────────────────────────────────


def execute_ask_zo(run_id: str, config: dict):
    prompt = config.get("prompt") or config.get("question")
    if not prompt:
        _mark_failed(run_id, "Missing 'prompt' in executor config")
        return

    token = os.environ.get("ZO_CLIENT_IDENTITY_TOKEN")
    if not token:
        _mark_failed(run_id, "ZO_CLIENT_IDENTITY_TOKEN not set")
        return

    _mark_running(run_id)

    req = urllib.request.Request(
        "https://api.zo.computer/zo/ask",
        data=json.dumps({"input": prompt}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as resp:
            body = resp.read().decode()
            data = json.loads(body)
            output = data.get("output", "") or "(empty response)"
            _mark_success(run_id, output)
    except Exception as e:
        _mark_failed(run_id, f"ask_zo error: {e}")


def execute_run_script(run_id: str, config: dict):
    script = config.get("script")
    args = config.get("args", [])
    timeout = int(config.get("timeout", DEFAULT_TIMEOUT))

    if not script:
        _mark_failed(run_id, "Missing 'script' in executor config")
        return

    # Resolve within Skills/ — prevents path traversal
    try:
        abs_path = (SKILLS_DIR / script).resolve()
        if not str(abs_path).startswith(str(SKILLS_DIR.resolve())):
            _mark_failed(run_id, f"Script path must be inside {SKILLS_DIR}")
            return
        if not abs_path.exists():
            _mark_failed(run_id, f"Script not found: {script}")
            return
    except Exception as e:
        _mark_failed(run_id, f"Invalid script path: {e}")
        return

    # Pick interpreter from extension
    if abs_path.suffix == ".py":
        cmd = ["python3", str(abs_path)] + list(args)
    elif abs_path.suffix in (".sh", ""):
        cmd = ["bash", str(abs_path)] + list(args)
    elif abs_path.suffix == ".ts":
        cmd = ["bun", str(abs_path)] + list(args)
    else:
        cmd = [str(abs_path)] + list(args)

    _mark_running(run_id)

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(WORKSPACE),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = proc.stdout or ""
        if proc.stderr:
            output += f"\n[stderr]\n{proc.stderr}"
        if proc.returncode == 0:
            _mark_success(run_id, output)
        else:
            _mark_failed(
                run_id,
                f"Script exited with code {proc.returncode}",
                output,
            )
    except subprocess.TimeoutExpired:
        _mark_failed(run_id, f"Script timed out after {timeout}s")
    except Exception as e:
        _mark_failed(run_id, f"Script error: {e}")


def execute_spawn_agent(run_id: str, config: dict):
    """Spawn a Claude subprocess to work on a task autonomously."""
    task = config.get("task") or config.get("prompt")
    timeout = int(config.get("timeout", DEFAULT_TIMEOUT))

    if not task:
        _mark_failed(run_id, "Missing 'task' in executor config")
        return

    _mark_running(run_id)

    # `claude -p` runs non-interactively with the prompt
    cmd = ["claude", "-p", task]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(WORKSPACE),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = proc.stdout or ""
        if proc.stderr:
            output += f"\n[stderr]\n{proc.stderr}"
        if proc.returncode == 0:
            _mark_success(run_id, output)
        else:
            _mark_failed(
                run_id,
                f"Agent exited with code {proc.returncode}",
                output,
            )
    except subprocess.TimeoutExpired:
        _mark_failed(run_id, f"Agent timed out after {timeout}s")
    except FileNotFoundError:
        _mark_failed(run_id, "claude CLI not found on PATH")
    except Exception as e:
        _mark_failed(run_id, f"Agent error: {e}")


EXECUTORS = {
    "ask_zo": execute_ask_zo,
    "run_script": execute_run_script,
    "spawn_agent": execute_spawn_agent,
}


def execute(run_id: str):
    run = get_run(run_id)
    if not run:
        return
    if run.get("status") not in ("pending", "running"):
        return  # already done

    executor = run.get("executor") or {}
    etype = executor.get("type")
    config = executor.get("config", {})

    fn = EXECUTORS.get(etype)
    if not fn:
        _mark_failed(run_id, f"Unknown executor type: {etype}")
        return

    try:
        fn(run_id, config)
    except Exception as e:
        _mark_failed(run_id, f"Executor crashed: {e}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: executor.py <run_id>", file=sys.stderr)
        sys.exit(1)
    execute(sys.argv[1])
