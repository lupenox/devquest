from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config
from app.db import get_conn, init_db
from app.github_study import create_repo_interview_pack, get_github_status, list_github_repos, sync_github_profile
from app.graders import grade_workspace_activity, materialize_workspace
from app.main import app
from app.rpg import calculate_par_bonus, sm2_next_review, xp_to_level
from app.sync import import_exercism_spec, sync_codewars, sync_exercism, sync_leetcode


@pytest.fixture()
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_path = tmp_path / "test_devquest.db"
    ws_dir = tmp_path / "workspaces"
    monkeypatch.setattr(config, "DB_PATH", db_path)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "WORKSPACES_DIR", ws_dir)
    monkeypatch.setenv("DEVQUEST_SKIP_GENERATED_CURRICULUM", "1")
    init_db(db_path=db_path)
    return db_path, ws_dir


def test_rpg_math_and_sm2():
    lv1, in1, need1 = xp_to_level(0)
    assert lv1 == 1 and in1 == 0 and need1 == 100
    lv2, _, _ = xp_to_level(120)
    assert lv2 == 2
    assert calculate_par_bonus(30, 40) == 20
    assert calculate_par_bonus(50, 40) == 10
    assert calculate_par_bonus(90, 40) == 0
    reps, ef, ivl, due = sm2_next_review(True, 0, 2.5, 1)
    assert reps == 1 and ivl == 1 and ef >= 2.5 and "T" in due
    reps2, _, ivl2, _ = sm2_next_review(False, reps, ef, ivl)
    assert reps2 == 0 and ivl2 == 1


def test_dashboard_seeds_all_17_technologies(isolated_env):
    client = TestClient(app)
    resp = client.get("/api/dashboard")
    assert resp.status_code == 200
    data = resp.json()
    slugs = {t["slug"] for t in data["technologies"]}
    expected = {
        "neovim", "python", "fastapi", "bash", "typescript", "javascript",
        "cpp", "json", "xml", "html", "css", "sql", "git", "react", "playwright", "regex", "debugging",
    }
    assert slugs == expected
    assert data["total_activities"] >= 30
    assert data["level"] == 1


def test_zybooks_browser_activities_and_xp_award(isolated_env):
    client = TestClient(app)
    # 1. Read Check (wrong then right)
    wrong = client.post("/api/activities/py-101-read-check/submit", json={"submission": {"selected_index": 0}})
    assert wrong.status_code == 200 and wrong.json()["passed"] is False and wrong.json()["xp_awarded"] == 0

    right = client.post("/api/activities/py-101-read-check/submit", json={"submission": {"selected_index": 1}})
    assert right.status_code == 200
    body = right.json()
    assert body["passed"] is True and body["xp_awarded"] == 20 and body["tech_mastery_pct"] > 0

    # 2. Code Trace
    trace = client.post(
        "/api/activities/py-101-code-trace/submit",
        json={"submission": {"answers": {"a": "2", "b": "6", "rest": "[12]"}}},
    )
    assert trace.status_code == 200 and trace.json()["passed"] is True

    # 3. Parsons
    parsons = client.post(
        "/api/activities/py-101-parsons/submit",
        json={"submission": {"order": [3, 1, 7, 5, 4, 6, 0, 2]}},
    )
    assert parsons.status_code == 200 and parsons.json()["passed"] is True

    # 4. Fill in the blank
    fb = client.post(
        "/api/activities/ts-101-fill-blank/submit",
        json={"submission": {"answers": ["is", "string"]}},
    )
    assert fb.status_code == 200 and fb.json()["passed"] is True


def _solve_and_grade(client: TestClient, activity_id: str, files: dict[str, str], keystrokes: int | None = None):
    ws = client.post(f"/api/activities/{activity_id}/launch-nvim", json={"reset": True}).json()
    ws_dir = Path(ws["workspace_dir"])
    for rel, content in files.items():
        (ws_dir / rel).write_text(content, encoding="utf-8")
    res = client.post(
        "/api/grade",
        json={"activity_id": activity_id, "workspace_dir": str(ws_dir), "keystrokes": keystrokes},
    )
    assert res.status_code == 200
    return res.json()


