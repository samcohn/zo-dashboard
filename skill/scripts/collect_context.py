#!/usr/bin/env python3
"""
Zo Dashboard Context Collector

Scans the entire Zo workspace and aggregates state from all systems
into a single context snapshot. Designed to be discovery-based so it
works for any Zo user, not just the creator.

Usage:
    python3 collect_context.py              # Full collection
    python3 collect_context.py --section skills   # Single section
    python3 collect_context.py --output /path/to/output.json
"""

import json
import os
import sys
import glob
import subprocess
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE = "/home/workspace"
DASHBOARD_DIR = os.path.join(WORKSPACE, ".zo-dashboard")
HISTORY_DIR = os.path.join(DASHBOARD_DIR, "history")
OUTPUT_FILE = os.path.join(DASHBOARD_DIR, "context.json")


def ensure_dirs():
    os.makedirs(DASHBOARD_DIR, exist_ok=True)
    os.makedirs(HISTORY_DIR, exist_ok=True)


def collect_skills():
    """Discover all installed skills and their health status."""
    skills_dir = os.path.join(WORKSPACE, "Skills")
    skills = []

    if not os.path.isdir(skills_dir):
        return skills

    for entry in sorted(os.listdir(skills_dir)):
        skill_path = os.path.join(skills_dir, entry)
        skill_md = os.path.join(skill_path, "SKILL.md")

        if not os.path.isdir(skill_path) or not os.path.isfile(skill_md):
            continue

        skill_info = {
            "name": entry,
            "path": skill_path,
            "has_scripts": os.path.isdir(os.path.join(skill_path, "scripts")),
            "has_references": os.path.isdir(os.path.join(skill_path, "references")),
            "has_assets": os.path.isdir(os.path.join(skill_path, "assets")),
            "last_modified": datetime.fromtimestamp(
                os.path.getmtime(skill_md), tz=timezone.utc
            ).isoformat(),
        }

        # Parse frontmatter for description
        try:
            with open(skill_md, "r") as f:
                content = f.read()
            if content.startswith("---"):
                end = content.index("---", 3)
                frontmatter = content[3:end].strip()
                for line in frontmatter.split("\n"):
                    if line.strip().startswith("description:"):
                        desc = line.split("description:", 1)[1].strip()
                        if desc.startswith("|"):
                            # Multi-line description, grab next few lines
                            idx = frontmatter.index("description:")
                            desc_lines = []
                            for dl in frontmatter[idx:].split("\n")[1:]:
                                if dl.startswith("  "):
                                    desc_lines.append(dl.strip())
                                else:
                                    break
                            desc = " ".join(desc_lines)
                        skill_info["description"] = desc.strip('"').strip("'")
                        break
        except Exception:
            pass

        # Count scripts
        scripts_dir = os.path.join(skill_path, "scripts")
        if os.path.isdir(scripts_dir):
            scripts = [f for f in os.listdir(scripts_dir) if not f.startswith(".")]
            skill_info["scripts"] = scripts
            skill_info["script_count"] = len(scripts)

        skills.append(skill_info)

    return skills


