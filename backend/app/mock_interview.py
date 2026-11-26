from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

import httpx

from . import config
from .achievements import evaluate_achievements
from .db import award_xp
from .github_study import fetch_and_analyze_repo, parse_repo_ref
from .ollama_gen import _extract_json_object, list_ollama_models
from .rpg import iso_now

TRADEOFF_TERMS = {
    "trade-off",
    "tradeoff",
    "tradeoffs",
    "trade-offs",
    "bottleneck",
    "scale",
    "scaling",
    "scalability",
    "latency",
    "throughput",
    "concurrency",
    "memory",
    "complexity",
    "simple",
    "simplicity",
    "alternative",
    "instead",
    "pros",
    "cons",
    "risk",
    "fallback",
    "timeout",
    "retry",
    "idempotent",
    "refactor",
    "cache",
    "caching",
    "queue",
    "index",
    "partition",
    "shard",
    "rollback",
    "monitor",
    "observability",
    "edge case",
    "failure",
}

ENGINEERING_TERMS = {
    "api",
    "endpoint",
    "route",
    "handler",
    "schema",
    "database",
    "sqlite",
    "postgres",
    "sql",
    "query",
    "transaction",
    "validation",
    "pydantic",
    "async",
    "sync",
    "state",
    "test",
    "pytest",
    "unit",
    "integration",
    "debug",
    "pdb",
    "breakpoint",
    "log",
    "logging",
    "error",
    "exception",
    "http",
    "status",
    "json",
    "auth",
    "token",
    "middleware",
    "dependency",
    "component",
    "hook",
    "websocket",
    "client",
    "server",
    "module",
    "architecture",
    "pipeline",
    "data",
    "flow",
    "request",
    "response",
    "model",
    "service",
    "layer",
    "input",
    "output",
}

STRUCTURE_TERMS = {
    "first",
    "second",
    "third",
    "next",
    "then",
    "finally",
    "because",
    "therefore",
    "however",
    "specifically",
    "for example",
    "step",
    "starts",
    "returns",
    "validates",
}


def _repo_module_id(full_name: str) -> str:
    slug_safe = re.sub(r"[^a-z0-9]+", "-", full_name.lower()).strip("-")
    return f"repo-interview-{slug_safe}"


def _analysis_from_existing_module(conn: sqlite3.Connection, repo_ref: str) -> tuple[dict[str, Any] | None, str | None]:
    """Fallback loader when a Repo Study Pack already exists in SQLite (works offline!)."""
    mod = None
    ref = repo_ref.strip()
    if ref.startswith("repo-interview-"):
        mod = conn.execute("SELECT * FROM modules WHERE id = ?", (ref,)).fetchone()
    if mod is None:
        try:
            owner, repo = parse_repo_ref(ref)
            mod_id = _repo_module_id(f"{owner}/{repo}")
            mod = conn.execute("SELECT * FROM modules WHERE id = ?", (mod_id,)).fetchone()
        except ValueError:
            pass
    if mod is None:
        mod = conn.execute(
            "SELECT * FROM modules WHERE kind = 'repo_interview' AND LOWER(title) LIKE ? LIMIT 1",
            (f"%{ref.lower()}%",),
        ).fetchone()
    if mod is None:
        return None, None

    content = json.loads(mod["content_json"] or "{}")
    sections = content.get("sections") or []
    combined_text = "\n".join(
        f"{s.get('title', '')}\n{s.get('body', '')}\n{s.get('code_example', '')}"
        for s in sections
    )

    title = str(mod["title"])
    full_name = title.replace("Interview Prep:", "").strip()
    if "/" not in full_name:
        full_name = ref if "/" in ref else str(mod["id"])

    # Extract filenames, routes, symbols mentioned in the saved study pack
    files = re.findall(r"-\s+([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)", combined_text)
    routes = re.findall(r"\b(?:GET|POST|PUT|DELETE|PATCH)\s+/[A-Za-z0-9_/{}-]+", combined_text)
    fn_match = re.search(r"Key functions:\s*([^\n]+)", combined_text)
    cls_match = re.search(r"Classes:\s*([^\n]+)", combined_text)
    stack_match = re.search(r"Primary Stack:\s*([^\n]+)", combined_text)
    dirs_match = re.search(r"Top-Level Modules:\s*([^\n]+)", combined_text)

    functions = [x.strip() for x in (fn_match.group(1).split(",") if fn_match else []) if x.strip() and x.strip() != "N/A"]
    classes = [x.strip() for x in (cls_match.group(1).split(",") if cls_match else []) if x.strip() and x.strip() != "N/A"]
    frameworks = [x.strip() for x in (stack_match.group(1).split(",") if stack_match else []) if x.strip()]
    top_dirs = [x.strip() for x in (dirs_match.group(1).split(",") if dirs_match else []) if x.strip() and x.strip() != "flat root layout"]

    analysis = {
        "full_name": full_name,
        "description": content.get("summary") or mod["subtitle"] or f"Repository {full_name}",
        "tech_slug": mod["tech_slug"],
        "primary_language": mod["tech_slug"].title(),
        "languages": {mod["tech_slug"].title(): 100},
        "frameworks": frameworks or [mod["tech_slug"].title()],
        "top_dirs": top_dirs,
        "file_count": max(len(files), 1),
        "has_tests": "test" in combined_text.lower(),
        "files": [{"path": f, "snippet": "", "lines": 0, "symbols": {}} for f in files[:8]],
        "routes": routes[:10],
        "classes": classes[:10],
        "functions": functions[:12],
    }
    return analysis, str(mod["id"])


