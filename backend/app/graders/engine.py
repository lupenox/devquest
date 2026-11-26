from __future__ import annotations

import difflib
import http.server
import json
import os
import re
import shutil
import socketserver
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jsonschema
from lxml import etree, html as lxml_html

from .. import config


@dataclass
class GradeResult:
    passed: bool
    score: float
    output: str
    details: dict[str, Any] | None = None


def _run_cmd(
    cmd: list[str],
    cwd: Path,
    timeout: int = 20,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    run_env = os.environ.copy()
    if env:
        run_env.update(env)
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=timeout,
        env=run_env,
    )


def grade_browser_activity(activity_type: str, spec: dict[str, Any], submission: dict[str, Any]) -> GradeResult:
    """Grades zyBooks-style interactive participation activities."""
    if activity_type == "read_check":
        selected = submission.get("selected_index")
        expected = spec.get("correct_index")
        passed = selected == expected
        explanation = spec.get("explanation", "")
        msg = (
            f"Correct! {explanation}".strip()
            if passed
            else f"Not quite — try again. Hint: {spec.get('hint', 'Re-read the concept card above.')}"
        )
        return GradeResult(passed=passed, score=1.0 if passed else 0.0, output=msg)

    if activity_type == "multi_select":
        selected = sorted(set(submission.get("selected_indices", [])))
        expected = sorted(set(spec.get("correct_indices", [])))
        passed = selected == expected
        explanation = spec.get("explanation", "")
        msg = (
            f"Spot on! {explanation}".strip()
            if passed
            else f"Selected {len(selected)} options; check all statements that apply. Hint: {spec.get('hint', '')}"
        )
        return GradeResult(passed=passed, score=1.0 if passed else 0.0, output=msg)

    if activity_type == "fill_blank":
        answers = submission.get("answers", [])
        blanks = spec.get("blanks", [])
        if len(answers) != len(blanks):
            return GradeResult(False, 0.0, f"Expected {len(blanks)} blanks, received {len(answers)}.")
        correct = 0
        feedback = []
        for idx, (ans, bspec) in enumerate(zip(answers, blanks)):
            val = str(ans).strip()
            accepted = bspec.get("accepted", [])
            case_sensitive = bspec.get("case_sensitive", True)
            if not case_sensitive:
                ok = val.lower() in [a.lower() for a in accepted]
            else:
                ok = val in accepted
            if not ok and bspec.get("regex"):
                ok = bool(re.fullmatch(bspec["regex"], val))
            if ok:
                correct += 1
                feedback.append(f"Blank #{idx + 1}: OK")
            else:
                feedback.append(f"Blank #{idx + 1}: mismatch (hint: {bspec.get('hint', 'check syntax')})")
        passed = correct == len(blanks)
        return GradeResult(
            passed=passed,
            score=correct / max(1, len(blanks)),
            output="\n".join(feedback) + (f"\n{spec.get('explanation', '')}" if passed else ""),
        )

    if activity_type == "parsons":
        submitted_order = submission.get("order", [])
        expected_order = spec.get("correct_order", [])
        # Support multiple valid orders if specified
        valid_orders = spec.get("valid_orders", [expected_order])
        passed = submitted_order in valid_orders
        if passed:
            return GradeResult(True, 1.0, f"Clean assembly! {spec.get('explanation', '')}".strip())
        matches = sum(1 for a, b in zip(submitted_order, expected_order) if a == b)
        return GradeResult(
            False,
            matches / max(1, len(expected_order)),
            f"{matches}/{len(expected_order)} lines are in the right position. Check control-flow order and indentation.",
        )

    if activity_type == "code_trace":
        answers = submission.get("answers", {})
        checkpoints = spec.get("checkpoints", [])
        correct = 0
        lines = []
        for cp in checkpoints:
            cid = str(cp["id"])
            got = str(answers.get(cid, "")).strip()
            expected = [str(v).strip() for v in cp.get("accepted", [cp.get("expected", "")])]
            if got in expected:
                correct += 1
                lines.append(f"Step {cid}: OK ({got})")
            else:
                lines.append(f"Step {cid}: got '{got}' — trace line {cp.get('line')} carefully.")
        passed = correct == len(checkpoints) and len(checkpoints) > 0
        return GradeResult(
            passed=passed,
            score=correct / max(1, len(checkpoints)),
            output="\n".join(lines) + (f"\n{spec.get('explanation', '')}" if passed else ""),
        )

    if activity_type == "pdb_sim":
        required_list = [str(a) for a in spec.get("required_actions", [])]
        required_set = set(required_list)
        completed_set = {str(a) for a in submission.get("completed_actions", [])}
        passed = required_set.issubset(completed_set)
        matched = required_set.intersection(completed_set)
        if passed:
            explanation = spec.get(
                "explanation",
                "You stepped through the frame and inspected live debugger state!",
            )
            return GradeResult(True, 1.0, f"Debugger objectives complete! {explanation}".strip())
        missing = [a for a in required_list if a not in completed_set]
        return GradeResult(
            False,
            len(matched) / max(1, len(required_set)),
            f"Completed {len(matched)}/{len(required_set)} debugger objectives. Remaining: {', '.join(missing)}.",
        )

    return GradeResult(False, 0.0, f"Unsupported browser activity type: {activity_type}")


