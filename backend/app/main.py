from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config
from .db import award_xp, get_conn, get_dashboard_data, init_db
from .graders import grade_browser_activity, grade_workspace_activity, materialize_workspace
from .ollama_gen import generate_zybooks_module, list_ollama_models
from .rpg import calculate_par_bonus, compute_mastery_pct, iso_now, sm2_next_review
from .sync import (
    import_exercism_spec,
    save_external_profile,
    sync_codewars,
    sync_exercism,
    sync_leetcode,
)


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

    # Fetch updated tech mastery
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
                else:
                    results.append({"provider": prov, "ok": False, "error": "Handle not configured yet."})
            except Exception as exc:
                results.append({"provider": prov, "ok": False, "error": str(exc)})
    await hub.broadcast("sync_complete", {"results": results})
    return {"results": results}


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


# Serve production React build when present
_dist_dir = config.FRONTEND_DIR / "dist"
if _dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(_dist_dir), html=True), name="frontend")