def _build_interview_questions(analysis: dict[str, Any]) -> list[dict[str, Any]]:
    full_name = analysis["full_name"]
    frameworks = analysis.get("frameworks") or [analysis.get("primary_language") or "Core Stack"]
    frameworks_str = ", ".join(frameworks[:4])
    top_dirs = analysis.get("top_dirs") or []
    dirs_str = ", ".join(top_dirs[:5]) if top_dirs else "the core source modules"
    files = [f["path"] for f in analysis.get("files", []) if isinstance(f, dict) and f.get("path")]
    anchor_file = files[0] if files else "main entrypoint"
    secondary_file = files[1] if len(files) > 1 else anchor_file
    routes = analysis.get("routes") or []
    functions = analysis.get("functions") or []
    classes = analysis.get("classes") or []
    primary_symbol = functions[0] if functions else (classes[0] if classes else anchor_file.rsplit("/", 1)[-1])
    route_hint = f" (e.g. `{routes[0]}`)" if routes else ""

    code_refs_pool = list(
        dict.fromkeys(
            [
                *files[:8],
                *[f.rsplit("/", 1)[-1] for f in files[:8]],
                *functions[:12],
                *classes[:10],
                *routes[:8],
                *top_dirs[:8],
            ]
        )
    )
    stack_pool = list(
        dict.fromkeys(
            [
                *frameworks,
                *(analysis.get("languages") or {}).keys(),
                str(analysis.get("tech_slug") or ""),
            ]
        )
    )

    return [
        {
            "index": 0,
            "category": "Architecture & Pitch",
            "focus": "High-level problem framing, stack choices, and module boundaries",
            "question": (
                f"Give me a crisp Staff-Engineer pitch for {full_name}: what problem does it solve, "
                f"why did you choose {frameworks_str}, and how are responsibilities separated across {dirs_str}?"
            ),
            "context_hint": (
                f"Reference the repo layout ({dirs_str}), stack ({frameworks_str}), and key files like `{anchor_file}`."
            ),
            "ideal_points": [
                f"State the concrete user/engineering problem {full_name} solves in 1-2 clear sentences.",
                f"Justify choosing {frameworks_str} with at least one concrete trade-off vs alternatives.",
                f"Explain module boundaries across {dirs_str} and name key files such as `{anchor_file}`.",
            ],
            "code_refs_pool": code_refs_pool,
            "stack_pool": stack_pool,
            "tech_slug": analysis.get("tech_slug") or "git",
            "answer": None,
            "rubric": None,
            "answered_at": None,
        },
        {
            "index": 1,
            "category": "Code & Data Flow",
            "focus": "End-to-end execution trace citing real files, symbols, and validation",
            "question": (
                f"Walk me line-by-line through a concrete request or execution flow in `{anchor_file}` "
                f"involving `{primary_symbol}`{route_hint}. How are inputs validated, transformed, and persisted or returned?"
            ),
            "context_hint": (
                f"Cite real symbols ({', '.join((functions + classes)[:4]) or primary_symbol}) "
                f"and files ({', '.join(files[:3]) or anchor_file})."
            ),
            "ideal_points": [
                f"Trace entry -> validation -> core logic -> response/persistence through `{anchor_file}` and `{primary_symbol}`.",
                f"Mention how `{secondary_file}` or adjacent layers interact with the entrypoint.",
                "Highlight error/status handling and boundary contracts (schemas, types, or invariants).",
            ],
            "code_refs_pool": code_refs_pool,
            "stack_pool": stack_pool,
            "tech_slug": analysis.get("tech_slug") or "git",
            "answer": None,
            "rubric": None,
            "answered_at": None,
        },
        {
            "index": 2,
            "category": "Debugging & Failure Modes",
            "focus": "Incident reproduction, debugging tools, and defensive failure isolation",
            "question": (
                f"Suppose a tricky regression or production failure hits `{anchor_file}` in {full_name} "
                f"(bad input, upstream timeout, or corrupted state). How do you reproduce, debug, and isolate the root cause?"
            ),
            "context_hint": (
                "Walk through reproduction, test/debugger tools (e.g. pytest, pdb/logs), and how you prevent regressions."
            ),
            "ideal_points": [
                "Write a minimal failing test or deterministic reproducer before touching production code.",
                f"Use targeted observability or interactive debugging (logs, `pdb`/`breakpoint()`, traces) around `{primary_symbol}`.",
                "Explain defensive safeguards (timeouts, rollbacks, validation, regression tests) so it cannot recur.",
            ],
            "code_refs_pool": code_refs_pool,
            "stack_pool": stack_pool,
            "tech_slug": analysis.get("tech_slug") or "git",
            "answer": None,
            "rubric": None,
            "answered_at": None,
        },
        {
            "index": 3,
            "category": "Trade-Offs & Scalability",
            "focus": "Bottlenecks, pragmatic evolution, and what to refactor vs keep simple",
            "question": (
                f"If {full_name} had to scale 100x in traffic or team size, what is the biggest architectural bottleneck "
                f"or trade-off in the current {frameworks_str} design? What would you refactor first—and what would you intentionally leave simple?"
            ),
            "context_hint": (
                "Discuss concrete bottlenecks (concurrency, I/O, storage, state), trade-offs (pros/cons), and phased evolution."
            ),
            "ideal_points": [
                "Pinpoint a real bottleneck (e.g., synchronous I/O, single-node storage/locks, or tight coupling).",
                "Compare two concrete architectural options with explicit pros, cons, and operational cost.",
                "Demonstrate Staff-level pragmatism by naming what NOT to over-engineer prematurely.",
            ],
            "code_refs_pool": code_refs_pool,
            "stack_pool": stack_pool,
            "tech_slug": analysis.get("tech_slug") or "git",
            "answer": None,
            "rubric": None,
            "answered_at": None,
        },
    ]


