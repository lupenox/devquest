from __future__ import annotations

import sqlite3
from typing import Any

from .rpg import compute_streak, iso_now, xp_to_level

RANK_LADDER: list[tuple[int, str]] = [
    (10, "Staff Architect"),
    (9, "Principal Tinkerer"),
    (8, "Kernel Whisperer"),
    (7, "Pipeline Tactician"),
    (6, "Systems Crafter"),
    (5, "Polyglot Ranger"),
    (4, "Test Runner"),
    (3, "Bug Hunter"),
    (2, "Buffer Apprentice"),
    (1, "Modal Initiate"),
]

ACHIEVEMENTS: list[dict[str, Any]] = [
    {
        "slug": "first_quest",
        "name": "First Quest",
        "description": "Complete your first DevQuest activity.",
        "icon": "sparkles",
        "bonus_xp": 25,
        "tech_slug": None,
    },
    {
        "slug": "vim_par_sniper",
        "name": "Vim Par Sniper",
        "description": "Beat Neovim par keystrokes on any coding lab.",
        "icon": "crosshair",
        "bonus_xp": 35,
        "tech_slug": "neovim",
    },
    {
        "slug": "bug_hunter",
        "name": "Bug Hunter",
        "description": "Complete a Debugging (pdb/Bash) lab.",
        "icon": "bug",
        "bonus_xp": 35,
        "tech_slug": "debugging",
    },
    {
        "slug": "polyglot_5",
        "name": "Polyglot V",
        "description": "Earn XP across 5 or more technologies.",
        "icon": "globe",
        "bonus_xp": 40,
        "tech_slug": None,
    },
    {
        "slug": "polyglot_10",
        "name": "Polyglot X",
        "description": "Earn XP across 10 or more technologies.",
        "icon": "crown",
        "bonus_xp": 75,
        "tech_slug": None,
    },
    {
        "slug": "boss_slayer",
        "name": "Boss Slayer",
        "description": "Complete a Boss Project milestone.",
        "icon": "swords",
        "bonus_xp": 50,
        "tech_slug": None,
    },
    {
        "slug": "sprint_combo_3",
        "name": "Flow State 3x",
        "description": "Reach a 3x combo in an AI Training Break Sprint.",
        "icon": "zap",
        "bonus_xp": 30,
        "tech_slug": None,
    },
    {
        "slug": "streak_3",
        "name": "3-Day Streak",
        "description": "Maintain a 3-day consecutive practice streak.",
        "icon": "flame",
        "bonus_xp": 40,
        "tech_slug": None,
    },
    {
        "slug": "github_connected",
        "name": "Repo Defender",
        "description": "Connect GitHub and generate a Repo Interview Study Pack.",
        "icon": "git-branch",
        "bonus_xp": 30,
        "tech_slug": "git",
    },
    {
        "slug": "interview_ready",
        "name": "Interview Ready",
        "description": "Score 80%+ Readiness in a Repo Mock Interview.",
        "icon": "award",
        "bonus_xp": 50,
        "tech_slug": None,
    },
    {
        "slug": "daily_goal_crusher",
        "name": "Daily Goal Crusher",
        "description": "Hit 100% of your daily XP goal.",
        "icon": "target",
        "bonus_xp": 30,
        "tech_slug": None,
    },
    {
        "slug": "level_5_hero",
        "name": "Level 5 Hero",
        "description": "Reach Global Level 5.",
        "icon": "shield",
        "bonus_xp": 75,
        "tech_slug": None,
    },
]

ACHIEVEMENT_BY_SLUG: dict[str, dict[str, Any]] = {a["slug"]: a for a in ACHIEVEMENTS}


def get_rank_title(level: int) -> str:
    lv = max(1, int(level))
    for min_lv, title in RANK_LADDER:
        if lv >= min_lv:
            return title
    return "Modal Initiate"


def _pick_bonus_tech(conn: sqlite3.Connection, preferred: str | None) -> str:
    if preferred:
        row = conn.execute("SELECT slug FROM technologies WHERE slug = ?", (preferred,)).fetchone()
        if row:
            return str(row["slug"])
    recent = conn.execute("SELECT tech_slug FROM xp_ledger ORDER BY id DESC LIMIT 1").fetchone()
    if recent and recent["tech_slug"]:
        return str(recent["tech_slug"])
    return "neovim"


def _award_achievement_xp(conn: sqlite3.Connection, tech_slug: str, amount: int, name: str, now: str) -> None:
    if amount <= 0:
        return
    conn.execute(
        "INSERT INTO xp_ledger (tech_slug, source, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)",
        (tech_slug, "achievement", amount, f"Achievement Unlocked: {name}", now),
    )
    conn.execute(
        "UPDATE technologies SET xp = xp + ?, last_practiced_at = ? WHERE slug = ?",
        (amount, now, tech_slug),
    )


