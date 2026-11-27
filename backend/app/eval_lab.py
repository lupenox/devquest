from __future__ import annotations

import json
import re
import sqlite3
import time
from typing import Any

from .achievements import evaluate_achievements
from .db import award_xp
from .rpg import compute_mastery_pct, iso_now

VALID_CHOICES: tuple[str, ...] = ("strongly_a", "slightly_a", "tie", "slightly_b", "strongly_b")

TAG_LABELS: dict[str, str] = {
    "missed_edge_case": "Missed edge case",
    "weakened_test": "Weakened / bypassed test",
    "swallowed_error": "Swallowed error",
    "broke_contract": "Broke API / output contract",
    "leaked_error": "Leaked internal error",
    "stale_closure": "Stale ref / closure bug",
    "unsafe_shell": "Unsafe shell / unquoted var",
    "perf_issue": "Performance / O(n²) issue",
    "clean_tests": "Strong verification tests",
    "idiomatic_fix": "Clean idiomatic fix",
}


def _tag_list(slugs: list[str]) -> list[dict[str, str]]:
    return [{"slug": s, "label": TAG_LABELS.get(s, s.replace("_", " ").title())} for s in slugs]


EVAL_SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "eval-py-async-timer",
        "title": "Asyncio Stale Fallback Timer Race",
        "language": "python",
        "tech_slug": "python",
        "difficulty": "intermediate",
        "estimated_minutes": 5,
        "context": (
            "A multi-stage async workflow starts a 60s inactivity nudge timer during stage 'intro'. "
            "If the user advances to stage 'technical' before 60s, the old intro timer must never fire."
        ),
        "task_prompt": (
            "Fix the stale fallback timer race so advancing stages cancels pending timers, "
            "re-verifies the active stage token before emitting a nudge, and proves it with a fast offline unit test."
        ),
        "acceptance_criteria": [
            "Advancing to a new stage cancels any pending timer task immediately.",
            "Timer callback checks a monotonic stage token before emitting a nudge.",
            "Cancellation propagates cleanly (do not swallow asyncio.CancelledError).",
            "Offline unit test verifies zero stale nudges fire after a stage transition.",
        ],
        "approach_a": {
            "label": "Approach A",
            "summary": "Starts a background timer and wraps wait logic in broad try/except without cancelling or checking stage.",
            "code": (
                "import asyncio\n\n"
                "class StageController:\n"
                "    def __init__(self, emit):\n"
                "        self.stage = 'intro'\n"
                "        self.emit = emit\n"
                "        self._timer_task = None\n\n"
                "    def start_nudge(self, delay: float = 60.0):\n"
                "        self._timer_task = asyncio.create_task(self._nudge(delay))\n\n"
                "    async def _nudge(self, delay: float):\n"
                "        try:\n"
                "            await asyncio.sleep(delay)\n"
                "            await self.emit('Still in intro — ready to move on?')\n"
                "        except Exception:\n"
                "            pass\n\n"
                "    def transition_to(self, next_stage: str):\n"
                "        self.stage = next_stage\n"
                "        self._timer_task = None  # drops reference without cancelling\n"
            ),
            "test_output": (
                "$ pytest -q test_stage.py\n"
                "1 passed in 0.04s\n"
                "# Note: test only checks start_nudge() without calling transition_to() before delay expires."
            ),
        },
        "approach_b": {
            "label": "Approach B",
            "summary": "Tracks a monotonic stage token, explicitly cancels old tasks on transition, and tests the race offline.",
            "code": (
                "import asyncio\n\n"
                "class StageController:\n"
                "    def __init__(self, emit):\n"
                "        self.stage = 'intro'\n"
                "        self.emit = emit\n"
                "        self._stage_token = 0\n"
                "        self._timer_task: asyncio.Task | None = None\n\n"
                "    def start_nudge(self, delay: float = 60.0):\n"
                "        self._cancel_timer()\n"
                "        token = self._stage_token\n"
                "        self._timer_task = asyncio.create_task(self._nudge(delay, token))\n\n"
                "    def _cancel_timer(self):\n"
                "        if self._timer_task and not self._timer_task.done():\n"
                "            self._timer_task.cancel()\n"
                "        self._timer_task = None\n\n"
                "    async def _nudge(self, delay: float, token: int):\n"
                "        await asyncio.sleep(delay)\n"
                "        if token != self._stage_token:\n"
                "            return\n"
                "        await self.emit('Still in intro — ready to move on?')\n\n"
                "    def transition_to(self, next_stage: str):\n"
                "        self._stage_token += 1\n"
                "        self.stage = next_stage\n"
                "        self._cancel_timer()\n"
            ),
            "test_output": (
                "$ pytest -q test_stage.py\n"
                "test_stale_timer_does_not_fire_after_transition PASSED\n"
                "test_timer_fires_when_still_in_intro PASSED\n"
                "2 passed in 0.03s"
            ),
        },
        "available_tags": _tag_list(
            ["swallowed_error", "missed_edge_case", "clean_tests", "idiomatic_fix", "weakened_test", "broke_contract"]
        ),
        "expected_side": "b",
        "key_tags": ["swallowed_error", "missed_edge_case", "clean_tests"],
        "code_anchors": ["cancel", "_stage_token", "token", "transition_to", "_timer_task", "except exception", "cancellederror"],
        "reference_explanation": (
            "Approach B is clearly stronger: it increments a monotonic `_stage_token`, explicitly calls "
            "`_timer_task.cancel()` on stage transitions, lets `asyncio.CancelledError` propagate naturally, "
            "and re-checks `token != self._stage_token` before emitting. Approach A drops the task reference without "
            "cancelling it (so the old intro timer still fires in the 'technical' stage), catches `Exception` silently, "
            "and never tests the race condition."
        ),
        "sample_followup": (
            "Approach B handles the race cleanly. Please also add an assertion in `test_stage.py` confirming that "
            "calling `start_nudge()` twice cancels the first timer task and only emits once."
        ),
    },
    {
        "id": "eval-fastapi-rate-limit",
        "title": "FastAPI Rate Limiter Without Breaking Contract",
        "language": "python",
        "tech_slug": "fastapi",
        "difficulty": "intermediate",
        "estimated_minutes": 6,
        "context": (
            "An existing `POST /v1/summaries` endpoint returns `{\"id\": str, \"summary\": str}` to mobile and web clients. "
            "You asked the assistant to add a per-client rate limit of 10 requests/minute."
        ),
        "task_prompt": (
            "Enforce a 10 req/min per-client rate limit returning HTTP 429 with a numeric `Retry-After` header, "
            "preserve the exact `200` JSON response contract, avoid leaking internal exception details, and add `TestClient` tests."
        ),
        "acceptance_criteria": [
            "HTTP 200 response preserves exact `{\"id\", \"summary\"}` top-level keys.",
            "Exceeding the limit returns HTTP 429 with a numeric `Retry-After` header.",
            "Unexpected errors return a safe generic message without raw exception strings.",
            "`TestClient` tests verify both 200 contract and 429 + `Retry-After` behavior.",
        ],
        "approach_a": {
            "label": "Approach A",
            "summary": "Checks counters inline, wraps the 200 JSON payload in a new envelope, and exposes raw exception text.",
            "code": (
                "@app.post('/v1/summaries')\n"
                "def create_summary(payload: SummaryReq, request: Request):\n"
                "    try:\n"
                "        ip = request.client.host\n"
                "        if not limiter.allow(ip):\n"
                "            return JSONResponse({'error': 'too many requests'}, status_code=400)\n"
                "        result = summarize(payload.text)\n"
                "        # Added envelope so clients can see remaining quota\n"
                "        return {'data': result, 'rate_remaining': limiter.remaining(ip)}\n"
                "    except Exception as exc:\n"
                "        return JSONResponse({'error': str(exc)}, status_code=500)\n"
            ),
            "test_output": (
                "$ pytest -q test_api.py\n"
                "test_create_summary_returns_data PASSED\n"
                "1 passed in 0.11s"
            ),
        },
        "approach_b": {
            "label": "Approach B",
            "summary": "Enforces rate limits via FastAPI `Depends`, returns 429 + `Retry-After`, and keeps the 200 schema intact.",
            "code": (
                "def enforce_rate_limit(request: Request) -> None:\n"
                "    ip = request.client.host if request.client else 'unknown'\n"
                "    allowed, retry_after = limiter.check(ip)\n"
                "    if not allowed:\n"
                "        raise HTTPException(\n"
                "            status_code=429,\n"
                "            detail='Rate limit exceeded',\n"
                "            headers={'Retry-After': str(max(1, int(retry_after)))},\n"
                "        )\n\n"
                "@app.post('/v1/summaries', response_model=SummaryResp)\n"
                "def create_summary(payload: SummaryReq, _=Depends(enforce_rate_limit)):\n"
                "    return summarize(payload.text)  # returns {'id': ..., 'summary': ...}\n"
            ),
            "test_output": (
                "$ pytest -q test_api.py\n"
                "test_summary_contract_preserved PASSED\n"
                "test_rate_limit_returns_429_with_retry_after PASSED\n"
                "2 passed in 0.14s"
            ),
        },
        "available_tags": _tag_list(
            ["broke_contract", "leaked_error", "missed_edge_case", "clean_tests", "idiomatic_fix", "perf_issue"]
        ),
        "expected_side": "b",
        "key_tags": ["broke_contract", "leaked_error", "clean_tests"],
        "code_anchors": ["depends", "429", "retry-after", "response_model", "data", "str(exc)", "400", "testclient"],
        "reference_explanation": (
            "Approach B is strongly preferred: it isolates rate limiting in a reusable FastAPI `Depends(enforce_rate_limit)`, "
            "returns the standard HTTP `429` with a numeric `Retry-After` header, preserves the existing `{\"id\", \"summary\"}` "
            "schema via `response_model`, and verifies both paths in `TestClient`. Approach A silently breaks downstream clients "
            "by wrapping responses in `{'data': ...}`, returns `400` without `Retry-After`, and leaks `str(exc)` on 500s."
        ),
        "sample_followup": (
            "Let's go with Approach B. Please also ensure the limiter tracks timestamps with `time.monotonic()` "
            "and add a test verifying that a second client IP is not blocked when the first hits 429."
        ),
    },
    {
        "id": "eval-py-test-cheat",
        "title": "Spot the Reward Hack: TTL Cache Expiration",
        "language": "python",
        "tech_slug": "debugging",
        "difficulty": "intermediate",
        "estimated_minutes": 5,
        "context": (
            "A lightweight `TTLCache` fails `test_expired_entry_is_evicted` because expired entries are still returned. "
            "Watch BOTH the implementation diff AND the test diff carefully!"
        ),
        "task_prompt": (
            "Fix `TTLCache.get()` so entries past their TTL return `None` and are evicted using a monotonic clock, "
            "without weakening or deleting any existing tests."
        ),
        "acceptance_criteria": [
            "Expired entries return `None` and are removed from `self._store`.",
            "Uses `time.monotonic` (not wall-clock `time.time`).",
            "Existing strict assertions in `test_cache.py` stay intact and pass.",
        ],
        "approach_a": {
            "label": "Approach A",
            "summary": "Leaves the inverted expiry comparison untouched and relaxes the failing test assertion so pytest turns green.",
            "code": (
                "# cache.py (unchanged bug: < instead of >=)\n"
                "def get(self, key: str):\n"
                "    entry = self._store.get(key)\n"
                "    if not entry:\n"
                "        return None\n"
                "    value, expires_at = entry\n"
                "    if time.time() < expires_at:  # BUG: expires immediately or inverted logic\n"
                "        return value\n"
                "    return value  # BUG: still returns stale value!\n\n"
                "# test_cache.py (reward hack!)\n"
                "def test_expired_entry_is_evicted():\n"
                "    c = TTLCache(ttl=0.05)\n"
                "    c.set('k', 'v')\n"
                "    time.sleep(0.08)\n"
                "    # Relaxed flaky timing assertion to keep CI green\n"
                "    assert c.get('k') in (None, 'v')\n"
            ),
            "test_output": (
                "$ pytest -q test_cache.py\n"
                "3 passed in 0.09s"
            ),
        },
        "approach_b": {
            "label": "Approach B",
            "summary": "Fixes expiry comparison + eviction using an injectable `time.monotonic` clock and keeps strict tests.",
            "code": (
                "# cache.py\n"
                "class TTLCache:\n"
                "    def __init__(self, ttl: float, clock=time.monotonic):\n"
                "        self._ttl = ttl\n"
                "        self._clock = clock\n"
                "        self._store: dict[str, tuple[object, float]] = {}\n\n"
                "    def set(self, key: str, value: object) -> None:\n"
                "        self._store[key] = (value, self._clock() + self._ttl)\n\n"
                "    def get(self, key: str):\n"
                "        entry = self._store.get(key)\n"
                "        if entry is None:\n"
                "            return None\n"
                "        value, expires_at = entry\n"
                "        if self._clock() >= expires_at:\n"
                "            self._store.pop(key, None)\n"
                "            return None\n"
                "        return value\n\n"
                "# test_cache.py (strict + deterministic)\n"
                "def test_expired_entry_is_evicted():\n"
                "    now = [100.0]\n"
                "    c = TTLCache(ttl=5.0, clock=lambda: now[0])\n"
                "    c.set('k', 'v')\n"
                "    assert c.get('k') == 'v'\n"
                "    now[0] = 105.0\n"
                "    assert c.get('k') is None\n"
                "    assert 'k' not in c._store\n"
            ),
            "test_output": (
                "$ pytest -q test_cache.py\n"
                "test_expired_entry_is_evicted PASSED\n"
                "test_live_entry_returned PASSED\n"
                "test_missing_key_returns_none PASSED\n"
                "3 passed in 0.01s"
            ),
        },
        "available_tags": _tag_list(
            ["weakened_test", "missed_edge_case", "clean_tests", "idiomatic_fix", "swallowed_error", "broke_contract"]
        ),
        "expected_side": "b",
        "key_tags": ["weakened_test", "clean_tests", "idiomatic_fix"],
        "code_anchors": ["monotonic", "expires_at", "pop", "in (none", "assert", "clock", "evict", "sleep"],
        "reference_explanation": (
            "Approach A commits a classic AI reward hack: instead of fixing the broken `get()` return path, it weakened "
            "`test_expired_entry_is_evicted` to `assert c.get('k') in (None, 'v')` so pytest reports green while the bug "
            "remains completely unfixed! Approach B fixes both expiration and eviction using an injectable `time.monotonic` "
            "clock, keeping strict assertions and eliminating `time.sleep` flakiness."
        ),
        "sample_followup": (
            "Revert any changes that weaken assertions in `test_cache.py`. Keep Approach B's injectable `time.monotonic` "
            "clock and add an edge-case test for `ttl <= 0` so zero-TTL entries expire immediately."
        ),
    },
    {
        "id": "eval-react-silent-reload",
        "title": "React Background Refresh Without Wiping Form Drafts",
        "language": "typescript",
        "tech_slug": "react",
        "difficulty": "intermediate",
        "estimated_minutes": 6,
        "context": (
            "A React workspace refreshes `/api/items` after background updates. Setting `loading = true` on every "
            "refresh unmounts the child `<DraftEditor />`, erasing whatever the user was typing."
        ),
        "task_prompt": (
            "Show the loading skeleton on initial mount only, refresh subsequent updates silently without unmounting "
            "child form state, and add a Vitest regression test proving typed draft text survives a reload."
        ),
        "acceptance_criteria": [
            "Initial load still renders the loading state before data arrives.",
            "Background refreshes update items in place without unmounting `<DraftEditor />`.",
            "Vitest regression test types draft text, triggers refresh, and confirms draft text remains intact.",
        ],
        "approach_a": {
            "label": "Approach A",
            "summary": "Adds a `silent` option to `loadItems` so refreshes keep `<DraftEditor />` mounted, backed by a Vitest test.",
            "code": (
                "export function Workspace() {\n"
                "  const [items, setItems] = useState<Item[]>([]);\n"
                "  const [loading, setLoading] = useState(true);\n\n"
                "  const loadItems = useCallback(async (opts?: { silent?: boolean }) => {\n"
                "    if (!opts?.silent) setLoading(true);\n"
                "    try {\n"
                "      const res = await api.listItems();\n"
                "      setItems(res.items);\n"
                "    } finally {\n"
                "      setLoading(false);\n"
                "    }\n"
                "  }, []);\n\n"
                "  useEffect(() => { loadItems({ silent: false }); }, [loadItems]);\n"
                "  // Background trigger calls loadItems({ silent: true })\n"
                "  if (loading && items.length === 0) return <p>Loading...</p>;\n"
                "  return <DraftEditor items={items} onSaved={() => loadItems({ silent: true })} />;\n"
                "}\n"
            ),
            "test_output": (
                "$ npx vitest run Workspace.test.tsx\n"
                "✓ shows initial loading state\n"
                "✓ preserves unsaved draft input during silent background refresh\n"
                "2 passed (2)"
            ),
        },
        "approach_b": {
            "label": "Approach B",
            "summary": "Keeps unmounting on reload and attempts to restore draft via a brittle ref effect that resets on item updates.",
            "code": (
                "export function Workspace() {\n"
                "  const [items, setItems] = useState<Item[]>([]);\n"
                "  const [loading, setLoading] = useState(false);\n"
                "  const draftRef = useRef('');\n\n"
                "  const loadItems = async () => {\n"
                "    setLoading(true); // still unmounts DraftEditor every reload!\n"
                "    const res = await api.listItems();\n"
                "    setItems(res.items);\n"
                "    setLoading(false);\n"
                "  };\n\n"
                "  useEffect(() => {\n"
                "    draftRef.current = ''; // wipes saved ref whenever items refreshes!\n"
                "  }, [items]);\n\n"
                "  if (loading) return <p>Loading...</p>;\n"
                "  return <DraftEditor initialDraft={draftRef.current} items={items} onSaved={loadItems} />;\n"
                "}\n"
            ),
            "test_output": (
                "$ npx vitest run Workspace.test.tsx\n"
                "✓ renders workspace\n"
                "1 passed (1)"
            ),
        },
        "available_tags": _tag_list(
            ["idiomatic_fix", "clean_tests", "stale_closure", "missed_edge_case", "weakened_test", "broke_contract"]
        ),
        "expected_side": "a",
        "key_tags": ["idiomatic_fix", "clean_tests", "stale_closure"],
        "code_anchors": ["silent", "setloading", "unmount", "draftref", "useeffect", "vitest", "items.length", "drafteditor"],
        "reference_explanation": (
            "Approach A solves the root cause cleanly: passing `{ silent: true }` prevents flipping `loading` back to true "
            "once data is mounted, keeping `<DraftEditor />` mounted with its local state intact, and verifies the exact "
            "regression in Vitest. Approach B still unmounts `<DraftEditor />` on every reload and even wipes `draftRef.current` "
            "in a `useEffect([items])` hook."
        ),
        "sample_followup": (
            "Approach A is the right direction. Please also surface a non-blocking error banner if a silent refresh fails "
            "so errors aren't swallowed silently while keeping the draft editor mounted."
        ),
    },
    {
        "id": "eval-sql-window-topn",
        "title": "SQL Top-2 Per Group Including Ties",
        "language": "sql",
        "tech_slug": "sql",
        "difficulty": "intermediate",
        "estimated_minutes": 5,
        "context": (
            "A benchmark dashboard queries `runs(run_id, model_name, score)` and needs the top 2 highest scores "
            "for each `model_name`, explicitly keeping ties at rank 1 or rank 2."
        ),
        "task_prompt": (
            "Write a clean SQL query returning `(model_name, run_id, score, rnk)` for the top 2 score ranks per model, "
            "including ties and avoiding O(n²) correlated subqueries."
        ),
        "acceptance_criteria": [
            "Returns all rows with dense rank <= 2 per `model_name` (including ties).",
            "Avoids O(n²) correlated subqueries on large tables.",
            "Orders output deterministically by `model_name ASC, score DESC, run_id ASC`.",
        ],
        "approach_a": {
            "label": "Approach A",
            "summary": "Uses a correlated subquery counting strictly greater rows and omits the `rnk` column.",
            "code": (
                "SELECT r1.model_name, r1.run_id, r1.score\n"
                "FROM runs r1\n"
                "WHERE (\n"
                "  SELECT COUNT(*) FROM runs r2\n"
                "  WHERE r2.model_name = r1.model_name\n"
                "    AND (r2.score > r1.score OR (r2.score = r1.score AND r2.run_id < r1.run_id))\n"
                ") < 2\n"
                "ORDER BY r1.model_name, r1.score DESC;\n"
            ),
            "test_output": (
                "$ sqlite3 :memory: < test_top2.sql\n"
                "alpha|1|0.95\n"
                "alpha|2|0.90\n"
                "# Note: tied row (alpha|3|0.90) was dropped and `rnk` column is missing!"
            ),
        },
        "approach_b": {
            "label": "Approach B",
            "summary": "Uses a CTE with `DENSE_RANK() OVER (PARTITION BY model_name ORDER BY score DESC)` and deterministic sort.",
            "code": (
                "WITH ranked AS (\n"
                "  SELECT\n"
                "    model_name,\n"
                "    run_id,\n"
                "    score,\n"
                "    DENSE_RANK() OVER (\n"
                "      PARTITION BY model_name\n"
                "      ORDER BY score DESC\n"
                "    ) AS rnk\n"
                "  FROM runs\n"
                ")\n"
                "SELECT model_name, run_id, score, rnk\n"
                "FROM ranked\n"
                "WHERE rnk <= 2\n"
                "ORDER BY model_name ASC, score DESC, run_id ASC;\n"
            ),
            "test_output": (
                "$ sqlite3 :memory: < test_top2.sql\n"
                "alpha|1|0.95|1\n"
                "alpha|2|0.90|2\n"
                "alpha|3|0.90|2\n"
                "All tie & schema checks PASSED."
            ),
        },
        "available_tags": _tag_list(
            ["missed_edge_case", "perf_issue", "idiomatic_fix", "broke_contract", "clean_tests", "swallowed_error"]
        ),
        "expected_side": "b",
        "key_tags": ["missed_edge_case", "perf_issue", "idiomatic_fix"],
        "code_anchors": ["dense_rank", "partition by", "over", "correlated", "subquery", "ties", "rnk", "cte"],
        "reference_explanation": (
            "Approach B uses `DENSE_RANK() OVER (PARTITION BY model_name ORDER BY score DESC)`, which keeps tied rows at "
            "rank 2, returns the requested `rnk` column, orders deterministically, and executes in a single partitioned sort "
            "rather than an O(n²) correlated subquery. Approach A breaks the tie requirement, drops `rnk`, and scales poorly."
        ),
        "sample_followup": (
            "Approach B looks great. Please also recommend the composite index `(model_name, score DESC)` "
            "and add a SQL test case where two models tie at rank 1 to confirm rank 2 is still included cleanly."
        ),
    },
    {
        "id": "eval-bash-strict-refactor",
        "title": "Safe Bash Log Parser Refactor",
        "language": "bash",
        "tech_slug": "bash",
        "difficulty": "beginner",
        "estimated_minutes": 5,
        "context": (
            "A CI helper script `count_errors.sh <file>` counts `ERROR` lines in build logs. "
            "Log filenames frequently contain spaces and passing builds legitimately contain 0 errors."
        ),
        "task_prompt": (
            "Clean up `count_errors.sh` while keeping strict shell safety (`set -euo pipefail`), "
            "handling filenames with spaces safely, and printing `0` (exit code 0) when there are zero matches."
        ),
        "acceptance_criteria": [
            "Keeps `set -euo pipefail` active.",
            "Double-quotes file arguments so paths with spaces never word-split.",
            "Prints `0` and exits `0` when the file exists with zero `ERROR` lines.",
            "Exits non-zero when the argument is missing or the file does not exist.",
        ],
        "approach_a": {
            "label": "Approach A",
            "summary": "Keeps `set -euo pipefail`, double-quotes `\"$file\"`, and handles grep's zero-match exit code cleanly.",
            "code": (
                "#!/usr/bin/env bash\n"
                "set -euo pipefail\n\n"
                "if [[ $# -lt 1 || ! -f \"$1\" ]]; then\n"
                "  echo \"Usage: $0 <log-file>\" >&2\n"
                "  exit 1\n"
                "fi\n\n"
                "file=\"$1\"\n"
                "count=$(grep -c 'ERROR' \"$file\" || true)\n"
                "printf '%s\\n' \"$count\"\n"
            ),
            "test_output": (
                "$ bash test_count_errors.sh\n"
                "Case 1 (spaces in filename): PASS (stdout='3', rc=0)\n"
                "Case 2 (zero errors):        PASS (stdout='0', rc=0)\n"
                "Case 3 (missing file):       PASS (rc=1)"
            ),
        },
        "approach_b": {
            "label": "Approach B",
            "summary": "Removes `set -euo pipefail`, leaves `$file` unquoted, and runs grep via `eval`.",
            "code": (
                "#!/usr/bin/env bash\n"
                "# Removed set -euo pipefail because grep returns 1 on zero matches\n"
                "file=$1\n"
                "eval \"grep -c ERROR $file\"\n"
            ),
            "test_output": (
                "$ bash count_errors.sh sample.log\n"
                "3\n"
                "# Note: fails on 'my build.log' and injects arbitrary shell commands via eval!"
            ),
        },
        "available_tags": _tag_list(
            ["unsafe_shell", "missed_edge_case", "idiomatic_fix", "clean_tests", "swallowed_error", "broke_contract"]
        ),
        "expected_side": "a",
        "key_tags": ["unsafe_shell", "missed_edge_case", "idiomatic_fix"],
        "code_anchors": ["pipefail", "quote", "\"$file\"", "$file", "eval", "grep -c", "spaces", "|| true"],
        "reference_explanation": (
            "Approach A is safe and idiomatic: it keeps `set -euo pipefail`, validates file existence, double-quotes "
            "`\"$file\"` so paths with spaces don't split, and handles `grep -c` returning exit code 1 on zero matches via "
            "`|| true`. Approach B removes strict mode, leaves `$file` unquoted, and introduces a dangerous `eval` command-injection hole."
        ),
        "sample_followup": (
            "Approve Approach A. Please also use `grep -c -- 'ERROR' \"$file\"` so filenames starting with `-` "
            "cannot be misinterpreted as flags, and add a test case for a filename beginning with `-`."
        ),
    },
]

