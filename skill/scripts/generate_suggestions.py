#!/usr/bin/env python3
"""
Zo Dashboard Suggestion Engine

Reads the context snapshot and generates personalized, actionable suggestions.
Can run standalone (rule-based) or call /zo/ask for AI-powered analysis.

Usage:
    python3 generate_suggestions.py                    # Rule-based suggestions
    python3 generate_suggestions.py --ai               # AI-enhanced via /zo/ask
    python3 generate_suggestions.py --ai --focus build  # AI with specific focus
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

WORKSPACE = "/home/workspace"
DASHBOARD_DIR = os.path.join(WORKSPACE, ".zo-dashboard")
CONTEXT_FILE = os.path.join(DASHBOARD_DIR, "context.json")
SUGGESTIONS_FILE = os.path.join(DASHBOARD_DIR, "suggestions.json")


def load_context():
    if not os.path.isfile(CONTEXT_FILE):
        print(f"No context file found at {CONTEXT_FILE}. Run collect_context.py first.")
        sys.exit(1)
    with open(CONTEXT_FILE) as f:
        return json.load(f)


def suggest_from_skills(sections):
    """Generate suggestions based on skills state."""
    suggestions = []
    skills = sections.get("skills", [])

    if not skills:
        suggestions.append({
            "category": "build",
            "priority": "high",
            "title": "Install your first skill",
            "description": "Your Zo has no skills installed. Skills extend what Zo can do for you. Try creating one with the skill-creator.",
            "action": "Use the skill-creator to build a skill for something you do repeatedly.",
        })
        return suggestions

    # Check for skills without scripts (might be incomplete)
    for skill in skills:
        if skill.get("script_count", 0) == 0 and skill["name"] not in ["code-degunker"]:
            suggestions.append({
                "category": "build",
                "priority": "medium",
                "title": f"Add automation scripts to '{skill['name']}'",
                "description": f"The {skill['name']} skill has no scripts. Adding scripts makes it more autonomous.",
                "action": f"Review Skills/{skill['name']}/SKILL.md and identify what could be scripted.",
            })

    # Check for stale skills (not modified in 30+ days)
    now = datetime.now(timezone.utc)
    for skill in skills:
        try:
            modified = datetime.fromisoformat(skill["last_modified"])
            age_days = (now - modified).days
            if age_days > 30:
                suggestions.append({
                    "category": "maintain",
                    "priority": "low",
                    "title": f"Review '{skill['name']}' skill ({age_days} days since last update)",
                    "description": f"This skill hasn't been touched in {age_days} days. It may need updating or might be unused.",
                    "action": f"Check if {skill['name']} is still relevant and up to date.",
                })
        except Exception:
            pass

    return suggestions


def suggest_from_jobs(sections):
    """Generate suggestions based on job queue state."""
    suggestions = []
    jobs = sections.get("jobs", {})
    summary = jobs.get("summary", {})

    if summary.get("failed", 0) > 0:
        suggestions.append({
            "category": "act",
            "priority": "high",
            "title": f"{summary['failed']} failed job(s) need attention",
            "description": "You have failed jobs in your queue. These may indicate broken automations or need manual retry.",
            "action": "Check .gsap-jobs/ for failed jobs and investigate the errors.",
        })

    if summary.get("pending", 0) > 0:
        suggestions.append({
            "category": "act",
            "priority": "medium",
            "title": f"{summary['pending']} pending job(s) waiting to process",
            "description": "Jobs are queued but not yet processed. The worker may need to be started.",
            "action": "Run: bun /home/workspace/GsapAnimations/worker.ts",
        })

    if summary.get("total", 0) == 0:
        suggestions.append({
            "category": "explore",
            "priority": "low",
            "title": "No jobs in queue",
            "description": "Your job queue is empty. This could mean everything is processed, or you haven't used job-based workflows yet.",
            "action": "Try submitting an animation to the GSAP Animator to see job processing in action.",
        })

    return suggestions


def suggest_from_activity(sections):
    """Generate suggestions based on recent activity patterns."""
    suggestions = []
    activity = sections.get("activity", {})
    commits = activity.get("git_commits", [])
    recent_files = activity.get("recently_modified", [])

    if not commits:
        suggestions.append({
            "category": "maintain",
            "priority": "medium",
            "title": "No recent git commits",
            "description": "Your workspace has no recent commits. Consider committing your work to track progress.",
            "action": "Review your changes and commit meaningful progress.",
        })

    # Detect if there's lots of activity in one area
    if recent_files:
        dir_counts = {}
        for f in recent_files:
            top_dir = f["path"].split("/")[0] if "/" in f["path"] else "root"
            dir_counts[top_dir] = dir_counts.get(top_dir, 0) + 1

        hot_dirs = [(d, c) for d, c in dir_counts.items() if c >= 3]
        for dir_name, count in hot_dirs:
            suggestions.append({
                "category": "explore",
                "priority": "low",
                "title": f"Active area: {dir_name} ({count} files changed recently)",
                "description": f"You've been working actively in {dir_name}. Consider if there are related improvements to make while you're in flow.",
                "action": f"Review recent changes in {dir_name}/ for coherence.",
            })

    return suggestions


def suggest_from_reflections(sections):
    """Generate suggestions based on self-improvement history."""
    suggestions = []
    reflections = sections.get("reflections", {})

    if reflections.get("count", 0) == 0:
        suggestions.append({
            "category": "maintain",
            "priority": "medium",
            "title": "Run your first self-improvement audit",
            "description": "The self-improvement skill can audit your entire Zo and find gaps, stale skills, and improvement opportunities.",
            "action": "Run: python3 /home/workspace/Skills/self-improvement/scripts/audit.py full",
        })

    return suggestions


def suggest_from_memory(sections):
    """Generate suggestions based on memory profile."""
    suggestions = []
    memory = sections.get("memory", {})

    if not memory.get("available", False):
        suggestions.append({
            "category": "build",
            "priority": "high",
            "title": "Set up Supermemory for persistent context",
            "description": "Supermemory gives your Zo long-term memory across conversations. It's the foundation for personalized suggestions.",
            "action": "Install the supermemory skill and add your API key.",
        })

    return suggestions


def suggest_from_workspace(sections):
    """Generate suggestions based on workspace overview."""
    suggestions = []
    workspace = sections.get("workspace", {})
    dirs = workspace.get("top_level_dirs", [])

    # Find large directories that might need cleanup
    for d in dirs:
        if d.get("size_mb", 0) > 100:
            suggestions.append({
                "category": "maintain",
                "priority": "low",
                "title": f"Large directory: {d['name']} ({d['size_mb']}MB)",
                "description": f"This directory is taking significant space. Consider if all files are still needed.",
                "action": f"Review {d['name']}/ for files that can be archived or removed.",
            })

    # Find directories with no files (potentially abandoned)
    for d in dirs:
        if d.get("file_count", 0) == 0:
            suggestions.append({
                "category": "maintain",
                "priority": "low",
                "title": f"Empty directory: {d['name']}",
                "description": "This directory has no files. It might be an abandoned project or need setup.",
                "action": f"Decide if {d['name']}/ should be removed or populated.",
            })

    return suggestions


def suggest_missing_capabilities(sections):
    """Suggest capabilities the user might want based on what they have."""
    suggestions = []
    skills = sections.get("skills", [])
    skill_names = [s["name"] for s in skills]

    # Common capability suggestions based on what's NOT installed
    capability_gaps = [
        {
            "check": "calendar" not in " ".join(skill_names).lower(),
            "title": "Connect your calendar",
            "description": "A calendar skill lets Zo prep you for meetings, manage scheduling, and connect events to your data.",
        },
        {
            "check": "email" not in " ".join(skill_names).lower() and "gmail" not in " ".join(skill_names).lower(),
            "title": "Connect your email",
            "description": "An email skill lets Zo help draft replies, surface important messages, and automate follow-ups.",
        },
        {
            "check": not any("monitor" in s or "health" in s for s in skill_names),
            "title": "Set up system monitoring",
            "description": "A monitoring skill can watch your Zo services, alert on failures, and track uptime.",
        },
    ]

    for gap in capability_gaps:
        if gap["check"]:
            suggestions.append({
                "category": "build",
                "priority": "low",
                "title": gap["title"],
                "description": gap["description"],
                "action": "Use the skill-creator to build this capability.",
            })

    return suggestions


def generate_ai_suggestions(context, focus=None):
    """Call /zo/ask for AI-powered suggestion generation."""
    import subprocess

    zo_token = os.environ.get("ZO_CLIENT_IDENTITY_TOKEN")
    if not zo_token:
        return [{
            "category": "act",
            "priority": "high",
            "title": "Set ZO_CLIENT_IDENTITY_TOKEN for AI suggestions",
            "description": "AI-powered suggestions need the Zo API token.",
            "action": "Add ZO_CLIENT_IDENTITY_TOKEN to your environment.",
        }]

    # Build a concise summary for the prompt
    skills = context.get("sections", {}).get("skills", [])
    skill_names = [s["name"] for s in skills]
    jobs_summary = context.get("sections", {}).get("jobs", {}).get("summary", {})
    commits = context.get("sections", {}).get("activity", {}).get("git_commits", [])[:5]
    commit_msgs = [c["message"] for c in commits]

    focus_instruction = ""
    if focus:
        focus_instruction = f"\nFocus specifically on '{focus}' suggestions."

    # Build richer context for AI
    recent_files = context.get("sections", {}).get("activity", {}).get("recently_modified", [])[:10]
    recent_file_names = [f.get("path", "") for f in recent_files]
    automations = context.get("sections", {}).get("automations", {}).get("discovered", [])
    auto_names = [a.get("skill", "") for a in automations]
    reflections = context.get("sections", {}).get("reflections", {})
    latest_reflection = reflections.get("latest", {}).get("preview", "")[:300] if reflections.get("latest") else ""

    prompt = f"""You are the intelligence layer of a Zo Computer dashboard. Your job is to look at