def _public_question(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "index": int(item["index"]),
        "category": str(item.get("category", "")),
        "question": str(item.get("question", "")),
        "context_hint": str(item.get("context_hint", "")),
        "focus": str(item.get("focus", "")),
    }


def _clamp_axis(value: Any, default: int = 12) -> int:
    try:
        return max(0, min(25, int(round(float(value)))))
    except (TypeError, ValueError):
        return default


def _grade_deterministic_rubric(q_item: dict[str, Any], answer_text: str) -> dict[str, Any]:
    text = answer_text.strip()
    low = text.lower()
    words = re.findall(r"[A-Za-z0-9_./-]+", text)
    word_count = len(words)
    sentences = [s.strip() for s in re.split(r"[.!?\n]+", text) if s.strip()]

    # 1. Clarity (0-25): length, multi-sentence structure, clear reasoning connectors
    if word_count == 0:
        clarity = 0
    elif word_count < 8:
        clarity = 6
    elif word_count < 18:
        clarity = 12
    elif word_count < 35:
        clarity = 17
    elif word_count < 65:
        clarity = 21
    else:
        clarity = 23

    struct_hits = sum(1 for t in STRUCTURE_TERMS if t in low)
    if len(sentences) >= 2:
        clarity += 1
    if struct_hits >= 2:
        clarity += 2
    elif struct_hits == 1:
        clarity += 1
    clarity = max(0, min(25, clarity))

    # 2. Technical Accuracy (0-25): stack & engineering concepts
    stack_pool = [str(s).lower() for s in q_item.get("stack_pool", []) if s]
    stack_hits = sum(1 for tok in stack_pool if len(tok) >= 2 and tok in low)
    eng_hits = sum(1 for tok in ENGINEERING_TERMS if re.search(rf"\b{re.escape(tok)}\b", low))
    accuracy = min(25, (3 if word_count >= 5 else 0) + stack_hits * 5 + eng_hits * 3)
    if word_count >= 20 and eng_hits >= 4:
        accuracy = max(accuracy, 20)

    # 3. Code References (0-25): citing real repo files, symbols, routes, dirs, or inline code tokens
    refs_pool = [str(r) for r in q_item.get("code_refs_pool", []) if r]
    matched_refs = [r for r in refs_pool if r.lower() in low]
    backtick_or_path = re.findall(r"`[^`]+`|\b[A-Za-z0-9_-]+\.(?:py|ts|tsx|js|mjs|sql|sh|cpp|hpp|json)\b|/[a-z][a-z0-9_/-]+|\b[a-z_][a-z0-9_]*\(\)", text)
    code_refs = min(25, len(set(matched_refs)) * 8 + min(3, len(backtick_or_path)) * 4)
    if word_count >= 12 and code_refs == 0 and any(k in low for k in ("file", "function", "class", "module", "route", "endpoint")):
        code_refs = 8

    # 4. Trade-Offs (0-25): trade-off thinking, bottlenecks, failure modes, testing/evolution
    tradeoff_hits = sum(1 for tok in TRADEOFF_TERMS if tok in low)
    tradeoffs = min(25, (3 if word_count >= 10 else 0) + tradeoff_hits * 5)
    if tradeoff_hits >= 4:
        tradeoffs = max(tradeoffs, 22)

    total = clarity + accuracy + code_refs + tradeoffs

    strengths: list[str] = []
    improvements: list[str] = []
    if clarity >= 18:
        strengths.append("clear structured communication")
    else:
        improvements.append("structure your explanation top-down (context -> steps -> outcome) with slightly more detail")

    if accuracy >= 18:
        strengths.append("strong technical depth")
    else:
        improvements.append("tie your answer more explicitly to the repo's stack and data/error handling mechanics")

    if code_refs >= 16:
        strengths.append("concrete codebase references")
    else:
        sample_refs = [r for r in refs_pool[:3] if r]
        hint_refs = f" (e.g., {', '.join(f'`{r}`' for r in sample_refs)})" if sample_refs else ""
        improvements.append(f"name specific files, routes, or functions{hint_refs} to prove hands-on ownership")

    if tradeoffs >= 16:
        strengths.append("senior trade-off & failure-mode awareness")
    else:
        improvements.append("call out at least one concrete trade-off, bottleneck, or failure recovery strategy")

    if strengths and improvements:
        feedback = f"Solid work on {', '.join(strengths)}. To level up to Staff bar, {improvements[0]}."
    elif strengths:
        feedback = f"Staff-level answer! Strong {', '.join(strengths)}."
    else:
        feedback = f"Good start — to raise your score, {'; '.join(improvements[:2])}."

    return {
        "clarity": clarity,
        "accuracy": accuracy,
        "code_refs": code_refs,
        "tradeoffs": tradeoffs,
        "total": total,
        "feedback": feedback,
        "ideal_points": list(q_item.get("ideal_points") or []),
        "graded_by": "deterministic_rubric",
    }


