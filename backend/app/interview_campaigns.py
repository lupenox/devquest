from __future__ import annotations

import io
import json
import math
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from pypdf import PdfReader

from . import config
from .achievements import evaluate_achievements
from .db import award_xp
from .ollama_gen import _extract_json_object, list_ollama_models
from .rpg import TECHNOLOGIES, iso_now, utcnow

VALID_CONFIDENCES: tuple[str, ...] = ("unreviewed", "shaky", "ready", "nailed")
CONFIDENCE_SCORE: dict[str, int] = {
    "unreviewed": 0,
    "shaky": 35,
    "ready": 75,
    "nailed": 100,
}
CONFIDENCE_XP_TARGET: dict[str, int] = {
    "unreviewed": 0,
    "shaky": 0,
    "ready": 10,
    "nailed": 20,
}
MAX_RESUME_BYTES = 10 * 1024 * 1024  # 10 MB
SUPPORTED_TECH_SLUGS = {t["slug"] for t in TECHNOLOGIES}

TECH_KEYWORD_MAP: list[tuple[str, str]] = [
    ("fastapi", "fastapi"),
    ("react", "react"),
    ("typescript", "typescript"),
    ("playwright", "playwright"),
    ("sqlite", "sql"),
    ("postgres", "sql"),
    ("sql", "sql"),
    ("python", "python"),
    ("c++", "cpp"),
    ("bash", "bash"),
    ("javascript", "javascript"),
    ("regex", "regex"),
    ("pdb", "debugging"),
    ("debug", "debugging"),
    ("neovim", "neovim"),
    ("git", "git"),
]


def _slugify(value: str, max_len: int = 32) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:max_len] or "item"


def _parse_interview_dt(raw: str) -> datetime | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        local_tz = datetime.now().astimezone().tzinfo or timezone.utc
        dt = dt.replace(tzinfo=local_tz)
    return dt.astimezone(timezone.utc)


def compute_hours_until(interview_at: str) -> float:
    dt = _parse_interview_dt(interview_at)
    if dt is None:
        return 0.0
    delta_hours = (dt - utcnow()).total_seconds() / 3600.0
    return round(delta_hours, 1)


def extract_resume_text(filename: str, raw_bytes: bytes) -> str:
    """Extracts clean plain text from an uploaded PDF, TXT, or Markdown resume."""
    if not raw_bytes:
        raise ValueError("Uploaded resume file is empty.")
    if len(raw_bytes) > MAX_RESUME_BYTES:
        raise ValueError("Resume file exceeds maximum size of 10 MB.")

    suffix = Path(filename or "").suffix.lower()
    is_pdf = suffix == ".pdf" or raw_bytes[:5] == b"%PDF-"

    if is_pdf:
        try:
            reader = PdfReader(io.BytesIO(raw_bytes))
            pages: list[str] = []
            for page in reader.pages:
                extracted = (page.extract_text() or "").strip()
                if extracted:
                    pages.append(extracted)
            text = "\n\n".join(pages)
        except Exception as exc:
            raise ValueError(f"Failed to parse PDF resume: {exc}") from exc
    elif suffix in {"", ".txt", ".md", ".markdown"}:
        text = raw_bytes.decode("utf-8", errors="replace")
    else:
        raise ValueError(f"Unsupported resume file format '{suffix}'. Upload a .pdf, .txt, or .md file.")

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.rstrip() for ln in text.split("\n")]
    cleaned = "\n".join(lines).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def _extract_bullets_and_sections(text: str) -> dict[str, list[str]]:
    """Extracts structured hints (projects, questions, gaps, ask_them, highlights) from free-form text."""
    projects: list[str] = []
    questions: list[str] = []
    gaps: list[str] = []
    ask_them: list[str] = []
    highlights: list[str] = []

    current_section = ""
    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        low = line.lower()

        # Detect markdown / uppercase section headers
        is_heading = line.startswith("#") or (
            len(line) <= 60 and line.isupper() and any(ch.isalpha() for ch in line)
        )
        if is_heading:
            clean_h = line.lstrip("#").strip(" :-")
            current_section = clean_h.lower()
            if any(k in current_section for k in ("project", "system", "architecture", "portfolio")):
                if len(clean_h) > 3 and clean_h.lower() not in {"projects", "key projects"}:
                    projects.append(clean_h)
            continue

        bullet = re.sub(r"^[-*•\d.)]+\s*", "", line).strip()
        if not bullet:
            continue

        if any(k in current_section for k in ("ask", "questions for", "questions to ask")):
            ask_them.append(bullet)
        elif any(k in current_section for k in ("gap", "risk", "weakness", "growth")):
            gaps.append(bullet)
        elif any(k in current_section for k in ("project", "experience", "build")) and len(bullet) >= 12:
            if len(projects) < 6 and (":" in bullet or "|" in bullet or "—" in bullet or " - " in bullet):
                projects.append(bullet[:140])
            else:
                highlights.append(bullet[:180])
        elif bullet.endswith("?") or low.startswith(("q:", "question:")):
            questions.append(re.sub(r"^(?:q|question)\s*:\s*", "", bullet, flags=re.I))
        elif any(k in low for k in ("gap", "ramp", "unfamiliar", "less experience", "weakness")):
            gaps.append(bullet[:180])
        elif len(bullet) >= 15:
            highlights.append(bullet[:180])

    return {
        "projects": list(dict.fromkeys(projects))[:6],
        "questions": list(dict.fromkeys(questions))[:6],
        "gaps": list(dict.fromkeys(gaps))[:5],
        "ask_them": list(dict.fromkeys(ask_them))[:5],
        "highlights": list(dict.fromkeys(highlights))[:10],
    }


