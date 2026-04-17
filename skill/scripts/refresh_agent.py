#!/usr/bin/env python3
"""
Zo Dashboard Refresh Agent

Designed to be called by a scheduled agent to keep dashboard data fresh.
Runs context collection + suggestion generation, optionally with AI enhancement.

Usage:
    python3 refresh_agent.py              # Quick refresh (rules only)
    python3 refresh_agent.py --ai         # Full refresh with AI suggestions
    python3 refresh_agent.py --notify     # Refresh and print summary for SMS/notification

Schedule this as a Zo agent:
    - Every 30 min during active hours: python3 refresh_agent.py
    - Daily morning briefing: python3 refresh_agent.py --ai --notify
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

WORKSPACE = "/home/workspace"
SCRIPTS_DIR = os.path.join(WORKSPACE, "Skills", "zo-dashboard", "scripts")
DASHBOARD_DIR = os.path.join(WORKSPACE, ".zo-dashboard")


def run_script(script_name, extra_args=None):
    args = ["python3", os.path.join(SCRIPTS_DIR, script_name)]
    if extra_args:
        args.extend(extra_args)
    result = subprocess.run(args, capture_output=True, text=True, cwd=WORKSPACE, timeout=120)
    if result.returncode != 0:
        print(f"Error running {script_name}: {result.stderr}", file=sys.stderr)
    return result.returncode == 0


def generate_briefing():
    """Generate a concise briefing from current dashboard data."""
    suggestions_file = os.path.join(DASHBOARD_DIR, "suggestions.json")
    context_file = os.path.join(DASHBOARD_DIR, "context.json")

    lines = []
    lines.append(f"Zo Dashboard Briefing - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append("")

    # Context summary
    if os.path.isfile(context_file):
        with open(context_file) as f:
            ctx = json.load(f)
        sections = ctx.get("sections", {})

        skills = sections.get("skills", [])
        lines.append(f"Skills: {len(skills)} installed")

        jobs = sections.get("jobs", {}).get("summary", {})
        if jobs.get("failed", 0) > 0:
            lines.append(f"Jobs: {jobs['failed']} FAILED, {jobs.get('pending', 0)} pending")
        elif jobs.get("pending", 0) > 0:
            lines.append(f"Jobs: {jobs['pending']} pending")
        else:
            lines.append(f"Jobs: {jobs.get('total', 0)} total, all clear")

        commits = sections.get("activity", {}).get("git_commits", [])
        if commits:
            lines.append(f"Latest commit: {commits[0].get('message', '?')}")

    # Top suggestions
    if os.path.isfile(suggestions_file):
        with open(suggestions_file) as f:
            sug = json.load(f)
        suggestions = sug.get("suggestions", [])
        high = [s for s in suggestions if s.get("priority") == "high"]

        if high:
            lines.append("")
            lines.append(f"High priority ({len(high)}):")
            for s in high[:3]:
                lines.append(f"  - [{s.get('category', '?')}] {s.get('title', '?')}")

        total = len(suggestions)
        if total > len(high):
            lines.append(f"  + {total - len(high)} more suggestions")

    return "\n".join(lines)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Zo Dashboard Refresh Agent")
    parser.add_argument("--ai", action="store_true", help="Include AI-powered suggestions")
    parser.add_argument("--notify", action="store_true", help="Print briefing summary")
    args = parser.parse_args()

    print("Refreshing Zo Dashboard...")

    # Step 1: Collect context
    if not run_script("collect_context.py"):
        print("Context collection failed", file=sys.stderr)
        sys.exit(1)

    # Step 2: Generate suggestions
    extra = ["--ai"] if args.ai else []
    if not run_script("generate_suggestions.py", extra):
        print("Suggestion generation failed", file=sys.stderr)
        sys.exit(1)

    print("Dashboard refreshed successfully")

    # Step 3: Optionally print briefing
    if args.notify:
        briefing = generate_briefing()
        print("")
        print(briefing)


if __name__ == "__main__":
    main()