def run_regex_playground(pattern: str, text: str) -> dict[str, Any]:
    """Safely tests a Python regex pattern against sample text and returns match spans + capture groups."""
    if len(pattern) > 2000:
        return {"ok": False, "error": "Pattern exceeds 2000 characters.", "matches": []}
    if len(text) > 50000:
        return {"ok": False, "error": "Sample text exceeds 50000 characters.", "matches": []}
    if pattern == "":
        return {"ok": True, "error": None, "matches": []}

    try:
        compiled = re.compile(pattern)
    except re.error as exc:
        return {"ok": False, "error": str(exc), "matches": []}

    index_to_name = {idx: name for name, idx in compiled.groupindex.items()}
    matches: list[dict[str, Any]] = []
    for m in compiled.finditer(text):
        groups: dict[str, str] = {}
        for idx, val in enumerate(m.groups(), start=1):
            key = index_to_name.get(idx, str(idx))
            groups[key] = "" if val is None else str(val)
        matches.append(
            {
                "start": m.start(),
                "end": m.end(),
                "match": m.group(0),
                "groups": groups,
            }
        )
        if len(matches) >= 200:
            break

    return {"ok": True, "error": None, "matches": matches}


def run_sql_playground(spec: dict[str, Any], query: str) -> dict[str, Any]:
    """Executes a read-only SQL query against an ephemeral in-memory sqlite3 DB seeded with spec['setup_sql']."""
    user_sql = (query or "").strip()
    if not user_sql:
        return {"ok": False, "error": "SQL query is empty.", "columns": [], "rows": [], "row_count": 0}
    if len(user_sql) > 10000:
        return {"ok": False, "error": "SQL query exceeds maximum length.", "columns": [], "rows": [], "row_count": 0}

    allowed_actions = {
        sqlite3.SQLITE_SELECT,
        sqlite3.SQLITE_READ,
        sqlite3.SQLITE_FUNCTION,
    }
    if hasattr(sqlite3, "SQLITE_RECURSIVE"):
        allowed_actions.add(sqlite3.SQLITE_RECURSIVE)

    def _read_only_authorizer(action: int, arg1: Any, arg2: Any, db_name: Any, trigger_name: Any) -> int:
        if action in allowed_actions:
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_PRAGMA and str(arg1 or "").lower() in {
            "table_info",
            "table_list",
            "table_xinfo",
        }:
            return sqlite3.SQLITE_OK
        return sqlite3.SQLITE_DENY

    conn = sqlite3.connect(":memory:")
    try:
        setup_sql = spec.get("setup_sql", "")
        if setup_sql:
            conn.executescript(setup_sql)
        conn.set_authorizer(_read_only_authorizer)
        deadline = time.monotonic() + 2.0
        conn.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 1000)

        cur = conn.execute(user_sql)
        cols = [d[0] for d in (cur.description or [])]
        rows = [list(r) for r in cur.fetchmany(500)]
        return {
            "ok": True,
            "error": None,
            "columns": cols,
            "rows": rows,
            "row_count": len(rows),
        }
    except sqlite3.Error as exc:
        return {
            "ok": False,
            "error": str(exc),
            "columns": [],
            "rows": [],
            "row_count": 0,
        }
    finally:
        conn.close()