the CURRENT state of this workspace and figure out what matters RIGHT NOW.

Think about: what was the user just working on? What's broken? What's ripe to build on?
What connections between systems could unlock new value? What's been neglected that
should be revisited given recent activity?

Current state (captured just now):
- Skills: {', '.join(skill_names) if skill_names else 'none'}
- Automations running: {', '.join(auto_names) if auto_names else 'none'}
- Jobs: {json.dumps(jobs_summary)}
- Recent commits: {json.dumps(commit_msgs)}
- Recently modified files: {json.dumps(recent_file_names[:8])}
- Latest reflection: {latest_reflection[:200] if latest_reflection else 'none yet'}
{focus_instruction}

Generate 3-5 suggestions as a JSON array. Each suggestion:
- category: "act" (urgent/broken) | "build" (create something) | "explore" (investigate/connect) | "maintain" (housekeeping)
- priority: "high" | "medium" | "low"
- title: short, specific, actionable
- description: WHY this matters right now, referencing specific things you see in the data
- action: concrete next step (a command, a file to look at, a question to ask)

Do NOT give generic advice. Every suggestion must reference something specific in the data above.
The dashboard reinvents itself for the present moment — your suggestions should feel like they
could only have been generated RIGHT NOW, not yesterday or tomorrow.
Return ONLY the JSON array, no markdown."""

    try:
        import urllib.request
        req = urllib.request.Request(
            "https://api.zo.computer/zo/ask",
            data=json.dumps({"input": prompt}).encode(),
            headers={
                "Authorization": f"Bearer {zo_token}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            output = result.get("output", "[]")
            # Try to parse the output as JSON
            # Strip markdown code blocks if present
            output = output.strip()
            if output.startswith("```"):
                output = output.split("\n", 1)[1]
                output = output.rsplit("```", 1)[0]
            return json.loads(output)
    except Exception as e:
        return [{
            "category": "act",
            "priority": "medium",
            "title": "AI suggestion generation failed",
            "description": f"Error: {str(e)}",
            "action": "Check your ZO_CLIENT_IDENTITY_TOKEN and network connectivity.",
        }]


def score_suggestion_relevance(suggestion, sections):
    """Score how relevant a suggestion is RIGHT NOW based on recency and connections."""
    import math

    score = 0.0
    title_lower = suggestion.get("title", "").lower()
    desc_lower = suggestion.get("description", "").lower()
    now = datetime.now(timezone.utc)

    # Priority base score
    prio_scores = {"high": 0.4, "medium": 0.2, "low": 0.05}
    score += prio_scores.get(suggestion.get("priority", "low"), 0)

    # Recency boost: does this suggestion relate to recently modified skills?
    for skill in sections.get("skills", []):
        if skill["name"].lower() in title_lower or skill["name"].lower() in desc_lower:
            try:
                modified = datetime.fromisoformat(skill["last_modified"])
                days = (now - modified).total_seconds() / 86400
                score += math.exp(-days / 5) * 0.3  # Recent = big boost
            except Exception:
                pass

    # Connection boost: relates to recent git activity?
    for commit in sections.get("activity", {}).get("git_commits", [])[:5]:
        msg = commit.get("message", "").lower()
        for token in title_lower.split():
            if len(token) > 3 and token in msg:
                score += 0.15
                break

    # Urgency boost: failed jobs, broken things
    if "failed" in title_lower or "broken" in title_lower or "error" in title_lower:
        score += 0.2

    return min(1.0, score)


def generate_all(use_ai=False, focus=None):
    """Generate all suggestions from context, scored for the present moment."""
    context = load_context()
    sections = context.get("sections", {})

    all_suggestions = []

    # Rule-based suggestions
    all_suggestions.extend(suggest_from_skills(sections))
    all_suggestions.extend(suggest_from_jobs(sections))
    all_suggestions.extend(suggest_from_activity(sections))
    all_suggestions.extend(suggest_from_reflections(sections))
    all_suggestions.extend(suggest_from_memory(sections))
    all_suggestions.extend(suggest_from_workspace(sections))
    all_suggestions.extend(suggest_missing_capabilities(sections))

    # AI-powered suggestions
    if use_ai:
        ai_suggestions = generate_ai_suggestions(context, focus=focus)
        for s in ai_suggestions:
            s["source"] = "ai"
        all_suggestions.extend(ai_suggestions)

    # Mark rule-based suggestions
    for s in all_suggestions:
        if "source" not in s:
            s["source"] = "rules"

    # Score each suggestion for present-moment relevance
    for s in all_suggestions:
        s["relevance"] = round(score_suggestion_relevance(s, sections), 3)

    # Sort by relevance (highest first), then by priority as tiebreaker
    priority_order = {"high": 0, "medium": 1, "low": 2}
    all_suggestions.sort(
        key=lambda s: (-s.get("relevance", 0), priority_order.get(s.get("priority", "low"), 3))
    )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "context_collected_at": context.get("collected_at", "unknown"),
        "suggestion_count": len(all_suggestions),
        "suggestions": all_suggestions,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Zo Dashboard Suggestion Engine")
    parser.add_argument("--ai", action="store_true", help="Include AI-powered suggestions via /zo/ask")
    parser.add_argument("--focus", help="Focus area for AI suggestions (act, build, explore, maintain)")
    parser.add_argument("--output", default=SUGGESTIONS_FILE, help="Output file path")
    parser.add_argument("--stdout", action="store_true", help="Print to stdout")
    args = parser.parse_args()

    result = generate_all(use_ai=args.ai, focus=args.focus)

    if args.stdout:
        print(json.dumps(result, indent=2))
    else:
        os.makedirs(DASHBOARD_DIR, exist_ok=True)
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
        print(f"Generated {result['suggestion_count']} suggestions")
        print(f"Saved to {args.output}")

        # Print summary
        by_cat = {}
        for s in result["suggestions"]:
            cat = s.get("category", "other")
            by_cat[cat] = by_cat.get(cat, 0) + 1
        print(f"Categories: {json.dumps(by_cat)}")


if __name__ == "__main__":
    main()
