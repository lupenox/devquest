from __future__ import annotations

import ast
import base64
import json
import os
import re
import sqlite3
import subprocess
import time
from typing import Any

import httpx

from . import config
from .db import award_xp, upsert_module_pack
from .ollama_gen import _extract_json_object, list_ollama_models
from .rpg import iso_now

GITHUB_API = "https://api.github.com"

LANG_TO_TECH: dict[str, str] = {
    "python": "python",
    "typescript": "typescript",
    "javascript": "javascript",
    "c++": "cpp",
    "c": "cpp",
    "shell": "bash",
    "html": "html",
    "css": "css",
    "sql": "sql",
    "lua": "neovim",
}

KEY_FILENAMES = {
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "makefile",
    "cmakelists.txt",
}

SOURCE_EXTS = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cpp", ".hpp", ".h", ".sh", ".sql", ".lua"}


def resolve_github_token(conn: sqlite3.Connection | None = None) -> tuple[str | None, str]:
    """Resolves a GitHub token from env, saved DB config, or local `gh auth token`."""
    env_tok = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
    if env_tok:
        return env_tok.strip(), "env"

    if conn is not None:
        row = conn.execute(
            "SELECT metadata_json FROM external_profiles WHERE provider = 'github'"
        ).fetchone()
        if row and row["metadata_json"]:
            meta = json.loads(row["metadata_json"])
            if meta.get("token"):
                return str(meta["token"]).strip(), "saved_pat"

    try:
        proc = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True,
            text=True,
            timeout=4,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return proc.stdout.strip(), "gh_cli"
    except Exception:
        pass
    return None, "unauthenticated"


def _gh_headers(token: str | None) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DevQuest-Learning-OS",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def save_github_connection(
    conn: sqlite3.Connection,
    username: str = "",
    token: str | None = None,
) -> dict[str, Any]:
    prev = conn.execute(
        "SELECT handle, metadata_json FROM external_profiles WHERE provider = 'github'"
    ).fetchone()
    meta = json.loads(prev["metadata_json"]) if (prev and prev["metadata_json"]) else {}
    if token is not None:
        if token.strip():
            meta["token"] = token.strip()
        else:
            meta.pop("token", None)
    handle = username.strip() or (prev["handle"] if prev else "")
    conn.execute(
        """
        INSERT INTO external_profiles (provider, handle, metadata_json)
        VALUES ('github', ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
            handle=excluded.handle,
            metadata_json=excluded.metadata_json
        """,
        (handle, json.dumps(meta)),
    )
    return {"provider": "github", "handle": handle, "has_saved_token": bool(meta.get("token"))}