def materialize_workspace(
    activity: dict[str, Any],
    workspaces_root: Path | None = None,
    force_reset: bool = False,
) -> dict[str, Any]:
    """Creates a real Neovim challenge directory with starter files and .devquest.json metadata."""
    root = workspaces_root or config.WORKSPACES_DIR
    root.mkdir(parents=True, exist_ok=True)
    spec = activity["spec"]
    slug_safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", activity["id"]).strip("-")
    ws_dir = root / slug_safe

    if force_reset and ws_dir.exists():
        shutil.rmtree(ws_dir)

    freshly_created = not ws_dir.exists()
    ws_dir.mkdir(parents=True, exist_ok=True)

    starter_files: dict[str, str] = spec.get("starter_files", {})
    primary_file = spec.get("primary_file")
    for rel_path, content in starter_files.items():
        fpath = ws_dir / rel_path
        fpath.parent.mkdir(parents=True, exist_ok=True)
        if freshly_created or force_reset or not fpath.exists():
            fpath.write_text(content, encoding="utf-8")
        if primary_file is None:
            primary_file = rel_path

    # Write README instructions inside workspace for easy reference in Neovim
    readme_lines = [
        f"# {activity['title']}",
        f"Technology: {activity['tech_slug']} | Reward: {activity['xp_reward']} XP",
        "",
        spec.get("instructions", ""),
        "",
        "## Workflow",
        "- Edit the target file in Neovim and save (`:w`) to auto-grade!",
        "- Press `<leader>qt` to re-run tests, `<leader>qo` to view test logs, `<leader>qh` for hints.",
    ]
    (ws_dir / "QUEST.md").write_text("\n".join(readme_lines), encoding="utf-8")

    # Link frontend node_modules for React/Playwright labs (enables Node ESM imports + Neovim ts_ls types!)
    if activity.get("grader_type") in {"react", "playwright"}:
        src_nm = config.FRONTEND_DIR / "node_modules"
        dst_nm = ws_dir / "node_modules"
        if src_nm.exists() and not dst_nm.exists():
            dst_nm.symlink_to(src_nm)

    # Run optional one-time setup commands (e.g., git repo initialization for Git quests)
    setup_cmds = spec.get("setup_commands", [])
    if setup_cmds and (freshly_created or force_reset):
        for cmd in setup_cmds:
            subprocess.run(cmd, shell=True, cwd=str(ws_dir), capture_output=True, text=True, timeout=15)

    meta = {
        "activity_id": activity["id"],
        "module_id": activity["module_id"],
        "tech_slug": activity["tech_slug"],
        "title": activity["title"],
        "primary_file": primary_file or "QUEST.md",
        "par_keystrokes": activity.get("par_keystrokes"),
        "hints": spec.get("hints", []),
    }
    (ws_dir / ".devquest.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    target_abs = ws_dir / (primary_file or "QUEST.md")
    return {
        "workspace_dir": str(ws_dir),
        "primary_file": str(target_abs),
        "nvim_command": f"cd {ws_dir} && nvim {primary_file or 'QUEST.md'}",
        "meta": meta,
    }


def _grade_python_or_fastapi(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    test_code = spec.get("test_code", "")
    test_file = ws_dir / "_devquest_test.py"
    test_file.write_text(test_code, encoding="utf-8")
    try:
        proc = _run_cmd(
            [sys.executable, "-m", "pytest", "-q", "--tb=short", str(test_file)],
            cwd=ws_dir,
            timeout=25,
            env={"PYTHONPATH": str(ws_dir)},
        )
        out = (proc.stdout + "\n" + proc.stderr).strip()
        return GradeResult(passed=proc.returncode == 0, score=1.0 if proc.returncode == 0 else 0.0, output=out)
    except subprocess.TimeoutExpired:
        return GradeResult(False, 0.0, "Execution timed out after 25s.")
    finally:
        test_file.unlink(missing_ok=True)


def _grade_bash(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    script_rel = spec.get("primary_file", "solution.sh")
    script_path = ws_dir / script_rel
    if not script_path.exists():
        return GradeResult(False, 0.0, f"Missing script file: {script_rel}")

    checks = spec.get("checks", [])
    logs: list[str] = []
    passed_count = 0
    for idx, chk in enumerate(checks, start=1):
        with tempfile.TemporaryDirectory(prefix="dq_bash_") as tmp:
            tmp_path = Path(tmp)
            for fname, fcontent in chk.get("fixture_files", {}).items():
                fp = tmp_path / fname
                fp.parent.mkdir(parents=True, exist_ok=True)
                fp.write_text(fcontent, encoding="utf-8")
            args = [str(a) for a in chk.get("args", [])]
            try:
                proc = _run_cmd(["bash", str(script_path), *args], cwd=tmp_path, timeout=15)
            except subprocess.TimeoutExpired:
                logs.append(f"Case {idx}: TIMEOUT")
                continue

            ok = True
            errs = []
            expected_rc = chk.get("exit_code", 0)
            if proc.returncode != expected_rc:
                ok = False
                errs.append(f"exit_code={proc.returncode} (expected {expected_rc})")
            if "stdout_equals" in chk and proc.stdout.strip() != chk["stdout_equals"].strip():
                ok = False
                errs.append(f"stdout={proc.stdout.strip()!r} (expected {chk['stdout_equals'].strip()!r})")
            for sub in chk.get("stdout_contains", []):
                if sub not in proc.stdout:
                    ok = False
                    errs.append(f"stdout missing {sub!r}")
            for fname, expected_text in chk.get("expect_files", {}).items():
                ef = tmp_path / fname
                if not ef.exists():
                    ok = False
                    errs.append(f"expected file {fname} not created")
                elif expected_text is not None and ef.read_text(encoding="utf-8").strip() != expected_text.strip():
                    ok = False
                    errs.append(f"file {fname} content mismatch")
            if ok:
                passed_count += 1
                logs.append(f"Case {idx} ({chk.get('name', 'check')}): PASS")
            else:
                logs.append(f"Case {idx} ({chk.get('name', 'check')}): FAIL -> {'; '.join(errs)}")
                if proc.stderr.strip():
                    logs.append(f"  stderr: {proc.stderr.strip()}")
    all_ok = passed_count == len(checks) and len(checks) > 0
    return GradeResult(all_ok, passed_count / max(1, len(checks)), "\n".join(logs))


def _grade_js_ts(ws_dir: Path, spec: dict[str, Any], is_ts: bool = False) -> GradeResult:
    ext = ".ts" if is_ts else ".mjs"
    test_code = spec.get("test_code", "")
    test_file = ws_dir / f"_devquest_test{ext}"
    test_file.write_text(test_code, encoding="utf-8")
    try:
        proc = _run_cmd(["node", str(test_file)], cwd=ws_dir, timeout=20)
        out = (proc.stdout + "\n" + proc.stderr).strip()
        if proc.returncode != 0:
            return GradeResult(False, 0.0, out or "Node test failed.")
        # Optional type-check via tsc if available and requested
        if is_ts and spec.get("require_type_annotations"):
            src = (ws_dir / spec.get("primary_file", "solution.ts")).read_text(encoding="utf-8")
            for pattern in spec.get("required_patterns", []):
                if not re.search(pattern, src):
                    return GradeResult(False, 0.5, f"Runtime passed, but missing TypeScript pattern: {pattern}")
        return GradeResult(True, 1.0, out or "All JS/TS assertions passed!")
    except subprocess.TimeoutExpired:
        return GradeResult(False, 0.0, "Node test timed out after 20s.")
    finally:
        test_file.unlink(missing_ok=True)


def _ensure_node_modules_link(ws_dir: Path) -> None:
    src_nm = config.FRONTEND_DIR / "node_modules"
    dst_nm = ws_dir / "node_modules"
    if src_nm.exists() and not dst_nm.exists():
        dst_nm.symlink_to(src_nm)


def _grade_react(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    """Grades React components using the workspace Vitest/Node toolchain or static + render assertions."""
    _ensure_node_modules_link(ws_dir)
    vitest_bin = config.FRONTEND_DIR / "node_modules/.bin/vitest"
    test_code = spec.get("test_code", "")
    if vitest_bin.exists() and spec.get("use_vitest", False):
        test_file = ws_dir / "_devquest.test.tsx"
        test_file.write_text(test_code, encoding="utf-8")
        try:
            proc = _run_cmd(
                [str(vitest_bin), "run", str(test_file), "--root", str(config.FRONTEND_DIR)],
                cwd=config.FRONTEND_DIR,
                timeout=30,
            )
            out = (proc.stdout + "\n" + proc.stderr).strip()
            return GradeResult(proc.returncode == 0, 1.0 if proc.returncode == 0 else 0.0, out)
        finally:
            test_file.unlink(missing_ok=True)

    # Lightweight React render grader using frontend's react + react-dom/server via node ESM
    test_file = ws_dir / "_devquest_react_test.mjs"
    test_file.write_text(test_code, encoding="utf-8")
    try:
        proc = _run_cmd(["node", str(test_file)], cwd=ws_dir, timeout=20)
        out = (proc.stdout + "\n" + proc.stderr).strip()
        return GradeResult(proc.returncode == 0, 1.0 if proc.returncode == 0 else 0.0, out or "React tests passed!")
    finally:
        test_file.unlink(missing_ok=True)


def _grade_cpp(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    harness = spec.get("test_code", "")
    harness_path = ws_dir / "_devquest_test.cpp"
    bin_path = ws_dir / "_devquest_test_bin"
    harness_path.write_text(harness, encoding="utf-8")
    try:
        comp = _run_cmd(
            ["g++", "-std=c++20", "-O2", "-Wall", "-Wextra", str(harness_path), "-o", str(bin_path)],
            cwd=ws_dir,
            timeout=25,
        )
        if comp.returncode != 0:
            return GradeResult(False, 0.0, f"Compilation failed:\n{comp.stderr.strip()}")
        run = _run_cmd([str(bin_path)], cwd=ws_dir, timeout=15)
        out = (run.stdout + "\n" + run.stderr).strip()
        return GradeResult(run.returncode == 0, 1.0 if run.returncode == 0 else 0.0, out or "C++ tests passed!")
    except subprocess.TimeoutExpired:
        return GradeResult(False, 0.0, "C++ compile/run timed out.")
    finally:
        harness_path.unlink(missing_ok=True)
        bin_path.unlink(missing_ok=True)


def _grade_sql(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    sql_file = ws_dir / spec.get("primary_file", "query.sql")
    if not sql_file.exists():
        return GradeResult(False, 0.0, f"Missing SQL file: {sql_file.name}")
    user_sql = sql_file.read_text(encoding="utf-8").strip()
    if not user_sql:
        return GradeResult(False, 0.0, "SQL file is empty.")

    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(spec.get("setup_sql", ""))
        cur = conn.execute(user_sql)
        cols = [d[0] for d in (cur.description or [])]
        rows = [list(r) for r in cur.fetchall()]
    except sqlite3.Error as exc:
        return GradeResult(False, 0.0, f"SQL Error: {exc}")
    finally:
        conn.close()

    expected_cols = spec.get("expected_columns")
    expected_rows = spec.get("expected_rows", [])
    order_matters = spec.get("order_matters", True)

    errs = []
    if expected_cols and [c.lower() for c in cols] != [c.lower() for c in expected_cols]:
        errs.append(f"Columns mismatch: got {cols}, expected {expected_cols}")

    got_cmp = rows if order_matters else sorted(rows, key=lambda x: str(x))
    exp_cmp = expected_rows if order_matters else sorted(expected_rows, key=lambda x: str(x))
    if got_cmp != exp_cmp:
        errs.append(f"Rows mismatch:\n  got:      {rows}\n  expected: {expected_rows}")

    if errs:
        return GradeResult(False, 0.0, "\n".join(errs))
    return GradeResult(True, 1.0, f"Query returned {len(rows)} exact matching rows ({cols}).")


def _grade_regex(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    rx_file = ws_dir / spec.get("primary_file", "pattern.regex")
    if not rx_file.exists():
        return GradeResult(False, 0.0, f"Missing regex file: {rx_file.name}")
    raw_lines = [
        ln.strip()
        for ln in rx_file.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    ]
    if not raw_lines:
        return GradeResult(False, 0.0, "No regex pattern found (uncomment or write a pattern).")
    pattern = raw_lines[0]
    try:
        compiled = re.compile(pattern)
    except re.error as exc:
        return GradeResult(False, 0.0, f"Invalid regex syntax: {exc}")

    mode = spec.get("mode", "fullmatch")
    errs = []
    passed_checks = 0
    total_checks = 0

    for text in spec.get("must_match", []):
        total_checks += 1
        m = compiled.fullmatch(text) if mode == "fullmatch" else compiled.search(text)
        if m:
            passed_checks += 1
        else:
            errs.append(f"Should MATCH but did not: {text!r}")

    for text in spec.get("must_not_match", []):
        total_checks += 1
        m = compiled.fullmatch(text) if mode == "fullmatch" else compiled.search(text)
        if not m:
            passed_checks += 1
        else:
            errs.append(f"Should NOT match but matched: {text!r}")

    for case in spec.get("capture_cases", []):
        total_checks += 1
        m = compiled.search(case["input"])
        if not m:
            errs.append(f"Capture case did not match: {case['input']!r}")
        else:
            got_groups = m.groupdict() if isinstance(case["expected"], dict) else list(m.groups())
            if got_groups == case["expected"]:
                passed_checks += 1
            else:
                errs.append(f"Capture mismatch on {case['input']!r}: got {got_groups}, expected {case['expected']}")

    if errs:
        return GradeResult(False, passed_checks / max(1, total_checks), "\n".join(errs))
    return GradeResult(True, 1.0, f"Regex `{pattern}` passed all {total_checks} test cases!")


def _grade_json(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    jf = ws_dir / spec.get("primary_file", "data.json")
    if not jf.exists():
        return GradeResult(False, 0.0, f"Missing JSON file: {jf.name}")
    try:
        data = json.loads(jf.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return GradeResult(False, 0.0, f"JSON syntax error at line {exc.lineno}, col {exc.colno}: {exc.msg}")

    if "schema" in spec:
        try:
            jsonschema.validate(instance=data, schema=spec["schema"])
        except jsonschema.ValidationError as exc:
            return GradeResult(False, 0.3, f"JSON Schema validation failed: {exc.message}")

    for assertion in spec.get("assertions", []):
        cur: Any = data
        for key in assertion["path"]:
            try:
                cur = cur[key]
            except (KeyError, IndexError, TypeError):
                return GradeResult(False, 0.5, f"Missing path {assertion['path']}")
        if "equals" in assertion and cur != assertion["equals"]:
            return GradeResult(False, 0.5, f"Path {assertion['path']}: got {cur!r}, expected {assertion['equals']!r}")
        if "min_len" in assertion and len(cur) < assertion["min_len"]:
            return GradeResult(False, 0.5, f"Path {assertion['path']} length {len(cur)} < {assertion['min_len']}")

    return GradeResult(True, 1.0, "Valid JSON matching schema and all semantic assertions!")


def _grade_xml(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    xf = ws_dir / spec.get("primary_file", "config.xml")
    if not xf.exists():
        return GradeResult(False, 0.0, f"Missing XML file: {xf.name}")
    try:
        root = etree.fromstring(xf.read_bytes())
    except etree.XMLSyntaxError as exc:
        return GradeResult(False, 0.0, f"XML parse error: {exc}")

    errs = []
    for chk in spec.get("xpath_checks", []):
        res = root.xpath(chk["xpath"])
        if "count" in chk and len(res) != chk["count"]:
            errs.append(f"XPath {chk['xpath']}: count={len(res)}, expected {chk['count']}")
        if "equals" in chk:
            val = res[0].text.strip() if (isinstance(res, list) and res and hasattr(res[0], "text") and res[0].text) else (str(res[0]) if isinstance(res, list) and res else str(res))
            if val != str(chk["equals"]):
                errs.append(f"XPath {chk['xpath']}: got {val!r}, expected {chk['equals']!r}")
    if errs:
        return GradeResult(False, 0.0, "\n".join(errs))
    return GradeResult(True, 1.0, f"Well-formed XML passed all {len(spec.get('xpath_checks', []))} XPath checks!")


def _grade_html(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    hf = ws_dir / spec.get("primary_file", "index.html")
    if not hf.exists():
        return GradeResult(False, 0.0, f"Missing HTML file: {hf.name}")
    raw = hf.read_text(encoding="utf-8")
    try:
        doc = lxml_html.fromstring(raw)
    except Exception as exc:
        return GradeResult(False, 0.0, f"HTML parse error: {exc}")

    errs = []
    for chk in spec.get("xpath_checks", []):
        res = doc.xpath(chk["xpath"])
        if "min_count" in chk and len(res) < chk["min_count"]:
            errs.append(f"Missing element(s) for {chk['desc']} ({chk['xpath']})")
        if "text_contains" in chk:
            texts = " ".join(el.text_content() for el in res if hasattr(el, "text_content"))
            if chk["text_contains"] not in texts:
                errs.append(f"Element {chk['desc']} missing text {chk['text_contains']!r}")
    if errs:
        return GradeResult(False, 0.0, "\n".join(errs))
    return GradeResult(True, 1.0, "Semantic HTML passed all structural and accessibility checks!")


def _grade_css(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    cf = ws_dir / spec.get("primary_file", "styles.css")
    if not cf.exists():
        return GradeResult(False, 0.0, f"Missing CSS file: {cf.name}")
    css = cf.read_text(encoding="utf-8")
    # Strip CSS comments
    clean = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    errs = []
    for req in spec.get("rule_checks", []):
        sel = re.escape(req["selector"])
        m = re.search(rf"{sel}\s*\{{([^}}]*)\}}", clean, flags=re.S)
        if not m:
            errs.append(f"Selector block `{req['selector']} {{ ... }}` not found.")
            continue
        body = m.group(1)
        for prop, val_regex in req.get("properties", {}).items():
            pm = re.search(rf"{re.escape(prop)}\s*:\s*([^;]+)", body, flags=re.I)
            if not pm or not re.search(val_regex, pm.group(1).strip(), flags=re.I):
                errs.append(f"In `{req['selector']}`, expected `{prop}` matching `{val_regex}`")
    if errs:
        return GradeResult(False, 0.0, "\n".join(errs))
    return GradeResult(True, 1.0, "CSS rules and layout properties passed all checks!")


def _grade_git(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    errs = []
    checks = spec.get("git_checks", [])
    for chk in checks:
        proc = _run_cmd(["bash", "-c", chk["cmd"]], cwd=ws_dir, timeout=10)
        out = proc.stdout.strip()
        if chk.get("expect_rc", 0) != proc.returncode:
            errs.append(f"{chk['desc']}: command failed ({proc.stderr.strip() or out})")
            continue
        if "equals" in chk and out != chk["equals"]:
            errs.append(f"{chk['desc']}: got {out!r}, expected {chk['equals']!r}")
        if "contains" in chk and chk["contains"] not in out:
            errs.append(f"{chk['desc']}: output {out!r} missing {chk['contains']!r}")
        if "min_int" in chk:
            try:
                if int(out) < int(chk["min_int"]):
                    errs.append(f"{chk['desc']}: got {out}, expected >= {chk['min_int']}")
            except ValueError:
                errs.append(f"{chk['desc']}: non-integer output {out!r}")
    if errs:
        return GradeResult(False, 0.0, "\n".join(errs))
    return GradeResult(True, 1.0, f"Git repository state verified ({len(checks)}/{len(checks)} checks passed)!")


def _grade_neovim(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    target_file = ws_dir / spec.get("primary_file", "buffer.txt")
    if not target_file.exists():
        return GradeResult(False, 0.0, f"Missing target file: {target_file.name}")
    got = target_file.read_text(encoding="utf-8").rstrip("\n")
    expected = spec.get("expected_content", "").rstrip("\n")
    if got == expected:
        return GradeResult(True, 1.0, "Buffer matches target text identically!")
    diff = "\n".join(
        difflib.unified_diff(
            expected.splitlines(),
            got.splitlines(),
            fromfile="expected",
            tofile="your_buffer",
            lineterm="",
        )
    )
    return GradeResult(False, 0.0, f"Buffer diff found:\n{diff}")


def _grade_playwright(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    """Serves an embedded fixture HTML page on localhost and executes user's Playwright spec!"""
    pw_script = ws_dir / spec.get("primary_file", "challenge.spec.mjs")
    if not pw_script.exists():
        return GradeResult(False, 0.0, f"Missing Playwright script: {pw_script.name}")

    fixture_html = spec.get("fixture_html", "<html><body><h1>Fixture</h1></body></html>")

    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(fixture_html.encode("utf-8"))

        def log_message(self, format: str, *args: Any) -> None:
            return

    _ensure_node_modules_link(ws_dir)
    server = socketserver.TCPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        proc = _run_cmd(
            ["node", str(pw_script)],
            cwd=ws_dir,
            timeout=35,
            env={"TARGET_URL": f"http://127.0.0.1:{port}"},
        )
        out = (proc.stdout + "\n" + proc.stderr).strip()
        return GradeResult(proc.returncode == 0, 1.0 if proc.returncode == 0 else 0.0, out or "Playwright assertions passed!")
    except subprocess.TimeoutExpired:
        return GradeResult(False, 0.0, "Playwright script timed out after 35s.")
    finally:
        server.shutdown()
        server.server_close()


def _grade_debugging(ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    """Grades debugging labs across Python (pdb), Bash (set -x), or C++ (gdb)."""
    runtime = spec.get("runtime", "python")
    if runtime == "bash":
        return _grade_bash(ws_dir, spec)
    if runtime == "cpp":
        return _grade_cpp(ws_dir, spec)
    # Guard against leftover breakpoint() calls in Python debugging labs
    primary = ws_dir / spec.get("primary_file", "buggy.py")
    if primary.exists() and "breakpoint(" in primary.read_text(encoding="utf-8"):
        return GradeResult(
            False,
            0.0,
            "Found an active `breakpoint()` call in your file. Remove `breakpoint()` once you finish debugging with pdb!",
        )
    return _grade_python_or_fastapi(ws_dir, spec)


def grade_workspace_activity(grader_type: str, ws_dir: Path, spec: dict[str, Any]) -> GradeResult:
    dispatch = {
        "python": _grade_python_or_fastapi,
        "fastapi": _grade_python_or_fastapi,
        "bash": _grade_bash,
        "javascript": lambda w, s: _grade_js_ts(w, s, is_ts=False),
        "typescript": lambda w, s: _grade_js_ts(w, s, is_ts=True),
        "react": _grade_react,
        "cpp": _grade_cpp,
        "sql": _grade_sql,
        "regex": _grade_regex,
        "json": _grade_json,
        "xml": _grade_xml,
        "html": _grade_html,
        "css": _grade_css,
        "git": _grade_git,
        "neovim": _grade_neovim,
        "playwright": _grade_playwright,
        "debugging": _grade_debugging,
    }
    fn = dispatch.get(grader_type)
    if not fn:
        return GradeResult(False, 0.0, f"Unknown grader_type: {grader_type}")
    return fn(ws_dir, spec)
