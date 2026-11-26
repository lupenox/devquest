from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import httpx

from .db import award_xp, upsert_module_pack
from .rpg import iso_now

SUPPORTED_TECHS = {
    "neovim", "python", "fastapi", "bash", "typescript", "javascript",
    "cpp", "json", "xml", "html", "css", "sql", "git", "react", "playwright", "regex", "debugging",
}

EXERCISM_TRACK_MAP = {
    "python": "python",
    "bash": "bash",
    "typescript": "typescript",
    "javascript": "javascript",
    "cpp": "cpp",
    "sqlite": "sql",
}

CODEWARS_LANG_MAP = {
    "python": "python",
    "shell": "bash",
    "typescript": "typescript",
    "javascript": "javascript",
    "cpp": "cpp",
    "sql": "sql",
}


def save_external_profile(conn: sqlite3.Connection, provider: str, handle: str) -> dict[str, Any]:
    provider = provider.strip().lower()
    if provider not in {"leetcode", "codewars", "exercism", "github"}:
        raise ValueError(f"Unsupported provider: {provider}")
    conn.execute(
        """
        INSERT INTO external_profiles (provider, handle)
        VALUES (?, ?)
        ON CONFLICT(provider) DO UPDATE SET handle=excluded.handle
        """,
        (provider, handle.strip()),
    )
    return {"provider": provider, "handle": handle.strip()}


