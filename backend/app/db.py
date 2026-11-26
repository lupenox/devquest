from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from . import config
from .achievements import get_rank_title, list_achievements
from .rpg import TECHNOLOGIES, compute_mastery_pct, compute_streak, iso_now, tech_xp_to_level, xp_to_level

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS technologies (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    last_practiced_at TEXT
);

CREATE TABLE IF NOT EXISTS modules (
    id TEXT PRIMARY KEY,
    tech_slug TEXT NOT NULL REFERENCES technologies(slug),
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL DEFAULT 'beginner',
    kind TEXT NOT NULL DEFAULT 'zybooks',
    estimated_minutes INTEGER NOT NULL DEFAULT 5,
    order_index INTEGER NOT NULL DEFAULT 0,
    prereq_module_id TEXT,
    source TEXT NOT NULL DEFAULT 'builtin',
    content_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    tech_slug TEXT NOT NULL REFERENCES technologies(slug),
    title TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    grader_type TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    xp_reward INTEGER NOT NULL DEFAULT 25,
    par_keystrokes INTEGER,
    spec_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS completions (
    activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
    first_passed_at TEXT NOT NULL,
    last_passed_at TEXT NOT NULL,
    best_keystrokes INTEGER,
    attempts_count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    passed INTEGER NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    keystrokes INTEGER,
    output_log TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS xp_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tech_slug TEXT NOT NULL REFERENCES technologies(slug),
    source TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS srs_cards (
    activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
    repetitions INTEGER NOT NULL DEFAULT 0,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 1,
    due_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_profiles (
    provider TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    last_synced_at TEXT,
    last_count INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS daily_goals (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS achievements (
    slug TEXT PRIMARY KEY,
    unlocked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sprint_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duration_minutes INTEGER NOT NULL,
    completed_count INTEGER NOT NULL,
    max_combo INTEGER NOT NULL,
    bonus_xp INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_full_name TEXT NOT NULL,
    module_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    readiness_score REAL NOT NULL DEFAULT 0,
    transcript_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def ensure_dirs() -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    config.WORKSPACES_DIR.mkdir(parents=True, exist_ok=True)
    (config.CURRICULUM_DIR / "generated").mkdir(parents=True, exist_ok=True)


@contextmanager
def get_conn(db_path: Path | None = None) -> Iterator[sqlite3.Connection]:
    path = db_path or config.DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: Path | None = None, curriculum_dir: Path | None = None) -> None:
    ensure_dirs()
    with get_conn(db_path) as conn:
        conn.executescript(SCHEMA_SQL)
        for tech in TECHNOLOGIES:
            conn.execute(
                """
                INSERT OR IGNORE INTO technologies (slug, name, category, color, icon)
                VALUES (?, ?, ?, ?, ?)
                """,
                (tech["slug"], tech["name"], tech["category"], tech["color"], tech["icon"]),
            )
        conn.execute(
            "INSERT OR IGNORE INTO daily_goals (key, value) VALUES ('daily_xp_target', '100')"
        )
    load_curriculum_files(db_path=db_path, curriculum_dir=curriculum_dir)


def upsert_module_pack(conn: sqlite3.Connection, mod: dict[str, Any], source: str = "builtin") -> None:
    now = iso_now()
    content_payload = {
        "sections": mod.get("sections", []),
        "summary": mod.get("summary", ""),
        "tags": mod.get("tags", []),
        "external_resources": mod.get("external_resources", []),
    }
    conn.execute(
        """
        INSERT INTO modules (
            id, tech_slug, title, subtitle, difficulty, kind,
            estimated_minutes, order_index, prereq_module_id, source, content_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            tech_slug=excluded.tech_slug,
            title=excluded.title,
            subtitle=excluded.subtitle,
            difficulty=excluded.difficulty,
            kind=excluded.kind,
            estimated_minutes=excluded.estimated_minutes,
            order_index=excluded.order_index,
            prereq_module_id=excluded.prereq_module_id,
            content_json=excluded.content_json
        """,
        (
            mod["id"],
            mod["tech_slug"],
            mod["title"],
            mod.get("subtitle", ""),
            mod.get("difficulty", "beginner"),
            mod.get("kind", "zybooks"),
            int(mod.get("estimated_minutes", 5)),
            int(mod.get("order_index", 0)),
            mod.get("prereq_module_id"),
            source,
            json.dumps(content_payload),
            now,
        ),
    )

    for idx, act in enumerate(mod.get("activities", [])):
        conn.execute(
            """
            INSERT INTO activities (
                id, module_id, tech_slug, title, activity_type,
                grader_type, order_index, xp_reward, par_keystrokes, spec_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                module_id=excluded.module_id,
                tech_slug=excluded.tech_slug,
                title=excluded.title,
                activity_type=excluded.activity_type,
                grader_type=excluded.grader_type,
                order_index=excluded.order_index,
                xp_reward=excluded.xp_reward,
                par_keystrokes=excluded.par_keystrokes,
                spec_json=excluded.spec_json
            """,
            (
                act["id"],
                mod["id"],
                act.get("tech_slug", mod["tech_slug"]),
                act["title"],
                act["activity_type"],
                act["grader_type"],
                int(act.get("order_index", idx)),
                int(act.get("xp_reward", 25)),
                act.get("par_keystrokes"),
                json.dumps(act.get("spec", {})),
            ),
        )


def load_curriculum_files(db_path: Path | None = None, curriculum_dir: Path | None = None) -> int:
    cdir = curriculum_dir or config.CURRICULUM_DIR
    if not cdir.exists():
        return 0
    loaded = 0
    with get_conn(db_path) as conn:
        for path in sorted(cdir.rglob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            source = "generated" if "generated" in path.parts else "builtin"
            modules = data.get("modules") if isinstance(data, dict) else (data if isinstance(data, list) else [])
            if isinstance(data, dict) and "id" in data and "tech_slug" in data:
                modules = [data]
            for mod in modules:
                if isinstance(mod, dict) and "id" in mod and "tech_slug" in mod:
                    upsert_module_pack(conn, mod, source=source)
                    loaded += 1
    return loaded


def award_xp(
    conn: sqlite3.Connection,
    tech_slug: str,
    amount: int,
    source: str,
    reason: str,
) -> None:
    if amount <= 0:
        return
    now = iso_now()
    conn.execute(
        "INSERT INTO xp_ledger (tech_slug, source, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)",
        (tech_slug, source, amount, reason, now),
    )
    conn.execute(
        "UPDATE technologies SET xp = xp + ?, last_practiced_at = ? WHERE slug = ?",
        (amount, now, tech_slug),
    )


def get_dashboard_data(conn: sqlite3.Connection) -> dict[str, Any]:
    total_xp_row = conn.execute("SELECT COALESCE(SUM(amount), 0) AS total FROM xp_ledger").fetchone()
    total_xp = int(total_xp_row["total"])
    level, xp_in_level, xp_for_next = xp_to_level(total_xp)

    # Streak & today XP
    ledger_rows = conn.execute(
        "SELECT created_at, amount FROM xp_ledger ORDER BY created_at DESC LIMIT 500"
    ).fetchall()
    streak_days = compute_streak([r["created_at"] for r in ledger_rows])
    today_prefix = iso_now()[:10]
    today_xp = sum(int(r["amount"]) for r in ledger_rows if r["created_at"].startswith(today_prefix))

    goal_row = conn.execute("SELECT value FROM daily_goals WHERE key = 'daily_xp_target'").fetchone()
    daily_xp_target = int(goal_row["value"]) if goal_row else 100

    # 14-day XP heatmap
    daily_totals: dict[str, int] = {}
    for r in ledger_rows:
        day = r["created_at"][:10]
        daily_totals[day] = daily_totals.get(day, 0) + int(r["amount"])

    # Per-tech counts
    act_totals = {
        r["tech_slug"]: int(r["cnt"])
        for r in conn.execute("SELECT tech_slug, COUNT(*) AS cnt FROM activities GROUP BY tech_slug").fetchall()
    }
    act_done = {
        r["tech_slug"]: int(r["cnt"])
        for r in conn.execute(
            """
            SELECT a.tech_slug, COUNT(*) AS cnt
            FROM completions c
            JOIN activities a ON a.id = c.activity_id
            GROUP BY a.tech_slug
            """
        ).fetchall()
    }

    tech_rows = conn.execute("SELECT * FROM technologies ORDER BY category, name").fetchall()
    technologies = []
    for t in tech_rows:
        slug = t["slug"]
        total_a = act_totals.get(slug, 0)
        done_a = act_done.get(slug, 0)
        xp = int(t["xp"])
        mastery_pct, freshness = compute_mastery_pct(done_a, total_a, xp, t["last_practiced_at"])
        technologies.append(
            {
                "slug": slug,
                "name": t["name"],
                "category": t["category"],
                "color": t["color"],
                "icon": t["icon"],
                "xp": xp,
                "level": tech_xp_to_level(xp),
                "completed_activities": done_a,
                "total_activities": total_a,
                "mastery_pct": mastery_pct,
                "freshness": freshness,
                "last_practiced_at": t["last_practiced_at"],
            }
        )

    now_iso = iso_now()
    due_reviews = conn.execute(
        """
        SELECT s.activity_id, s.due_at, s.interval_days, a.title, a.tech_slug, a.module_id, a.activity_type, a.xp_reward
        FROM srs_cards s
        JOIN activities a ON a.id = s.activity_id
        WHERE s.due_at <= ?
        ORDER BY s.due_at ASC
        LIMIT 10
        """,
        (now_iso,),
    ).fetchall()

    recent_xp = conn.execute(
        """
        SELECT l.id, l.tech_slug, t.name AS tech_name, t.color, l.source, l.amount, l.reason, l.created_at
        FROM xp_ledger l
        JOIN technologies t ON t.slug = l.tech_slug
        ORDER BY l.id DESC
        LIMIT 12
        """
    ).fetchall()

    external_profiles = [
        {
            "provider": r["provider"],
            "handle": r["handle"],
            "last_synced_at": r["last_synced_at"],
            "last_count": r["last_count"],
            "metadata": json.loads(r["metadata_json"] or "{}"),
        }
        for r in conn.execute("SELECT * FROM external_profiles").fetchall()
    ]

    # Recommend next unfinished activity (quick-burst friendly)
    next_rec = conn.execute(
        """
        SELECT a.id AS activity_id, a.title, a.activity_type, a.xp_reward, a.tech_slug,
               m.id AS module_id, m.title AS module_title, m.kind, m.estimated_minutes
        FROM activities a
        JOIN modules m ON m.id = a.module_id
        LEFT JOIN completions c ON c.activity_id = a.id
        WHERE c.activity_id IS NULL
        ORDER BY m.order_index ASC, a.order_index ASC
        LIMIT 3
        """
    ).fetchall()

    # Build 3 smart Daily Warmup items (due SM-2 reviews -> rusty/unstarted quick drills -> general quick drills)
    daily_warmup: list[dict[str, Any]] = []
    warmup_seen: set[str] = set()
    warmup_techs: set[str] = set()
    freshness_by_tech = {t["slug"]: t["freshness"] for t in technologies}

    for rev in due_reviews:
        if len(daily_warmup) >= 2:
            break
        aid = str(rev["activity_id"])
        warmup_seen.add(aid)
        warmup_techs.add(str(rev["tech_slug"]))
        daily_warmup.append(
            {
                "activity_id": aid,
                "title": str(rev["title"]),
                "tech_slug": str(rev["tech_slug"]),
                "module_id": str(rev["module_id"]),
                "activity_type": str(rev["activity_type"]),
                "xp_reward": int(rev["xp_reward"]),
                "reason": "Spaced-repetition review due",
            }
        )

    quick_candidates = conn.execute(
        """
        SELECT a.id AS activity_id, a.title, a.tech_slug, a.module_id, a.activity_type, a.xp_reward,
               CASE WHEN c.activity_id IS NULL THEN 0 ELSE 1 END AS is_done
        FROM activities a
        JOIN modules m ON m.id = a.module_id
        LEFT JOIN completions c ON c.activity_id = a.id
        WHERE a.activity_type IN ('read_check', 'multi_select', 'fill_blank', 'parsons', 'code_trace', 'pdb_sim')
        ORDER BY is_done ASC, m.order_index ASC, a.order_index ASC
        LIMIT 60
        """
    ).fetchall()

    freshness_rank = {"rusty": 0, "warming": 1, "unstarted": 2, "fresh": 3}
    ranked_quick = sorted(
        quick_candidates,
        key=lambda r: (
            int(r["is_done"]),
            freshness_rank.get(freshness_by_tech.get(str(r["tech_slug"]), "unstarted"), 2),
        ),
    )

    for pass_distinct in (True, False):
        for r in ranked_quick:
            if len(daily_warmup) >= 3:
                break
            aid = str(r["activity_id"])
            tslug = str(r["tech_slug"])
            if aid in warmup_seen:
                continue
            if pass_distinct and tslug in warmup_techs:
                continue
            fr = freshness_by_tech.get(tslug, "unstarted")
            reason = (
                "Refresh rusty skill"
                if fr == "rusty"
                else ("Keep warming track sharp" if fr == "warming" else ("Explore new track" if fr == "unstarted" else "Quick warm-up drill"))
            )
            warmup_seen.add(aid)
            warmup_techs.add(tslug)
            daily_warmup.append(
                {
                    "activity_id": aid,
                    "title": str(r["title"]),
                    "tech_slug": tslug,
                    "module_id": str(r["module_id"]),
                    "activity_type": str(r["activity_type"]),
                    "xp_reward": int(r["xp_reward"]),
                    "reason": reason,
                }
            )

    if len(daily_warmup) < 3:
        fallback_rows = conn.execute(
            """
            SELECT a.id AS activity_id, a.title, a.tech_slug, a.module_id, a.activity_type, a.xp_reward
            FROM activities a
            JOIN modules m ON m.id = a.module_id
            ORDER BY m.order_index ASC, a.order_index ASC
            LIMIT 10
            """
        ).fetchall()
        for r in fallback_rows:
            if len(daily_warmup) >= 3:
                break
            aid = str(r["activity_id"])
            if aid in warmup_seen:
                continue
            warmup_seen.add(aid)
            daily_warmup.append(
                {
                    "activity_id": aid,
                    "title": str(r["title"]),
                    "tech_slug": str(r["tech_slug"]),
                    "module_id": str(r["module_id"]),
                    "activity_type": str(r["activity_type"]),
                    "xp_reward": int(r["xp_reward"]),
                    "reason": "Daily practice quest",
                }
            )

    completed_total = sum(act_done.values())
    activities_total = sum(act_totals.values())

    return {
        "total_xp": total_xp,
        "level": level,
        "xp_in_level": xp_in_level,
        "xp_for_next": xp_for_next,
        "rank_title": get_rank_title(level),
        "streak_days": streak_days,
        "today_xp": today_xp,
        "daily_xp_target": daily_xp_target,
        "completed_activities": completed_total,
        "total_activities": activities_total,
        "achievements": list_achievements(conn),
        "daily_warmup": daily_warmup,
        "technologies": technologies,
        "due_reviews": [dict(r) for r in due_reviews],
        "recent_xp": [dict(r) for r in recent_xp],
        "daily_totals": daily_totals,
        "external_profiles": external_profiles,
        "recommended_next": [dict(r) for r in next_rec],
    }