def _extract_tech_tokens(text: str, linked_repos: list[str]) -> list[str]:
    low = (text or "").lower()
    found: list[str] = []
    common_stack = [
        "Python", "FastAPI", "React", "TypeScript", "JavaScript", "SQLite", "PostgreSQL",
        "Docker", "Playwright", "Pytest", "RAG", "LLM", "WebSockets", "Asyncio", "REST",
        "GraphQL", "Redis", "Kubernetes", "Rust", "C++", "Linux", "Git", "CI/CD", "Pydantic",
    ]
    for label in common_stack:
        if label.lower() in low:
            found.append(label)
    for repo in linked_repos:
        if repo:
            found.append(repo)
            if "/" in repo:
                found.append(repo.split("/", 1)[1])
    return list(dict.fromkeys(found))[:16]


def _detect_primary_tech_slug(combined_text: str) -> str:
    low = (combined_text or "").lower()
    for needle, slug in TECH_KEYWORD_MAP:
        if needle in low and slug in SUPPORTED_TECH_SLUGS:
            return slug
    return "python"


def _format_day_label(day_number: int, study_days: int, interview_dt: datetime | None, theme: str) -> str:
    if day_number == 0:
        if interview_dt is not None:
            local_dt = interview_dt.astimezone(datetime.now().astimezone().tzinfo or timezone.utc)
            return f"Interview Morning · {local_dt.strftime('%a %b %-d')} Skim"
        return "Interview Morning · 10-Min Skim"

    if interview_dt is not None:
        local_tz = datetime.now().astimezone().tzinfo or timezone.utc
        now_local = datetime.now(local_tz).date()
        target_date = now_local + timedelta(days=day_number - 1)
        interview_date = interview_dt.astimezone(local_tz).date()
        if target_date > interview_date:
            target_date = interview_date
        return f"Day {day_number} · {target_date.strftime('%a %b %-d')} — {theme}"

    return f"Day {day_number} — {theme}"