def test_all_local_graders_pass_when_solved(isolated_env):
    client = TestClient(app)

    # 1. Python
    py_res = _solve_and_grade(
        client,
        "py-101-nvim-lab",
        {
            "solution.py": (
                "def dedupe_preserve_order(items):\n"
                "    return list(dict.fromkeys(items))\n"
                "def moving_average(values, window):\n"
                "    if window <= 0 or window > len(values):\n"
                "        raise ValueError('bad window')\n"
                "    return [sum(values[i:i+window])/window for i in range(len(values)-window+1)]\n"
            )
        },
        keystrokes=60,
    )
    assert py_res["passed"] is True and py_res["par_bonus"] == 20

    # 2. FastAPI
    fa_res = _solve_and_grade(
        client,
        "fastapi-101-nvim-lab",
        {
            "api.py": (
                "from fastapi import FastAPI, HTTPException\n"
                "from pydantic import BaseModel, Field\n"
                "app = FastAPI()\n"
                "RUNS = {}\n"
                "class RunCreate(BaseModel):\n"
                "    model: str = Field(min_length=1)\n"
                "    score: float = Field(ge=0.0, le=1.0)\n"
                "@app.get('/health')\n"
                "def health(): return {'status': 'ok'}\n"
                "@app.post('/runs', status_code=201)\n"
                "def create_run(p: RunCreate):\n"
                "    rid = len(RUNS) + 1\n"
                "    RUNS[rid] = {'id': rid, **p.model_dump()}\n"
                "    return RUNS[rid]\n"
                "@app.get('/runs/{rid}')\n"
                "def get_run(rid: int):\n"
                "    if rid not in RUNS: raise HTTPException(404)\n"
                "    return RUNS[rid]\n"
            )
        },
    )
    assert fa_res["passed"] is True

    # 3. Bash
    bash_res = _solve_and_grade(
        client,
        "bash-101-nvim-lab",
        {
            "count_errors.sh": (
                "#!/usr/bin/env bash\n"
                "set -euo pipefail\n"
                "[[ $# -ge 1 && -f \"$1\" ]] || exit 1\n"
                "grep -c 'ERROR' \"$1\" || true\n"
            )
        },
    )
    assert bash_res["passed"] is True

    # 4. TypeScript (native Node 26 TS!)
    ts_res = _solve_and_grade(
        client,
        "ts-101-nvim-lab",
        {
            "solution.ts": (
                "export type JobEvent = { kind: 'start'; model: string } | { kind: 'progress'; epoch: number; loss: number } | { kind: 'fail'; reason: string };\n"
                "export function formatEvent(ev: JobEvent): string {\n"
                "  switch (ev.kind) {\n"
                "    case 'start': return `Started ${ev.model}`;\n"
                "    case 'progress': return `Epoch ${ev.epoch}: loss=${ev.loss.toFixed(2)}`;\n"
                "    case 'fail': return `Failed: ${ev.reason}`;\n"
                "  }\n"
                "}\n"
            )
        },
    )
    assert ts_res["passed"] is True

    # 5. JavaScript
    js_res = _solve_and_grade(
        client,
        "js-101-nvim-lab",
        {
            "solution.mjs": (
                "export function makeCounter(start = 0) { let c = start; return () => ++c; }\n"
                "export async function retry(fn, maxAttempts) {\n"
                "  let last;\n"
                "  for (let i = 0; i < maxAttempts; i++) {\n"
                "    try { return await fn(); } catch (e) { last = e; }\n"
                "  }\n"
                "  throw last;\n"
                "}\n"
            )
        },
    )
    assert js_res["passed"] is True

    # 6. C++20
    cpp_res = _solve_and_grade(
        client,
        "cpp-101-nvim-lab",
        {
            "solution.hpp": (
                "#pragma once\n#include <algorithm>\n#include <vector>\n"
                "inline int dot_product(const std::vector<int>& a, const std::vector<int>& b) {\n"
                "  int s = 0; for (size_t i = 0; i < a.size(); ++i) s += a[i] * b[i]; return s;\n"
                "}\n"
                "inline void clamp_in_place(std::vector<int>& xs, int lo, int hi) {\n"
                "  for (int& x : xs) x = std::clamp(x, lo, hi);\n"
                "}\n"
            )
        },
    )
    assert cpp_res["passed"] is True

    # 7. SQL
    sql_res = _solve_and_grade(
        client,
        "sql-101-nvim-lab",
        {
            "query.sql": (
                "SELECT m.name, ROUND(AVG(r.score), 2) AS avg_score "
                "FROM models m JOIN runs r ON r.model_id = m.id "
                "GROUP BY m.name HAVING AVG(r.score) >= 0.80 ORDER BY avg_score DESC;"
            )
        },
    )
    assert sql_res["passed"] is True

    # 8. Regex
    rx_res = _solve_and_grade(
        client,
        "regex-101-nvim-lab",
        {"pattern.regex": "epoch=(?P<epoch>\\d+)\\s+loss=(?P<loss>\\d+\\.\\d+)\n"},
    )
    assert rx_res["passed"] is True

    # 9. JSON
    json_res = _solve_and_grade(
        client,
        "json-101-nvim-lab",
        {
            "training_spec.json": json.dumps(
                {"name": "sft-run-1", "epochs": 3, "learning_rate": 0.0002, "tags": ["lora", "neovim"]}
            )
        },
    )
    assert json_res["passed"] is True

    # 10. XML
    xml_res = _solve_and_grade(
        client,
        "xml-101-nvim-lab",
        {
            "pipeline.xml": (
                '<?xml version="1.0"?>'
                '<pipeline version="2.0">'
                '<stage name="tokenize" enabled="true"/>'
                '<stage name="evaluate" enabled="true"><metric>f1</metric></stage>'
                '</pipeline>'
            )
        },
    )
    assert xml_res["passed"] is True

    # 11. HTML
    html_res = _solve_and_grade(
        client,
        "html-101-nvim-lab",
        {
            "index.html": (
                "<!doctype html><html><body><main><h1>Eval Runner</h1>"
                '<form><label for="model-name">Model</label><input id="model-name" required />'
                '<button type="submit">Start Eval</button></form></main></body></html>'
            )
        },
    )
    assert html_res["passed"] is True

    # 12. CSS
    css_res = _solve_and_grade(
        client,
        "css-101-nvim-lab",
        {
            "styles.css": (
                ".toolbar { display: flex; justify-content: space-between; align-items: center; }\n"
                ".skill-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }\n"
            )
        },
    )
    assert css_res["passed"] is True

    # 13. Neovim buffer diff + par bonus
    nvim_res = _solve_and_grade(
        client,
        "nvim-101-par-lab",
        {"config.env": "ENV=prod\nAPI_HOST=prod.internal\nPORT=8765\nLOG_TAG=prod-worker\n"},
        keystrokes=28,
    )
    assert nvim_res["passed"] is True and nvim_res["par_bonus"] == 20

    # 14. Git real repo sandbox
    import subprocess
    git_ws = client.post("/api/activities/git-101-sandbox-lab/launch-nvim", json={"reset": True}).json()
    gdir = Path(git_ws["workspace_dir"])
    subprocess.run("git switch -c feat/neovim-docs", shell=True, cwd=gdir, check=True)
    (gdir / "README.md").write_text("# DevQuest Git Sandbox\nStatus: ready\n", encoding="utf-8")
    subprocess.run("git add README.md && git commit -m 'ready'", shell=True, cwd=gdir, check=True)
    subprocess.run("git switch main && git merge feat/neovim-docs", shell=True, cwd=gdir, check=True)
    git_res = client.post(
        "/api/grade", json={"activity_id": "git-101-sandbox-lab", "workspace_dir": str(gdir)}
    ).json()
    assert git_res["passed"] is True

    # 15. React (if frontend node_modules installed)
    if (config.FRONTEND_DIR / "node_modules/react").exists():
        react_res = _solve_and_grade(
            client,
            "react-101-nvim-lab",
            {
                "SkillBadge.mjs": (
                    "import React from 'react';\n"
                    "export function SkillBadge({ name, mastery }) {\n"
                    "  const tier = mastery >= 80 ? 'master' : mastery >= 40 ? 'adept' : 'novice';\n"
                    "  return React.createElement('div', { className: 'skill-badge' },\n"
                    "    React.createElement('strong', null, name),\n"
                    "    React.createElement('span', { 'data-tier': tier }, `${mastery}%`)\n"
                    "  );\n"
                    "}\n"
                )
            },
        )
        assert react_res["passed"] is True

    # 16. Playwright live fixture browser grader (if playwright installed)
    if (config.FRONTEND_DIR / "node_modules/playwright").exists():
        pw_res = _solve_and_grade(
            client,
            "pw-101-nvim-lab",
            {
                "challenge.spec.mjs": (
                    "import assert from 'node:assert/strict';\n"
                    "import { chromium } from 'playwright';\n"
                    "const browser = await chromium.launch();\n"
                    "try {\n"
                    "  const page = await browser.newPage();\n"
                    "  await page.goto(process.env.TARGET_URL);\n"
                    "  await page.getByLabel('Prompt').fill('hello nvim');\n"
                    "  await page.getByRole('button', { name: 'Score' }).click();\n"
                    "  const out = await page.getByTestId('out').textContent();\n"
                    "  assert.equal(out, 'Scored: HELLO NVIM');\n"
                    "} finally { await browser.close(); }\n"
                )
            },
        )
        assert pw_res["passed"] is True


def test_external_sync_and_exercism_import(isolated_env, tmp_path: Path):
    def lc_handler(request: httpx.Request):
        return httpx.Response(
            200,
            json={
                "data": {
                    "matchedUser": {
                        "username": "coder",
                        "submitStatsGlobal": {
                            "acSubmissionNum": [
                                {"difficulty": "All", "count": 5},
                                {"difficulty": "Easy", "count": 3},
                                {"difficulty": "Medium", "count": 2},
                            ]
                        },
                    }
                }
            },
        )

    def cw_handler(request: httpx.Request):
        return httpx.Response(
            200,
            json={
                "honor": 150,
                "codeChallenges": {"totalCompleted": 4},
                "ranks": {"languages": {"python": {"score": 120}}},
            },
        )

    ex_dir = tmp_path / "exercism"
    (ex_dir / "python" / "two-fer" / ".exercism").mkdir(parents=True)
    (ex_dir / "bash" / "hello-world" / ".exercism").mkdir(parents=True)

    with get_conn() as conn:
        r_lc = sync_leetcode(conn, "coder", http_client=httpx.Client(transport=httpx.MockTransport(lc_handler)))
        assert r_lc["ok"] is True and r_lc["xp_awarded"] == 125

        r_cw = sync_codewars(conn, "coder", http_client=httpx.Client(transport=httpx.MockTransport(cw_handler)))
        assert r_cw["ok"] is True and r_cw["xp_awarded"] == 80

        r_ex = sync_exercism(conn, str(ex_dir))
        assert r_ex["ok"] is True and r_ex["total_exercises"] == 2 and r_ex["xp_awarded"] == 60

        imported = import_exercism_spec(
            conn,
            {
                "exercise": "two-fer",
                "cases": [
                    {"property": "two_fer", "input": {"name": "Alice"}, "expected": "One for Alice, one for me."}
                ],
            },
            tech_slug="python",
        )
        assert imported["id"] == "exercism-python-two-fer"


def test_debugging_graders_pdb_and_bash(isolated_env):
    client = TestClient(app)
    # Leftover breakpoint() should be caught cleanly
    bp_res = _solve_and_grade(
        client,
        "dbg-101-nvim-lab",
        {"buggy_eval.py": "def collect_scores(s, h=None):\n    breakpoint()\n    return [s]\n"},
    )
    assert bp_res["passed"] is False and "breakpoint()" in bp_res["output"]

    # Properly fixed Python debugging lab passes
    fixed_py = _solve_and_grade(
        client,
        "dbg-101-nvim-lab",
        {
            "buggy_eval.py": (
                "def collect_scores(score, history=None):\n"
                "    history = [] if history is None else history\n"
                "    history.append(score)\n"
                "    return history\n"
                "def top_k_average(scores, k):\n"
                "    if k <= 0 or not scores: return 0.0\n"
                "    top = sorted(scores, reverse=True)[:k]\n"
                "    return round(sum(top) / len(top), 4)\n"
                "def safe_ratio(hits, total):\n"
                "    return 0.0 if total == 0 else round(hits / total, 4)\n"
            )
        },
    )
    assert fixed_py["passed"] is True

    # Bash set -x debugging lab passes
    fixed_bash = _solve_and_grade(
        client,
        "dbg-102-nvim-lab",
        {
            "sum_col.sh": (
                "#!/usr/bin/env bash\n"
                "set -euo pipefail\n"
                "file=\"$1\"\n"
                "awk -F, 'NR > 1 { s += $2 } END { print s + 0 }' \"$file\"\n"
            )
        },
    )
    assert fixed_bash["passed"] is True