def collect_recent_activity():
    """Get recent git activity and file changes."""
    activity = {"git_commits": [], "recently_modified": []}

    # Recent git commits
    try:
        result = subprocess.run(
            ["git", "log", "--oneline", "--no-decorate", "-20",
             "--format=%H|%s|%ai|%an"],
            capture_output=True, text=True, cwd=WORKSPACE, timeout=10
        )
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                parts = line.split("|", 3)
                if len(parts) == 4:
                    activity["git_commits"].append({
                        "hash": parts[0][:8],
                        "message": parts[1],
                        "date": parts[2],
                        "author": parts[3],
                    })
    except Exception:
        pass

    # Recently modified files (last 24 hours, excluding hidden dirs)
    try:
        result = subprocess.run(
            ["find", WORKSPACE, "-maxdepth", "3", "-type", "f",
             "-mtime", "-1", "-not", "-path", "*/.*",
             "-not", "-path", "*/node_modules/*"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            files = result.stdout.strip().split("\n")
            files = [f for f in files if f][:30]  # Cap at 30
            for f in files:
                try:
                    stat = os.stat(f)
                    activity["recently_modified"].append({
                        "path": os.path.relpath(f, WORKSPACE),
                        "modified": datetime.fromtimestamp(
                            stat.st_mtime, tz=timezone.utc
                        ).isoformat(),
                        "size": stat.st_size,
                    })
                except Exception:
                    pass
    except Exception:
        pass

    return activity


def collect_jobs():
    """Check all job queues for status."""
    jobs = {"queues": {}, "summary": {"total": 0, "pending": 0, "completed": 0, "failed": 0}}

    # GSAP jobs
    gsap_dir = os.path.join(WORKSPACE, ".gsap-jobs")
    if os.path.isdir(gsap_dir):
        gsap_jobs = []
        for jf in sorted(glob.glob(os.path.join(gsap_dir, "*.json"))):
            try:
                with open(jf) as f:
                    job = json.load(f)
                gsap_jobs.append({
                    "id": job.get("id", ""),
                    "name": job.get("name", ""),
                    "status": job.get("status", "unknown"),
                    "created": job.get("createdAt", ""),
                    "source_type": job.get("sourceType", ""),
                })
                status = job.get("status", "")
                jobs["summary"]["total"] += 1
                if status in jobs["summary"]:
                    jobs["summary"][status] += 1
            except Exception:
                pass
        jobs["queues"]["gsap-animations"] = gsap_jobs[-10:]  # Last 10

    # Discover other job directories
    for entry in os.listdir(WORKSPACE):
        if entry.startswith(".") and entry.endswith("-jobs") and entry != ".gsap-jobs":
            queue_dir = os.path.join(WORKSPACE, entry)
            if os.path.isdir(queue_dir):
                queue_jobs = []
                for jf in sorted(glob.glob(os.path.join(queue_dir, "*.json")))[-10:]:
                    try:
                        with open(jf) as f:
                            queue_jobs.append(json.load(f))
                    except Exception:
                        pass
                jobs["queues"][entry.strip(".")] = queue_jobs

    return jobs


def collect_reflections():
    """Get latest self-improvement reflections."""
    reflections_dir = os.path.join(WORKSPACE, "Records", "Reflections")
    reflections = {"latest": None, "count": 0, "history": []}

    if not os.path.isdir(reflections_dir):
        return reflections

    files = sorted(glob.glob(os.path.join(reflections_dir, "*.md")))
    reflections["count"] = len(files)

    for f in files[-5:]:  # Last 5
        name = os.path.basename(f)
        try:
            with open(f) as fh:
                content = fh.read()
            reflections["history"].append({
                "file": name,
                "date": name.replace("-reflection.md", ""),
                "preview": content[:500],
            })
        except Exception:
            pass

    if reflections["history"]:
        reflections["latest"] = reflections["history"][-1]

    return reflections


def collect_memory_profile():
    """Get supermemory profile if available."""
    memory_script = os.path.join(WORKSPACE, "Skills", "supermemory", "scripts", "memory.py")
    profile = {"available": False}

    if not os.path.isfile(memory_script):
        return profile

    profile["available"] = True

    try:
        result = subprocess.run(
            ["python3", memory_script, "profile"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            try:
                profile["data"] = json.loads(result.stdout)
            except json.JSONDecodeError:
                profile["data_raw"] = result.stdout[:2000]
    except Exception as e:
        profile["error"] = str(e)

    return profile


def collect_workspace_overview():
    """High-level workspace stats."""
    overview = {"top_level_dirs": [], "total_files": 0, "total_size_mb": 0}

    try:
        for entry in sorted(os.listdir(WORKSPACE)):
            full = os.path.join(WORKSPACE, entry)
            if entry.startswith("."):
                continue
            if os.path.isdir(full):
                # Count files in dir
                count = 0
                size = 0
                for root, dirs, files in os.walk(full):
                    # Skip hidden dirs and node_modules
                    dirs[:] = [d for d in dirs if not d.startswith(".") and d != "node_modules"]
                    count += len(files)
                    for f in files:
                        try:
                            size += os.path.getsize(os.path.join(root, f))
                        except OSError:
                            pass
                overview["top_level_dirs"].append({
                    "name": entry,
                    "file_count": count,
                    "size_mb": round(size / (1024 * 1024), 2),
                })
                overview["total_files"] += count
                overview["total_size_mb"] += size
            elif os.path.isfile(full):
                overview["total_files"] += 1
    except Exception:
        pass

    overview["total_size_mb"] = round(overview["total_size_mb"] / (1024 * 1024), 2)
    return overview


def collect_automations():
    """Discover scheduled agents and automations."""
    automations = {"scheduled": [], "webhooks": [], "discovered": []}

    # Check for cron-like scheduled agents (scan for patterns in skills)
    for skill_dir in glob.glob(os.path.join(WORKSPACE, "Skills", "*")):
        skill_md = os.path.join(skill_dir, "SKILL.md")
        if not os.path.isfile(skill_md):
            continue
        try:
            with open(skill_md) as f:
                content = f.read().lower()
            if any(kw in content for kw in ["scheduled", "weekly", "daily", "cron", "periodic"]):
                automations["discovered"].append({
                    "skill": os.path.basename(skill_dir),
                    "type": "scheduled",
                    "hint": "Has scheduling-related keywords in SKILL.md",
                })
            if any(kw in content for kw in ["webhook", "sms", "twilio", "http endpoint"]):
                automations["discovered"].append({
                    "skill": os.path.basename(skill_dir),
                    "type": "webhook",
                    "hint": "Has webhook-related keywords in SKILL.md",
                })
        except Exception:
            pass

    return automations


def collect_all(section=None):
    """Run all collectors and merge into a single snapshot."""
    collectors = {
        "skills": collect_skills,
        "activity": collect_recent_activity,
        "jobs": collect_jobs,
        "reflections": collect_reflections,
        "memory": collect_memory_profile,
        "workspace": collect_workspace_overview,
        "automations": collect_automations,
    }

    if section and section in collectors:
        collectors = {section: collectors[section]}

    snapshot = {
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "workspace": WORKSPACE,
        "sections": {},
    }

    for name, collector in collectors.items():
        try:
            snapshot["sections"][name] = collector()
        except Exception as e:
            snapshot["sections"][name] = {"error": str(e)}

    return snapshot


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Zo Dashboard Context Collector")
    parser.add_argument("--section", help="Collect only a specific section")
    parser.add_argument("--output", default=OUTPUT_FILE, help="Output file path")
    parser.add_argument("--stdout", action="store_true", help="Print to stdout instead of file")
    args = parser.parse_args()

    ensure_dirs()
    snapshot = collect_all(section=args.section)

    if args.stdout:
        print(json.dumps(snapshot, indent=2))
    else:
        # Write current snapshot
        with open(args.output, "w") as f:
            json.dump(snapshot, f, indent=2)

        # Save to history
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
        history_file = os.path.join(HISTORY_DIR, f"context_{ts}.json")
        with open(history_file, "w") as f:
            json.dump(snapshot, f, indent=2)

        # Prune history to last 50 snapshots
        history_files = sorted(glob.glob(os.path.join(HISTORY_DIR, "context_*.json")))
        for old in history_files[:-50]:
            os.remove(old)

        print(f"Context snapshot saved to {args.output}")
        print(f"History saved to {history_file}")
        print(f"Sections collected: {list(snapshot['sections'].keys())}")


if __name__ == "__main__":
    main()