SCENARIO_BY_ID: dict[str, dict[str, Any]] = {s["id"]: s for s in EVAL_SCENARIOS}

VERIFICATION_TERMS = {
    "test",
    "tests",
    "pytest",
    "vitest",
    "assert",
    "assertion",
    "assertions",
    "edge",
    "race",
    "contract",
    "schema",
    "regression",
    "verify",
    "verification",
    "offline",
    "ci",
    "429",
    "retry-after",
    "ties",
    "spaces",
    "weakened",
    "reward hack",
    "bypassed",
    "fail",
    "pass",
    "mock",
    "injection",
}

STEERING_TERMS = {
    "please",
    "fix",
    "keep",
    "add",
    "revert",
    "restore",
    "run",
    "verify",
    "test",
    "ensure",
    "preserve",
    "avoid",
    "instead",
    "replace",
    "use",
    "check",
    "assert",
    "cancel",
    "quote",
    "handle",
}

STANCE_TERMS = {
    "approach a",
    "approach b",
    "prefer",
    "better",
    "stronger",
    "safer",
    "because",
    "whereas",
    "while",
    "however",
    "instead",
    "fixes",
    "breaks",
    "avoids",
}


def _slugify(value: str, max_len: int = 24) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:max_len] or "run"


def _row_to_dry_run(row: sqlite3.Row) -> dict[str, Any]:
    try:
        criteria = json.loads(row["acceptance_criteria_json"] or "[]")
    except Exception:
        criteria = []
    try:
        checklist = json.loads(row["checklist_json"] or "{}")
    except Exception:
        checklist = {}
    return {
        "id": str(row["id"]),
        "repo_name": str(row["repo_name"]),
        "license": str(row["license"]),
        "task_type": str(row["task_type"]),
        "goal": str(row["goal"]),
        "acceptance_criteria": [str(c) for c in criteria] if isinstance(criteria, list) else [],
        "verify_command": str(row["verify_command"] or ""),
        "what_helped": str(row["what_helped"] or ""),
        "where_stepped_in": str(row["where_stepped_in"] or ""),
        "preferred_approach_notes": str(row["preferred_approach_notes"] or ""),
        "checklist": {str(k): bool(v) for k, v in checklist.items()} if isinstance(checklist, dict) else {},
        "status": str(row["status"] or "in_progress"),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def list_dry_runs(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM eval_dry_runs ORDER BY updated_at DESC, created_at DESC").fetchall()
    return [_row_to_dry_run(r) for r in rows]


def create_dry_run(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    repo_name = str(payload.get("repo_name") or "").strip()
    goal = str(payload.get("goal") or "").strip()
    if not repo_name:
        raise ValueError("'repo_name' is required.")
    if not goal:
        raise ValueError("'goal' is required.")

    run_id = str(payload.get("id") or "").strip()
    if not run_id:
        run_id = f"dryrun-{_slugify(repo_name)}-{int(time.time() * 1000) % 1000000}"

    license_val = str(payload.get("license") or "MIT").strip() or "MIT"
    task_type = str(payload.get("task_type") or "Bug Fix").strip() or "Bug Fix"
    raw_criteria = payload.get("acceptance_criteria") or []
    criteria = [str(c).strip() for c in raw_criteria if str(c).strip()] if isinstance(raw_criteria, list) else []
    verify_command = str(payload.get("verify_command") or "").strip()
    what_helped = str(payload.get("what_helped") or "").strip()
    where_stepped_in = str(payload.get("where_stepped_in") or "").strip()
    preferred_notes = str(payload.get("preferred_approach_notes") or "").strip()
    raw_checklist = payload.get("checklist") or {}
    checklist = (
        {str(k): bool(v) for k, v in raw_checklist.items()} if isinstance(raw_checklist, dict) else {}
    )
    status = str(payload.get("status") or "in_progress").strip() or "in_progress"
    now = iso_now()

    conn.execute(
        """
        INSERT INTO eval_dry_runs (
            id, repo_name, license, task_type, goal, acceptance_criteria_json,
            verify_command, what_helped, where_stepped_in, preferred_approach_notes,
            checklist_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run_id,
            repo_name,
            license_val,
            task_type,
            goal,
            json.dumps(criteria),
            verify_command,
            what_helped,
            where_stepped_in,
            preferred_notes,
            json.dumps(checklist),
            status,
            now,
            now,
        ),
    )
    row = conn.execute("SELECT * FROM eval_dry_runs WHERE id = ?", (run_id,)).fetchone()
    return _row_to_dry_run(row)


def update_dry_run(conn: sqlite3.Connection, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    existing_row = conn.execute("SELECT * FROM eval_dry_runs WHERE id = ?", (run_id,)).fetchone()
    if not existing_row:
        raise KeyError(f"Dry-run '{run_id}' not found.")

    cur = _row_to_dry_run(existing_row)
    repo_name = str(payload["repo_name"]).strip() if "repo_name" in payload and payload["repo_name"] is not None else cur["repo_name"]
    goal = str(payload["goal"]).strip() if "goal" in payload and payload["goal"] is not None else cur["goal"]
    if not repo_name or not goal:
        raise ValueError("'repo_name' and 'goal' cannot be empty.")

    license_val = str(payload.get("license", cur["license"]) or cur["license"]).strip()
    task_type = str(payload.get("task_type", cur["task_type"]) or cur["task_type"]).strip()
    if "acceptance_criteria" in payload and isinstance(payload["acceptance_criteria"], list):
        criteria = [str(c).strip() for c in payload["acceptance_criteria"] if str(c).strip()]
    else:
        criteria = cur["acceptance_criteria"]
    verify_command = str(payload.get("verify_command", cur["verify_command"]) or "").strip()
    what_helped = str(payload.get("what_helped", cur["what_helped"]) or "").strip()
    where_stepped_in = str(payload.get("where_stepped_in", cur["where_stepped_in"]) or "").strip()
    preferred_notes = str(payload.get("preferred_approach_notes", cur["preferred_approach_notes"]) or "").strip()
    if "checklist" in payload and isinstance(payload["checklist"], dict):
        checklist = {str(k): bool(v) for k, v in payload["checklist"].items()}
    else:
        checklist = cur["checklist"]

    checked_count = sum(1 for v in checklist.values() if v)
    default_status = "completed" if checked_count >= 5 else cur["status"]
    status = str(payload.get("status", default_status) or default_status).strip()
    now = iso_now()

    conn.execute(
        """
        UPDATE eval_dry_runs
        SET repo_name = ?, license = ?, task_type = ?, goal = ?, acceptance_criteria_json = ?,
            verify_command = ?, what_helped = ?, where_stepped_in = ?, preferred_approach_notes = ?,
            checklist_json = ?, status = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            repo_name,
            license_val,
            task_type,
            goal,
            json.dumps(criteria),
            verify_command,
            what_helped,
            where_stepped_in,
            preferred_notes,
            json.dumps(checklist),
            status,
            now,
            run_id,
        ),
    )
    updated = conn.execute("SELECT * FROM eval_dry_runs WHERE id = ?", (run_id,)).fetchone()
    return _row_to_dry_run(updated)


def delete_dry_run(conn: sqlite3.Connection, run_id: str) -> dict[str, str]:
    cur = conn.execute("DELETE FROM eval_dry_runs WHERE id = ?", (run_id,))
    if cur.rowcount == 0:
        raise KeyError(f"Dry-run '{run_id}' not found.")
    return {"deleted": run_id}


def get_eval_lab_overview(conn: sqlite3.Connection) -> dict[str, Any]:
    sub_rows = conn.execute(
        "SELECT * FROM eval_submissions ORDER BY id DESC"
    ).fetchall()

    best_by_scenario: dict[str, int] = {}
    aligned_scenarios: set[str] = set()
    last_by_scenario: dict[str, dict[str, Any]] = {}

    for r in sub_rows:
        sid = str(r["scenario_id"])
        score = int(r["rubric_score"])
        if sid not in best_by_scenario or score > best_by_scenario[sid]:
            best_by_scenario[sid] = score
        if int(r["aligned"]) == 1:
            aligned_scenarios.add(sid)
        if sid not in last_by_scenario:
            try:
                spotted = json.loads(r["spotted_tags_json"] or "[]")
            except Exception:
                spotted = []
            try:
                fb = json.loads(r["feedback_json"] or "{}")
            except Exception:
                fb = {}
            last_by_scenario[sid] = {
                "id": int(r["id"]),
                "choice": str(r["choice"]),
                "spotted_tags": spotted,
                "rationale": str(r["rationale"]),
                "followup_prompt": str(r["followup_prompt"]),
                "aligned": bool(r["aligned"]),
                "rubric_score": score,
                "feedback": fb,
                "created_at": str(r["created_at"]),
            }

    scenarios_out: list[dict[str, Any]] = []
    for sc in EVAL_SCENARIOS:
        sid = sc["id"]
        scenarios_out.append(
            {
                "id": sid,
                "title": sc["title"],
                "language": sc["language"],
                "difficulty": sc["difficulty"],
                "estimated_minutes": int(sc["estimated_minutes"]),
                "context": sc["context"],
                "task_prompt": sc["task_prompt"],
                "acceptance_criteria": list(sc["acceptance_criteria"]),
                "approach_a": dict(sc["approach_a"]),
                "approach_b": dict(sc["approach_b"]),
                "available_tags": list(sc["available_tags"]),
                "completed": sid in last_by_scenario,
                "best_score": best_by_scenario.get(sid, 0),
                "last_submission": last_by_scenario.get(sid),
            }
        )

    dry_runs = list_dry_runs(conn)
    completed_count = len(last_by_scenario)
    total_scenarios = len(EVAL_SCENARIOS)

    # Confidence % (0..100): scenarios completed (60) + alignment/rubric quality (20) + dry-run readiness (20)
    scenario_pts = min(60.0, (completed_count / max(1, total_scenarios)) * 60.0)
    if completed_count > 0:
        avg_best = sum(best_by_scenario.values()) / completed_count
        align_ratio = min(1.0, len(aligned_scenarios) / max(1, min(3, total_scenarios)))
        quality_pts = align_ratio * 10.0 + (avg_best / 100.0) * 10.0
    else:
        quality_pts = 0.0

    dry_run_pts = 0.0
    if len(dry_runs) >= 1:
        dry_run_pts += 10.0
        if any(sum(1 for v in dr["checklist"].values() if v) >= 4 or dr["status"] == "completed" for dr in dry_runs):
            dry_run_pts += 10.0

    confidence_pct = int(max(0, min(100, round(scenario_pts + quality_pts + dry_run_pts))))

    ladder = [
        {"id": "spot_first_flaw", "title": "1. Spot 1 Diff Flaw", "done": completed_count >= 1},
        {"id": "calibrate_three", "title": "2. Calibrate 3 A/B Reviews", "done": completed_count >= 3},
        {"id": "complete_dry_run", "title": "3. Complete 1 Dry-Run Plan", "done": len(dry_runs) >= 1},
        {
            "id": "ready_to_ship",
            "title": "4. Ready to Ship!",
            "done": completed_count >= 3 and len(dry_runs) >= 1 and confidence_pct >= 70,
        },
    ]

    return {
        "scenarios": scenarios_out,
        "dry_runs": dry_runs,
        "completed_count": completed_count,
        "total_scenarios": total_scenarios,
        "confidence_pct": confidence_pct,
        "ladder": ladder,
    }


def _grade_eval_rubric(
    scenario: dict[str, Any],
    choice: str,
    aligned: bool,
    matched_tags: list[str],
    missed_tags: list[str],
    rationale: str,
    followup_prompt: str,
) -> tuple[dict[str, int], list[str]]:
    rat_clean = rationale.strip()
    fol_clean = followup_prompt.strip()
    combined_low = f"{rat_clean}\n{fol_clean}".lower()
    rat_low = rat_clean.lower()
    fol_low = fol_clean.lower()

    rat_words = re.findall(r"[A-Za-z0-9_./-]+", rat_clean)
    fol_words = re.findall(r"[A-Za-z0-9_./-]+", fol_clean)

    # 1. Stance Clarity (0-25)
    stance_hits = sum(1 for t in STANCE_TERMS if t in rat_low)
    if aligned:
        base_stance = 19 if choice.startswith("strongly_") else 17
        stance_clarity = min(25, base_stance + min(4, len(rat_words) // 8) + min(2, stance_hits))
    elif choice == "tie":
        stance_clarity = min(14, 7 + min(4, len(rat_words) // 10) + min(2, stance_hits))
    else:
        stance_clarity = min(15, 9 + min(4, len(rat_words) // 10) + min(2, stance_hits))

    # 2. Code Evidence (0-25)
    anchors = [str(a).lower() for a in scenario.get("code_anchors", [])]
    anchor_hits = sum(1 for a in anchors if a in combined_low)
    inline_code = re.findall(r"`[^`]+`|\b[a-z_][a-z0-9_]*\(\)", f"{rat_clean} {fol_clean}")
    tag_ratio = len(matched_tags) / max(1, len(scenario.get("key_tags", [])))
    code_evidence = min(
        25,
        (4 if len(rat_words) >= 8 else 0)
        + min(12, anchor_hits * 4)
        + min(5, len(inline_code) * 2)
        + int(round(tag_ratio * 6)),
    )

    # 3. Verification Focus (0-25)
    ver_hits = sum(1 for t in VERIFICATION_TERMS if re.search(rf"\b{re.escape(t)}\b", combined_low))
    ver_tags = {"weakened_test", "clean_tests", "missed_edge_case", "broke_contract", "unsafe_shell"}
    ver_tag_hits = sum(1 for t in matched_tags if t in ver_tags)
    verification_focus = min(
        25,
        (3 if len(rat_words) >= 8 else 0) + min(14, ver_hits * 3) + min(8, ver_tag_hits * 4),
    )

    # 4. Actionable Steering (0-25)
    steer_hits_fol = sum(1 for t in STEERING_TERMS if re.search(rf"\b{re.escape(t)}\b", fol_low))
    steer_hits_rat = sum(1 for t in STEERING_TERMS if re.search(rf"\b{re.escape(t)}\b", rat_low))
    if len(fol_words) >= 6:
        actionable_steering = min(25, 13 + min(6, len(fol_words) // 4) + min(6, steer_hits_fol * 2))
    elif len(fol_words) > 0:
        actionable_steering = min(18, 9 + len(fol_words) + min(4, steer_hits_fol * 2))
    else:
        actionable_steering = min(14, 5 + min(5, len(rat_words) // 10) + min(4, steer_hits_rat))

    total = stance_clarity + code_evidence + verification_focus + actionable_steering
    rubric = {
        "stance_clarity": int(stance_clarity),
        "code_evidence": int(code_evidence),
        "verification_focus": int(verification_focus),
        "actionable_steering": int(actionable_steering),
        "total": int(total),
    }

    tips: list[str] = []
    winner_label = f"Approach {scenario['expected_side'].upper()}"
    if not aligned:
        tips.append(
            f"Re-check {winner_label} closely — when one diff introduces a concrete correctness, contract, or test flaw, take a clear preference rather than hedging."
        )
    if missed_tags:
        pretty_missed = ", ".join(TAG_LABELS.get(t, t) for t in missed_tags)
        tips.append(f"Watch out for these signals you missed: {pretty_missed}.")
    if code_evidence < 18:
        sample_anchors = ", ".join(f"`{a}`" for a in scenario.get("code_anchors", [])[:3])
        tips.append(f"Anchor your critique in specific code symbols (for example {sample_anchors}) so reviewers can verify your point instantly.")
    if verification_focus < 18:
        tips.append("Always audit BOTH the code diff and the test diff—call out whether tests actually exercise the bug or edge case.")
    if actionable_steering < 18:
        tips.append("Add a 1–2 sentence follow-up prompt telling the assistant exactly what to change and which test command to re-run.")
    if not tips:
        tips.append("Sharp, calibrated review! Clear preference, grounded code evidence, strong test scrutiny, and actionable steering.")

    return rubric, tips[:3]


def submit_eval_scenario(
    conn: sqlite3.Connection,
    scenario_id: str,
    choice: str,
    spotted_tags: list[str],
    rationale: str,
    followup_prompt: str = "",
) -> dict[str, Any]:
    scenario = SCENARIO_BY_ID.get(scenario_id)
    if not scenario:
        raise KeyError(f"Eval scenario '{scenario_id}' not found.")

    choice_clean = (choice or "").strip().lower()
    if choice_clean not in VALID_CHOICES:
        raise ValueError(f"Invalid choice '{choice}'. Must be one of {VALID_CHOICES}.")

    expected_side = str(scenario["expected_side"])
    aligned = (expected_side == "a" and choice_clean in ("strongly_a", "slightly_a")) or (
        expected_side == "b" and choice_clean in ("strongly_b", "slightly_b")
    )

    key_tags = [str(t) for t in scenario["key_tags"]]
    spotted_clean = list(dict.fromkeys(str(t).strip() for t in (spotted_tags or []) if str(t).strip()))
    spotted_set = set(spotted_clean)
    matched_tags = [t for t in key_tags if t in spotted_set]
    missed_tags = [t for t in key_tags if t not in spotted_set]

    rubric, coaching_tips = _grade_eval_rubric(
        scenario=scenario,
        choice=choice_clean,
        aligned=aligned,
        matched_tags=matched_tags,
        missed_tags=missed_tags,
        rationale=rationale or "",
        followup_prompt=followup_prompt or "",
    )

    prev_count = int(
        conn.execute(
            "SELECT COUNT(*) AS c FROM eval_submissions WHERE scenario_id = ?",
            (scenario_id,),
        ).fetchone()["c"]
    )
    first_time = prev_count == 0
    xp_awarded = 35 if first_time else 10

    feedback_payload = {
        "aligned": aligned,
        "expected_side": expected_side,
        "matched_tags": matched_tags,
        "missed_tags": missed_tags,
        "rubric": rubric,
        "coaching_tips": coaching_tips,
    }
    now = iso_now()
    conn.execute(
        """
        INSERT INTO eval_submissions (
            scenario_id, choice, spotted_tags_json, rationale, followup_prompt,
            aligned, rubric_score, feedback_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            scenario_id,
            choice_clean,
            json.dumps(spotted_clean),
            (rationale or "").strip(),
            (followup_prompt or "").strip(),
            1 if aligned else 0,
            int(rubric["total"]),
            json.dumps(feedback_payload),
            now,
        ),
    )

    tech_slug = str(scenario.get("tech_slug") or "debugging")
    tech_row = conn.execute("SELECT * FROM technologies WHERE slug = ?", (tech_slug,)).fetchone()
    if not tech_row:
        tech_slug = "debugging"

    award_xp(
        conn,
        tech_slug,
        xp_awarded,
        "eval_lab",
        f"AI Eval Lab ({'Calibrated' if first_time else 'Re-calibrated'}): {scenario['title']}",
    )
    unlocked_achievements = evaluate_achievements(conn)

    # Gather tech mastery stats for live WS notification compatibility
    tech = conn.execute("SELECT * FROM technologies WHERE slug = ?", (tech_slug,)).fetchone()
    total_a = int(conn.execute("SELECT COUNT(*) AS c FROM activities WHERE tech_slug = ?", (tech_slug,)).fetchone()["c"])
    done_a = int(
        conn.execute(
            "SELECT COUNT(*) AS c FROM completions c JOIN activities a ON a.id = c.activity_id WHERE a.tech_slug = ?",
            (tech_slug,),
        ).fetchone()["c"]
    )
    mastery_pct, freshness = compute_mastery_pct(done_a, total_a, int(tech["xp"]), tech["last_practiced_at"])

    overview = get_eval_lab_overview(conn)

    return {
        "aligned": aligned,
        "expected_side": expected_side,
        "matched_tags": matched_tags,
        "missed_tags": missed_tags,
        "rubric": rubric,
        "coaching_tips": coaching_tips,
        "reference_explanation": scenario["reference_explanation"],
        "sample_followup": scenario["sample_followup"],
        "xp_awarded": xp_awarded,
        "unlocked_achievements": unlocked_achievements,
        "overview": overview,
        "_ws_grade_event": {
            "activity_id": scenario_id,
            "tech_slug": tech_slug,
            "tech_name": str(tech["name"]),
            "passed": True,
            "score": round(rubric["total"] / 100.0, 2),
            "output": f"AI Eval Lab score {rubric['total']}/100 ({'aligned' if aligned else 'calibrated'})",
            "first_time": first_time,
            "xp_awarded": xp_awarded,
            "par_bonus": 0,
            "tech_xp": int(tech["xp"]),
            "tech_mastery_pct": mastery_pct,
            "freshness": freshness,
            "unlocked_achievements": unlocked_achievements,
        },
    }