def _enrich_items_with_ollama(
    company: str,
    role: str,
    duration_minutes: int,
    interviewer_name: str,
    mission_notes: str,
    resume_text: str,
    prep_brief_text: str,
    base_items: list[dict[str, Any]],
    model: str | None = None,
    ollama_client: httpx.Client | None = None,
) -> list[dict[str, Any]]:
    chosen_model = model
    if not chosen_model:
        if ollama_client is not None:
            chosen_model = "local-ollama"
        else:
            models = list_ollama_models(timeout=1.5)
            chosen_model = models[0]["name"] if models else None
    if not chosen_model:
        return base_items

    prompt = f"""You are a calm Staff Software Engineer helping a candidate prepare for a {duration_minutes}-minute interview for "{role}" at "{company}".
Interviewer: {interviewer_name or 'Hiring Engineer'}
Mission context: {mission_notes[:800]}
Prep brief excerpt: {prep_brief_text[:1800]}
Resume excerpt: {resume_text[:1800]}

Generate ONLY a valid JSON object with 2 sharp, high-signal interview drill items tailored to this role:
{{
  "extra_items": [
    {{
      "category": "Q&A",
      "title": "Short specific drill title",
      "prompt": "Direct interviewer question the candidate should answer out loud.",
      "key_points": ["Concrete talking point 1", "Concrete talking point 2", "Concrete talking point 3"],
      "target_seconds": 60,
      "estimated_minutes": 5
    }}
  ]
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
                "options": {"temperature": 0.3},
            },
        )
        resp.raise_for_status()
        parsed = _extract_json_object(resp.json().get("response", "{}"))
    except Exception:
        return base_items
    finally:
        if close_after:
            client.close()

    extras = parsed.get("extra_items") if isinstance(parsed, dict) else None
    if not isinstance(extras, list):
        return base_items

    enriched = list(base_items)
    for raw in extras[:2]:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "").strip()
        q_prompt = str(raw.get("prompt") or "").strip()
        kps = [str(x).strip() for x in (raw.get("key_points") or []) if str(x).strip()]
        if title and q_prompt and kps:
            enriched.append(
                {
                    "category": str(raw.get("category") or "Q&A").upper()[:20],
                    "title": title,
                    "prompt": q_prompt,
                    "key_points": kps[:5],
                    "target_seconds": max(30, min(180, int(raw.get("target_seconds") or 60))),
                    "estimated_minutes": max(3, min(15, int(raw.get("estimated_minutes") or 5))),
                }
            )
    return enriched


def build_realistic_schedule(
    campaign_id: str,
    company: str,
    role: str,
    interview_at: str,
    duration_minutes: int = 30,
    daily_minutes: int = 35,
    interviewer_name: str = "",
    interviewer_notes: str = "",
    mission_notes: str = "",
    resume_text: str = "",
    prep_brief_text: str = "",
    linked_repos: list[str] | None = None,
    supplied_items: list[dict[str, Any]] | None = None,
    use_ollama: bool = False,
    model: str | None = None,
    ollama_client: httpx.Client | None = None,
) -> list[dict[str, Any]]:
    """Builds a calm, realistic, time-boxed study plan up to interview_at + Interview Morning skim."""
    repos = [r.strip() for r in (linked_repos or []) if str(r).strip()]
    interview_dt = _parse_interview_dt(interview_at)
    hours_until = compute_hours_until(interview_at)
    daily_budget = max(15, min(120, int(daily_minutes or 35)))

    # If caller passed pre-structured items, normalize & preserve them directly.
    if supplied_items:
        normalized: list[dict[str, Any]] = []
        for idx, raw in enumerate(supplied_items):
            day_num = int(raw.get("day_number", 1))
            day_label = str(
                raw.get("day_label")
                or ("Interview Morning · 10-Min Skim" if day_num == 0 else f"Day {day_num}")
            )
            item_id = str(raw.get("id") or f"{campaign_id}-item-{idx + 1}")
            kps = raw.get("key_points")
            if kps is None and isinstance(raw.get("key_points_json"), str):
                try:
                    kps = json.loads(raw["key_points_json"])
                except Exception:
                    kps = []
            confidence = str(raw.get("confidence") or "unreviewed")
            if confidence not in VALID_CONFIDENCES:
                confidence = "unreviewed"
            normalized.append(
                {
                    "id": item_id,
                    "campaign_id": campaign_id,
                    "day_number": day_num,
                    "day_label": day_label,
                    "category": str(raw.get("category") or "Q&A").upper(),
                    "title": str(raw.get("title") or f"Study Drill #{idx + 1}"),
                    "prompt": str(raw.get("prompt") or ""),
                    "key_points": [str(k) for k in (kps or []) if str(k).strip()],
                    "target_seconds": max(15, min(300, int(raw.get("target_seconds", 60)))),
                    "estimated_minutes": max(2, min(45, int(raw.get("estimated_minutes", 5)))),
                    "confidence": confidence,
                    "practice_count": max(0, int(raw.get("practice_count", 0))),
                    "order_index": int(raw.get("order_index", idx)),
                    "notes": str(raw.get("notes") or ""),
                }
            )
        return normalized

    # Determine realistic study day count based on hours remaining (1 to 4 study days + Day 0 skim)
    if hours_until <= 18:
        study_days = 1
    elif hours_until <= 42:
        study_days = 2
    elif hours_until <= 84:
        study_days = 3
    else:
        study_days = min(4, max(3, int(math.ceil(hours_until / 24.0))))

    brief_info = _extract_bullets_and_sections(prep_brief_text)
    resume_info = _extract_bullets_and_sections(resume_text)
    combined = "\n".join([mission_notes, interviewer_notes, prep_brief_text, resume_text])
    tech_tokens = _extract_tech_tokens(combined, repos)
    stack_str = ", ".join(tech_tokens[:6]) if tech_tokens else "your core engineering stack"

    pitch_secs = 45 if duration_minutes <= 25 else 60
    interviewer_label = interviewer_name.strip() or "the interviewer"
    lead_project = (
        repos[0]
        if repos
        else (
            brief_info["projects"][0]
            if brief_info["projects"]
            else (resume_info["projects"][0] if resume_info["projects"] else f"Your flagship {role} project")
        )
    )
    secondary_project = (
        repos[1]
        if len(repos) > 1
        else (
            brief_info["projects"][1]
            if len(brief_info["projects"]) > 1
            else (resume_info["projects"][1] if len(resume_info["projects"]) > 1 else None)
        )
    )

    core_drills: list[dict[str, Any]] = [
        {
            "category": "PITCH",
            "title": f"{pitch_secs}s Tell Me About Yourself ({company})",
            "prompt": (
                f"Deliver a crisp {pitch_secs}-second introduction tailored to {interviewer_label} for the "
                f"{role} role at {company} ({duration_minutes}-min call)."
            ),
            "key_points": [
                f"Present -> Past -> Why {company}: lead with the most relevant systems you built ({stack_str}).",
                f"Anchor on 1–2 concrete shipped projects (starting with `{lead_project}`) instead of reciting your whole resume.",
                f"Bridge directly to {company}'s mission: {mission_notes[:140] or f'high-impact {role} engineering'}.",
            ],
            "target_seconds": pitch_secs,
            "estimated_minutes": 6,
        },
        {
            "category": "PROJECT",
            "title": f"Lead Project Deep Dive: {lead_project[:60]}",
            "prompt": (
                f"Walk through `{lead_project}` top-down: problem solved, core architecture, concrete metrics, "
                "and one trade-off you would revisit next."
            ),
            "key_points": [
                f"State the architecture & data flow of `{lead_project}` naming exact modules/services.",
                *(brief_info["highlights"][:2] or resume_info["highlights"][:2] or [
                    "Highlight reliability, validation, or latency constraints you engineered around."
                ]),
                "End with one concrete 'what I would build next' improvement to show Staff-level ownership.",
            ],
            "target_seconds": 90,
            "estimated_minutes": 8,
        },
        {
            "category": "DEBUG STORY",
            "title": "High-Signal Debugging & Testing Story",
            "prompt": (
                "Tell a tight 75-second story about a gnarly bug or production edge case: how you reproduced it, "
                "diagnosed the root cause, verified the fix, and prevented regressions."
            ),
            "key_points": [
                "Situation & symptom in 15s (exact failure mode, not vague background).",
                "Root-cause isolation: logs, debugger/assertions, minimal reproducer test.",
                "Fix + durable safeguard (automated regression tests, fail-closed validation, or timeout/state guards).",
            ],
            "target_seconds": 75,
            "estimated_minutes": 7,
        },
        {
            "category": "Q&A",
            "title": f"Why {company} & Role Alignment ({role})",
            "prompt": (
                f"Why are you excited about {company}'s mission and this {role} seat specifically, "
                f"and how does your recent work translate on day one?"
            ),
            "key_points": [
                mission_notes[:180] if mission_notes.strip() else f"Connect your engineering strengths directly to {company}'s product challenges.",
                *(brief_info["questions"][:1] or [f"Tie hands-on work in {stack_str} to measurable impact in the first 30–60 days."]),
                f"Keep tone grounded, collaborative, and curious about {company}'s real technical bottlenecks.",
            ],
            "target_seconds": 60,
            "estimated_minutes": 6,
        },
    ]

    if secondary_project:
        core_drills.append(
            {
                "category": "PROJECT",
                "title": f"Backup Project Walkthrough: {secondary_project[:55]}",
                "prompt": (
                    f"Give a 60-second architecture & trade-off summary of `{secondary_project}` ready as a follow-up example."
                ),
                "key_points": [
                    f"Lead with why `{secondary_project}` exists and the hardest technical constraint.",
                    *(resume_info["highlights"][2:4] or ["Cite concrete tests, eval metrics, or fail-closed error handling."]),
                    "Keep it punchy so you leave time for follow-up probing.",
                ],
                "target_seconds": 60,
                "estimated_minutes": 6,
            }
        )

    for idx, q_text in enumerate(brief_info["questions"][:2], start=1):
        core_drills.append(
            {
                "category": "Q&A",
                "title": f"Brief Q&A #{idx}: {q_text[:52]}",
                "prompt": q_text,
                "key_points": [
                    "Answer directly in the first sentence, then back it up with a concrete example.",
                    f"Reference specific tools/trade-offs from {stack_str}.",
                    "Keep within 60 seconds and invite follow-up depth.",
                ],
                "target_seconds": 60,
                "estimated_minutes": 6,
            }
        )

    gap_points = brief_info["gaps"] or resume_info["gaps"] or [
        "Be 100% transparent about any stack area where you have lighter production mileage—never bluff.",
        "Bridge from adjacent systems fundamentals you DO own to show fast ramp-up velocity.",
        "Share a concrete week-1 ramp plan (reading core code paths, running tests, pairing on a scoped ticket).",
    ]
    core_drills.append(
        {
            "category": "GAP PREP",
            "title": "Honest Gap Framing & Fast Ramp-Up Plan",
            "prompt": (
                f"If {interviewer_label} probes an area of the {role} stack where you have lighter direct experience, "
                "how do you answer honestly while demonstrating fast, high-agency ramp-up?"
            ),
            "key_points": gap_points[:4],
            "target_seconds": 60,
            "estimated_minutes": 6,
        }
    )

    ask_points = brief_info["ask_them"] or [
        f"What is the highest-leverage technical bottleneck for this {role} in the next 90 days?",
        "How do you evaluate quality, reliability, and regressions before shipping changes?",
        "What distinguishes someone who ramps up from solid to truly high-impact on this team?",
    ]
    core_drills.append(
        {
            "category": "ASK THEM",
            "title": f"3 Sharp Questions for {interviewer_label}",
            "prompt": (
                f"Practice asking 2–3 crisp, thoughtful questions tailored to {interviewer_label} in the final 3–5 minutes."
            ),
            "key_points": ask_points[:4],
            "target_seconds": 45,
            "estimated_minutes": 5,
        }
    )

    if use_ollama:
        core_drills = _enrich_items_with_ollama(
            company=company,
            role=role,
            duration_minutes=duration_minutes,
            interviewer_name=interviewer_name,
            mission_notes=mission_notes,
            resume_text=resume_text,
            prep_brief_text=prep_brief_text,
            base_items=core_drills,
            model=model,
            ollama_client=ollama_client,
        )

    # Trim gently if total study minutes vastly exceeds realistic budget across study_days
    max_total_study_minutes = max(20, int(study_days * daily_budget * 1.15))
    packed_drills: list[dict[str, Any]] = []
    running_mins = 0
    for drill in core_drills:
        est = int(drill["estimated_minutes"])
        if packed_drills and running_mins + est > max_total_study_minutes and len(packed_drills) >= 4:
            continue
        packed_drills.append(drill)
        running_mins += est

    # Distribute packed_drills cleanly across Days 1..study_days respecting daily_budget
    day_themes = [
        "Pitch & Lead Project",
        "Deep Dives, Stories & Q&A",
        "Gap Framing & Timed Rehearsal",
        "Final Polish & Mock Run",
    ]
    buckets: list[list[dict[str, Any]]] = [[] for _ in range(study_days)]
    bucket_mins = [0] * study_days
    target_per_day = max(12, min(daily_budget, int(math.ceil(running_mins / max(1, study_days)))))

    cur_day = 0
    for drill in packed_drills:
        est = int(drill["estimated_minutes"])
        while cur_day < study_days - 1 and buckets[cur_day] and (bucket_mins[cur_day] + est > target_per_day):
            cur_day += 1
        buckets[cur_day].append(drill)
        bucket_mins[cur_day] += est

    # Build final CampaignItem list
    final_items: list[dict[str, Any]] = []
    order_idx = 0
    for d_idx, day_drills in enumerate(buckets, start=1):
        if not day_drills:
            continue
        theme = day_themes[(d_idx - 1) % len(day_themes)]
        label = _format_day_label(d_idx, study_days, interview_dt, theme)
        for drill in day_drills:
            order_idx += 1
            final_items.append(
                {
                    "id": f"{campaign_id}-d{d_idx}-{order_idx}",
                    "campaign_id": campaign_id,
                    "day_number": d_idx,
                    "day_label": label,
                    "category": drill["category"],
                    "title": drill["title"],
                    "prompt": drill["prompt"],
                    "key_points": drill["key_points"],
                    "target_seconds": int(drill["target_seconds"]),
                    "estimated_minutes": int(drill["estimated_minutes"]),
                    "confidence": "unreviewed",
                    "practice_count": 0,
                    "order_index": order_idx,
                    "notes": "",
                }
            )

    # Always include a calm Interview Morning Skim (day_number = 0, ~10 min total)
    morning_label = _format_day_label(0, study_days, interview_dt, "Skim")
    morning_drills = [
        {
            "category": "PITCH",
            "title": "30-Second Opening & Metric Anchor Skim",
            "prompt": (
                f"Do ONE calm spoken run of your opening pitch and top metric anchors for `{lead_project}` "
                "— no cramming!"
            ),
            "key_points": [
                f"Role & Company anchor: `{role}` at `{company}` ({duration_minutes} min with {interviewer_label}).",
                f"Lead project anchor: `{lead_project}` (problem -> architecture -> reliability -> next step).",
                "Breathe, slow your cadence slightly, and answer the question asked before diving deep.",
            ],
            "target_seconds": 45,
            "estimated_minutes": 5,
        },
        {
            "category": "ASK THEM",
            "title": "Pre-Call Questions & Logistics Check",
            "prompt": (
                "Confirm audio/mic, meeting link, and keep your top 2–3 questions visible in front of you."
            ),
            "key_points": [
                *ask_points[:2],
                "Check mic/headphones 5 minutes early, have water nearby, and keep your resume/repos tab handy.",
            ],
            "target_seconds": 30,
            "estimated_minutes": 5,
        },
    ]
    for m_idx, drill in enumerate(morning_drills, start=1):
        order_idx += 1
        final_items.append(
            {
                "id": f"{campaign_id}-d0-{m_idx}",
                "campaign_id": campaign_id,
                "day_number": 0,
                "day_label": morning_label,
                "category": drill["category"],
                "title": drill["title"],
                "prompt": drill["prompt"],
                "key_points": drill["key_points"],
                "target_seconds": int(drill["target_seconds"]),
                "estimated_minutes": int(drill["estimated_minutes"]),
                "confidence": "unreviewed",
                "practice_count": 0,
                "order_index": order_idx,
                "notes": "",
            }
        )

    return final_items


def _row_to_item(row: sqlite3.Row) -> dict[str, Any]:
    try:
        key_points = json.loads(row["key_points_json"] or "[]")
    except Exception:
        key_points = []
    return {
        "id": str(row["id"]),
        "campaign_id": str(row["campaign_id"]),
        "day_number": int(row["day_number"]),
        "day_label": str(row["day_label"]),
        "category": str(row["category"]),
        "title": str(row["title"]),
        "prompt": str(row["prompt"]),
        "key_points": [str(k) for k in key_points] if isinstance(key_points, list) else [],
        "target_seconds": int(row["target_seconds"]),
        "estimated_minutes": int(row["estimated_minutes"]),
        "confidence": str(row["confidence"]),
        "practice_count": int(row["practice_count"]),
        "order_index": int(row["order_index"]),
        "notes": str(row["notes"] or ""),
    }


def _group_days(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_day: dict[int, list[dict[str, Any]]] = {}
    labels: dict[int, str] = {}
    for it in items:
        dnum = int(it["day_number"])
        by_day.setdefault(dnum, []).append(it)
        labels.setdefault(dnum, it["day_label"])

    # Study days (1, 2, 3...) first, then Interview Morning Skim (0) last
    ordered_day_nums = sorted([d for d in by_day if d > 0]) + ([0] if 0 in by_day else [])
    days: list[dict[str, Any]] = []
    for dnum in ordered_day_nums:
        day_items = sorted(by_day[dnum], key=lambda x: x["order_index"])
        days.append(
            {
                "day_number": dnum,
                "day_label": labels[dnum],
                "estimated_minutes": sum(int(x["estimated_minutes"]) for x in day_items),
                "remaining_minutes": sum(
                    int(x["estimated_minutes"]) for x in day_items if x["confidence"] not in ("ready", "nailed")
                ),
                "completed_count": sum(1 for x in day_items if x["confidence"] in ("ready", "nailed")),
                "total_count": len(day_items),
                "items": day_items,
            }
        )
    return days


def compute_campaign_summary(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    item_rows = conn.execute(
        """
        SELECT * FROM campaign_items
        WHERE campaign_id = ?
        ORDER BY CASE WHEN day_number = 0 THEN 999 ELSE day_number END ASC, order_index ASC
        """,
        (row["id"],),
    ).fetchall()
    items = [_row_to_item(r) for r in item_rows]
    total_items = len(items)
    mastered_items = sum(1 for it in items if it["confidence"] in ("ready", "nailed"))
    if total_items > 0:
        readiness_pct = round(
            sum(CONFIDENCE_SCORE.get(it["confidence"], 0) for it in items) / total_items,
            1,
        )
    else:
        readiness_pct = 0.0

    total_minutes = sum(int(it["estimated_minutes"]) for it in items)
    remaining_minutes = sum(
        int(it["estimated_minutes"]) for it in items if it["confidence"] not in ("ready", "nailed")
    )
    hours_until = compute_hours_until(str(row["interview_at"]))

    next_item_title: str | None = None
    for it in items:
        if it["confidence"] in ("unreviewed", "shaky"):
            next_item_title = it["title"]
            break
    if next_item_title is None:
        for it in items:
            if it["confidence"] != "nailed":
                next_item_title = it["title"]
                break

    return {
        "id": str(row["id"]),
        "company": str(row["company"]),
        "role": str(row["role"]),
        "interview_at": str(row["interview_at"]),
        "duration_minutes": int(row["duration_minutes"]),
        "daily_minutes": int(row["daily_minutes"]),
        "meeting_url": str(row["meeting_url"] or ""),
        "interviewer_name": str(row["interviewer_name"] or ""),
        "status": str(row["status"]),
        "readiness_pct": readiness_pct,
        "total_items": total_items,
        "mastered_items": mastered_items,
        "total_minutes": total_minutes,
        "remaining_minutes": remaining_minutes,
        "hours_until": hours_until,
        "next_item_title": next_item_title,
        "days": _group_days(items),
    }


def _strip_days_for_summary(summary_with_days: dict[str, Any]) -> dict[str, Any]:
    out = dict(summary_with_days)
    out.pop("days", None)
    return out


def list_campaigns(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM interview_campaigns ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, interview_at ASC"
    ).fetchall()
    return [_strip_days_for_summary(compute_campaign_summary(conn, r)) for r in rows]


def get_upcoming_campaign(conn: sqlite3.Connection) -> dict[str, Any] | None:
    rows = conn.execute(
        "SELECT * FROM interview_campaigns WHERE status = 'active' ORDER BY interview_at ASC"
    ).fetchall()
    if not rows:
        return None
    summaries = [_strip_days_for_summary(compute_campaign_summary(conn, r)) for r in rows]
    # Prefer soonest non-expired campaign (within -2h grace window), else soonest active
    upcoming = [s for s in summaries if s["hours_until"] >= -2.0]
    chosen = min(upcoming, key=lambda s: s["hours_until"]) if upcoming else summaries[0]
    return chosen


def get_campaign_detail(conn: sqlite3.Connection, campaign_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM interview_campaigns WHERE id = ?", (campaign_id,)).fetchone()
    if not row:
        raise KeyError(f"Interview campaign '{campaign_id}' not found.")
    summary_with_days = compute_campaign_summary(conn, row)
    days = summary_with_days["days"]
    flat_items = [it for day in days for it in day["items"]]
    try:
        linked_repos = json.loads(row["linked_repos_json"] or "[]")
    except Exception:
        linked_repos = []

    return {
        **summary_with_days,
        "interviewer_notes": str(row["interviewer_notes"] or ""),
        "mission_notes": str(row["mission_notes"] or ""),
        "resume_filename": str(row["resume_filename"] or ""),
        "resume_text": str(row["resume_text"] or ""),
        "prep_brief_text": str(row["prep_brief_text"] or ""),
        "linked_repos": [str(r) for r in linked_repos] if isinstance(linked_repos, list) else [],
        "items": flat_items,
        "days": days,
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def create_campaign(
    conn: sqlite3.Connection,
    *,
    company: str,
    role: str,
    interview_at: str,
    duration_minutes: int = 30,
    daily_minutes: int = 35,
    meeting_url: str = "",
    interviewer_name: str = "",
    interviewer_notes: str = "",
    mission_notes: str = "",
    resume_filename: str = "",
    resume_text: str = "",
    prep_brief_text: str = "",
    linked_repos: list[str] | None = None,
    use_ollama: bool = False,
    model: str | None = None,
    items: list[dict[str, Any]] | None = None,
    campaign_id: str | None = None,
    ollama_client: httpx.Client | None = None,
) -> dict[str, Any]:
    company_clean = (company or "").strip()
    role_clean = (role or "").strip()
    if not company_clean or not role_clean:
        raise ValueError("Both 'company' and 'role' are required.")
    if not (interview_at or "").strip():
        raise ValueError("'interview_at' timestamp is required.")

    cid = (campaign_id or "").strip()
    if not cid:
        cid = f"camp-{_slugify(company_clean, 20)}-{_slugify(role_clean, 16)}-{int(time.time() * 1000) % 1000000}"

    repos = [str(r).strip() for r in (linked_repos or []) if str(r).strip()]
    now = iso_now()

    conn.execute(
        """
        INSERT INTO interview_campaigns (
            id, company, role, interview_at, duration_minutes, daily_minutes,
            meeting_url, interviewer_name, interviewer_notes, mission_notes,
            resume_filename, resume_text, prep_brief_text, linked_repos_json,
            status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            company=excluded.company,
            role=excluded.role,
            interview_at=excluded.interview_at,
            duration_minutes=excluded.duration_minutes,
            daily_minutes=excluded.daily_minutes,
            meeting_url=excluded.meeting_url,
            interviewer_name=excluded.interviewer_name,
            interviewer_notes=excluded.interviewer_notes,
            mission_notes=excluded.mission_notes,
            resume_filename=excluded.resume_filename,
            resume_text=excluded.resume_text,
            prep_brief_text=excluded.prep_brief_text,
            linked_repos_json=excluded.linked_repos_json,
            status=excluded.status,
            updated_at=excluded.updated_at
        """,
        (
            cid,
            company_clean,
            role_clean,
            interview_at.strip(),
            int(duration_minutes),
            int(daily_minutes),
            (meeting_url or "").strip(),
            (interviewer_name or "").strip(),
            (interviewer_notes or "").strip(),
            (mission_notes or "").strip(),
            (resume_filename or "").strip(),
            (resume_text or "").strip(),
            (prep_brief_text or "").strip(),
            json.dumps(repos),
            now,
            now,
        ),
    )

    built_items = build_realistic_schedule(
        campaign_id=cid,
        company=company_clean,
        role=role_clean,
        interview_at=interview_at.strip(),
        duration_minutes=int(duration_minutes),
        daily_minutes=int(daily_minutes),
        interviewer_name=interviewer_name,
        interviewer_notes=interviewer_notes,
        mission_notes=mission_notes,
        resume_text=resume_text,
        prep_brief_text=prep_brief_text,
        linked_repos=repos,
        supplied_items=items,
        use_ollama=use_ollama,
        model=model,
        ollama_client=ollama_client,
    )

    # Replace items cleanly on upsert
    conn.execute("DELETE FROM campaign_items WHERE campaign_id = ?", (cid,))
    for it in built_items:
        conn.execute(
            """
            INSERT INTO campaign_items (
                id, campaign_id, day_number, day_label, category, title, prompt,
                key_points_json, target_seconds, estimated_minutes, confidence,
                practice_count, order_index, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                it["id"],
                cid,
                int(it["day_number"]),
                it["day_label"],
                it["category"],
                it["title"],
                it["prompt"],
                json.dumps(it["key_points"]),
                int(it["target_seconds"]),
                int(it["estimated_minutes"]),
                it["confidence"],
                int(it["practice_count"]),
                int(it["order_index"]),
                it["notes"],
            ),
        )

    return get_campaign_detail(conn, cid)