def _grade_with_ollama(
    repo_full_name: str,
    q_item: dict[str, Any],
    answer_text: str,
    model: str | None = None,
    ollama_client: httpx.Client | None = None,
) -> dict[str, Any] | None:
    chosen_model = model
    if not chosen_model:
        if ollama_client is not None:
            chosen_model = "local-ollama"
        else:
            models = list_ollama_models(timeout=1.5)
            chosen_model = models[0]["name"] if models else None
    if not chosen_model:
        return None

    prompt = f"""You are a Staff Software Engineer conducting a mock technical interview about the candidate's GitHub repository "{repo_full_name}".
Question ({q_item.get('category')}): {q_item.get('question')}
Known repo files/symbols/routes: {json.dumps(q_item.get('code_refs_pool', [])[:12])}
Ideal talking points: {json.dumps(q_item.get('ideal_points', []))}

Candidate Answer:
\"\"\"{answer_text}\"\"\"

Grade the candidate strictly on 4 axes (integers 0 to 25 each) and return ONLY a valid JSON object:
{{
  "clarity": 0,
  "accuracy": 0,
  "code_refs": 0,
  "tradeoffs": 0,
  "feedback": "2-3 concise sentences of actionable Staff-Engineer coaching feedback.",
  "ideal_points": ["Key point 1", "Key point 2", "Key point 3"]
}}"""

    client = ollama_client or httpx.Client(timeout=20.0)
    close_after = ollama_client is None
    try:
        resp = client.post(
            f"{config.OLLAMA_URL}/api/generate",
            json={
                "model": chosen_model,
                "prompt": prompt,
                "format": "json",
                "stream": False,
                "options": {"temperature": 0.2},
            },
        )
        resp.raise_for_status()
        parsed = _extract_json_object(resp.json().get("response", "{}"))
    except Exception:
        return None
    finally:
        if close_after:
            client.close()

    if not isinstance(parsed, dict):
        return None
    required_keys = {"clarity", "accuracy", "code_refs", "tradeoffs"}
    if not required_keys.intersection(parsed.keys()):
        return None

    clarity = _clamp_axis(parsed.get("clarity"), 12)
    accuracy = _clamp_axis(parsed.get("accuracy"), 12)
    code_refs = _clamp_axis(parsed.get("code_refs"), 12)
    tradeoffs = _clamp_axis(parsed.get("tradeoffs"), 12)
    total = clarity + accuracy + code_refs + tradeoffs

    raw_ideal = parsed.get("ideal_points")
    ideal_points = (
        [str(p).strip() for p in raw_ideal if str(p).strip()][:4]
        if isinstance(raw_ideal, list) and raw_ideal
        else list(q_item.get("ideal_points") or [])
    )
    feedback = str(parsed.get("feedback") or "").strip() or "Good response — keep grounding answers in concrete files and trade-offs."

    return {
        "clarity": clarity,
        "accuracy": accuracy,
        "code_refs": code_refs,
        "tradeoffs": tradeoffs,
        "total": total,
        "feedback": feedback,
        "ideal_points": ideal_points,
        "graded_by": f"ollama:{chosen_model}",
    }