def test_github_connector_and_repo_interview_pack(isolated_env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import base64

    monkeypatch.setattr(config, "CURRICULUM_DIR", tmp_path / "curriculum")
    sample_py = (
        "from fastapi import FastAPI\n"
        "app = FastAPI()\n"
        "class OrderService:\n"
        "    pass\n"
        "@app.get('/orders')\n"
        "def list_orders():\n"
        "    return []\n"
    )
    b64_py = base64.b64encode(sample_py.encode()).decode()
    b64_readme = base64.b64encode(b"# Sample FastAPI Service\nHandles orders cleanly.").decode()

    def gh_handler(request: httpx.Request):
        p = request.url.path
        if p == "/user":
            return httpx.Response(200, json={"login": "lupenox", "name": "Logan", "public_repos": 5, "total_private_repos": 2})
        if p == "/user/repos":
            return httpx.Response(
                200,
                json=[
                    {
                        "full_name": "lupenox/order-api",
                        "name": "order-api",
                        "owner": {"login": "lupenox"},
                        "description": "FastAPI order service",
                        "language": "Python",
                        "private": False,
                        "stargazers_count": 3,
                        "updated_at": "2026-11-26T00:00:00Z",
                        "default_branch": "main",
                        "html_url": "https://github.com/lupenox/order-api",
                        "topics": ["fastapi"],
                    }
                ],
            )
        if p == "/repos/lupenox/order-api":
            return httpx.Response(
                200,
                json={
                    "full_name": "lupenox/order-api",
                    "description": "FastAPI order service",
                    "language": "Python",
                    "default_branch": "main",
                    "html_url": "https://github.com/lupenox/order-api",
                },
            )
        if p == "/repos/lupenox/order-api/languages":
            return httpx.Response(200, json={"Python": 9000, "SQL": 1000})
        if p == "/repos/lupenox/order-api/readme":
            return httpx.Response(200, json={"content": b64_readme})
        if p == "/repos/lupenox/order-api/git/trees/main":
            return httpx.Response(
                200,
                json={
                    "tree": [
                        {"path": "app/main.py", "type": "blob"},
                        {"path": "tests/test_orders.py", "type": "blob"},
                    ]
                },
            )
        if p == "/repos/lupenox/order-api/contents/app/main.py":
            return httpx.Response(200, json={"content": b64_py})
        return httpx.Response(404)

    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    mock_client = httpx.Client(transport=httpx.MockTransport(gh_handler))

    with get_conn() as conn:
        st = get_github_status(conn, http_client=mock_client)
        assert st["connected"] is True and st["username"] == "lupenox"

        repos = list_github_repos(conn, http_client=mock_client)
        assert len(repos) == 1 and repos[0]["full_name"] == "lupenox/order-api"

        synced = sync_github_profile(conn, http_client=mock_client)
        assert synced["ok"] is True and synced["xp_awarded"] == 15

        pack = create_repo_interview_pack(conn, "https://github.com/lupenox/order-api", use_ollama=False, http_client=mock_client)
        mod = pack["module"]
        assert mod["id"] == "repo-interview-lupenox-order-api"
        assert mod["kind"] == "repo_interview"
        assert mod["tech_slug"] == "fastapi"
        assert "list_orders" in pack["analysis"]["functions"]
        assert "GET /orders" in pack["analysis"]["routes"]
        assert len(mod["activities"]) == 3


def test_non_destructive_v1_schema_migration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import sqlite3

    v1_db = tmp_path / "legacy_v1.db"
    ws_dir = tmp_path / "workspaces"
    monkeypatch.setattr(config, "DB_PATH", v1_db)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "WORKSPACES_DIR", ws_dir)
    monkeypatch.setenv("DEVQUEST_SKIP_GENERATED_CURRICULUM", "1")

    # Create a genuine v1 schema (WITHOUT achievements, sprint_sessions, mock_interviews)
    conn = sqlite3.connect(str(v1_db))
    conn.executescript(
        """
        CREATE TABLE technologies (
            slug TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
            color TEXT NOT NULL, icon TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, last_practiced_at TEXT
        );
        CREATE TABLE modules (
            id TEXT PRIMARY KEY, tech_slug TEXT NOT NULL, title TEXT NOT NULL,
            subtitle TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT 'beginner',
            kind TEXT NOT NULL DEFAULT 'zybooks', estimated_minutes INTEGER NOT NULL DEFAULT 5,
            order_index INTEGER NOT NULL DEFAULT 0, prereq_module_id TEXT,
            source TEXT NOT NULL DEFAULT 'builtin', content_json TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE activities (
            id TEXT PRIMARY KEY, module_id TEXT NOT NULL, tech_slug TEXT NOT NULL,
            title TEXT NOT NULL, activity_type TEXT NOT NULL, grader_type TEXT NOT NULL,
            order_index INTEGER NOT NULL DEFAULT 0, xp_reward INTEGER NOT NULL DEFAULT 25,
            par_keystrokes INTEGER, spec_json TEXT NOT NULL
        );
        CREATE TABLE completions (
            activity_id TEXT PRIMARY KEY, first_passed_at TEXT NOT NULL,
            last_passed_at TEXT NOT NULL, best_keystrokes INTEGER, attempts_count INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id TEXT NOT NULL, passed INTEGER NOT NULL,
            score REAL NOT NULL DEFAULT 0, keystrokes INTEGER, output_log TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
        );
        CREATE TABLE xp_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tech_slug TEXT NOT NULL, source TEXT NOT NULL,
            amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE srs_cards (
            activity_id TEXT PRIMARY KEY, repetitions INTEGER NOT NULL DEFAULT 0,
            ease_factor REAL NOT NULL DEFAULT 2.5, interval_days INTEGER NOT NULL DEFAULT 1, due_at TEXT NOT NULL
        );
        CREATE TABLE external_profiles (
            provider TEXT PRIMARY KEY, handle TEXT NOT NULL, last_synced_at TEXT,
            last_count INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE daily_goals (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """
    )
    conn.execute(
        "INSERT INTO technologies VALUES ('python', 'Python', 'Core Languages', '#3776AB', 'code', 145, '2026-11-25T10:00:00+00:00')"
    )
    conn.execute(
        "INSERT INTO modules VALUES ('python-comprehensions-101', 'python', 'Python', '', 'beginner', 'zybooks', 5, 1, NULL, 'builtin', '{}', '2026-11-25T10:00:00+00:00')"
    )
    conn.execute(
        "INSERT INTO activities VALUES ('py-101-read-check', 'python-comprehensions-101', 'python', 'Check', 'read_check', 'browser', 0, 20, NULL, '{}')"
    )
    conn.execute(
        "INSERT INTO completions VALUES ('py-101-read-check', '2026-11-25T10:00:00+00:00', '2026-11-25T10:00:00+00:00', NULL, 1)"
    )
    conn.execute(
        "INSERT INTO xp_ledger (tech_slug, source, amount, reason, created_at) VALUES ('python', 'devquest', 145, 'Existing v1 XP', '2026-11-25T10:00:00+00:00')"
    )
    conn.execute("INSERT INTO daily_goals VALUES ('daily_xp_target', '250')")
    conn.execute("INSERT INTO external_profiles VALUES ('leetcode', 'legacy_user', NULL, 7, '{}')")
    conn.commit()
    conn.close()

    # Run v2 init_db migration
    init_db(db_path=v1_db)

    with get_conn(v1_db) as migrated:
        tables = {
            r["name"]
            for r in migrated.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        assert {
            "achievements",
            "sprint_sessions",
            "mock_interviews",
            "interview_campaigns",
            "campaign_items",
            "eval_submissions",
            "eval_dry_runs",
        }.issubset(tables)

        py_row = migrated.execute("SELECT xp FROM technologies WHERE slug = 'python'").fetchone()
        assert int(py_row["xp"]) == 145

        comp = migrated.execute("SELECT * FROM completions WHERE activity_id = 'py-101-read-check'").fetchone()
        assert comp is not None

        goal = migrated.execute("SELECT value FROM daily_goals WHERE key = 'daily_xp_target'").fetchone()
        assert goal["value"] == "250"

        ext = migrated.execute("SELECT handle, last_count FROM external_profiles WHERE provider = 'leetcode'").fetchone()
        assert ext["handle"] == "legacy_user" and int(ext["last_count"]) == 7

    client = TestClient(app)
    dash = client.get("/api/dashboard").json()
    assert dash["total_xp"] == 145
    assert dash["daily_xp_target"] == 250
    assert isinstance(dash["rank_title"], str) and len(dash["rank_title"]) > 0
    assert len(dash["achievements"]) == 13
    assert len(dash["daily_warmup"]) == 3
    for item in dash["daily_warmup"]:
        assert {"activity_id", "title", "tech_slug", "module_id", "activity_type", "xp_reward", "reason"}.issubset(
            item.keys()
        )


def test_search_endpoint(isolated_env):
    client = TestClient(app)

    # Empty query returns populated catalog slices
    empty = client.get("/api/search?q=").json()
    assert set(empty.keys()) >= {"technologies", "modules", "activities", "packs"}
    assert len(empty["technologies"]) > 0
    assert len(empty["modules"]) > 0
    assert len(empty["activities"]) > 0

    # Specific query for pdb
    pdb_res = client.get("/api/search?q=pdb").json()
    assert any(m["id"] == "debugging-pdb-101" for m in pdb_res["modules"])
    assert any("dbg-101" in a["id"] for a in pdb_res["activities"])

    # Technology search
    py_res = client.get("/api/search?q=python").json()
    assert any(t["slug"] == "python" for t in py_res["technologies"])

    # Repo pack appears under packs
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO modules (
                id, tech_slug, title, subtitle, difficulty, kind, estimated_minutes,
                order_index, prereq_module_id, source, content_json, created_at
            ) VALUES (
                'repo-interview-demo-svc', 'fastapi', 'Interview Prep: demo/svc',
                'Order API walkthrough', 'intermediate', 'repo_interview', 10,
                50, NULL, 'github_repo', '{}', '2026-11-26T00:00:00+00:00'
            )
            """
        )
    pack_res = client.get("/api/search?q=demo/svc").json()
    assert any(p["id"] == "repo-interview-demo-svc" for p in pack_res["packs"])


def test_achievements_unlock_and_idempotency(isolated_env):
    from datetime import timedelta

    from app.achievements import ACHIEVEMENTS, evaluate_achievements
    from app.db import award_xp
    from app.rpg import utcnow

    assert len(ACHIEVEMENTS) == 13
    client = TestClient(app)

    # Completing first activity unlocks first_quest via HTTP submit
    r1 = client.post("/api/activities/py-101-read-check/submit", json={"submission": {"selected_index": 1}}).json()
    assert r1["passed"] is True
    unlocked_slugs = {a["slug"] for a in r1["unlocked_achievements"]}
    assert "first_quest" in unlocked_slugs

    # Solving Neovim lab under par unlocks vim_par_sniper (and crosses 100 XP daily goal -> daily_goal_crusher)
    par_res = _solve_and_grade(
        client,
        "nvim-101-par-lab",
        {"config.env": "ENV=prod\nAPI_HOST=prod.internal\nPORT=8765\nLOG_TAG=prod-worker\n"},
        keystrokes=25,
    )
    assert par_res["passed"] is True
    par_unlocked = {a["slug"] for a in par_res["unlocked_achievements"]}
    assert "vim_par_sniper" in par_unlocked
    assert "daily_goal_crusher" in par_unlocked

    # Solving debugging lab unlocks bug_hunter
    dbg_res = _solve_and_grade(
        client,
        "dbg-102-nvim-lab",
        {
            "sum_col.sh": (
                "#!/usr/bin/env bash\n"
                "set -euo pipefail\n"
                "file=\"$1\"\n"
                "awk -F, 'NR > 1 { s += $2 } END { print s + 0 }' \"$file\"\n"
            )
        },
    )
    assert dbg_res["passed"] is True
    assert "bug_hunter" in {a["slug"] for a in dbg_res["unlocked_achievements"]}

    # Trigger remaining achievements cleanly and check idempotency
    with get_conn() as conn:
        # 3-day streak entries
        now = utcnow()
        for days_ago in (1, 2):
            dt = (now - timedelta(days=days_ago)).isoformat()
            conn.execute(
                "INSERT INTO xp_ledger (tech_slug, source, amount, reason, created_at) VALUES ('python', 'devquest', 20, 'streak test', ?)",
                (dt,),
            )

        # Polyglot 10 + Level 5 Hero
        for slug in ("fastapi", "bash", "typescript", "javascript", "cpp", "sql", "regex", "json", "xml", "git"):
            award_xp(conn, slug, 120, "devquest", f"Practice {slug}")

        # Boss project completion
        boss_act = conn.execute(
            "SELECT a.id FROM activities a JOIN modules m ON m.id = a.module_id WHERE a.activity_type = 'boss_checkpoint' OR m.kind = 'project' LIMIT 1"
        ).fetchone()
        if boss_act:
            conn.execute(
                "INSERT OR IGNORE INTO completions VALUES (?, ?, ?, NULL, 1)",
                (boss_act["id"], now.isoformat(), now.isoformat()),
            )

        # Sprint combo 3, GitHub study pack, Interview ready >= 80
        conn.execute(
            "INSERT INTO sprint_sessions (duration_minutes, completed_count, max_combo, bonus_xp, created_at) VALUES (5, 4, 3, 80, ?)",
            (now.isoformat(),),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO modules (
                id, tech_slug, title, subtitle, difficulty, kind, estimated_minutes,
                order_index, prereq_module_id, source, content_json, created_at
            ) VALUES (
                'repo-interview-ach-test', 'fastapi', 'Interview Prep: lupenox/ach',
                '', 'intermediate', 'repo_interview', 10, 50, NULL, 'github_repo', '{}', ?
            )
            """,
            (now.isoformat(),),
        )
        conn.execute(
            """
            INSERT INTO mock_interviews (repo_full_name, module_id, status, readiness_score, transcript_json, created_at, updated_at)
            VALUES ('lupenox/ach', 'repo-interview-ach-test', 'completed', 88.0, '[]', ?, ?)
            """,
            (now.isoformat(), now.isoformat()),
        )
        for sid in ("eval-py-async-timer", "eval-fastapi-rate-limit", "eval-py-test-cheat"):
            conn.execute(
                """
                INSERT INTO eval_submissions (scenario_id, choice, spotted_tags_json, rationale, followup_prompt, aligned, rubric_score, feedback_json, created_at)
                VALUES (?, 'strongly_b', '[]', 'grounded review', 'add test', 1, 88, '{}', ?)
                """,
                (sid, now.isoformat()),
            )

        newly = evaluate_achievements(conn)
        newly_slugs = {a["slug"] for a in newly}
        assert {
            "polyglot_5",
            "polyglot_10",
            "sprint_combo_3",
            "streak_3",
            "github_connected",
            "interview_ready",
            "level_5_hero",
            "ai_eval_ready",
        }.issubset(newly_slugs)
        if boss_act:
            assert "boss_slayer" in newly_slugs

        # Idempotent second call unlocks nothing and adds no XP
        xp_before = int(conn.execute("SELECT COALESCE(SUM(amount), 0) AS s FROM xp_ledger").fetchone()["s"])
        again = evaluate_achievements(conn)
        xp_after = int(conn.execute("SELECT COALESCE(SUM(amount), 0) AS s FROM xp_ledger").fetchone()["s"])
        assert again == []
        assert xp_after == xp_before

    dash = client.get("/api/dashboard").json()
    assert len(dash["achievements"]) == 13
    assert all(a["unlocked"] is True and a["unlocked_at"] is not None for a in dash["achievements"])
    assert dash["level"] >= 5
    assert dash["rank_title"] in {
        "Polyglot Ranger",
        "Systems Crafter",
        "Pipeline Tactician",
        "Kernel Whisperer",
        "Principal Tinkerer",
        "Staff Architect",
    }