def record_item_practice(
    conn: sqlite3.Connection,
    campaign_id: str,
    item_id: str,
    confidence: str,
    notes: str | None = None,
) -> dict[str, Any]:
    conf = (confidence or "").strip().lower()
    if conf not in VALID_CONFIDENCES:
        raise ValueError(f"Invalid confidence '{confidence}'. Must be one of {VALID_CONFIDENCES}.")

    camp_row = conn.execute("SELECT * FROM interview_campaigns WHERE id = ?", (campaign_id,)).fetchone()
    if not camp_row:
        raise KeyError(f"Interview campaign '{campaign_id}' not found.")

    item_row = conn.execute(
        "SELECT * FROM campaign_items WHERE id = ? AND campaign_id = ?",
        (item_id, campaign_id),
    ).fetchone()
    if not item_row:
        raise KeyError(f"Campaign item '{item_id}' not found in campaign '{campaign_id}'.")

    new_notes = str(item_row["notes"] or "") if notes is None else str(notes)
    now = iso_now()

    conn.execute(
        """
        UPDATE campaign_items
        SET confidence = ?, practice_count = practice_count + 1, notes = ?
        WHERE id = ? AND campaign_id = ?
        """,
        (conf, new_notes, item_id, campaign_id),
    )
    conn.execute(
        "UPDATE interview_campaigns SET updated_at = ? WHERE id = ?",
        (now, campaign_id),
    )

    # Award capped XP (+10 for ready, +20 total for nailed) without infinite farming
    target_xp = CONFIDENCE_XP_TARGET.get(conf, 0)
    prev_xp_row = conn.execute(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM xp_ledger WHERE source = 'campaign_practice' AND reason LIKE ?",
        (f"%[{item_id}]%",),
    ).fetchone()
    prev_xp = int(prev_xp_row["s"]) if prev_xp_row else 0
    xp_awarded = max(0, target_xp - prev_xp)

    if xp_awarded > 0:
        tech_slug = _detect_primary_tech_slug(
            f"{camp_row['role']} {camp_row['prep_brief_text']} {camp_row['linked_repos_json']}"
        )
        award_xp(
            conn,
            tech_slug,
            xp_awarded,
            "campaign_practice",
            f"Interview Prep ({camp_row['company']}): {item_row['title']} [{item_id}]",
        )

    unlocked_achievements = evaluate_achievements(conn)

    updated_item_row = conn.execute(
        "SELECT * FROM campaign_items WHERE id = ? AND campaign_id = ?",
        (item_id, campaign_id),
    ).fetchone()
    updated_camp_row = conn.execute(
        "SELECT * FROM interview_campaigns WHERE id = ?",
        (campaign_id,),
    ).fetchone()

    return {
        "item": _row_to_item(updated_item_row),
        "campaign": _strip_days_for_summary(compute_campaign_summary(conn, updated_camp_row)),
        "xp_awarded": xp_awarded,
        "unlocked_achievements": unlocked_achievements,
    }


