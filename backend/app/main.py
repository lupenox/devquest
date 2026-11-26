from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import config
from .achievements import evaluate_achievements
from .db import award_xp, get_conn, get_dashboard_data, init_db
from .github_study import (
    create_repo_interview_pack,
    get_github_status,
    list_github_repos,
    save_github_connection,
    sync_github_profile,
)
from .graders import (
    grade_browser_activity,
    grade_workspace_activity,
    materialize_workspace,
    run_regex_playground,
    run_sql_playground,
)
from .mock_interview import answer_mock_question, list_mock_interviews, start_mock_interview
from .ollama_gen import generate_zybooks_module, list_ollama_models
from .rpg import calculate_par_bonus, compute_mastery_pct, iso_now, sm2_next_review
from .sync import (
    import_exercism_spec,
    save_external_profile,
    sync_codewars,
    sync_exercism,
    sync_leetcode,
)
from .terminal_launcher import launch_terminal_nvim


class EventHub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def broadcast(self, event_type: str, payload: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        message = json.dumps({"type": event_type, "payload": payload})
        for ws in list(self.clients):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = EventHub()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="DevQuest API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BrowserSubmitReq(BaseModel):
    submission: dict[str, Any] = Field(default_factory=dict)


class LaunchNvimReq(BaseModel):
    reset: bool = False


class GradeWorkspaceReq(BaseModel):
    activity_id: str
    workspace_dir: str
    keystrokes: int | None = None


class ExternalProfileReq(BaseModel):
    provider: str
    handle: str


class SyncRunReq(BaseModel):
    provider: str | None = None


class OllamaGenerateReq(BaseModel):
    tech_slug: str
    topic: str
    difficulty: str = "intermediate"
    model: str | None = None


class DailyGoalReq(BaseModel):
    daily_xp_target: int = Field(ge=20, le=2000)


class ExercismImportReq(BaseModel):
    tech_slug: str = "python"
    canonical_data: dict[str, Any]


class GitHubConnectReq(BaseModel):
    username: str = ""
    token: str | None = None


class GitHubAnalyzeReq(BaseModel):
    repo: str
    use_ollama: bool = False
    model: str | None = None


class SprintStartReq(BaseModel):
    duration_minutes: int = Field(default=5, ge=1, le=30)
    tech_slug: str | None = None


class SprintCompleteReq(BaseModel):
    duration_minutes: int = Field(ge=1, le=60)
    completed_count: int = Field(ge=0, le=100)
    max_combo: int = Field(ge=0, le=100)
    tech_slug: str | None = None


class RegexPlaygroundReq(BaseModel):
    pattern: str = ""
    text: str = ""


class SqlPlaygroundReq(BaseModel):
    query: str = ""


class MockInterviewStartReq(BaseModel):
    repo: str
    model: str | None = None


class MockInterviewAnswerReq(BaseModel):
    answer: str
    model: str | None = None


async def _broadcast_achievements(unlocked: list[dict[str, Any]]) -> None:
    if not unlocked:
        return
    await hub.broadcast("achievement_unlocked", {**unlocked[0], "achievements": unlocked})


def _record_grade_outcome(
    conn,
    act_row,
    passed: bool,
    score: float,
    output: str,
    keystrokes: int | None = None,
) -> dict[str, Any]:
    now = iso_now()
    activity_id = act_row["id"]
    tech_slug = act_row["tech_slug"]
    xp_reward = int(act_row["xp_reward"])
    par_keystrokes = act_row["par_keystrokes"]

    conn.execute(
        """
        INSERT INTO attempts (activity_id, passed, score, keystrokes, output_log, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (activity_id, 1 if passed else 0, score, keystrokes, output, now),
    )

    xp_awarded = 0
    par_bonus = 0
    first_time = False

    if passed:
        existing = conn.execute(
            "SELECT * FROM completions WHERE activity_id = ?", (activity_id,)
        ).fetchone()
        if not existing:
            first_time = True
            xp_awarded = xp_reward
            conn.execute(
                """
                INSERT INTO completions (activity_id, first_passed_at, last_passed_at, best_keystrokes, attempts_count)
                VALUES (?, ?, ?, ?, 1)
                """,
                (activity_id, now, now, keystrokes),
            )
            award_xp(conn, tech_slug, xp_awarded, "devquest", f"Completed: {act_row['title']}")
        else:
            # Review XP bonus (smaller repeatable mastery reinforcement)
            xp_awarded = max(5, xp_reward // 4)
            best_k = existing["best_keystrokes"]
            if keystrokes and (best_k is None or keystrokes < best_k):
                best_k = keystrokes
            conn.execute(
                """
                UPDATE completions
                SET last_passed_at = ?, best_keystrokes = ?, attempts_count = attempts_count + 1
                WHERE activity_id = ?
                """,
                (now, best_k, activity_id),
            )
            award_xp(conn, tech_slug, xp_awarded, "devquest_review", f"Mastery refresh: {act_row['title']}")

        par_bonus = calculate_par_bonus(keystrokes, par_keystrokes)
        if par_bonus > 0:
            award_xp(
                conn,
                "neovim",
                par_bonus,
                "nvim_bonus",
                f"Vim Par Bonus on {act_row['title']} ({keystrokes}/{par_keystrokes} keys)",
            )

    # Update SM-2 spaced repetition card
    srs = conn.execute("SELECT * FROM srs_cards WHERE activity_id = ?", (activity_id,)).fetchone()
    if srs:
        reps, ef, ivl, due = sm2_next_review(
            passed, int(srs["repetitions"]), float(srs["ease_factor"]), int(srs["interval_days"])
        )
        conn.execute(
            """
            UPDATE srs_cards SET repetitions = ?, ease_factor = ?, interval_days = ?, due_at = ?
            WHERE activity_id = ?
            """,
            (reps, ef, ivl, due, activity_id),
        )
    elif passed:
        reps, ef, ivl, due = sm2_next_review(True, 0, 2.5, 1)
        conn.execute(
            """
            INSERT INTO srs_cards (activity_id, repetitions, ease_factor, interval_days, due_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (activity_id, reps, ef, ivl, due),
        )

    unlocked_achievements = evaluate_achievements(conn) if passed else []

    # Fetch updated tech mastery (after any achievement bonus XP)
    tech = conn.execute("SELECT * FROM technologies WHERE slug = ?", (tech_slug,)).fetchone()
    total_a = conn.execute("SELECT COUNT(*) AS c FROM activities WHERE tech_slug = ?", (tech_slug,)).fetchone()["c"]
    done_a = conn.execute(
        """
        SELECT COUNT(*) AS c FROM completions c
        JOIN activities a ON a.id = c.activity_id
        WHERE a.tech_slug = ?
        """,
        (tech_slug,),
    ).fetchone()["c"]
    mastery_pct, freshness = compute_mastery_pct(done_a, total_a, int(tech["xp"]), tech["last_practiced_at"])

    return {
        "activity_id": activity_id,
        "tech_slug": tech_slug,
        "tech_name": tech["name"],
        "passed": passed,
        "score": score,
        "output": output,
        "first_time": first_time,
        "xp_awarded": xp_awarded,
        "par_bonus": par_bonus,
        "tech_xp": int(tech["xp"]),
        "tech_mastery_pct": mastery_pct,
        "freshness": freshness,
        "unlocked_achievements": unlocked_achievements,
    }


@app.websocket("/ws/events")
async def ws_events(websocket: WebSocket):
    await hub.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(websocket)


@app.get("/api/health")
def health():
    return {"status": "ok", "db": str(config.DB_PATH)}


@app.get("/api/dashboard")
def dashboard():
    with get_conn() as conn:
        return get_dashboard_data(conn)


@app.post("/api/daily-goal")
def set_daily_goal(req: DailyGoalReq):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO daily_goals (key, value) VALUES ('daily_xp_target', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(req.daily_xp_target),),
        )
    return {"daily_xp_target": req.daily_xp_target}


@app.get("/api/tracks")
def list_tracks():
    with get_conn() as conn:
        dash = get_dashboard_data(conn)
        mods = conn.execute(
            """
            SELECT m.*,
                   (SELECT COUNT(*) FROM activities a WHERE a.module_id = m.id) AS activity_count,
                   (SELECT COUNT(*) FROM completions c JOIN activities a ON a.id = c.activity_id WHERE a.module_id = m.id) AS completed_count
            FROM modules m
            ORDER BY m.tech_slug, m.order_index ASC
            """
        ).fetchall()
        by_tech: dict[str, list[dict[str, Any]]] = {}
        for m in mods:
            d = dict(m)
            d["content"] = json.loads(d.pop("content_json"))
            by_tech.setdefault(d["tech_slug"], []).append(d)
        for t in dash["technologies"]:
            t["modules"] = by_tech.get(t["slug"], [])
        return {"technologies": dash["technologies"]}


@app.get("/api/tracks/{tech_slug}")
def get_track(tech_slug: str):
    with get_conn() as conn:
        tech = conn.execute("SELECT * FROM technologies WHERE slug = ?", (tech_slug,)).fetchone()
        if not tech:
            raise HTTPException(status_code=404, detail=f"Technology '{tech_slug}' not found")
        mods = conn.execute(
            "SELECT * FROM modules WHERE tech_slug = ? ORDER BY order_index ASC", (tech_slug,)
        ).fetchall()
        done_ids = {
            r["activity_id"] for r in conn.execute("SELECT activity_id FROM completions").fetchall()
        }
        result_mods = []
        for m in mods:
            acts = conn.execute(
                "SELECT * FROM activities WHERE module_id = ? ORDER BY order_index ASC", (m["id"],)
            ).fetchall()
            act_list = []
            for a in acts:
                ad = dict(a)
                ad["spec"] = json.loads(ad.pop("spec_json"))
                ad["completed"] = a["id"] in done_ids
                act_list.append(ad)
            md = dict(m)
            md["content"] = json.loads(md.pop("content_json"))
            md["activities"] = act_list
            md["completed_count"] = sum(1 for a in act_list if a["completed"])
            md["activity_count"] = len(act_list)
            result_mods.append(md)
        return {"technology": dict(tech), "modules": result_mods}


@app.get("/api/modules/{module_id}")
def get_module(module_id: str):
    with get_conn() as conn:
        m = conn.execute("SELECT * FROM modules WHERE id = ?", (module_id,)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Module not found")
        tech = conn.execute("SELECT * FROM technologies WHERE slug = ?", (m["tech_slug"],)).fetchone()
        acts = conn.execute(
            "SELECT * FROM activities WHERE module_id = ? ORDER BY order_index ASC", (module_id,)
        ).fetchall()
        done_map = {
            r["activity_id"]: dict(r)
            for r in conn.execute("SELECT * FROM completions").fetchall()
        }
        act_list = []
        for a in acts:
            ad = dict(a)
            ad["spec"] = json.loads(ad.pop("spec_json"))
            comp = done_map.get(a["id"])
            ad["completed"] = comp is not None
            ad["completion"] = comp
            act_list.append(ad)
        md = dict(m)
        md["content"] = json.loads(md.pop("content_json"))
        md["technology"] = dict(tech)
        md["activities"] = act_list
        return md


@app.get("/api/projects")
def list_projects():
    with get_conn() as conn:
        mods = conn.execute(
            "SELECT * FROM modules WHERE kind = 'project' ORDER BY order_index ASC"
        ).fetchall()
        done_ids = {
            r["activity_id"] for r in conn.execute("SELECT activity_id FROM completions").fetchall()
        }
        out = []
        for m in mods:
            acts = conn.execute(
                "SELECT * FROM activities WHERE module_id = ? ORDER BY order_index ASC", (m["id"],)
            ).fetchall()
            act_list = []
            for a in acts:
                ad = dict(a)
                ad["spec"] = json.loads(ad.pop("spec_json"))
                ad["completed"] = a["id"] in done_ids
                act_list.append(ad)
            md = dict(m)
            md["content"] = json.loads(md.pop("content_json"))
            md["activities"] = act_list
            md["completed_count"] = sum(1 for a in act_list if a["completed"])
            md["activity_count"] = len(act_list)
            out.append(md)
        return {"projects": out}


@app.get("/api/skill-tree")
def get_skill_tree():
    with get_conn() as conn:
        mods = conn.execute(
            """
            SELECT m.id, m.tech_slug, m.title, m.difficulty, m.kind, m.order_index, m.prereq_module_id,
                   t.name AS tech_name, t.color, t.category,
                   (SELECT COUNT(*) FROM activities a WHERE a.module_id = m.id) AS total_acts,
                   (SELECT COUNT(*) FROM completions c JOIN activities a ON a.id = c.activity_id WHERE a.module_id = m.id) AS done_acts
            FROM modules m
            JOIN technologies t ON t.slug = m.tech_slug
            ORDER BY t.category, m.tech_slug, m.order_index
            """
        ).fetchall()
        nodes = []
        edges = []
        done_modules = {
            m["id"] for m in mods if int(m["total_acts"]) > 0 and int(m["done_acts"]) >= int(m["total_acts"])
        }
        for m in mods:
            prereq = m["prereq_module_id"]
            unlocked = prereq is None or prereq in done_modules
            completed = m["id"] in done_modules
            nodes.append(
                {
                    "id": m["id"],
                    "tech_slug": m["tech_slug"],
                    "tech_name": m["tech_name"],
                    "color": m["color"],
                    "category": m["category"],
                    "title": m["title"],
                    "difficulty": m["difficulty"],
                    "kind": m["kind"],
                    "total_acts": m["total_acts"],
                    "done_acts": m["done_acts"],
                    "completed": completed,
                    "unlocked": unlocked,
                    "prereq_module_id": prereq,
                }
            )
            if prereq:
                edges.append({"from": prereq, "to": m["id"]})
        return {"nodes": nodes, "edges": edges}


@app.get("/api/next")
def get_next_quest(
    tech: str | None = Query(default=None),
    mode: str = Query(default="any"),
):
    with get_conn() as conn:
        where = ["c.activity_id IS NULL"]
        params: list[Any] = []
        if tech:
            where.append("a.tech_slug = ?")
            params.append(tech)
        if mode == "nvim":
            where.append("a.activity_type IN ('nvim_lab', 'boss_checkpoint')")
        elif mode == "quick":
            where.append("a.activity_type IN ('read_check', 'multi_select', 'fill_blank', 'parsons', 'code_trace')")

        row = conn.execute(
            f"""
            SELECT a.*, m.title AS module_title
            FROM activities a
            JOIN modules m ON m.id = a.module_id
            LEFT JOIN completions c ON c.activity_id = a.id
            WHERE {' AND '.join(where)}
            ORDER BY m.order_index ASC, a.order_index ASC
            LIMIT 1
            """,
            params,
        ).fetchone()
        if not row:
            # Fallback to any activity matching filter for review
            row = conn.execute(
                """
                SELECT a.*, m.title AS module_title
                FROM activities a
                JOIN modules m ON m.id = a.module_id
                WHERE (? IS NULL OR a.tech_slug = ?)
                ORDER BY a.order_index ASC
                LIMIT 1
                """,
                (tech, tech),
            ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No matching activities found.")
        act = dict(row)
        act["spec"] = json.loads(act.pop("spec_json"))
        return act


@app.post("/api/activities/{activity_id}/submit")
async def submit_browser_activity(activity_id: str, req: BrowserSubmitReq):
    with get_conn() as conn:
        act = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
        if not act:
            raise HTTPException(status_code=404, detail="Activity not found")
        spec = json.loads(act["spec_json"])
        res = grade_browser_activity(act["activity_type"], spec, req.submission)
        outcome = _record_grade_outcome(conn, act, res.passed, res.score, res.output)
    await hub.broadcast("activity_graded", outcome)
    await _broadcast_achievements(outcome.get("unlocked_achievements", []))
    return outcome


@app.post("/api/activities/{activity_id}/launch-nvim")
def launch_nvim_workspace(activity_id: str, req: LaunchNvimReq | None = None):
    with get_conn() as conn:
        act = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
        if not act:
            raise HTTPException(status_code=404, detail="Activity not found")
        act_dict = dict(act)
        act_dict["spec"] = json.loads(act_dict.pop("spec_json"))
    return materialize_workspace(act_dict, force_reset=bool(req and req.reset))


@app.post("/api/activities/{activity_id}/open-terminal")
def open_activity_terminal(activity_id: str, req: LaunchNvimReq | None = None):
    with get_conn() as conn:
        act = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
        if not act:
            raise HTTPException(status_code=404, detail="Activity not found")
        act_dict = dict(act)
        act_dict["spec"] = json.loads(act_dict.pop("spec_json"))
    ws = materialize_workspace(act_dict, force_reset=bool(req and req.reset))
    try:
        return launch_terminal_nvim(ws["workspace_dir"], ws["meta"]["primary_file"], ws["nvim_command"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/grade")
async def grade_workspace(req: GradeWorkspaceReq):
    with get_conn() as conn:
        act = conn.execute("SELECT * FROM activities WHERE id = ?", (req.activity_id,)).fetchone()
        if not act:
            raise HTTPException(status_code=404, detail=f"Activity '{req.activity_id}' not found")
        spec = json.loads(act["spec_json"])
        ws_dir = Path(req.workspace_dir).expanduser().resolve()
        if not ws_dir.exists():
            raise HTTPException(status_code=400, detail=f"Workspace does not exist: {ws_dir}")
        res = grade_workspace_activity(act["grader_type"], ws_dir, spec)
        outcome = _record_grade_outcome(conn, act, res.passed, res.score, res.output, keystrokes=req.keystrokes)
    await hub.broadcast("activity_graded", outcome)
    await _broadcast_achievements(outcome.get("unlocked_achievements", []))
    return outcome


@app.post("/api/sync/profile")
def configure_external_profile(req: ExternalProfileReq):
    with get_conn() as conn:
        try:
            return save_external_profile(conn, req.provider, req.handle)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/sync/run")
async def run_external_sync(req: SyncRunReq | None = None):
    target = req.provider.lower() if (req and req.provider) else None
    results = []
    with get_conn() as conn:
        profiles = conn.execute("SELECT * FROM external_profiles").fetchall()
        by_prov = {p["provider"]: p["handle"] for p in profiles}
        providers = [target] if target else list(by_prov.keys()) or ["exercism"]
        for prov in providers:
            try:
                if prov == "leetcode" and prov in by_prov:
                    results.append(sync_leetcode(conn, by_prov[prov]))
                elif prov == "codewars" and prov in by_prov:
                    results.append(sync_codewars(conn, by_prov[prov]))
                elif prov == "exercism":
                    results.append(sync_exercism(conn, by_prov.get("exercism")))
                elif prov == "github":
                    results.append(sync_github_profile(conn))
                else:
                    results.append({"provider": prov, "ok": False, "error": "Handle not configured yet."})
            except Exception as exc:
                results.append({"provider": prov, "ok": False, "error": str(exc)})
        unlocked = evaluate_achievements(conn)
    await hub.broadcast("sync_complete", {"results": results, "unlocked_achievements": unlocked})
    await _broadcast_achievements(unlocked)
    return {"results": results, "unlocked_achievements": unlocked}


@app.post("/api/import/exercism")
def import_exercism(req: ExercismImportReq):
    with get_conn() as conn:
        try:
            mod = import_exercism_spec(conn, req.canonical_data, tech_slug=req.tech_slug)
            return {"imported": mod["id"], "module": mod}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/ollama/models")
def ollama_models():
    models = list_ollama_models()
    return {"available": len(models) > 0, "url": config.OLLAMA_URL, "models": models}


@app.post("/api/ollama/generate")
async def ollama_generate(req: OllamaGenerateReq):
    with get_conn() as conn:
        try:
            mod = generate_zybooks_module(
                conn,
                tech_slug=req.tech_slug,
                topic=req.topic,
                difficulty=req.difficulty,
                model=req.model,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Ollama generation failed: {exc}")
    await hub.broadcast("module_generated", {"module_id": mod["id"], "tech_slug": mod["tech_slug"]})
    return {"module": mod}


@app.get("/api/github/status")
def github_status():
    with get_conn() as conn:
        return get_github_status(conn)


@app.post("/api/github/connect")
def github_connect(req: GitHubConnectReq):
    with get_conn() as conn:
        save_github_connection(conn, username=req.username, token=req.token)
        return get_github_status(conn)


@app.get("/api/github/repos")
def github_repos(username: str | None = Query(default=None), limit: int = Query(default=40, ge=1, le=100)):
    with get_conn() as conn:
        try:
            repos = list_github_repos(conn, username=username, limit=limit)
            return {"repos": repos}
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to list GitHub repos: {exc}")


@app.get("/api/github/study-packs")
def github_study_packs():
    with get_conn() as conn:
        mods = conn.execute(
            """
            SELECT m.*,
                   (SELECT COUNT(*) FROM activities a WHERE a.module_id = m.id) AS activity_count,
                   (SELECT COUNT(*) FROM completions c JOIN activities a ON a.id = c.activity_id WHERE a.module_id = m.id) AS completed_count
            FROM modules m
            WHERE m.kind = 'repo_interview'
            ORDER BY m.created_at DESC
            """
        ).fetchall()
        out = []
        for m in mods:
            d = dict(m)
            d["content"] = json.loads(d.pop("content_json"))
            out.append(d)
        return {"packs": out}


@app.post("/api/github/analyze")
async def github_analyze(req: GitHubAnalyzeReq):
    with get_conn() as conn:
        try:
            res = create_repo_interview_pack(
                conn,
                repo_ref=req.repo,
                use_ollama=req.use_ollama,
                model=req.model,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"GitHub analysis failed: {exc}")
        unlocked = evaluate_achievements(conn)
    res["unlocked_achievements"] = unlocked
    await hub.broadcast(
        "module_generated",
        {"module_id": res["module"]["id"], "tech_slug": res["module"]["tech_slug"]},
    )
    await _broadcast_achievements(unlocked)
    return res


@app.get("/api/search")
def search_catalog(q: str = Query(default="")):
    needle = q.strip().lower()
    like = f"%{needle}%"
    with get_conn() as conn:
        dash = get_dashboard_data(conn)
        tech_mastery = {t["slug"]: t["mastery_pct"] for t in dash["technologies"]}

        if needle:
            tech_rows = conn.execute(
                """
                SELECT slug, name, category, color
                FROM technologies
                WHERE LOWER(slug) LIKE ? OR LOWER(name) LIKE ? OR LOWER(category) LIKE ?
                ORDER BY name ASC
                LIMIT 10
                """,
                (like, like, like),
            ).fetchall()
            mod_rows = conn.execute(
                """
                SELECT id, tech_slug, title, subtitle, kind, difficulty
                FROM modules
                WHERE kind != 'repo_interview'
                  AND (LOWER(id) LIKE ? OR LOWER(title) LIKE ? OR LOWER(subtitle) LIKE ? OR LOWER(tech_slug) LIKE ? OR LOWER(content_json) LIKE ?)
                ORDER BY
                    CASE WHEN LOWER(title) LIKE ? OR LOWER(id) LIKE ? THEN 0 ELSE 1 END,
                    order_index ASC
                LIMIT 12
                """,
                (like, like, like, like, like, like, like),
            ).fetchall()
            act_rows = conn.execute(
                """
                SELECT id, module_id, tech_slug, title, activity_type, xp_reward
                FROM activities
                WHERE LOWER(id) LIKE ? OR LOWER(title) LIKE ? OR LOWER(tech_slug) LIKE ? OR LOWER(activity_type) LIKE ?
                ORDER BY
                    CASE WHEN LOWER(title) LIKE ? OR LOWER(id) LIKE ? THEN 0 ELSE 1 END,
                    order_index ASC
                LIMIT 12
                """,
                (like, like, like, like, like, like),
            ).fetchall()
            pack_rows = conn.execute(
                """
                SELECT id, tech_slug, title, subtitle, kind, difficulty
                FROM modules
                WHERE kind = 'repo_interview'
                  AND (LOWER(id) LIKE ? OR LOWER(title) LIKE ? OR LOWER(subtitle) LIKE ? OR LOWER(tech_slug) LIKE ?)
                ORDER BY created_at DESC
                LIMIT 8
                """,
                (like, like, like, like),
            ).fetchall()
        else:
            tech_rows = conn.execute(
                "SELECT slug, name, category, color FROM technologies ORDER BY name ASC LIMIT 8"
            ).fetchall()
            mod_rows = conn.execute(
                """
                SELECT id, tech_slug, title, subtitle, kind, difficulty
                FROM modules
                WHERE kind != 'repo_interview'
                ORDER BY order_index ASC
                LIMIT 8
                """
            ).fetchall()
            act_rows = conn.execute(
                """
                SELECT id, module_id, tech_slug, title, activity_type, xp_reward
                FROM activities
                ORDER BY order_index ASC
                LIMIT 8
                """
            ).fetchall()
            pack_rows = conn.execute(
                """
                SELECT id, tech_slug, title, subtitle, kind, difficulty
                FROM modules
                WHERE kind = 'repo_interview'
                ORDER BY created_at DESC
                LIMIT 5
                """
            ).fetchall()

        technologies = [
            {
                "slug": str(r["slug"]),
                "name": str(r["name"]),
                "category": str(r["category"]),
                "color": str(r["color"]),
                "mastery_pct": tech_mastery.get(str(r["slug"]), 0.0),
            }
            for r in tech_rows
        ]
        return {
            "query": q,
            "technologies": technologies,
            "modules": [dict(r) for r in mod_rows],
            "activities": [dict(r) for r in act_rows],
            "packs": [dict(r) for r in pack_rows],
        }


@app.post("/api/sprint/start")
def sprint_start(req: SprintStartReq):
    target_count = 2 if req.duration_minutes <= 2 else (4 if req.duration_minutes <= 5 else 6)
    quick_types = ("read_check", "multi_select", "fill_blank", "parsons", "code_trace", "pdb_sim")
    now_iso = iso_now()

    with get_conn() as conn:
        if req.tech_slug:
            tech = conn.execute("SELECT slug FROM technologies WHERE slug = ?", (req.tech_slug,)).fetchone()
            if not tech:
                raise HTTPException(status_code=404, detail=f"Technology '{req.tech_slug}' not found")

        done_map = {
            r["activity_id"]: dict(r)
            for r in conn.execute("SELECT * FROM completions").fetchall()
        }

        where = ["a.activity_type IN ('read_check', 'multi_select', 'fill_blank', 'parsons', 'code_trace', 'pdb_sim')"]
        params: list[Any] = [now_iso]
        if req.tech_slug:
            where.append("a.tech_slug = ?")
            params.append(req.tech_slug)

        rows = conn.execute(
            f"""
            SELECT a.*,
                   CASE WHEN s.due_at IS NOT NULL AND s.due_at <= ? THEN 0 ELSE 1 END AS due_rank,
                   CASE WHEN c.activity_id IS NULL THEN 0 ELSE 1 END AS done_rank
            FROM activities a
            JOIN modules m ON m.id = a.module_id
            LEFT JOIN completions c ON c.activity_id = a.id
            LEFT JOIN srs_cards s ON s.activity_id = a.id
            WHERE {' AND '.join(where)}
            ORDER BY due_rank ASC, done_rank ASC, m.order_index ASC, a.order_index ASC
            LIMIT 60
            """,
            params,
        ).fetchall()

        # Fallback to any activity for the requested tech if no browser drills exist
        if not rows:
            fallback_where = ["1 = 1"]
            fallback_params: list[Any] = []
            if req.tech_slug:
                fallback_where.append("a.tech_slug = ?")
                fallback_params.append(req.tech_slug)
            rows = conn.execute(
                f"""
                SELECT a.*
                FROM activities a
                JOIN modules m ON m.id = a.module_id
                WHERE {' AND '.join(fallback_where)}
                ORDER BY m.order_index ASC, a.order_index ASC
                LIMIT ?
                """,
                [*fallback_params, target_count],
            ).fetchall()

        chosen_rows: list[Any] = []
        seen_ids: set[str] = set()
        if not req.tech_slug:
            seen_techs: set[str] = set()
            for r in rows:
                if len(chosen_rows) >= target_count:
                    break
                if r["tech_slug"] not in seen_techs:
                    seen_techs.add(r["tech_slug"])
                    seen_ids.add(r["id"])
                    chosen_rows.append(r)

        for r in rows:
            if len(chosen_rows) >= target_count:
                break
            if r["id"] not in seen_ids:
                seen_ids.add(r["id"])
                chosen_rows.append(r)

        activities: list[dict[str, Any]] = []
        for a in chosen_rows:
            ad = {
                "id": a["id"],
                "module_id": a["module_id"],
                "tech_slug": a["tech_slug"],
                "title": a["title"],
                "activity_type": a["activity_type"],
                "grader_type": a["grader_type"],
                "order_index": a["order_index"],
                "xp_reward": a["xp_reward"],
                "par_keystrokes": a["par_keystrokes"],
                "spec": json.loads(a["spec_json"]),
            }
            comp = done_map.get(a["id"])
            ad["completed"] = comp is not None
            ad["completion"] = comp
            activities.append(ad)

        return {
            "duration_minutes": req.duration_minutes,
            "activities": activities,
        }


@app.post("/api/sprint/complete")
async def sprint_complete(req: SprintCompleteReq):
    if req.completed_count <= 0:
        bonus_xp = 0
    else:
        if req.max_combo <= 1:
            mult = 1.0
        elif req.max_combo == 2:
            mult = 1.5
        elif req.max_combo == 3:
            mult = 2.0
        else:
            mult = 3.0
        bonus_xp = int(round(req.completed_count * 10 * mult))

    now = iso_now()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO sprint_sessions (duration_minutes, completed_count, max_combo, bonus_xp, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (req.duration_minutes, req.completed_count, req.max_combo, bonus_xp, now),
        )
        session_id = int(cur.lastrowid)

        if bonus_xp > 0:
            target_tech = None
            if req.tech_slug:
                row = conn.execute("SELECT slug FROM technologies WHERE slug = ?", (req.tech_slug,)).fetchone()
                if row:
                    target_tech = str(row["slug"])
            if not target_tech:
                recent = conn.execute("SELECT tech_slug FROM xp_ledger ORDER BY id DESC LIMIT 1").fetchone()
                target_tech = str(recent["tech_slug"]) if recent else "python"
            award_xp(
                conn,
                target_tech,
                bonus_xp,
                "sprint",
                f"AI Break Sprint ({req.duration_minutes}m, {req.completed_count} drills, {req.max_combo}x combo)",
            )

        unlocked = evaluate_achievements(conn)

    payload = {
        "session_id": session_id,
        "duration_minutes": req.duration_minutes,
        "completed_count": req.completed_count,
        "max_combo": req.max_combo,
        "bonus_xp": bonus_xp,
        "unlocked_achievements": unlocked,
    }
    await hub.broadcast("sprint_completed", payload)
    await _broadcast_achievements(unlocked)
    return payload


@app.post("/api/playground/regex")
def playground_regex(req: RegexPlaygroundReq):
    return run_regex_playground(req.pattern, req.text)


@app.post("/api/playground/sql/{activity_id}")
def playground_sql(activity_id: str, req: SqlPlaygroundReq):
    with get_conn() as conn:
        act = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
        if not act:
            raise HTTPException(status_code=404, detail="Activity not found")
        spec = json.loads(act["spec_json"])
    return run_sql_playground(spec, req.query)


@app.get("/api/interviews")
def get_interviews():
    with get_conn() as conn:
        return {"interviews": list_mock_interviews(conn)}


@app.post("/api/interviews/start")
def interview_start(req: MockInterviewStartReq):
    with get_conn() as conn:
        try:
            return start_mock_interview(conn, req.repo, model=req.model)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to start mock interview: {exc}")


@app.post("/api/interviews/{session_id}/answer")
async def interview_answer(session_id: int, req: MockInterviewAnswerReq):
    with get_conn() as conn:
        try:
            res = answer_mock_question(conn, session_id, req.answer, model=req.model)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    if res.get("completed"):
        await hub.broadcast(
            "interview_completed",
            {
                "session_id": res["session_id"],
                "repo_full_name": res["repo_full_name"],
                "readiness_score": res["readiness_score"],
                "xp_awarded": res["xp_awarded"],
            },
        )
    await _broadcast_achievements(res.get("unlocked_achievements", []))
    return res


def _serve_spa_or_static(full_path: str) -> FileResponse:
    norm = full_path.lstrip("/")
    if norm == "api" or norm.startswith("api/") or norm == "ws" or norm.startswith("ws/"):
        raise HTTPException(status_code=404, detail="Not found")

    dist_dir = (config.FRONTEND_DIR / "dist").resolve()
    if not dist_dir.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found")

    if norm:
        candidate = (dist_dir / norm).resolve()
        if candidate.is_relative_to(dist_dir) and candidate.is_file():
            media_type = None
            if candidate.suffix == ".webmanifest":
                media_type = "application/manifest+json"
            elif candidate.name == "sw.js":
                media_type = "application/javascript"
            return FileResponse(candidate, media_type=media_type)
        if norm.startswith("assets/"):
            raise HTTPException(status_code=404, detail="Asset not found")

    index_file = dist_dir / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend index.html not found")
    return FileResponse(index_file, media_type="text/html")


@app.get("/", include_in_schema=False)
def spa_root():
    return _serve_spa_or_static("")


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str):
    return _serve_spa_or_static(full_path)