def test_pdb_sim_and_regex_sql_playgrounds(isolated_env):
    from app.graders import grade_browser_activity

    # Direct pdb_sim grader check
    spec = {
        "required_actions": ["step", "inspect_var:total", "stack"],
        "explanation": "Stepping with n and inspecting total exposed the overwrite bug.",
    }
    partial = grade_browser_activity("pdb_sim", spec, {"completed_actions": ["step"]})
    assert partial.passed is False and 0 < partial.score < 1.0 and "stack" in partial.output

    complete = grade_browser_activity(
        "pdb_sim",
        spec,
        {"completed_actions": ["step", "inspect_var:total", "stack", "continue"]},
    )
    assert complete.passed is True and complete.score == 1.0

    # End-to-end HTTP submit for the real curriculum pdb_sim activity (dbg-101-pdb-sim)
    client = TestClient(app)
    fail_resp = client.post(
        "/api/activities/dbg-101-pdb-sim/submit",
        json={"submission": {"completed_actions": ["step"]}},
    ).json()
    assert fail_resp["passed"] is False

    pass_resp = client.post(
        "/api/activities/dbg-101-pdb-sim/submit",
        json={"submission": {"completed_actions": ["step", "inspect_var:total", "stack"]}},
    ).json()
    assert pass_resp["passed"] is True
    assert "bug_hunter" in {a["slug"] for a in pass_resp["unlocked_achievements"]}

    # Regex playground: named groups
    rx_named = client.post(
        "/api/playground/regex",
        json={"pattern": r"epoch=(?P<epoch>\d+)\s+loss=(?P<loss>\d+\.\d+)", "text": "epoch=3 loss=0.42 | epoch=4 loss=0.31"},
    ).json()
    assert rx_named["ok"] is True and rx_named["error"] is None
    assert len(rx_named["matches"]) == 2
    assert rx_named["matches"][0]["groups"] == {"epoch": "3", "loss": "0.42"}

    # Regex playground: unnamed numbered groups
    rx_num = client.post(
        "/api/playground/regex",
        json={"pattern": r"(\w+)=(\d+)", "text": "lr=10 bs=32"},
    ).json()
    assert rx_num["ok"] is True and rx_num["matches"][0]["groups"] == {"1": "lr", "2": "10"}

    # Regex playground: invalid regex syntax
    rx_err = client.post(
        "/api/playground/regex",
        json={"pattern": r"(?P<unclosed", "text": "hello"},
    ).json()
    assert rx_err["ok"] is False and rx_err["error"] is not None and rx_err["matches"] == []

    # SQL playground: valid query against sql-101-nvim-lab
    sql_ok = client.post(
        "/api/playground/sql/sql-101-nvim-lab",
        json={"query": "SELECT m.name, COUNT(r.id) AS cnt FROM models m JOIN runs r ON r.model_id = m.id GROUP BY m.name ORDER BY m.name"},
    ).json()
    assert sql_ok["ok"] is True and sql_ok["error"] is None
    assert sql_ok["columns"] == ["name", "cnt"]
    assert len(sql_ok["rows"]) >= 1

    # SQL playground: window function support
    sql_win = client.post(
        "/api/playground/sql/sql-101-nvim-lab",
        json={"query": "SELECT id, score, ROW_NUMBER() OVER (ORDER BY score DESC) AS rn FROM runs"},
    ).json()
    assert sql_win["ok"] is True and sql_win["columns"] == ["id", "score", "rn"]

    # SQL playground: read-only authorizer blocks mutating SQL / ATTACH
    sql_deny = client.post(
        "/api/playground/sql/sql-101-nvim-lab",
        json={"query": "DELETE FROM runs"},
    ).json()
    assert sql_deny["ok"] is False and sql_deny["error"] is not None

    # SQL playground: 404 on unknown activity
    assert client.post("/api/playground/sql/nonexistent-sql", json={"query": "SELECT 1"}).status_code == 404


def test_sprint_start_and_complete(isolated_env):
    client = TestClient(app)

    s2 = client.post("/api/sprint/start", json={"duration_minutes": 2}).json()
    assert s2["duration_minutes"] == 2 and len(s2["activities"]) == 2
    assert isinstance(s2["activities"][0]["spec"], dict)

    s5 = client.post("/api/sprint/start", json={"duration_minutes": 5}).json()
    assert len(s5["activities"]) == 4

    s10 = client.post("/api/sprint/start", json={"duration_minutes": 10}).json()
    assert len(s10["activities"]) == 6

    s_py = client.post("/api/sprint/start", json={"duration_minutes": 2, "tech_slug": "python"}).json()
    assert len(s_py["activities"]) == 2
    assert all(a["tech_slug"] == "python" for a in s_py["activities"])

    assert client.post("/api/sprint/start", json={"duration_minutes": 2, "tech_slug": "no-such-tech"}).status_code == 404

    comp = client.post(
        "/api/sprint/complete",
        json={"duration_minutes": 5, "completed_count": 4, "max_combo": 3},
    ).json()
    assert comp["bonus_xp"] == 80
    assert "sprint_combo_3" in {a["slug"] for a in comp["unlocked_achievements"]}


def test_safe_terminal_launcher(isolated_env, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    from app import terminal_launcher

    client = TestClient(app)
    spawned: list[dict] = []

    def fake_popen(argv, **kwargs):
        spawned.append({"argv": argv, "kwargs": kwargs})
        return object()

    monkeypatch.setattr(terminal_launcher.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(terminal_launcher.shutil, "which", lambda name: f"/usr/bin/{name}" if name in {"konsole", "kitty"} else None)
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.delenv("DEVQUEST_TERMINAL", raising=False)

    res = client.post("/api/activities/py-101-nvim-lab/open-terminal", json={"reset": False})
    assert res.status_code == 200
    body = res.json()
    assert body["launched"] is True
    assert body["terminal"] == "konsole"
    assert len(spawned) == 1
    assert spawned[0]["argv"] == [
        "/usr/bin/konsole",
        "--workdir",
        body["workspace_dir"],
        "-e",
        "nvim",
        "solution.py",
    ]
    assert spawned[0]["kwargs"].get("shell") is None

    # Disallowed DEVQUEST_TERMINAL is ignored in favor of allowlisted konsole
    monkeypatch.setenv("DEVQUEST_TERMINAL", "bash")
    spawned.clear()
    res2 = client.post("/api/activities/py-101-nvim-lab/open-terminal", json={"reset": False}).json()
    assert res2["launched"] is True and res2["terminal"] == "konsole"

    # Allowlisted DEVQUEST_TERMINAL=kitty is respected
    monkeypatch.setenv("DEVQUEST_TERMINAL", "kitty")
    spawned.clear()
    res3 = client.post("/api/activities/py-101-nvim-lab/open-terminal", json={"reset": False}).json()
    assert res3["launched"] is True and res3["terminal"] == "kitty"
    assert spawned[0]["argv"][0] == "/usr/bin/kitty"

    # Headless session returns clean fallback without crashing
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    res_headless = client.post("/api/activities/py-101-nvim-lab/open-terminal", json={"reset": False}).json()
    assert res_headless["launched"] is False and "nvim_command" in res_headless

    # Rejects unknown activity_id
    assert client.post("/api/activities/does-not-exist/open-terminal", json={"reset": False}).status_code == 404

    # Rejects workspace outside WORKSPACES_DIR and path traversal in primary_file
    outside = tmp_path / "outside_dir"
    outside.mkdir()
    with pytest.raises(ValueError):
        terminal_launcher.validate_workspace_target(outside, "solution.py")

    ws_inside = Path(body["workspace_dir"])
    with pytest.raises(ValueError):
        terminal_launcher.validate_workspace_target(ws_inside, "../../etc/passwd")


def test_mock_interview_ollama_and_fallback(isolated_env, monkeypatch: pytest.MonkeyPatch):
    import base64

    from app import mock_interview
    from app.mock_interview import answer_mock_question, list_mock_interviews, start_mock_interview

    sample_py = (
        "from fastapi import FastAPI\n"
        "app = FastAPI()\n"
        "class OrderService:\n"
        "    pass\n"
        "@app.get('/orders')\n"
        "def list_orders():\n"
        "    return []\n"
    )
    b64_py = base64.b64encode(sample_py.encode()).decode()
    b64_readme = base64.b64encode(b"# Order API\nFastAPI order microservice.").decode()

    def gh_handler(request: httpx.Request):
        p = request.url.path
        if p == "/repos/lupenox/order-api":
            return httpx.Response(
                200,
                json={
                    "full_name": "lupenox/order-api",
                    "description": "FastAPI order service",
                    "language": "Python",
                    "default_branch": "main",
                    "html_url": "https://github.com/lupenox/order-api",
                },
            )
        if p == "/repos/lupenox/order-api/languages":
            return httpx.Response(200, json={"Python": 9000})
        if p == "/repos/lupenox/order-api/readme":
            return httpx.Response(200, json={"content": b64_readme})
        if p == "/repos/lupenox/order-api/git/trees/main":
            return httpx.Response(200, json={"tree": [{"path": "app/main.py", "type": "blob"}]})
        if p == "/repos/lupenox/order-api/contents/app/main.py":
            return httpx.Response(200, json={"content": b64_py})
        return httpx.Response(404)

    gh_client = httpx.Client(transport=httpx.MockTransport(gh_handler))

    def ollama_ok_handler(request: httpx.Request):
        return httpx.Response(
            200,
            json={
                "response": json.dumps(
                    {
                        "clarity": 22,
                        "accuracy": 21,
                        "code_refs": 23,
                        "tradeoffs": 20,
                        "feedback": "Clear walkthrough citing app/main.py and GET /orders.",
                        "ideal_points": ["Trace GET /orders", "Explain validation trade-offs"],
                    }
                )
            },
        )

    ollama_ok_client = httpx.Client(transport=httpx.MockTransport(ollama_ok_handler))

    # Disable auto-detecting local Ollama when testing deterministic fallback
    monkeypatch.setattr(mock_interview, "list_ollama_models", lambda timeout=1.5: [])

    with get_conn() as conn:
        started = start_mock_interview(conn, "lupenox/order-api", http_client=gh_client)
        sid = started["session_id"]
        assert started["repo_full_name"] == "lupenox/order-api"
        assert started["total_questions"] == 4
        assert started["current_index"] == 0
        assert "app/main.py" in started["question"]["context_hint"] or "order-api" in started["question"]["question"]

        # Q1 graded via mocked Ollama JSON
        a1 = answer_mock_question(
            conn,
            sid,
            "Order API uses FastAPI in app/main.py with list_orders and OrderService because Pydantic validation keeps latency low.",
            model="qwen2.5:7b",
            ollama_client=ollama_ok_client,
        )
        assert a1["completed"] is False
        assert a1["rubric"]["total"] == 86
        assert a1["rubric"]["graded_by"] == "ollama:qwen2.5:7b"
        assert a1["next_question"]["index"] == 1

        # Q2, Q3, Q4 graded via deterministic rubric fallback (strong Staff-level answers)
        strong_answer = (
            "First, requests enter `app/main.py` at `GET /orders` and call `list_orders` alongside `OrderService`. "
            "Next, FastAPI and Pydantic validate input schemas and handle exceptions cleanly with pytest unit tests and pdb debugging. "
            "The main trade-off is simplicity vs horizontal scalability: at 100x load the bottleneck would be database concurrency and latency, "
            "so I would add caching, connection pooling, and timeout retries while keeping the stateless route layer simple."
        )
        a2 = answer_mock_question(conn, sid, strong_answer)
        assert a2["rubric"]["graded_by"] == "deterministic_rubric"
        assert a2["rubric"]["total"] >= 80
        assert a2["next_question"]["index"] == 2

        a3 = answer_mock_question(conn, sid, strong_answer)
        assert a3["next_question"]["index"] == 3

        a4 = answer_mock_question(conn, sid, strong_answer)
        assert a4["completed"] is True
        assert a4["status"] == "completed"
        assert a4["next_question"] is None
        assert a4["readiness_score"] >= 80.0
        assert a4["xp_awarded"] >= 80
        assert "interview_ready" in {a["slug"] for a in a4["unlocked_achievements"]}

        # Verify weak answer scores significantly lower on deterministic rubric
        weak_rubric = mock_interview._grade_deterministic_rubric(
            {"code_refs_pool": ["app/main.py", "list_orders"], "stack_pool": ["FastAPI"], "ideal_points": ["p1"]},
            "it works fine",
        )
        assert weak_rubric["total"] < 35

        sessions = list_mock_interviews(conn)
        assert len(sessions) == 1
        assert sessions[0]["status"] == "completed"
        assert sessions[0]["answered_count"] == 4
        assert sessions[0]["readiness_score"] >= 80.0

    # HTTP endpoints check
    client = TestClient(app)
    listed = client.get("/api/interviews").json()
    assert len(listed["interviews"]) == 1
    assert client.post("/api/interviews/start", json={"repo": "not-a-valid-repo"}).status_code == 400
    assert client.post("/api/interviews/99999/answer", json={"answer": "hello"}).status_code == 404


def test_spa_fallback_and_static_assets(isolated_env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    fe_root = tmp_path / "frontend"
    dist = fe_root / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><html><body>DevQuest SPA</body></html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('devquest');", encoding="utf-8")
    (dist / "favicon.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (dist / "manifest.webmanifest").write_text('{"name":"DevQuest"}', encoding="utf-8")
    (dist / "sw.js").write_text("self.addEventListener('fetch', () => {});", encoding="utf-8")
    monkeypatch.setattr(config, "FRONTEND_DIR", fe_root)

    client = TestClient(app)

    # SPA routes return index.html
    for path in ("/", "/tracks/python", "/modules/debugging-pdb-101", "/sprint", "/repos", "/tree"):
        r = client.get(path)
        assert r.status_code == 200
        assert "DevQuest SPA" in r.text

    # Real static assets & PWA files serve directly
    r_js = client.get("/assets/app.js")
    assert r_js.status_code == 200 and "console.log('devquest')" in r_js.text

    r_man = client.get("/manifest.webmanifest")
    assert r_man.status_code == 200 and r_man.json()["name"] == "DevQuest"

    r_sw = client.get("/sw.js")
    assert r_sw.status_code == 200 and "fetch" in r_sw.text

    r_fav = client.get("/favicon.png")
    assert r_fav.status_code == 200

    # Unknown API & missing assets still return 404 (not index.html)
    assert client.get("/api/nonexistent-endpoint").status_code == 404
    assert client.get("/assets/does-not-exist.js").status_code == 404


def _make_minimal_pdf(text: str) -> bytes:
    """Builds a tiny valid 1-page PDF containing `text` for pypdf extraction tests."""
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET\n".encode("latin-1")
    objs = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
        f"4 0 obj\n<< /Length {len(stream)} >>\nstream\n".encode("latin-1") + stream + b"endstream\nendobj\n",
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objs:
        offsets.append(len(out))
        out.extend(obj)
    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objs) + 1}\n".encode("latin-1"))
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
    out.extend(
        f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1")
    )
    return bytes(out)


def test_interview_campaign_pdf_schedule_practice_and_mock(isolated_env, monkeypatch: pytest.MonkeyPatch):
    from datetime import timedelta

    from app import mock_interview
    from app.rpg import utcnow

    monkeypatch.setattr(mock_interview, "list_ollama_models", lambda timeout=1.5: [])
    client = TestClient(app)

    # Dashboard starts with no upcoming campaign
    assert client.get("/api/dashboard").json()["upcoming_campaign"] is None

    # 1. Resume parsing: PDF + TXT + rejected binary
    pdf_bytes = _make_minimal_pdf("Acme Candidate - Python FastAPI Voice Agent Engineer")
    pdf_resp = client.post(
        "/api/campaigns/parse-resume",
        files={"file": ("candidate_resume.pdf", pdf_bytes, "application/pdf")},
    )
    assert pdf_resp.status_code == 200
    pdf_body = pdf_resp.json()
    assert pdf_body["filename"] == "candidate_resume.pdf"
    assert "Acme Candidate" in pdf_body["text"]
    assert pdf_body["char_count"] == len(pdf_body["text"])
    assert pdf_body["preview"] == pdf_body["text"][:400]

    txt_resp = client.post(
        "/api/campaigns/parse-resume",
        files={"file": ("resume.md", b"# Projects\n- Voice Agent: Python + FastAPI + WebSockets\n", "text/markdown")},
    )
    assert txt_resp.status_code == 200 and "Voice Agent" in txt_resp.json()["text"]

    bad_resp = client.post(
        "/api/campaigns/parse-resume",
        files={"file": ("avatar.png", b"\x89PNG\r\n", "image/png")},
    )
    assert bad_resp.status_code == 400

    # 2. Create reusable time-boxed campaign for fictional Acme AI (~70 hours out)
    interview_dt = (utcnow() + timedelta(hours=70)).isoformat()
    create_resp = client.post(
        "/api/campaigns",
        json={
            "company": "Acme AI",
            "role": "SWE, Applied AI",
            "interview_at": interview_dt,
            "duration_minutes": 20,
            "daily_minutes": 30,
            "meeting_url": "https://meet.example.com/acme-r1",
            "interviewer_name": "Alex Rivera (CTO)",
            "interviewer_notes": "Focuses on architecture clarity, testing discipline, and calm debugging stories.",
            "mission_notes": "Building reliable human-centered AI safety evaluation pipelines.",
            "resume_filename": "candidate_resume.pdf",
            "resume_text": pdf_body["text"] + "\nPROJECTS\n- Acme Voice Agent: Python, FastAPI, asyncio timers\n- Acme RAG Eval: hybrid dense + BM25 search with pytest CI\n",
            "prep_brief_text": (
                "## Prep Questions\n"
                "- How did you test async pipelines offline without flaky API calls?\n"
                "## Gaps\n"
                "- Lighter Rust CLI experience — emphasize C++ systems background and fast week-1 ramp.\n"
                "## Questions to Ask\n"
                "- What is the biggest evaluation bottleneck for Acme AI this quarter?\n"
            ),
            "linked_repos": ["acme/voice-agent", "acme/rag-eval"],
            "use_ollama": False,
        },
    )
    assert create_resp.status_code == 200
    camp = create_resp.json()
    cid = camp["id"]
    assert camp["company"] == "Acme AI"
    assert camp["role"] == "SWE, Applied AI"
    assert camp["duration_minutes"] == 20
    assert camp["readiness_pct"] == 0.0
    assert camp["hours_until"] > 60.0
    assert len(camp["items"]) >= 5
    day_numbers = {d["day_number"] for d in camp["days"]}
    assert 0 in day_numbers and 1 in day_numbers
    assert camp["days"][-1]["day_number"] == 0  # Morning skim appears last in day order
    categories = {it["category"] for it in camp["items"]}
    assert {"PITCH", "PROJECT", "DEBUG STORY", "GAP PREP", "ASK THEM"}.issubset(categories)

    # 3. Dashboard exposes upcoming_campaign cleanly
    dash = client.get("/api/dashboard").json()
    up = dash["upcoming_campaign"]
    assert up is not None
    assert up["id"] == cid
    assert up["company"] == "Acme AI"
    assert up["readiness_pct"] == 0.0
    assert up["next_item_title"] == camp["items"][0]["title"]

    # List & get detail endpoints
    listed = client.get("/api/campaigns").json()["campaigns"]
    assert len(listed) == 1 and listed[0]["id"] == cid
    fetched = client.get(f"/api/campaigns/{cid}").json()
    assert fetched["id"] == cid and len(fetched["items"]) == len(camp["items"])
    assert client.get("/api/campaigns/no-such-campaign").status_code == 404

    # 4. Practice confidence progression, capped XP (no farming), notes persistence & readiness %
    first_item_id = camp["items"][0]["id"]

    p_shaky = client.post(
        f"/api/campaigns/{cid}/items/{first_item_id}/practice",
        json={"confidence": "shaky", "notes": "Tighten intro to 40 seconds"},
    )
    assert p_shaky.status_code == 200
    b_shaky = p_shaky.json()
    assert b_shaky["xp_awarded"] == 0
    assert b_shaky["item"]["confidence"] == "shaky"
    assert b_shaky["item"]["practice_count"] == 1
    assert b_shaky["item"]["notes"] == "Tighten intro to 40 seconds"
    assert b_shaky["campaign"]["readiness_pct"] > 0

    p_ready = client.post(
        f"/api/campaigns/{cid}/items/{first_item_id}/practice",
        json={"confidence": "ready"},
    ).json()
    assert p_ready["xp_awarded"] == 10
    assert p_ready["item"]["notes"] == "Tighten intro to 40 seconds"  # preserved when notes omitted
    assert p_ready["campaign"]["mastered_items"] == 1

    # Repeating ready grants 0 extra XP
    p_ready_dup = client.post(
        f"/api/campaigns/{cid}/items/{first_item_id}/practice",
        json={"confidence": "ready"},
    ).json()
    assert p_ready_dup["xp_awarded"] == 0

    # Upgrading ready -> nailed awards remaining +10 (20 total cap)
    p_nailed = client.post(
        f"/api/campaigns/{cid}/items/{first_item_id}/practice",
        json={"confidence": "nailed"},
    ).json()
    assert p_nailed["xp_awarded"] == 10
    assert p_nailed["campaign"]["readiness_pct"] > p_ready["campaign"]["readiness_pct"]

    # Repeating nailed grants 0 extra XP (anti-farming cap)
    p_nailed_dup = client.post(
        f"/api/campaigns/{cid}/items/{first_item_id}/practice",
        json={"confidence": "nailed"},
    ).json()
    assert p_nailed_dup["xp_awarded"] == 0

    # Validation errors
    assert client.post(f"/api/campaigns/{cid}/items/{first_item_id}/practice", json={"confidence": "bogus"}).status_code == 400
    assert client.post(f"/api/campaigns/{cid}/items/missing-item/practice", json={"confidence": "ready"}).status_code == 404

    # 5. Tailored Campaign Mock Interview compatible with MockInterviewPanel + answer_mock_question
    mock_start = client.post(f"/api/campaigns/{cid}/mock-interview", json={})
    assert mock_start.status_code == 200
    ms = mock_start.json()
    assert ms["repo_full_name"] == "Acme AI — SWE, Applied AI"
    assert ms["total_questions"] == 4
    assert ms["current_index"] == 0
    assert "Acme AI" in ms["question"]["question"]
    assert "Alex Rivera" in ms["question"]["question"]

    mock_ans = client.post(
        f"/api/interviews/{ms['session_id']}/answer",
        json={
            "answer": (
                "First, I build Python and FastAPI AI systems like `acme/voice-agent` and `acme/rag-eval` "
                "with deterministic pytest verification. I am excited by Acme AI's safety evaluation mission "
                "because clear trade-offs around latency, fail-closed validation, and regression testing matter deeply."
            )
        },
    )
    assert mock_ans.status_code == 200
    ma = mock_ans.json()
    assert ma["rubric"]["total"] > 50
    assert ma["next_question"]["index"] == 1
    assert ma["completed"] is False

    # 6. Pre-structured items creation + Delete campaign cleans up cleanly
    custom_resp = client.post(
        "/api/campaigns",
        json={
            "id": "acme-custom-seed",
            "company": "Acme Labs",
            "role": "Backend Engineer",
            "interview_at": interview_dt,
            "items": [
                {
                    "id": "acme-item-1",
                    "day_number": 1,
                    "day_label": "Day 1 — Core",
                    "category": "PITCH",
                    "title": "45s Pitch",
                    "prompt": "Deliver pitch",
                    "key_points": ["Point A", "Point B"],
                    "target_seconds": 45,
                    "estimated_minutes": 5,
                }
            ],
        },
    )
    assert custom_resp.status_code == 200
    assert len(custom_resp.json()["items"]) == 1
    assert custom_resp.json()["items"][0]["id"] == "acme-item-1"

    assert client.delete(f"/api/campaigns/{cid}").json() == {"deleted": cid}
    assert client.delete("/api/campaigns/acme-custom-seed").json() == {"deleted": "acme-custom-seed"}
    assert client.get(f"/api/campaigns/{cid}").status_code == 404
    assert client.get("/api/dashboard").json()["upcoming_campaign"] is None


def test_ai_eval_lab_scenarios_rubric_achievement_and_dry_runs(isolated_env):
    client = TestClient(app)

    # 1. Load overview: all 6 scenarios present, 0 completed, 4-step confidence ladder
    ov0 = client.get("/api/eval-lab")
    assert ov0.status_code == 200
    body0 = ov0.json()
    assert body0["total_scenarios"] == 6
    assert body0["completed_count"] == 0
    assert body0["confidence_pct"] == 0
    assert len(body0["ladder"]) == 4
    assert all(step["done"] is False for step in body0["ladder"])
    scenario_ids = [s["id"] for s in body0["scenarios"]]
    assert scenario_ids == [
        "eval-py-async-timer",
        "eval-fastapi-rate-limit",
        "eval-py-test-cheat",
        "eval-react-silent-reload",
        "eval-sql-window-topn",
        "eval-bash-strict-refactor",
    ]
    for s in body0["scenarios"]:
        assert {"label", "summary", "code", "test_output"}.issubset(s["approach_a"].keys())
        assert {"label", "summary", "code", "test_output"}.issubset(s["approach_b"].keys())
        assert len(s["available_tags"]) >= 4

    # 2. Submit calibrated review on reward-hacking TTL cache scenario
    s1_resp = client.post(
        "/api/eval-lab/scenarios/eval-py-test-cheat/submit",
        json={
            "choice": "strongly_b",
            "spotted_tags": ["weakened_test", "clean_tests", "idiomatic_fix"],
            "rationale": (
                "Strongly prefer Approach B because Approach A weakened the assertion in `test_cache.py` "
                "to `in (None, 'v')` without fixing `get()`. Approach B uses an injectable `time.monotonic` "
                "clock, checks `expires_at`, pops expired keys to evict them, and keeps strict pytest assertions."
            ),
            "followup_prompt": (
                "Keep Approach B's monotonic clock and strict assertions, and please add an edge-case pytest "
                "verifying `ttl <= 0` expires immediately."
            ),
        },
    )
    assert s1_resp.status_code == 200
    s1 = s1_resp.json()
    assert s1["aligned"] is True
    assert s1["expected_side"] == "b"
    assert set(s1["matched_tags"]) == {"weakened_test", "clean_tests", "idiomatic_fix"}
    assert s1["missed_tags"] == []
    assert s1["xp_awarded"] == 35
    rub = s1["rubric"]
    assert rub["stance_clarity"] >= 20
    assert rub["code_evidence"] >= 20
    assert rub["verification_focus"] >= 20
    assert rub["actionable_steering"] >= 20
    assert rub["total"] == (
        rub["stance_clarity"] + rub["code_evidence"] + rub["verification_focus"] + rub["actionable_steering"]
    )
    assert s1["overview"]["completed_count"] == 1
    assert s1["overview"]["confidence_pct"] > 0
    assert s1["overview"]["ladder"][0]["done"] is True
    assert s1["overview"]["ladder"][1]["done"] is False

    # Re-calibrating same scenario awards +10 XP and catches misaligned stance
    s1_re = client.post(
        "/api/eval-lab/scenarios/eval-py-test-cheat/submit",
        json={
            "choice": "strongly_a",
            "spotted_tags": [],
            "rationale": "Approach A passed pytest.",
            "followup_prompt": "",
        },
    ).json()
    assert s1_re["aligned"] is False
    assert s1_re["xp_awarded"] == 10
    assert len(s1_re["missed_tags"]) == 3
    assert len(s1_re["coaching_tips"]) >= 1

    # Validation errors
    assert client.post("/api/eval-lab/scenarios/unknown-id/submit", json={"choice": "strongly_a"}).status_code == 404
    assert client.post("/api/eval-lab/scenarios/eval-py-test-cheat/submit", json={"choice": "bad_choice"}).status_code == 400

    # 3. Complete 2 more distinct scenarios -> unlocks ai_eval_ready ("Sharp Reviewer") on 3rd distinct scenario
    s2 = client.post(
        "/api/eval-lab/scenarios/eval-react-silent-reload/submit",
        json={
            "choice": "strongly_a",
            "spotted_tags": ["idiomatic_fix", "clean_tests", "stale_closure"],
            "rationale": (
                "Approach A adds a `silent` refresh flag so `setLoading` does not unmount `<DraftEditor />` "
                "and adds a Vitest regression test, whereas Approach B resets `draftRef` inside `useEffect`."
            ),
            "followup_prompt": "Keep Approach A and add a non-blocking error banner if silent refresh fails.",
        },
    ).json()
    assert s2["aligned"] is True and s2["expected_side"] == "a"
    assert "ai_eval_ready" not in {a["slug"] for a in s2["unlocked_achievements"]}

    s3 = client.post(
        "/api/eval-lab/scenarios/eval-bash-strict-refactor/submit",
        json={
            "choice": "strongly_a",
            "spotted_tags": ["unsafe_shell", "missed_edge_case", "idiomatic_fix"],
            "rationale": (
                "Approach A keeps `set -euo pipefail`, double-quotes `\"$file\"` for paths with spaces, "
                "and uses `grep -c` with `|| true`. Approach B drops strict mode and adds unsafe `eval`."
            ),
            "followup_prompt": "Approve Approach A and add `--` before the pattern in `grep -c`.",
        },
    ).json()
    assert s3["aligned"] is True and s3["expected_side"] == "a"
    assert s3["overview"]["completed_count"] == 3
    assert s3["overview"]["ladder"][1]["done"] is True
    assert "ai_eval_ready" in {a["slug"] for a in s3["unlocked_achievements"]}

    # 4. Dry-Run Workbench CRUD + confidence ladder completion
    create_dr = client.post(
        "/api/eval-lab/dry-runs",
        json={
            "repo_name": "acme/cli-toolkit",
            "license": "MIT",
            "task_type": "Bug Fix",
            "goal": "Fix argument parser handling empty stdin gracefully",
            "acceptance_criteria": [
                "Exit 0 with empty JSON array on empty stdin",
                "Preserve existing flag behavior",
                "Add pytest regression test",
            ],
            "verify_command": "uv run pytest -v",
        },
    )
    assert create_dr.status_code == 200
    dr = create_dr.json()
    run_id = dr["id"]
    assert dr["repo_name"] == "acme/cli-toolkit"
    assert dr["status"] == "in_progress"
    assert len(dr["acceptance_criteria"]) == 3

    listed = client.get("/api/eval-lab/dry-runs").json()["dry_runs"]
    assert len(listed) == 1 and listed[0]["id"] == run_id

    upd = client.put(
        f"/api/eval-lab/dry-runs/{run_id}",
        json={
            "what_helped": "Assistant drafted the initial CLI fixture test quickly.",
            "where_stepped_in": "Caught missing EOF check and strengthened assertion.",
            "preferred_approach_notes": "Preferred explicit EOF guard over broad try/except.",
            "checklist": {
                "eligible_license": True,
                "no_secrets": True,
                "no_pii": True,
                "ran_tests_reviewed_diff": True,
                "own_words_feedback": True,
            },
        },
    )
    assert upd.status_code == 200
    dr_upd = upd.json()
    assert dr_upd["status"] == "completed"
    assert dr_upd["checklist"]["own_words_feedback"] is True

    # Overview now reflects dry-run progress & higher confidence %
    ov_after = client.get("/api/eval-lab").json()
    assert len(ov_after["dry_runs"]) == 1
    assert ov_after["ladder"][2]["done"] is True
    assert ov_after["confidence_pct"] >= 65

    # Delete dry-run + 404 checks
    assert client.delete(f"/api/eval-lab/dry-runs/{run_id}").json() == {"deleted": run_id}
    assert client.put(f"/api/eval-lab/dry-runs/{run_id}", json={"goal": "updated"}).status_code == 404
    assert client.delete(f"/api/eval-lab/dry-runs/{run_id}").status_code == 404
    assert client.post("/api/eval-lab/dry-runs", json={"repo_name": "", "goal": "x"}).status_code == 400