def _check_conditions(conn: sqlite3.Connection) -> dict[str, bool]:
    completions_count = int(conn.execute("SELECT COUNT(*) AS c FROM completions").fetchone()["c"])

    par_count = int(
        conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM completions c
            JOIN activities a ON a.id = c.activity_id
            WHERE c.best_keystrokes IS NOT NULL
              AND a.par_keystrokes IS NOT NULL
              AND c.best_keystrokes <= a.par_keystrokes
            """
        ).fetchone()["c"]
    )

    bug_count = int(
        conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM completions c
            JOIN activities a ON a.id = c.activity_id
            WHERE a.tech_slug = 'debugging'
              AND a.activity_type IN ('nvim_lab', 'pdb_sim', 'boss_checkpoint')
            """
        ).fetchone()["c"]
    )

    techs_with_xp = int(
        conn.execute("SELECT COUNT(*) AS c FROM technologies WHERE xp > 0").fetchone()["c"]
    )

    boss_count = int(
        conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM completions c
            JOIN activities a ON a.id = c.activity_id
            JOIN modules m ON m.id = a.module_id
            WHERE a.activity_type = 'boss_checkpoint' OR m.kind = 'project'
            """
        ).fetchone()["c"]
    )

    sprint_combo_count = int(
        conn.execute("SELECT COUNT(*) AS c FROM sprint_sessions WHERE max_combo >= 3").fetchone()["c"]
    )

    ledger_rows = conn.execute(
        "SELECT created_at, amount FROM xp_ledger ORDER BY created_at DESC LIMIT 500"
    ).fetchall()
    streak_days = compute_streak([r["created_at"] for r in ledger_rows])

    today_prefix = iso_now()[:10]
    today_xp = sum(int(r["amount"]) for r in ledger_rows if str(r["created_at"]).startswith(today_prefix))
    goal_row = conn.execute("SELECT value FROM daily_goals WHERE key = 'daily_xp_target'").fetchone()
    daily_xp_target = int(goal_row["value"]) if goal_row else 100

    total_xp = int(conn.execute("SELECT COALESCE(SUM(amount), 0) AS total FROM xp_ledger").fetchone()["total"])
    level, _, _ = xp_to_level(total_xp)

    repo_pack_count = int(
        conn.execute("SELECT COUNT(*) AS c FROM modules WHERE kind = 'repo_interview'").fetchone()["c"]
    )

    interview_ready_count = int(
        conn.execute(
            "SELECT COUNT(*) AS c FROM mock_interviews WHERE readiness_score >= 80"
        ).fetchone()["c"]
    )

    return {
        "first_quest": completions_count >= 1,
        "vim_par_sniper": par_count >= 1,
        "bug_hunter": bug_count >= 1,
        "polyglot_5": techs_with_xp >= 5,
        "polyglot_10": techs_with_xp >= 10,
        "boss_slayer": boss_count >= 1,
        "sprint_combo_3": sprint_combo_count >= 1,
        "streak_3": streak_days >= 3,
        "github_connected": repo_pack_count >= 1,
        "interview_ready": interview_ready_count >= 1,
        "daily_goal_crusher": daily_xp_target > 0 and today_xp >= daily_xp_target,
        "level_5_hero": level >= 5,
    }


def evaluate_achievements(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Evaluates all 12 achievements idempotently, persists newly unlocked badges, and awards bonus XP."""
    newly_unlocked: list[dict[str, Any]] = []

    # Fixed-point loop (max 3 passes) so bonus XP from an achievement can immediately
    # trigger daily_goal_crusher or level_5_hero in the same transaction.
    for _ in range(3):
        already = {
            str(r["slug"])
            for r in conn.execute("SELECT slug FROM achievements").fetchall()
        }
        conditions = _check_conditions(conn)
        unlocked_this_pass = 0

        for ach in ACHIEVEMENTS:
            slug = ach["slug"]
            if slug in already or not conditions.get(slug, False):
                continue

            now = iso_now()
            cur = conn.execute(
                "INSERT OR IGNORE INTO achievements (slug, unlocked_at) VALUES (?, ?)",
                (slug, now),
            )
            if cur.rowcount != 1:
                continue

            bonus_xp = int(ach["bonus_xp"])
            bonus_tech = _pick_bonus_tech(conn, ach.get("tech_slug"))
            _award_achievement_xp(conn, bonus_tech, bonus_xp, ach["name"], now)

            newly_unlocked.append(
                {
                    "slug": slug,
                    "name": ach["name"],
                    "description": ach["description"],
                    "icon": ach["icon"],
                    "bonus_xp": bonus_xp,
                    "unlocked_at": now,
                }
            )
            unlocked_this_pass += 1

        if unlocked_this_pass == 0:
            break

    return newly_unlocked


def list_achievements(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    unlocked_map = {
        str(r["slug"]): str(r["unlocked_at"])
        for r in conn.execute("SELECT slug, unlocked_at FROM achievements").fetchall()
    }
    return [
        {
            "slug": ach["slug"],
            "name": ach["name"],
            "description": ach["description"],
            "icon": ach["icon"],
            "bonus_xp": int(ach["bonus_xp"]),
            "unlocked": ach["slug"] in unlocked_map,
            "unlocked_at": unlocked_map.get(ach["slug"]),
        }
        for ach in ACHIEVEMENTS
    ]