def get_github_status(
    conn: sqlite3.Connection,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    token, source = resolve_github_token(conn)
    row = conn.execute(
        "SELECT handle, last_synced_at, last_count, metadata_json FROM external_profiles WHERE provider = 'github'"
    ).fetchone()
    saved_handle = row["handle"] if row else ""

    client = http_client or httpx.Client(timeout=10.0)
    close_after = http_client is None
    try:
        if token:
            resp = client.get(f"{GITHUB_API}/user", headers=_gh_headers(token))
            if resp.status_code == 200:
                u = resp.json()
                login = u.get("login", saved_handle)
                conn.execute(
                    """
                    INSERT INTO external_profiles (provider, handle, last_synced_at, last_count, metadata_json)
                    VALUES ('github', ?, ?, 0, COALESCE((SELECT metadata_json FROM external_profiles WHERE provider='github'), '{}'))
                    ON CONFLICT(provider) DO UPDATE SET handle=excluded.handle
                    """,
                    (login, row["last_synced_at"] if row else None),
                )
                return {
                    "connected": True,
                    "auth_source": source,
                    "username": login,
                    "name": u.get("name") or login,
                    "avatar_url": u.get("avatar_url"),
                    "public_repos": u.get("public_repos", 0),
                    "private_repos": u.get("total_private_repos", 0),
                }
        if saved_handle:
            resp = client.get(f"{GITHUB_API}/users/{saved_handle}", headers=_gh_headers(None))
            if resp.status_code == 200:
                u = resp.json()
                return {
                    "connected": True,
                    "auth_source": "public_handle",
                    "username": u.get("login", saved_handle),
                    "name": u.get("name") or saved_handle,
                    "avatar_url": u.get("avatar_url"),
                    "public_repos": u.get("public_repos", 0),
                    "private_repos": 0,
                }
    except Exception as exc:
        return {"connected": False, "auth_source": source, "username": saved_handle, "error": str(exc)}
    finally:
        if close_after:
            client.close()

    return {"connected": False, "auth_source": source, "username": saved_handle}


def list_github_repos(
    conn: sqlite3.Connection,
    username: str | None = None,
    limit: int = 40,
    http_client: httpx.Client | None = None,
) -> list[dict[str, Any]]:
    token, _ = resolve_github_token(conn)
    client = http_client or httpx.Client(timeout=12.0)
    close_after = http_client is None
    try:
        if token and not username:
            url = f"{GITHUB_API}/user/repos?sort=updated&per_page={limit}&affiliation=owner,collaborator"
        else:
            target = username
            if not target:
                row = conn.execute("SELECT handle FROM external_profiles WHERE provider='github'").fetchone()
                target = row["handle"] if row else ""
            if not target:
                return []
            url = f"{GITHUB_API}/users/{target}/repos?sort=updated&per_page={limit}"

        resp = client.get(url, headers=_gh_headers(token))
        resp.raise_for_status()
        repos = resp.json()
        return [
            {
                "full_name": r["full_name"],
                "name": r["name"],
                "owner": (r.get("owner") or {}).get("login", ""),
                "description": r.get("description") or "",
                "language": r.get("language") or "Unknown",
                "private": bool(r.get("private", False)),
                "stargazers_count": int(r.get("stargazers_count", 0)),
                "updated_at": r.get("updated_at", ""),
                "default_branch": r.get("default_branch", "main"),
                "html_url": r.get("html_url", ""),
                "topics": r.get("topics") or [],
            }
            for r in repos
        ]
    finally:
        if close_after:
            client.close()


def sync_github_profile(
    conn: sqlite3.Connection,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    status = get_github_status(conn, http_client=http_client)
    if not status.get("connected"):
        return {"provider": "github", "ok": False, "error": "GitHub not connected."}
    repos = list_github_repos(conn, limit=30, http_client=http_client)
    repo_count = len(repos)
    prev = conn.execute("SELECT last_count FROM external_profiles WHERE provider='github'").fetchone()
    prev_count = int(prev["last_count"]) if prev else 0
    delta = max(0, repo_count - prev_count)
    xp_gain = min(150, delta * 15) if prev_count == 0 else delta * 15
    if xp_gain > 0:
        award_xp(conn, "git", xp_gain, "github", f"GitHub sync ({status['username']}: {repo_count} repos)")

    now = iso_now()
    conn.execute(
        """
        UPDATE external_profiles
        SET last_synced_at = ?, last_count = ?
        WHERE provider = 'github'
        """,
        (now, repo_count),
    )
    return {
        "provider": "github",
        "ok": True,
        "username": status["username"],
        "repo_count": repo_count,
        "xp_awarded": xp_gain,
    }


def parse_repo_ref(repo_ref: str) -> tuple[str, str]:
    ref = repo_ref.strip().rstrip("/")
    ref = re.sub(r"\.git$", "", ref)
    m = re.search(r"github\.com[:/]([^/\s]+)/([^/\s]+)", ref)
    if m:
        return m.group(1), m.group(2)
    parts = [p for p in ref.split("/") if p]
    if len(parts) == 2:
        return parts[0], parts[1]
    raise ValueError(f"Invalid GitHub repository reference '{repo_ref}'. Use 'owner/repo' or full GitHub URL.")


def _extract_code_symbols(path: str, text: str) -> dict[str, Any]:
    symbols: dict[str, Any] = {"classes": [], "functions": [], "routes": [], "imports": []}
    if path.endswith(".py"):
        try:
            tree = ast.parse(text)
            for node in ast.walk(tree):
                if isinstance(node, ast.ClassDef):
                    symbols["classes"].append(node.name)
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if not node.name.startswith("_"):
                        symbols["functions"].append(node.name)
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        symbols["imports"].append(alias.name.split(".")[0])
                elif isinstance(node, ast.ImportFrom) and node.module:
                    symbols["imports"].append(node.module.split(".")[0])
        except SyntaxError:
            pass
        routes = re.findall(r"@(?:app|router)\.(get|post|put|delete|patch)\(['\"]([^'\"]+)['\"]", text)
        symbols["routes"] = [f"{m.upper()} {p}" for m, p in routes]
    else:
        symbols["functions"] = re.findall(
            r"(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)", text
        )[:15]
        symbols["classes"] = re.findall(r"class\s+([A-Za-z_][A-Za-z0-9_]*)", text)[:10]
        symbols["imports"] = re.findall(r"from\s+['\"]([^'\"]+)['\"]", text)[:15]
    return symbols


def _pick_important_files(tree_paths: list[str]) -> list[str]:
    manifests = []
    entrypoints = []
    other_src = []
    ignore_prefixes = ("node_modules/", ".venv/", "venv/", "dist/", "build/", ".git/", "__pycache__/")
    for p in tree_paths:
        low = p.lower()
        if any(low.startswith(pref) or f"/{pref}" in low for pref in ignore_prefixes):
            continue
        base = low.rsplit("/", 1)[-1]
        if base in KEY_FILENAMES:
            manifests.append(p)
        elif any(low.endswith(ext) for ext in SOURCE_EXTS):
            if any(k in base for k in ("main.", "app.", "server.", "index.", "cli", "engine", "api", "router", "model")):
                entrypoints.append(p)
            elif "test" not in low:
                other_src.append(p)
    selected = manifests[:3] + entrypoints[:5] + other_src[:4]
    # Preserve uniqueness, cap at 9 files for speed
    seen = set()
    out = []
    for f in selected:
        if f not in seen:
            seen.add(f)
            out.append(f)
        if len(out) >= 9:
            break
    return out


def fetch_and_analyze_repo(
    conn: sqlite3.Connection,
    repo_ref: str,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    owner, repo = parse_repo_ref(repo_ref)
    token, _ = resolve_github_token(conn)
    headers = _gh_headers(token)
    client = http_client or httpx.Client(timeout=15.0)
    close_after = http_client is None
    try:
        meta_resp = client.get(f"{GITHUB_API}/repos/{owner}/{repo}", headers=headers)
        meta_resp.raise_for_status()
        meta = meta_resp.json()
        default_branch = meta.get("default_branch", "main")

        langs_resp = client.get(f"{GITHUB_API}/repos/{owner}/{repo}/languages", headers=headers)
        languages = langs_resp.json() if langs_resp.status_code == 200 else {}

        readme_text = ""
        rm_resp = client.get(f"{GITHUB_API}/repos/{owner}/{repo}/readme", headers=headers)
        if rm_resp.status_code == 200:
            content_b64 = rm_resp.json().get("content", "")
            try:
                readme_text = base64.b64decode(content_b64).decode("utf-8", errors="replace")[:4000]
            except Exception:
                readme_text = ""

        tree_resp = client.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/{default_branch}?recursive=1",
            headers=headers,
        )
        tree_items = tree_resp.json().get("tree", []) if tree_resp.status_code == 200 else []
        blob_paths = [it["path"] for it in tree_items if it.get("type") == "blob"]

        selected_files = _pick_important_files(blob_paths)
        files_data: list[dict[str, Any]] = []
        all_imports: set[str] = set()
        all_routes: list[str] = []
        all_classes: list[str] = []
        all_functions: list[str] = []

        for fpath in selected_files:
            fresp = client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/contents/{fpath}?ref={default_branch}",
                headers=headers,
            )
            if fresp.status_code != 200:
                continue
            fjson = fresp.json()
            if not isinstance(fjson, dict) or not fjson.get("content"):
                continue
            try:
                text = base64.b64decode(fjson["content"]).decode("utf-8", errors="replace")
            except Exception:
                continue
            syms = _extract_code_symbols(fpath, text)
            all_imports.update(syms["imports"])
            all_routes.extend(syms["routes"])
            all_classes.extend(syms["classes"])
            all_functions.extend(syms["functions"])
            files_data.append(
                {
                    "path": fpath,
                    "snippet": text[:1600],
                    "lines": len(text.splitlines()),
                    "symbols": syms,
                }
            )
    finally:
        if close_after:
            client.close()

    # Detect technologies/frameworks
    detected_frameworks: list[str] = []
    joined_paths = " ".join(blob_paths).lower()
    joined_imports = " ".join(all_imports).lower() + " " + readme_text.lower()
    checks = [
        ("FastAPI", "fastapi"),
        ("React", "react"),
        ("Playwright", "playwright"),
        ("SQLite / SQL", "sqlite"),
        ("Docker", "dockerfile"),
        ("Pytest", "pytest"),
        ("Ollama / Local LLM", "ollama"),
        ("TypeScript", ".ts"),
        ("Pydantic", "pydantic"),
        ("Tailwind / Vite", "vite"),
    ]
    for label, needle in checks:
        if needle in joined_imports or needle in joined_paths:
            detected_frameworks.append(label)

    # Determine primary DevQuest technology slug
    primary_lang = (meta.get("language") or "").lower()
    tech_slug = LANG_TO_TECH.get(primary_lang, "git")
    if "FastAPI" in detected_frameworks:
        tech_slug = "fastapi"
    elif "React" in detected_frameworks and primary_lang in {"typescript", "javascript"}:
        tech_slug = "react"

    top_dirs = sorted({p.split("/")[0] for p in blob_paths if "/" in p})[:10]
    has_tests = any("test" in p.lower() or "spec" in p.lower() for p in blob_paths)

    return {
        "owner": owner,
        "repo": repo,
        "full_name": f"{owner}/{repo}",
        "html_url": meta.get("html_url") or f"https://github.com/{owner}/{repo}",
        "description": meta.get("description") or f"Repository {owner}/{repo}",
        "default_branch": default_branch,
        "primary_language": meta.get("language") or "Multi-language",
        "languages": languages,
        "tech_slug": tech_slug,
        "file_count": len(blob_paths),
        "top_dirs": top_dirs,
        "has_tests": has_tests,
        "frameworks": detected_frameworks,
        "readme_excerpt": readme_text[:1800],
        "files": files_data,
        "routes": list(dict.fromkeys(all_routes))[:12],
        "classes": list(dict.fromkeys(all_classes))[:12],
        "functions": list(dict.fromkeys(all_functions))[:16],
    }


def _build_deterministic_interview_module(analysis: dict[str, Any]) -> dict[str, Any]:
    full_name = analysis["full_name"]
    slug_safe = re.sub(r"[^a-z0-9]+", "-", full_name.lower()).strip("-")
    mod_id = f"repo-interview-{slug_safe}"
    tech_slug = analysis["tech_slug"]

    langs = analysis["languages"]
    total_bytes = sum(langs.values()) or 1
    lang_summary = ", ".join(
        f"{k} ({round(v / total_bytes * 100)}%)"
        for k, v in sorted(langs.items(), key=lambda kv: -kv[1])[:4]
    ) or analysis["primary_language"]

    frameworks_str = ", ".join(analysis["frameworks"]) if analysis["frameworks"] else analysis["primary_language"]
    dirs_str = ", ".join(analysis["top_dirs"]) if analysis["top_dirs"] else "flat root layout"
    key_files = [f["path"] for f in analysis["files"]]
    first_file = analysis["files"][0] if analysis["files"] else None

    routes_block = "\n".join(analysis["routes"][:8]) if analysis["routes"] else ""
    symbols_summary = (
        f"Classes: {', '.join(analysis['classes'][:6]) or 'N/A'}\n"
        f"Key functions: {', '.join(analysis['functions'][:10]) or 'N/A'}\n"
        + (f"API routes:\n{routes_block}" if routes_block else "")
    )

    sections = [
        {
            "title": f"1. 60-Second Interview Pitch: {full_name}",
            "body": (
                f"{analysis['description']}. "
                f"When an interviewer asks you to walk through **{full_name}**, start with the problem it solves, "
                f"then outline the tech stack (**{frameworks_str}**; language split: {lang_summary}) "
                f"and how the repository ({analysis['file_count']} files across `{dirs_str}`) separates responsibilities."
            ),
            "code_example": (
                f"Repository: {full_name}\n"
                f"Primary Stack: {frameworks_str}\n"
                f"Top-Level Modules: {dirs_str}\n"
                f"Key Inspected Files:\n" + "\n".join(f"  - {p}" for p in key_files[:8])
            ),
        },
        {
            "title": "2. Architecture, Entrypoints & Real Code Walkthrough",
            "body": (
                "Interviewers probe past high-level buzzwords by asking *which file handles requests/startup* and *how data flows*. "
                "Study the real symbols and routes extracted directly from your codebase below so you can reference concrete file and function names."
            ),
            "code_example": symbols_summary + (
                f"\n\n--- Excerpt from {first_file['path']} ---\n{first_file['snippet'][:700]}"
                if first_file
                else ""
            ),
        },
        {
            "title": "3. Senior-Level Trade-Offs, Testing & Debugging Talking Points",
            "body": (
                f"Be ready to discuss: (1) Why you chose {frameworks_str} over heavier alternatives; "
                f"(2) Testing posture ({'automated tests detected in repo' if analysis['has_tests'] else 'how you would add automated unit + E2E tests next'}); "
                "(3) Failure modes & debugging workflow (how you inspect logs, set `breakpoint()`/debugger hooks, and handle bad external inputs); "
                "(4) How you would scale or containerize this system under higher concurrency."
            ),
        },
    ]

    # Build grounded interactive zyBooks interview quizzes from actual repo facts!
    activities: list[dict[str, Any]] = []

    # Q1: Architecture / Stack defense
    wrong_stacks = [
        "COBOL mainframe batch jobs with tape storage",
        "Pure Assembly kernel driver with zero dependencies",
        "Static LaTeX PDF template with no runtime logic",
    ]
    correct_stack_opt = f"{frameworks_str} ({lang_summary})"
    activities.append(
        {
            "id": f"{mod_id}-q-stack",
            "tech_slug": tech_slug,
            "title": "Interview Defense 1: Explain the Core Stack & Architecture",
            "activity_type": "read_check",
            "grader_type": "browser",
            "order_index": 0,
            "xp_reward": 25,
            "spec": {
                "question": f"An interviewer asks: 'Give me a concise summary of the tech stack powering {full_name}.' Which answer accurately reflects this repository?",
                "options": [wrong_stacks[0], correct_stack_opt, wrong_stacks[1], wrong_stacks[2]],
                "correct_index": 1,
                "explanation": f"Spot on! {full_name} is built with {frameworks_str} ({lang_summary}) across {analysis['file_count']} files.",
                "hint": "Check Section 1 above for the exact detected language split and frameworks.",
            },
        }
    )

    # Q2: File / Module ownership recall (fill in the blank)
    anchor_file = key_files[0] if key_files else "README.md"
    anchor_name = anchor_file.rsplit("/", 1)[-1]
    primary_fn = analysis["functions"][0] if analysis["functions"] else (analysis["classes"][0] if analysis["classes"] else anchor_name)
    activities.append(
        {
            "id": f"{mod_id}-q-symbols",
            "tech_slug": tech_slug,
            "title": "Interview Defense 2: Recall Concrete Entrypoint & Symbol Names",
            "activity_type": "fill_blank",
            "grader_type": "browser",
            "order_index": 1,
            "xp_reward": 30,
            "spec": {
                "prompt": f"Interviewers love when you cite exact files and symbols instead of hand-waving. Complete your walkthrough statement for {full_name}:",
                "template": f"In {full_name}, one of the key files I can walk through is ___ and a core symbol in the codebase is ___.",
                "blanks": [
                    {"accepted": [anchor_name, anchor_file], "case_sensitive": False, "hint": f"Key file (e.g. {anchor_name})"},
                    {"accepted": [primary_fn], "case_sensitive": False, "hint": f"Core symbol (e.g. {primary_fn})"},
                ],
                "explanation": f"Citing exact paths like `{anchor_file}` and real symbols like `{primary_fn}` instantly signals real ownership in an interview.",
            },
        }
    )

    # Q3: Interview Walkthrough Order (Parsons)
    walkthrough_steps = [
        "1. State the user problem & 1-sentence value proposition",
        f"2. Outline the high-level architecture ({dirs_str})",
        f"3. Trace a real execution path through `{anchor_file}`",
        "4. Explain one trade-off, edge case, and how you test/debug it",
    ]
    activities.append(
        {
            "id": f"{mod_id}-q-flow",
            "tech_slug": tech_slug,
            "title": "Interview Defense 3: Structure Your Technical Deep-Dive (Parsons)",
            "activity_type": "parsons",
            "grader_type": "browser",
            "order_index": 2,
            "xp_reward": 30,
            "spec": {
                "prompt": "Order the strongest interview explanation flow from 30,000-ft context down to concrete code & trade-offs:",
                "lines": [
                    walkthrough_steps[2],
                    walkthrough_steps[0],
                    walkthrough_steps[3],
                    walkthrough_steps[1],
                ],
                "correct_order": [1, 3, 0, 2],
                "explanation": "Top-down framing (Problem -> Architecture -> Concrete Code Trace -> Trade-offs & Testing) keeps interviewers engaged without losing them in weeds.",
            },
        }
    )

    return {
        "id": mod_id,
        "tech_slug": tech_slug,
        "title": f"Interview Prep: {full_name}",
        "subtitle": f"Master architecture, code flow & interview Q&A for {full_name}",
        "difficulty": "intermediate",
        "kind": "repo_interview",
        "estimated_minutes": 10,
        "order_index": 50,
        "summary": f"Deep interview preparation module generated from GitHub repository {full_name}.",
        "tags": ["github-repo", "interview-prep", tech_slug],
        "external_resources": [{"label": f"Open {full_name} on GitHub", "url": analysis["html_url"]}],
        "sections": sections,
        "activities": activities,
    }


def _enrich_with_ollama(
    base_module: dict[str, Any],
    analysis: dict[str, Any],
    model: str | None = None,
) -> dict[str, Any]:
    models = list_ollama_models(timeout=2.5)
    chosen = model or (models[0]["name"] if models else None)
    if not chosen:
        return base_module

    compact_files = [
        {"path": f["path"], "symbols": f["symbols"], "snippet": f["snippet"][:900]}
        for f in analysis["files"][:5]
    ]
    prompt = f"""You are a Staff Software Engineer coaching a candidate to ace a technical interview about their GitHub repository "{analysis['full_name']}".
Repository data:
- Description: {analysis['description']}
- Languages: {json.dumps(analysis['languages'])}
- Frameworks: {json.dumps(analysis['frameworks'])}
- Routes: {json.dumps(analysis['routes'])}
- Key files & excerpts: {json.dumps(compact_files)}

Generate ONLY a valid JSON object (no markdown fences) containing deep, repo-specific interview teaching material:
{{
  "architecture_deep_dive": "4-6 sentences explaining how the actual modules in this repo work together, naming real files/functions.",
  "grill_questions": [
    {{
      "question": "A sharp interviewer question specific to this repo's actual code/architecture",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 0,
      "explanation": "Clear senior-engineer explanation referencing real code patterns in the repo",
      "hint": "Short clue"
    }},
    {{
      "question": "A second technical question about debugging, failure modes, or trade-offs in this repo",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 1,
      "explanation": "Why this answer is strongest in an interview",
      "hint": "Short clue"
    }}
  ],
  "talking_points": "Bullet-style paragraph of 3 crisp talking points the candidate should memorize."
}}"""

    try:
        with httpx.Client(timeout=90.0) as client:
            resp = client.post(
                f"{config.OLLAMA_URL}/api/generate",
                json={
                    "model": chosen,
                    "prompt": prompt,
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": 0.35},
                },
            )
            resp.raise_for_status()
            parsed = _extract_json_object(resp.json().get("response", "{}"))
    except Exception:
        return base_module

    mod_id = base_module["id"]
    tech_slug = base_module["tech_slug"]

    if parsed.get("architecture_deep_dive"):
        base_module["sections"].append(
            {
                "title": f"4. AI Staff-Engineer Deep Dive ({chosen})",
                "body": parsed["architecture_deep_dive"],
                "code_example": parsed.get("talking_points", ""),
            }
        )

    for idx, q in enumerate(parsed.get("grill_questions") or [], start=1):
        if q.get("question") and isinstance(q.get("options"), list) and len(q["options"]) >= 2:
            base_module["activities"].append(
                {
                    "id": f"{mod_id}-ollama-grill-{idx}",
                    "tech_slug": tech_slug,
                    "title": f"Interviewer Grill Question #{idx}",
                    "activity_type": "read_check",
                    "grader_type": "browser",
                    "order_index": len(base_module["activities"]),
                    "xp_reward": 35,
                    "spec": {
                        "question": q["question"],
                        "options": q["options"],
                        "correct_index": int(q.get("correct_index", 0)),
                        "explanation": q.get("explanation", ""),
                        "hint": q.get("hint", "Think about the architecture & code flow above."),
                    },
                }
            )
    base_module["tags"] = list(dict.fromkeys([*base_module.get("tags", []), "ollama-enriched"]))
    return base_module


def create_repo_interview_pack(
    conn: sqlite3.Connection,
    repo_ref: str,
    use_ollama: bool = False,
    model: str | None = None,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    analysis = fetch_and_analyze_repo(conn, repo_ref, http_client=http_client)
    module_pack = _build_deterministic_interview_module(analysis)
    if use_ollama:
        module_pack = _enrich_with_ollama(module_pack, analysis, model=model)

    out_path = config.CURRICULUM_DIR / "generated" / f"{module_pack['id']}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(module_pack, indent=2), encoding="utf-8")

    upsert_module_pack(conn, module_pack, source="github_repo")
    return {"module": module_pack, "analysis": analysis}