def sync_leetcode(
    conn: sqlite3.Connection,
    username: str,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    query = """
    query userProblemsSolved($username: String!) {
      matchedUser(username: $username) {
        username
        submitStatsGlobal {
          acSubmissionNum {
            difficulty
            count
          }
        }
      }
    }
    """
    client = http_client or httpx.Client(timeout=12.0)
    close_after = http_client is None
    try:
        resp = client.post(
            "https://leetcode.com/graphql",
            json={"query": query, "variables": {"username": username}},
            headers={"Content-Type": "application/json", "Referer": "https://leetcode.com"},
        )
        resp.raise_for_status()
        payload = resp.json()
    finally:
        if close_after:
            client.close()

    matched = (payload.get("data") or {}).get("matchedUser")
    if not matched:
        return {"provider": "leetcode", "ok": False, "error": f"LeetCode user '{username}' not found."}

    nums = ((matched.get("submitStatsGlobal") or {}).get("acSubmissionNum")) or []
    counts = {item["difficulty"].lower(): int(item["count"]) for item in nums}
    total_solved = counts.get("all", counts.get("easy", 0) + counts.get("medium", 0) + counts.get("hard", 0))

    prev_row = conn.execute(
        "SELECT last_count FROM external_profiles WHERE provider = 'leetcode'"
    ).fetchone()
    prev_count = int(prev_row["last_count"]) if prev_row else 0
    delta = max(0, total_solved - prev_count)
    # Award 25 XP per newly solved LeetCode problem (cap initial backfill at 250 XP so level stays motivating)
    xp_gain = min(250, delta * 25) if prev_count == 0 else delta * 25
    if xp_gain > 0:
        award_xp(conn, "python", xp_gain, "leetcode", f"LeetCode sync ({username}: +{delta} solved)")

    now = iso_now()
    conn.execute(
        """
        INSERT INTO external_profiles (provider, handle, last_synced_at, last_count, metadata_json)
        VALUES ('leetcode', ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
            handle=excluded.handle,
            last_synced_at=excluded.last_synced_at,
            last_count=excluded.last_count,
            metadata_json=excluded.metadata_json
        """,
        (username, now, total_solved, json.dumps(counts)),
    )
    return {
        "provider": "leetcode",
        "ok": True,
        "handle": username,
        "total_solved": total_solved,
        "delta": delta,
        "xp_awarded": xp_gain,
        "breakdown": counts,
    }


def sync_codewars(
    conn: sqlite3.Connection,
    username: str,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    client = http_client or httpx.Client(timeout=12.0)
    close_after = http_client is None
    try:
        resp = client.get(f"https://www.codewars.com/api/v1/users/{username}")
        resp.raise_for_status()
        data = resp.json()
    finally:
        if close_after:
            client.close()

    total_completed = int((data.get("codeChallenges") or {}).get("totalCompleted", 0))
    honor = int(data.get("honor", 0))
    langs = (data.get("ranks") or {}).get("languages") or {}

    prev_row = conn.execute(
        "SELECT last_count FROM external_profiles WHERE provider = 'codewars'"
    ).fetchone()
    prev_count = int(prev_row["last_count"]) if prev_row else 0
    delta = max(0, total_completed - prev_count)
    xp_gain = min(200, delta * 20) if prev_count == 0 else delta * 20

    target_tech = "python"
    for cw_lang in langs.keys():
        if cw_lang.lower() in CODEWARS_LANG_MAP:
            target_tech = CODEWARS_LANG_MAP[cw_lang.lower()]
            break

    if xp_gain > 0:
        award_xp(conn, target_tech, xp_gain, "codewars", f"Codewars sync ({username}: +{delta} katas)")

    now = iso_now()
    meta = {"honor": honor, "languages": list(langs.keys())}
    conn.execute(
        """
        INSERT INTO external_profiles (provider, handle, last_synced_at, last_count, metadata_json)
        VALUES ('codewars', ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
            handle=excluded.handle,
            last_synced_at=excluded.last_synced_at,
            last_count=excluded.last_count,
            metadata_json=excluded.metadata_json
        """,
        (username, now, total_completed, json.dumps(meta)),
    )
    return {
        "provider": "codewars",
        "ok": True,
        "handle": username,
        "total_completed": total_completed,
        "delta": delta,
        "xp_awarded": xp_gain,
        "honor": honor,
    }


def sync_exercism(conn: sqlite3.Connection, workspace_path: str | None = None) -> dict[str, Any]:
    root = Path(workspace_path or str(Path.home() / "exercism")).expanduser()
    per_track: dict[str, int] = {}
    total_found = 0
    if root.exists() and root.is_dir():
        for track_dir in root.iterdir():
            if not track_dir.is_dir():
                continue
            mapped = EXERCISM_TRACK_MAP.get(track_dir.name.lower())
            if not mapped:
                continue
            # Count exercise directories containing .exercism metadata
            ex_count = sum(
                1 for child in track_dir.iterdir()
                if child.is_dir() and (child / ".exercism").exists()
            )
            if ex_count > 0:
                per_track[mapped] = ex_count
                total_found += ex_count

    prev_row = conn.execute(
        "SELECT last_count, metadata_json FROM external_profiles WHERE provider = 'exercism'"
    ).fetchone()
    prev_meta = json.loads(prev_row["metadata_json"]) if (prev_row and prev_row["metadata_json"]) else {}
    prev_tracks = prev_meta.get("tracks", {})

    xp_awarded_total = 0
    for tech, count in per_track.items():
        old_c = int(prev_tracks.get(tech, 0))
        delta = max(0, count - old_c)
        if delta > 0:
            gain = delta * 30
            award_xp(conn, tech, gain, "exercism", f"Exercism {tech} track (+{delta} exercises)")
            xp_awarded_total += gain

    now = iso_now()
    conn.execute(
        """
        INSERT INTO external_profiles (provider, handle, last_synced_at, last_count, metadata_json)
        VALUES ('exercism', ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
            handle=excluded.handle,
            last_synced_at=excluded.last_synced_at,
            last_count=excluded.last_count,
            metadata_json=excluded.metadata_json
        """,
        (str(root), now, total_found, json.dumps({"tracks": per_track, "exists": root.exists()})),
    )
    return {
        "provider": "exercism",
        "ok": True,
        "workspace": str(root),
        "total_exercises": total_found,
        "tracks": per_track,
        "xp_awarded": xp_awarded_total,
    }


def import_exercism_spec(
    conn: sqlite3.Connection,
    canonical_data: dict[str, Any],
    tech_slug: str = "python",
) -> dict[str, Any]:
    """Converts an Exercism problem-specifications canonical-data.json into a DevQuest kata module."""
    if tech_slug not in SUPPORTED_TECHS:
        raise ValueError(f"Unsupported tech_slug: {tech_slug}")
    ex_slug = canonical_data.get("exercise", "custom-kata")
    cases = canonical_data.get("cases", [])
    flat_cases: list[dict[str, Any]] = []
    for c in cases:
        if "cases" in c:
            flat_cases.extend(c["cases"])
        else:
            flat_cases.append(c)

    first_prop = flat_cases[0].get("property", "solve") if flat_cases else "solve"
    test_lines = [f"from solution import {first_prop}", ""]
    for idx, c in enumerate(flat_cases[:10]):
        inp = c.get("input", {})
        exp = c.get("expected")
        if isinstance(exp, dict) and "error" in exp:
            continue
        kwargs_str = ", ".join(f"{k}={v!r}" for k, v in inp.items())
        test_lines.append(f"def test_case_{idx}():")
        test_lines.append(f"    assert {first_prop}({kwargs_str}) == {exp!r}")
        test_lines.append("")

    mod_id = f"exercism-{tech_slug}-{ex_slug}"
    mod = {
        "id": mod_id,
        "tech_slug": tech_slug,
        "title": f"Exercism Kata: {ex_slug.replace('-', ' ').title()}",
        "subtitle": f"Imported from Exercism canonical problem-specifications ({len(flat_cases)} cases)",
        "difficulty": "intermediate",
        "kind": "kata",
        "estimated_minutes": 10,
        "order_index": 80,
        "summary": f"Implement `{first_prop}` in Neovim to satisfy Exercism canonical test cases.",
        "sections": [
            {
                "title": "Specification",
                "body": f"Solve the canonical Exercism challenge **{ex_slug}** by implementing `{first_prop}` in `solution.py`.",
            }
        ],
        "activities": [
            {
                "id": f"{mod_id}-lab",
                "tech_slug": tech_slug,
                "title": f"Implement {first_prop} in Neovim",
                "activity_type": "nvim_lab",
                "grader_type": "python" if tech_slug == "python" else tech_slug,
                "xp_reward": 60,
                "par_keystrokes": 60,
                "spec": {
                    "primary_file": "solution.py",
                    "instructions": f"Implement `{first_prop}(...)` to pass all Exercism canonical assertions.",
                    "starter_files": {
                        "solution.py": f"def {first_prop}(*args, **kwargs):\n    raise NotImplementedError\n"
                    },
                    "test_code": "\n".join(test_lines),
                    "hints": ["Check edge cases in the failing pytest output with <leader>qo."],
                },
            }
        ],
    }
    upsert_module_pack(conn, mod, source="imported")
    return mod
