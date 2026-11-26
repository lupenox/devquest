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