def start_mock_interview(
    conn: sqlite3.Connection,
    repo_ref: str,
    model: str | None = None,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    ref = repo_ref.strip()
    if not ref:
        raise ValueError("Repository reference is required.")

    analysis: dict[str, Any] | None = None
    module_id: str | None = None

    # First check if a saved repo_interview pack matches; still try live GitHub analysis if ref looks like owner/repo
    cached_analysis, cached_mod_id = _analysis_from_existing_module(conn, ref)
    module_id = cached_mod_id

    try:
        owner, repo = parse_repo_ref(ref)
        expected_mod_id = _repo_module_id(f"{owner}/{repo}")
        row = conn.execute("SELECT id FROM modules WHERE id = ?", (expected_mod_id,)).fetchone()
        if row:
            module_id = str(row["id"])
        analysis = fetch_and_analyze_repo(conn, ref, http_client=http_client)
    except ValueError:
        if cached_analysis is None:
            raise
        analysis = cached_analysis
    except Exception:
        if cached_analysis is None:
            raise
        analysis = cached_analysis

    questions = _build_interview_questions(analysis)
    now = iso_now()
    cur = conn.execute(
        """
        INSERT INTO mock_interviews (
            repo_full_name, module_id, status, readiness_score, transcript_json, created_at, updated_at
        ) VALUES (?, ?, 'active', 0, ?, ?, ?)
        """,
        (analysis["full_name"], module_id, json.dumps(questions), now, now),
    )
    session_id = int(cur.lastrowid)
    public_questions = [_public_question(q) for q in questions]

    return {
        "session_id": session_id,
        "repo_full_name": analysis["full_name"],
        "module_id": module_id,
        "status": "active",
        "current_index": 0,
        "total_questions": len(public_questions),
        "question": public_questions[0],
        "questions": public_questions,
        "readiness_score": 0.0,
    }


def answer_mock_question(
    conn: sqlite3.Connection,
    session_id: int,
    answer_text: str,
    model: str | None = None,
    ollama_client: httpx.Client | None = None,
) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM mock_interviews WHERE id = ?", (session_id,)).fetchone()
    if not row:
        raise KeyError(f"Mock interview session {session_id} not found.")

    answer_clean = answer_text.strip()
    if not answer_clean:
        raise ValueError("Answer text cannot be empty.")

    transcript: list[dict[str, Any]] = json.loads(row["transcript_json"] or "[]")
    if not transcript:
        raise ValueError("Mock interview session has no questions.")

    # Find first unanswered question
    current_idx: int | None = None
    for idx, item in enumerate(transcript):
        if item.get("answer") is None:
            current_idx = idx
            break

    if current_idx is None:
        raise ValueError("Mock interview session is already completed.")

    q_item = transcript[current_idx]
    rubric = _grade_with_ollama(
        row["repo_full_name"],
        q_item,
        answer_clean,
        model=model,
        ollama_client=ollama_client,
    )
    if rubric is None:
        rubric = _grade_deterministic_rubric(q_item, answer_clean)

    now = iso_now()
    q_item["answer"] = answer_clean
    q_item["rubric"] = rubric
    q_item["answered_at"] = now

    answered_scores = [
        int(it["rubric"]["total"])
        for it in transcript
        if isinstance(it.get("rubric"), dict) and "total" in it["rubric"]
    ]
    readiness_score = round(sum(answered_scores) / max(1, len(answered_scores)), 1)

    next_idx = current_idx + 1
    is_completed = next_idx >= len(transcript)
    new_status = "completed" if is_completed else "active"
    next_question = None if is_completed else _public_question(transcript[next_idx])

    conn.execute(
        """
        UPDATE mock_interviews
        SET status = ?, readiness_score = ?, transcript_json = ?, updated_at = ?
        WHERE id = ?
        """,
        (new_status, readiness_score, json.dumps(transcript), now, session_id),
    )

    xp_awarded = 0
    unlocked_achievements: list[dict[str, Any]] = []
    if is_completed:
        xp_awarded = max(25, min(100, int(round(readiness_score))))
        tech_slug = str(q_item.get("tech_slug") or "git")
        tech_exists = conn.execute("SELECT 1 FROM technologies WHERE slug = ?", (tech_slug,)).fetchone()
        if not tech_exists:
            tech_slug = "git"
        award_xp(
            conn,
            tech_slug,
            xp_awarded,
            "mock_interview",
            f"Mock Interview ({row['repo_full_name']}): {readiness_score:.0f}% Readiness",
        )
        unlocked_achievements = evaluate_achievements(conn)

    return {
        "session_id": int(session_id),
        "repo_full_name": str(row["repo_full_name"]),
        "status": new_status,
        "answered_index": current_idx,
        "current_index": min(next_idx, len(transcript)),
        "total_questions": len(transcript),
        "rubric": rubric,
        "next_question": next_question,
        "completed": is_completed,
        "readiness_score": readiness_score,
        "xp_awarded": xp_awarded,
        "unlocked_achievements": unlocked_achievements,
    }


def list_mock_interviews(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM mock_interviews ORDER BY updated_at DESC, id DESC LIMIT 50"
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        try:
            transcript = json.loads(r["transcript_json"] or "[]")
        except Exception:
            transcript = []
        answered_count = sum(1 for item in transcript if isinstance(item, dict) and item.get("answer") is not None)
        out.append(
            {
                "id": int(r["id"]),
                "repo_full_name": str(r["repo_full_name"]),
                "module_id": r["module_id"],
                "status": str(r["status"]),
                "readiness_score": float(r["readiness_score"]),
                "created_at": str(r["created_at"]),
                "updated_at": str(r["updated_at"]),
                "answered_count": answered_count,
                "total_questions": len(transcript),
            }
        )
    return out
