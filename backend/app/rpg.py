from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

# 16 core technologies tailored to user's full stack
TECHNOLOGIES: list[dict] = [
    {"slug": "neovim", "name": "Neovim", "category": "Dev Tools & Workflow", "color": "#57A143", "icon": "terminal"},
    {"slug": "python", "name": "Python", "category": "Core Languages", "color": "#3776AB", "icon": "code"},
    {"slug": "fastapi", "name": "FastAPI", "category": "Backend & APIs", "color": "#009688", "icon": "zap"},
    {"slug": "bash", "name": "Bash", "category": "Dev Tools & Workflow", "color": "#4EAA25", "icon": "shell"},
    {"slug": "typescript", "name": "TypeScript", "category": "Core Languages", "color": "#3178C6", "icon": "braces"},
    {"slug": "javascript", "name": "JavaScript", "category": "Core Languages", "color": "#F7DF1E", "icon": "file-code"},
    {"slug": "cpp", "name": "C++", "category": "Core Languages", "color": "#00599C", "icon": "cpu"},
    {"slug": "json", "name": "JSON", "category": "Data & Markup", "color": "#F59E0B", "icon": "brackets"},
    {"slug": "xml", "name": "XML", "category": "Data & Markup", "color": "#EA580C", "icon": "code-xml"},
    {"slug": "html", "name": "HTML", "category": "Frontend & Testing", "color": "#E34F26", "icon": "layout"},
    {"slug": "css", "name": "CSS", "category": "Frontend & Testing", "color": "#264DE4", "icon": "palette"},
    {"slug": "sql", "name": "SQL", "category": "Data & Markup", "color": "#336791", "icon": "database"},
    {"slug": "git", "name": "Git", "category": "Dev Tools & Workflow", "color": "#F05032", "icon": "git-branch"},
    {"slug": "react", "name": "React", "category": "Frontend & Testing", "color": "#61DAFB", "icon": "atom"},
    {"slug": "playwright", "name": "Playwright", "category": "Frontend & Testing", "color": "#2EAD33", "icon": "bot"},
    {"slug": "regex", "name": "Regex", "category": "Data & Markup", "color": "#A855F7", "icon": "regex"},
]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utcnow().isoformat()


def xp_to_level(xp: int) -> tuple[int, int, int]:
    """
    Smooth RPG curve: Level L starts at 100 * (L-1)^1.5 XP.
    Returns (level, xp_into_current_level, xp_needed_for_next_level).
    """
    xp = max(0, int(xp))
    level = 1
    while True:
        next_threshold = int(round(100 * (level ** 1.5)))
        if xp < next_threshold:
            curr_threshold = int(round(100 * ((level - 1) ** 1.5)))
            return level, xp - curr_threshold, max(1, next_threshold - curr_threshold)
        level += 1


def tech_xp_to_level(xp: int) -> int:
    xp = max(0, int(xp))
    return max(1, int(math.floor(math.sqrt(xp / 40.0))) + 1)


def compute_mastery_pct(
    completed_activities: int,
    total_activities: int,
    tech_xp: int,
    last_practiced_iso: str | None,
) -> tuple[float, str]:
    """
    Combines curriculum completion (70%) + XP depth (30%) capped at 100%,
    and reports freshness ('fresh', 'warming', 'rusty', 'unstarted').
    """
    if total_activities <= 0 and tech_xp <= 0:
        return 0.0, "unstarted"

    completion_ratio = (completed_activities / total_activities) if total_activities > 0 else 0.0
    xp_ratio = min(1.0, tech_xp / 1000.0)
    raw = min(100.0, round((completion_ratio * 70.0 + xp_ratio * 30.0), 1))
    # Guarantee 100% if all curriculum activities are complete and XP >= 300
    if total_activities > 0 and completed_activities >= total_activities and tech_xp >= 200:
        raw = max(raw, 85.0)

    if not last_practiced_iso:
        return raw, "unstarted" if raw == 0 else "fresh"

    try:
        dt = datetime.fromisoformat(last_practiced_iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        days = (utcnow() - dt).days
    except ValueError:
        days = 0

    if days <= 3:
        freshness = "fresh"
    elif days <= 10:
        freshness = "warming"
    else:
        freshness = "rusty"
    return raw, freshness


def calculate_par_bonus(keystrokes: int | None, par_keystrokes: int | None) -> int:
    if not keystrokes or not par_keystrokes or keystrokes <= 0:
        return 0
    if keystrokes <= par_keystrokes:
        return 20
    if keystrokes <= int(par_keystrokes * 1.35):
        return 10
    return 0


def sm2_next_review(
    passed: bool,
    repetitions: int,
    ease_factor: float,
    interval_days: int,
) -> tuple[int, float, int, str]:
    """SM-2 spaced repetition step for keeping mastery sharp."""
    quality = 5 if passed else 2
    ef = max(1.3, ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
    if not passed:
        reps = 0
        interval = 1
    else:
        reps = repetitions + 1
        if reps == 1:
            interval = 1
        elif reps == 2:
            interval = 4
        else:
            interval = max(1, int(round(interval_days * ef)))
    due = (utcnow() + timedelta(days=interval)).isoformat()
    return reps, round(ef, 3), interval, due


def compute_streak(activity_dates_iso: list[str]) -> int:
    """Compute consecutive-day practice streak up to today or yesterday."""
    days = set()
    for raw in activity_dates_iso:
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            days.add(dt.date())
        except ValueError:
            continue
    if not days:
        return 0
    today = utcnow().date()
    cursor = today if today in days else (today - timedelta(days=1))
    if cursor not in days:
        return 0
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak
