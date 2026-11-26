from __future__ import annotations

import json
import re
import sqlite3
import time
from typing import Any

import httpx

from . import config
from .db import upsert_module_pack
from .rpg import TECHNOLOGIES

TECH_BY_SLUG = {t["slug"]: t for t in TECHNOLOGIES}


def list_ollama_models(timeout: float = 3.0) -> list[dict[str, Any]]:
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(f"{config.OLLAMA_URL}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            return [
                {"name": m.get("name"), "size": m.get("size", 0)}
                for m in data.get("models", [])
                if m.get("name")
            ]
    except Exception:
        return []


def _extract_json_object(raw: str) -> dict[str, Any]:
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, flags=re.S)
        if not m:
            raise ValueError("Model response did not contain a valid JSON object.")
        return json.loads(m.group(0))


def generate_zybooks_module(
    conn: sqlite3.Connection,
    tech_slug: str,
    topic: str,
    difficulty: str = "intermediate",
    model: str | None = None,
) -> dict[str, Any]:
    if tech_slug not in TECH_BY_SLUG:
        raise ValueError(f"Unknown technology: {tech_slug}")

    models = list_ollama_models()
    chosen_model = model or (models[0]["name"] if models else None)
    if not chosen_model:
        raise RuntimeError(
            f"No Ollama models available at {config.OLLAMA_URL}. Make sure Ollama is running and has a model pulled."
        )

    tech_name = TECH_BY_SLUG[tech_slug]["name"]
    prompt = f"""You are a computer science curriculum author writing a zyBooks-style interactive micro-lesson.
Generate ONLY a valid JSON object (no markdown fences) for technology "{tech_name}" ({tech_slug}), topic "{topic}", difficulty "{difficulty}".

Required JSON structure:
{{
  "title": "Short engaging module title",
  "subtitle": "One-sentence learning goal",
  "summary": "2-sentence overview",
  "sections": [
    {{
      "title": "Concept 1 title",
      "body": "Clear, concise zyBooks-style explanation (3-5 sentences).",
      "code_example": "Short idiomatic {tech_name} snippet"
    }},
    {{
      "title": "Concept 2 title",
      "body": "Practical gotcha or real-world pattern (3-4 sentences).",
      "code_example": "Short idiomatic {tech_name} snippet"
    }}
  ],
  "read_check": {{
    "question": "Conceptual multiple-choice question",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_index": 0,
    "explanation": "Why the correct option is right",
    "hint": "Helpful nudge"
  }},
  "fill_blank": {{
    "prompt": "Complete the snippet using ___ for each blank",
    "template": "code line with ___ placeholder",
    "blanks": [
      {{"accepted": ["answer1"], "hint": "short hint"}}
    ],
    "explanation": "Brief explanation"
  }},
  "parsons": {{
    "prompt": "Arrange these lines in the correct logical order",
    "lines": ["line 1", "line 2", "line 3", "line 4"],
    "explanation": "Why this order works"
  }}
}}"""

    with httpx.Client(timeout=120.0) as client:
        resp = client.post(
            f"{config.OLLAMA_URL}/api/generate",
            json={
                "model": chosen_model,
                "prompt": prompt,
                "format": "json",
                "stream": False,
                "options": {"temperature": 0.4},
            },
        )
        resp.raise_for_status()
        body = resp.json()

    parsed = _extract_json_object(body.get("response", "{}"))
    slug_part = re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:28] or "topic"
    mod_id = f"gen-{tech_slug}-{slug_part}-{int(time.time())}"

    rc = parsed.get("read_check") or {}
    fb = parsed.get("fill_blank") or {}
    ps = parsed.get("parsons") or {}

    activities: list[dict[str, Any]] = []
    if rc.get("question") and rc.get("options"):
        activities.append(
            {
                "id": f"{mod_id}-rc",
                "tech_slug": tech_slug,
                "title": "Participation Activity: Concept Check",
                "activity_type": "read_check",
                "grader_type": "browser",
                "order_index": 0,
                "xp_reward": 20,
                "spec": {
                    "question": rc["question"],
                    "options": rc["options"],
                    "correct_index": int(rc.get("correct_index", 0)),
                    "explanation": rc.get("explanation", ""),
                    "hint": rc.get("hint", "Review the concept cards above."),
                },
            }
        )

    if fb.get("template") and fb.get("blanks"):
        activities.append(
            {
                "id": f"{mod_id}-fb",
                "tech_slug": tech_slug,
                "title": "Participation Activity: Fill in the Syntax",
                "activity_type": "fill_blank",
                "grader_type": "browser",
                "order_index": 1,
                "xp_reward": 25,
                "spec": {
                    "prompt": fb.get("prompt", "Fill in the missing token(s)."),
                    "template": fb["template"],
                    "blanks": fb["blanks"],
                    "explanation": fb.get("explanation", ""),
                },
            }
        )

    ps_lines = ps.get("lines") or []
    if len(ps_lines) >= 2:
        scrambled = list(reversed(ps_lines))
        correct_order = list(range(len(ps_lines) - 1, -1, -1))
        activities.append(
            {
                "id": f"{mod_id}-ps",
                "tech_slug": tech_slug,
                "title": "Participation Activity: Parsons Line Assembly",
                "activity_type": "parsons",
                "grader_type": "browser",
                "order_index": 2,
                "xp_reward": 30,
                "spec": {
                    "prompt": ps.get("prompt", "Reorder the lines into valid code."),
                    "lines": scrambled,
                    "correct_order": correct_order,
                    "explanation": ps.get("explanation", ""),
                },
            }
        )

    module_pack = {
        "id": mod_id,
        "tech_slug": tech_slug,
        "title": parsed.get("title") or f"{tech_name}: {topic}",
        "subtitle": parsed.get("subtitle") or f"AI-generated zyBooks micro-lesson on {topic}",
        "difficulty": difficulty,
        "kind": "zybooks",
        "estimated_minutes": 5,
        "order_index": 90,
        "summary": parsed.get("summary") or f"Interactive practice on {topic} in {tech_name}.",
        "tags": ["ollama-generated", tech_slug],
        "sections": parsed.get("sections", []),
        "activities": activities,
    }

    out_path = config.CURRICULUM_DIR / "generated" / f"{mod_id}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(module_pack, indent=2), encoding="utf-8")

    upsert_module_pack(conn, module_pack, source="generated")
    return module_pack