def delete_campaign(conn: sqlite3.Connection, campaign_id: str) -> dict[str, str]:
    cur = conn.execute("DELETE FROM interview_campaigns WHERE id = ?", (campaign_id,))
    if cur.rowcount == 0:
        raise KeyError(f"Interview campaign '{campaign_id}' not found.")
    return {"deleted": campaign_id}


def start_campaign_mock_interview(
    conn: sqlite3.Connection,
    campaign_id: str,
    model: str | None = None,
) -> dict[str, Any]:
    """Starts a 4-question tailored mock interview grounded in the campaign's company, mission, resume & drills."""
    detail = get_campaign_detail(conn, campaign_id)
    company = detail["company"]
    role = detail["role"]
    duration = detail["duration_minutes"]
    interviewer = detail["interviewer_name"] or "your interviewer"
    interviewer_notes = detail["interviewer_notes"]
    mission = detail["mission_notes"]
    repos = detail["linked_repos"]
    items = detail["items"]

    by_cat: dict[str, list[dict[str, Any]]] = {}
    for it in items:
        by_cat.setdefault(it["category"].upper(), []).append(it)

    pitch_item = (by_cat.get("PITCH") or [None])[0]
    project_item = (by_cat.get("PROJECT") or [None])[0]
    debug_item = (by_cat.get("DEBUG STORY") or by_cat.get("Q&A") or [None])[0]
    gap_item = (by_cat.get("GAP PREP") or by_cat.get("ASK THEM") or [None])[0]

    combined_text = "\n".join(
        [
            company,
            role,
            interviewer,
            interviewer_notes,
            mission,
            detail["resume_text"][:3000],
            detail["prep_brief_text"][:3000],
        ]
    )
    stack_pool = _extract_tech_tokens(combined_text, repos)
    tech_slug = _detect_primary_tech_slug(combined_text)

    # Extract concrete code/project references from repos, resume, and drill key_points
    raw_refs: list[str] = list(repos)
    for r in repos:
        if "/" in r:
            raw_refs.append(r.split("/", 1)[1])
    for it in items:
        for kp in it.get("key_points", []):
            raw_refs.extend(re.findall(r"`([^`]+)`", kp))
    raw_refs.extend(
        re.findall(r"\b[A-Za-z0-9_-]+\.(?:py|ts|tsx|js|mjs|sql|sh|cpp|hpp|rs|json)\b|/[a-z][a-z0-9_/-]+", combined_text)
    )
    raw_refs.extend([company, role])
    code_refs_pool = list(dict.fromkeys(r.strip() for r in raw_refs if r and len(r.strip()) >= 2))[:24]

    lead_proj_name = (
        project_item["title"]
        if project_item
        else (repos[0] if repos else f"your most relevant {role} project")
    )

    q1_ideal = (
        pitch_item["key_points"]
        if pitch_item and pitch_item.get("key_points")
        else [
            f"Deliver a concise intro tailored to {role} at {company}.",
            f"Connect concrete shipped work ({', '.join(repos[:2]) or 'core projects'}) to {company}'s mission.",
            "Keep pacing tight and leave room for technical follow-ups.",
        ]
    )
    q2_ideal = (
        project_item["key_points"]
        if project_item and project_item.get("key_points")
        else [
            f"Trace the end-to-end architecture and key modules of {lead_proj_name}.",
            "Cite concrete metrics, constraints, or latency/reliability choices.",
            "Call out one next iteration or trade-off you would tackle next.",
        ]
    )
    q3_ideal = (
        debug_item["key_points"]
        if debug_item and debug_item.get("key_points")
        else [
            "Describe a specific failure mode and how you reproduced it deterministically.",
            "Explain the root cause and verification strategy (automated tests, mocks, or evals).",
            "Highlight defensive safeguards that prevent regressions.",
        ]
    )
    q4_ideal = (
        gap_item["key_points"]
        if gap_item and gap_item.get("key_points")
        else [
            "Address stack gaps transparently without overclaiming.",
            "Bridge from adjacent systems experience to a concrete ramp-up plan.",
            f"Discuss one realistic trade-off relevant to {company}'s engineering priorities.",
        ]
    )

    persona_note = f" ({interviewer_notes[:120]})" if interviewer_notes else ""
    mission_snippet = f" Mission context: {mission[:160]}." if mission else ""

    questions = [
        {
            "index": 0,
            "category": "Intro & Mission Fit",
            "focus": f"{duration}-minute screen opening with {interviewer}",
            "question": (
                f"Hi — I'm {interviewer} at {company}. We have {duration} minutes for this {role} screen. "
                f"Give me a tight introduction to your background and what specifically draws you to {company}'s work?"
            ),
            "context_hint": f"Tailor to {interviewer}{persona_note}.{mission_snippet}",
            "ideal_points": q1_ideal[:4],
            "code_refs_pool": code_refs_pool,
            "stack_pool": stack_pool,
            "tech_slug": tech_slug,
            "answer": None,
            "rubric": None,
            "answered_at": None,
        },
        {
            "index": 1,
            "category": "Lead Project Deep Dive",
            "focus": "Architecture, concrete implementation details & measurable outcomes",
            "question": (
                project_item["prompt"]
                if project_item and project_item.get("prompt")
                else f"Walk me deep into `{lead_proj_name}`: how is it architected end-to-end, what trade-offs did you make, and what would you improve next?"
            ),
            "context_hint": (
                f"Reference concrete components/metrics from {lead_proj_name} "
                f"(linked repos: {', '.join(repos[:3]) or 'your resume projects'})."
            ),
            "ideal_points": q2_ideal[:4],
            "code_refs_pool": code_refs_pool,
            "stack_pool": stack_pool,
            "tech_slug": tech_slug,
            "answer": None,
            "rubric": None,
            "answered_at": None,
        },
        {
            "index": 2,
            "category": "Debugging, Testing & Reliability",
            "focus": "Root-cause isolation, automated testing, and fail-closed engineering",
            "question": (
                debug_item["prompt"]
                if debug_item and debug_item.get("prompt")
                else f"Walk me through a subtle bug or failure mode you hit in `{lead_proj_name}` — how did you isolate it, test it offline, and keep it from recurring?"
            ),
            "context_hint": "Keep it structured: Symptom (15s) -> Root Cause -> Fix -> Automated Safeguard.",
            "ideal_points": q3_ideal[:4],
            "code_refs_pool": code_refs_pool,
            "stack_pool": stack_pool,
            "tech_slug": tech_slug,
            "answer": None,
            "rubric": None,
            "answered_at": None,
        },
        {
            "index": 3,
            "category": "Trade-Offs & Ramp-Up",
            "focus": "Engineering judgment, honest gap framing, and high-agency execution",
            "question": (
                gap_item["prompt"]
                if gap_item and gap_item.get("prompt")
                else f"Looking at the {role} stack at {company}, where would your biggest learning curve be in month one, what trade-offs would you watch closely, and how would you ramp up fast?"
            ),
            "context_hint": "Stay honest about gaps, anchor on adjacent fundamentals, and state a concrete ramp-up plan.",
            "ideal_points": q4_ideal[:4],
            "code_refs_pool": code_refs_pool,
            "stack_pool": stack_pool,
            "tech_slug": tech_slug,
            "answer": None,
            "rubric": None,
            "answered_at": None,
        },
    ]

    repo_full_name = f"{company} — {role}"
    module_id = f"campaign:{campaign_id}"
    now = iso_now()
    cur = conn.execute(
        """
        INSERT INTO mock_interviews (
            repo_full_name, module_id, status, readiness_score, transcript_json, created_at, updated_at
        ) VALUES (?, ?, 'active', 0, ?, ?, ?)
        """,
        (repo_full_name, module_id, json.dumps(questions), now, now),
    )
    session_id = int(cur.lastrowid)

    public_questions = [
        {
            "index": int(q["index"]),
            "category": str(q["category"]),
            "question": str(q["question"]),
            "context_hint": str(q["context_hint"]),
            "focus": str(q["focus"]),
        }
        for q in questions
    ]

    return {
        "session_id": session_id,
        "repo_full_name": repo_full_name,
        "module_id": module_id,
        "status": "active",
        "current_index": 0,
        "total_questions": len(public_questions),
        "question": public_questions[0],
        "questions": public_questions,
        "readiness_score": 0.0,
    }
