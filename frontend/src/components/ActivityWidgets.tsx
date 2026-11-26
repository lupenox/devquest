import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Code2,
  Copy,
  Database,
  ExternalLink,
  HelpCircle,
  Layers,
  Play,
  Regex as RegexIcon,
  RotateCcw,
  Terminal,
} from "lucide-react";
import { api } from "../api";
import type {
  Activity,
  GradeOutcome,
  LaunchWorkspaceResp,
  RegexPlaygroundResp,
  SqlPlaygroundResp,
} from "../types";
import { HighlightedLines, RichText, ZySectionBody } from "./RichText";
import "../labs.css";

interface WidgetProps {
  activity: Activity;
  liveOutcome?: GradeOutcome | null;
  onGraded: (outcome: GradeOutcome) => void;
}

export function ActivityCard({ activity, liveOutcome, onGraded }: WidgetProps) {
  const [outcome, setOutcome] = useState<GradeOutcome | null>(liveOutcome || null);
  const completed = Boolean(activity.completed || outcome?.passed);

  useEffect(() => {
    if (liveOutcome && liveOutcome.activity_id === activity.id) {
      setOutcome(liveOutcome);
    }
  }, [liveOutcome, activity.id]);

  const handleOutcome = (res: GradeOutcome) => {
    setOutcome(res);
    onGraded(res);
  };

  return (
    <div className={`zy-activity ${completed ? "passed" : ""}`} data-testid={`activity-${activity.id}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {completed ? <CheckCircle2 size={18} color="#22c55e" /> : <Play size={16} color="#7aa2f7" />}
          <strong><RichText text={activity.title} /></strong>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="badge badge-kind">{activity.activity_type.replace("_", " ")}</span>
          <span className="badge badge-xp">+{activity.xp_reward} XP</span>
          {activity.par_keystrokes ? (
            <span className="badge badge-warming">Par ≤ {activity.par_keystrokes} keys</span>
          ) : null}
          {completed ? <span className="badge badge-done">Mastered</span> : null}
        </div>
      </div>

      {activity.activity_type === "read_check" && (
        <ReadCheckInner activity={activity} onResult={handleOutcome} />
      )}
      {activity.activity_type === "fill_blank" && (
        <FillBlankInner activity={activity} onResult={handleOutcome} />
      )}
      {activity.activity_type === "parsons" && (
        <ParsonsInner activity={activity} onResult={handleOutcome} />
      )}
      {activity.activity_type === "code_trace" && (
        <CodeTraceInner activity={activity} onResult={handleOutcome} />
      )}
      {activity.activity_type === "pdb_sim" && (
        <PdbSimInner activity={activity} onResult={handleOutcome} />
      )}
      {(activity.activity_type === "nvim_lab" || activity.activity_type === "boss_checkpoint") && (
        <NvimLabInner activity={activity} onResult={handleOutcome} />
      )}

      {outcome && (
        <div className={`feedback-box ${outcome.passed ? "ok" : "err"}`} data-testid={`feedback-${activity.id}`}>
          <strong>
            {outcome.passed
              ? `✓ Passed! +${outcome.xp_awarded} XP${outcome.par_bonus ? ` (+${outcome.par_bonus} Vim Par Bonus!)` : ""}`
              : "✗ Not quite yet"}
          </strong>
          <div><RichText text={outcome.output} /></div>
        </div>
      )}
    </div>
  );
}

function ReadCheckInner({ activity, onResult }: { activity: Activity; onResult: (r: GradeOutcome) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const options: string[] = activity.spec.options || [];

  const submit = async () => {
    if (selected === null) return;
    setBusy(true);
    try {
      const res = await api.submitBrowser(activity.id, { selected_index: selected });
      onResult(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="activity-prompt"><RichText text={activity.spec.question || ""} /></p>
      {options.map((opt, idx) => (
        <button
          key={idx}
          type="button"
          className={`option-btn ${selected === idx ? "selected" : ""}`}
          onClick={() => setSelected(idx)}
        >
          <span className="badge badge-kind">{String.fromCharCode(65 + idx)}</span>
          <span><RichText text={opt} /></span>
        </button>
      ))}
      <button type="button" className="btn btn-primary" onClick={submit} disabled={selected === null || busy}>
        {busy ? "Checking..." : "Check Answer"}
      </button>
    </div>
  );
}

function FillBlankInner({ activity, onResult }: { activity: Activity; onResult: (r: GradeOutcome) => void }) {
  const blanks: any[] = activity.spec.blanks || [];
  const [answers, setAnswers] = useState<string[]>(() => blanks.map(() => ""));
  const [busy, setBusy] = useState(false);
  const parts: string[] = String(activity.spec.template || "").split("___");

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.submitBrowser(activity.id, { answers });
      onResult(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="activity-prompt"><RichText text={activity.spec.prompt || ""} /></p>
      <div className="code-block" style={{ lineHeight: 2.2 }}>
        {parts.map((part, idx) => (
          <React.Fragment key={idx}>
            <HighlightedLines code={part} lang={activity.tech_slug} />
            {idx < blanks.length && (
              <input
                aria-label={`Blank ${idx + 1}`}
                className="blank-input"
                value={answers[idx] || ""}
                placeholder={blanks[idx]?.hint || `blank ${idx + 1}`}
                onChange={(e) => {
                  const next = [...answers];
                  next[idx] = e.target.value;
                  setAnswers(next);
                }}
              />
            )}
          </React.Fragment>
        ))}
      </div>
      <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
        {busy ? "Checking..." : "Verify Blanks"}
      </button>
    </div>
  );
}

function ParsonsInner({ activity, onResult }: { activity: Activity; onResult: (r: GradeOutcome) => void }) {
  const lines: string[] = activity.spec.lines || [];
  const [order, setOrder] = useState<number[]>(() => lines.map((_, i) => i));
  const [busy, setBusy] = useState(false);

  const move = (pos: number, dir: -1 | 1) => {
    const target = pos + dir;
    if (target < 0 || target >= order.length) return;
    const copy = [...order];
    [copy[pos], copy[target]] = [copy[target], copy[pos]];
    setOrder(copy);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.submitBrowser(activity.id, { order });
      onResult(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="activity-prompt"><RichText text={activity.spec.prompt || ""} /></p>
      <div style={{ marginBottom: 12 }}>
        {order.map((lineIdx, pos) => (
          <div key={lineIdx} className="parsons-row">
            <pre style={{ margin: 0, whiteSpace: "pre" }}>
              <HighlightedLines code={lines[lineIdx]} lang={activity.tech_slug} />
            </pre>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`Move line ${pos + 1} up`}
                onClick={() => move(pos, -1)}
                disabled={pos === 0}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`Move line ${pos + 1} down`}
                onClick={() => move(pos, 1)}
                disabled={pos === order.length - 1}
              >
                <ArrowDown size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
        {busy ? "Checking..." : "Check Line Order"}
      </button>
    </div>
  );
}

function CodeTraceInner({ activity, onResult }: { activity: Activity; onResult: (r: GradeOutcome) => void }) {
  const codeLines: string[] = activity.spec.code || [];
  const steps: { line: number; note: string }[] = activity.spec.steps || [];
  const checkpoints: { id: string; line: number; label: string }[] = activity.spec.checkpoints || [];
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const activeLine = steps[stepIdx]?.line ?? -1;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.submitBrowser(activity.id, { answers });
      onResult(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="activity-prompt"><RichText text={activity.spec.prompt || ""} /></p>
      <div className="code-block">
        {codeLines.map((ln, idx) => (
          <div key={idx} className={`trace-line ${activeLine === idx + 1 ? "active" : ""}`}>
            <span className="muted" style={{ width: 22, textAlign: "right" }}>
              {idx + 1}
            </span>
            <span><HighlightedLines code={ln} lang={activity.tech_slug} /></span>
          </div>
        ))}
      </div>
      {steps.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "8px 12px",
            background: "var(--bg-elev)",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: "0.85rem" }}>
            <strong>Step {stepIdx + 1}/{steps.length}:</strong> <RichText text={steps[stepIdx]?.note || ""} />
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setStepIdx((s) => Math.max(0, s - 1))}
              disabled={stepIdx === 0}
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setStepIdx((s) => Math.min(steps.length - 1, s + 1))}
              disabled={stepIdx >= steps.length - 1}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
      <div className="grid-2" style={{ marginBottom: 12 }}>
        {checkpoints.map((cp) => (
          <label key={cp.id} style={{ display: "block", fontSize: "0.85rem" }}>
            <div style={{ marginBottom: 4 }}>
              <RichText text={cp.label} /> <span className="muted">(line {cp.line})</span>
            </div>
            <input
              className="input-field"
              value={answers[cp.id] || ""}
              onChange={(e) => setAnswers({ ...answers, [cp.id]: e.target.value })}
              placeholder="Enter value..."
            />
          </label>
        ))}
      </div>
      <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
        {busy ? "Verifying Trace..." : "Verify Trace"}
      </button>
    </div>
  );
}

/* ── Interactive Python (Pdb) Browser Simulator ──────────────────────────── */
interface PdbTraceFrame {
  line: number;
  func: string;
  locals: Record<string, string>;
  stack: string[];
}

interface PdbLogEntry {
  cmd?: string;
  out: string;
  kind?: "info" | "ok" | "err";
}

function formatPdbActionLabel(action: string): string {
  if (action === "step") return "Step line (n / s)";
  if (action === "stack") return "Print call stack (w)";
  if (action === "continue") return "Continue execution (c)";
  if (action === "list") return "List source (l)";
  if (action.startsWith("inspect_var:")) {
    const varName = action.slice("inspect_var:".length);
    return `Inspect ${varName} (p ${varName})`;
  }
  if (action.startsWith("breakpoint:")) {
    return `Set breakpoint at line ${action.slice("breakpoint:".length)}`;
  }
  return action;
}

function PdbSimInner({ activity, onResult }: { activity: Activity; onResult: (r: GradeOutcome) => void }) {
  const codeLines: string[] = activity.spec.code || [];
  const trace: PdbTraceFrame[] = activity.spec.trace || [];
  const requiredActions: string[] = activity.spec.required_actions || ["step", "inspect_var:total", "stack"];

  const [frameIdx, setFrameIdx] = useState(0);
  const [prevLocals, setPrevLocals] = useState<Record<string, string>>({});
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const [cmdInput, setCmdInput] = useState("");
  const [lastCmd, setLastCmd] = useState("");
  const [completedActions, setCompletedActions] = useState<string[]>([]);
  const [commandsUsed, setCommandsUsed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const autoSubmittedRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const firstFrame = trace[0] || { line: 1, func: "<module>", locals: {}, stack: ["<module>()"] };
  const [logs, setLogs] = useState<PdbLogEntry[]>(() => [
    {
      out: `> ${firstFrame.func}() line ${firstFrame.line}\n-> ${codeLines[(firstFrame.line || 1) - 1] || ""}`,
      kind: "info",
    },
  ]);

  const currentFrame = trace[Math.min(frameIdx, Math.max(0, trace.length - 1))] || firstFrame;
  const activeLine = currentFrame.line;
  const localEntries = Object.entries(currentFrame.locals || {});
  const stackFrames = currentFrame.stack || [`${currentFrame.func}() line ${currentFrame.line}`];

  const inspectChipCmd = useMemo(() => {
    const target = requiredActions.find((a) => a.startsWith("inspect_var:"));
    if (target) return `p ${target.slice("inspect_var:".length)}`;
    return "p total";
  }, [requiredActions]);

  const quickChips = useMemo(
    () => ["n", "s", inspectChipCmd, "w", "l", "c", "h"],
    [inspectChipCmd]
  );

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const submitSession = async (actionsToSend: string[], cmdsToSend: string[]) => {
    setBusy(true);
    try {
      const res = await api.submitBrowser(activity.id, {
        completed_actions: actionsToSend,
        commands_used: cmdsToSend,
      });
      onResult(res);
    } finally {
      setBusy(false);
    }
  };

  const resetDebugger = () => {
    setFrameIdx(0);
    setPrevLocals({});
    setBreakpoints([]);
    setCmdInput("");
    setLastCmd("");
    setCompletedActions([]);
    setCommandsUsed([]);
    autoSubmittedRef.current = false;
    setLogs([
      {
        out: `Session reset.\n> ${firstFrame.func}() line ${firstFrame.line}\n-> ${codeLines[(firstFrame.line || 1) - 1] || ""}`,
        kind: "info",
      },
    ]);
  };

  const toggleBreakpoint = (lineNo: number) => {
    setBreakpoints((prev) =>
      prev.includes(lineNo) ? prev.filter((x) => x !== lineNo) : [...prev, lineNo].sort((a, b) => a - b)
    );
  };

  const runCommand = (rawInput: string) => {
    const trimmed = (rawInput.trim() || lastCmd).trim();
    if (!trimmed) return;
    setLastCmd(trimmed);
    setCmdInput("");

    const parts = trimmed.split(/\s+/);
    const verb = parts[0].toLowerCase();
    const arg = trimmed.slice(parts[0].length).trim();

    let nextFrameIdx = frameIdx;
    let output = "";
    let kind: "info" | "ok" | "err" = "info";
    const newlyCompleted = new Set(completedActions);
    const nextCommands = [...commandsUsed, trimmed];

    if (verb === "n" || verb === "next" || verb === "s" || verb === "step") {
      if (trace.length > 0 && frameIdx < trace.length - 1) {
        setPrevLocals(currentFrame.locals || {});
        nextFrameIdx = frameIdx + 1;
        setFrameIdx(nextFrameIdx);
        const nf = trace[nextFrameIdx];
        const srcLine = codeLines[(nf.line || 1) - 1] || "";
        output = `> ${nf.func}() line ${nf.line}\n-> ${srcLine}`;
        kind = "ok";
      } else {
        output = "--Return-- (end of execution trace reached; use Reset to replay)";
        kind = "info";
      }
      newlyCompleted.add("step");
    } else if (verb === "c" || verb === "continue") {
      setPrevLocals(currentFrame.locals || {});
      let foundIdx = -1;
      for (let i = frameIdx + 1; i < trace.length; i++) {
        if (breakpoints.includes(trace[i].line)) {
          foundIdx = i;
          break;
        }
      }
      if (foundIdx !== -1) {
        nextFrameIdx = foundIdx;
        setFrameIdx(nextFrameIdx);
        const nf = trace[nextFrameIdx];
        output = `Hit breakpoint at line ${nf.line}\n> ${nf.func}() line ${nf.line}\n-> ${codeLines[(nf.line || 1) - 1] || ""}`;
      } else if (trace.length > 0) {
        nextFrameIdx = trace.length - 1;
        setFrameIdx(nextFrameIdx);
        const nf = trace[nextFrameIdx];
        output = `Continued to final frame:\n> ${nf.func}() line ${nf.line}\n-> ${codeLines[(nf.line || 1) - 1] || ""}`;
      } else {
        output = "Continued execution.";
      }
      kind = "ok";
      newlyCompleted.add("step");
      newlyCompleted.add("continue");
    } else if (verb === "p" || verb === "pp") {
      if (!arg) {
        output = "Usage: p <variable_name> (e.g. p total)";
        kind = "err";
      } else if (arg === "locals()") {
        output = JSON.stringify(currentFrame.locals || {}, null, 2);
        kind = "ok";
      } else if (currentFrame.locals && Object.prototype.hasOwnProperty.call(currentFrame.locals, arg)) {
        output = `${arg} = ${currentFrame.locals[arg]}`;
        kind = "ok";
        newlyCompleted.add(`inspect_var:${arg}`);
      } else {
        // Check if variable exists in a later trace frame so we give a super helpful hint
        const laterIdx = trace.findIndex(
          (f, idx) => idx > frameIdx && f.locals && Object.prototype.hasOwnProperty.call(f.locals, arg)
        );
        if (laterIdx !== -1) {
          output = `*** NameError: name '${arg}' is not bound yet at line ${currentFrame.line}. Step forward with 'n' first!`;
        } else {
          // Also check if defined in an earlier frame
          const anyFrame = trace.find((f) => f.locals && Object.prototype.hasOwnProperty.call(f.locals, arg));
          if (anyFrame) {
            output = `${arg} = ${anyFrame.locals[arg]} (from frame ${anyFrame.func})`;
            kind = "ok";
            newlyCompleted.add(`inspect_var:${arg}`);
          } else {
            output = `*** NameError: name '${arg}' is not defined in current scope. Available: ${
              Object.keys(currentFrame.locals || {}).join(", ") || "(none yet)"
            }`;
            kind = "err";
          }
        }
      }
    } else if (verb === "w" || verb === "where" || verb === "bt") {
      const linesOut = stackFrames.map((sf, i) =>
        i === stackFrames.length - 1 ? `-> ${sf}` : `   ${sf}`
      );
      output = linesOut.join("\n");
      kind = "ok";
      newlyCompleted.add("stack");
    } else if (verb === "l" || verb === "list" || verb === "ll") {
      output = codeLines
        .map((ln, idx) => {
          const n = idx + 1;
          const marker = n === activeLine ? "->" : "  ";
          const bp = breakpoints.includes(n) ? "B" : " ";
          return `${String(n).padStart(2, " ")} ${bp}${marker} ${ln}`;
        })
        .join("\n");
      kind = "info";
      newlyCompleted.add("list");
    } else if (verb === "b" || verb === "break") {
      const lineNum = Number.parseInt(arg, 10);
      if (!arg) {
        output = breakpoints.length
          ? `Active breakpoints at lines: ${breakpoints.join(", ")}`
          : "No breakpoints set. Usage: b <line_number>";
      } else if (Number.isNaN(lineNum) || lineNum < 1 || lineNum > codeLines.length) {
        output = `*** Invalid line number '${arg}' (valid: 1..${codeLines.length})`;
        kind = "err";
      } else {
        if (!breakpoints.includes(lineNum)) {
          setBreakpoints((prev) => [...prev, lineNum].sort((a, b) => a - b));
        }
        output = `Breakpoint set at line ${lineNum}`;
        kind = "ok";
        newlyCompleted.add("breakpoint");
        newlyCompleted.add(`breakpoint:${lineNum}`);
      }
    } else if (verb === "h" || verb === "help" || verb === "?") {
      output =
        "Commands: n (next line), s (step into), p <var> (print var), pp <var> (pretty-print),\n" +
        "          w (call stack / where), l (list code), b <line> (breakpoint), c (continue), h (help)";
      kind = "info";
    } else {
      output = `*** Unknown command '${trimmed}'. Type 'h' for available pdb commands.`;
      kind = "err";
    }

    const updatedActions = Array.from(newlyCompleted);
    setCompletedActions(updatedActions);
    setCommandsUsed(nextCommands);
    setLogs((prev) => [...prev, { cmd: trimmed, out: output, kind }]);

    const allRequiredDone =
      requiredActions.length > 0 && requiredActions.every((req) => newlyCompleted.has(req));
    if (allRequiredDone && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      void submitSession(updatedActions, nextCommands);
    }
  };

  const allSatisfied =
    requiredActions.length > 0 && requiredActions.every((req) => completedActions.includes(req));

  return (
    <div className="pdb-shell" data-testid={`pdb-sim-${activity.id}`}>
      <p className="activity-prompt"><RichText text={activity.spec.prompt || ""} /></p>

      {/* Required Debugging Objectives Checklist */}
      <div className="pdb-objectives" aria-label="Debugging objectives">
        {requiredActions.map((act) => {
          const done = completedActions.includes(act);
          return (
            <span
              key={act}
              className={`pdb-obj ${done ? "done" : ""}`}
              data-testid={`pdb-obj-${act}`}
            >
              {done ? <CheckCircle2 size={14} /> : <Circle size={13} />}
              {formatPdbActionLabel(act)}
            </span>
          );
        })}
      </div>

      {/* Main Split: Code Viewer + Watch & Call Stack */}
      <div className="pdb-workspace">
        <div className="pdb-panel">
          <div className="pdb-panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Bug size={13} color="#f7768e" />
              {currentFrame.func}() — Frame {frameIdx + 1}/{Math.max(1, trace.length)}
            </span>
            <span style={{ color: "var(--accent)" }}>Line {activeLine}</span>
          </div>
          <div className="pdb-code-body">
            {codeLines.map((ln, idx) => {
              const lineNo = idx + 1;
              const isActive = lineNo === activeLine;
              const hasBp = breakpoints.includes(lineNo);
              return (
                <div key={lineNo} className={`pdb-line ${isActive ? "active" : ""}`}>
                  <button
                    type="button"
                    className={`pdb-bp-dot ${hasBp ? "set" : ""}`}
                    title={`Toggle breakpoint at line ${lineNo}`}
                    aria-label={`Toggle breakpoint line ${lineNo}`}
                    onClick={() => toggleBreakpoint(lineNo)}
                  />
                  <span className="pdb-pointer">{isActive ? "->" : ""}</span>
                  <span className="pdb-lineno">{lineNo}</span>
                  <span className="pdb-code-text"><HighlightedLines code={ln} lang="python" /></span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pdb-side-stack">
          {/* Live Variables Watch Table */}
          <div className="pdb-panel">
            <div className="pdb-panel-header">
              <span>Variables Watch</span>
              <span>{localEntries.length} local{localEntries.length === 1 ? "" : "s"}</span>
            </div>
            {localEntries.length === 0 ? (
              <div className="muted" style={{ padding: "10px 12px", fontSize: "0.78rem" }}>
                No local variables bound yet — step with <code>n</code>.
              </div>
            ) : (
              <table className="pdb-watch-table" aria-label="Variables watch table">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {localEntries.map(([name, val]) => {
                    const changed = prevLocals[name] !== undefined && prevLocals[name] !== val;
                    return (
                      <tr key={name} className={changed ? "changed" : ""}>
                        <td className="pdb-var-name">{name}</td>
                        <td className="pdb-var-val">{String(val)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Live Call Stack Panel */}
          <div className="pdb-panel">
            <div className="pdb-panel-header">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Layers size={12} /> Call Stack
              </span>
              <span>{stackFrames.length} frame{stackFrames.length === 1 ? "" : "s"}</span>
            </div>
            <ul className="pdb-stack-list" aria-label="Call stack">
              {stackFrames.map((sf, idx) => {
                const isTop = idx === stackFrames.length - 1;
                return (
                  <li key={idx} className={`pdb-stack-item ${isTop ? "top" : ""}`}>
                    {isTop ? "-> " : "   "}
                    {sf}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {/* Interactive (Pdb) Console */}
      <div className="pdb-panel">
        <div className="pdb-panel-header">
          <span>Interactive (Pdb) Console</span>
          <button type="button" className="btn btn-sm" onClick={resetDebugger}>
            <RotateCcw size={12} /> Reset
          </button>
        </div>

        <div className="pdb-console-log" ref={logRef}>
          {logs.map((entry, idx) => (
            <div key={idx} className="pdb-log-entry">
              {entry.cmd && <div className="pdb-log-cmd">(Pdb) {entry.cmd}</div>}
              <div className={`pdb-log-out ${entry.kind || ""}`}>{entry.out}</div>
            </div>
          ))}
        </div>

        <form
          className="pdb-prompt-bar"
          onSubmit={(e) => {
            e.preventDefault();
            runCommand(cmdInput);
          }}
        >
          <span className="pdb-prompt-prefix">(Pdb)</span>
          <input
            type="text"
            className="pdb-prompt-input"
            aria-label="Pdb command"
            data-testid={`pdb-input-${activity.id}`}
            placeholder={`Enter command (${quickChips.slice(0, 4).join(", ")}...)`}
            value={cmdInput}
            onChange={(e) => setCmdInput(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" data-testid={`pdb-run-${activity.id}`}>
            Run
          </button>
        </form>

        <div className="pdb-chips-row">
          <span className="muted" style={{ fontSize: "0.74rem", marginRight: 2 }}>
            Quick commands:
          </span>
          {quickChips.map((chip) => (
            <button
              key={chip}
              type="button"
              className="pdb-chip"
              onClick={() => runCommand(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      <div className="pdb-footer-actions">
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          {allSatisfied
            ? "All debugging objectives completed!"
            : `${completedActions.filter((a) => requiredActions.includes(a)).length}/${requiredActions.length} objectives complete`}
        </span>
        <button
          type="button"
          className={allSatisfied ? "btn btn-green" : "btn btn-primary"}
          disabled={busy}
          onClick={() => submitSession(completedActions, commandsUsed)}
        >
          {busy ? "Verifying..." : allSatisfied ? "Complete Debugging Checkpoint" : "Verify Debugging Progress"}
        </button>
      </div>
    </div>
  );
}

/* ── Live Quick Playgrounds inside Regex / SQL / HTML-CSS Neovim Labs ────── */
function extractStarterCode(activity: Activity): string {
  const starterFiles = activity.spec?.starter_files || {};
  const primary = activity.spec?.primary_file;
  if (primary && typeof starterFiles[primary] === "string") {
    return starterFiles[primary];
  }
  const firstVal = Object.values(starterFiles)[0];
  return typeof firstVal === "string" ? firstVal : "";
}

function RegexQuickPlayground({ activity }: { activity: Activity }) {
  const initialPattern = useMemo(() => {
    const raw = extractStarterCode(activity);
    const firstNonComment = raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("#"));
    return firstNonComment || "";
  }, [activity]);

  const initialSample = useMemo(() => {
    const mustMatch: string[] = activity.spec?.must_match || [];
    const mustNot: string[] = activity.spec?.must_not_match || [];
    const combined = [...mustMatch, ...mustNot.slice(0, 2)];
    return combined.length > 0 ? combined.join("\n") : "epoch=12 loss=0.341\nepoch=42 loss=0.095";
  }, [activity]);

  const [pattern, setPattern] = useState(initialPattern);
  const [sampleText, setSampleText] = useState(initialSample);
  const [result, setResult] = useState<RegexPlaygroundResp | null>(null);
  const [busy, setBusy] = useState(false);

  const runTest = async (pat = pattern, txt = sampleText) => {
    setBusy(true);
    try {
      const res = await api.playgroundRegex(pat, txt);
      setResult(res);
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || "Regex playground request failed", matches: [] });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (pattern.trim()) {
        void runTest(pattern, sampleText);
      } else {
        setResult(null);
      }
    }, 240);
    return () => window.clearTimeout(timer);
  }, [pattern, sampleText]);

  const highlightedSegments = useMemo(() => {
    if (!result?.ok || !result.matches.length) {
      return [{ text: sampleText, isMatch: false }];
    }
    const sorted = [...result.matches].sort((a, b) => a.start - b.start);
    const segs: { text: string; isMatch: boolean }[] = [];
    let cursor = 0;
    for (const m of sorted) {
      if (m.start < cursor || m.end <= m.start) continue;
      if (m.start > cursor) {
        segs.push({ text: sampleText.slice(cursor, m.start), isMatch: false });
      }
      segs.push({ text: sampleText.slice(m.start, m.end), isMatch: true });
      cursor = m.end;
    }
    if (cursor < sampleText.length) {
      segs.push({ text: sampleText.slice(cursor), isMatch: false });
    }
    return segs;
  }, [result, sampleText]);

  return (
    <div className="playground-body" data-testid={`regex-playground-${activity.id}`}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          className="input-field"
          aria-label="Regex pattern"
          placeholder="Enter regex pattern..."
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          style={{ fontFamily: '"JetBrains Mono", monospace' }}
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => runTest()} disabled={busy}>
          {busy ? "Testing..." : "Test"}
        </button>
      </div>

      <div>
        <div className="muted" style={{ fontSize: "0.75rem", marginBottom: 4 }}>
          Sample text (pre-loaded with lab examples):
        </div>
        <textarea
          className="pg-textarea"
          aria-label="Regex sample text"
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
        />
      </div>

      {result && !result.ok && result.error && (
        <div className="feedback-box err" style={{ marginTop: 0 }}>
          Regex error: {result.error}
        </div>
      )}

      {result && result.ok && (
        <>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span className="muted" style={{ fontSize: "0.75rem" }}>Live Match Highlights</span>
              <span className={`badge ${result.matches.length > 0 ? "badge-done" : "badge-unstarted"}`}>
                {result.matches.length} match{result.matches.length === 1 ? "" : "es"}
              </span>
            </div>
            <div className="regex-highlight-box">
              {highlightedSegments.map((seg, idx) =>
                seg.isMatch ? (
                  <mark key={idx} className="regex-match">
                    {seg.text}
                  </mark>
                ) : (
                  <React.Fragment key={idx}>{seg.text}</React.Fragment>
                )
              )}
            </div>
          </div>

          {result.matches.length > 0 && (
            <div className="pg-table-wrap">
              <table className="pg-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Match</th>
                    <th>Span</th>
                    <th>Capture Groups</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.map((m, i) => {
                    const groupEntries = Object.entries(m.groups || {});
                    return (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td><code>{m.match}</code></td>
                        <td className="muted">[{m.start}, {m.end})</td>
                        <td>
                          {groupEntries.length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            groupEntries.map(([k, v]) => (
                              <span key={k} className="badge badge-kind" style={{ marginRight: 5, textTransform: "none" }}>
                                {k}={String(v)}
                              </span>
                            ))
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SqlQuickPlayground({ activity }: { activity: Activity }) {
  const [query, setQuery] = useState(() => extractStarterCode(activity) || "SELECT 1 AS ok;");
  const [result, setResult] = useState<SqlPlaygroundResp | null>(null);
  const [busy, setBusy] = useState(false);

  const runSql = async () => {
    setBusy(true);
    try {
      const res = await api.playgroundSql(activity.id, query);
      setResult(res);
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || "SQL query failed", columns: [], rows: [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="playground-body" data-testid={`sql-playground-${activity.id}`}>
      <div className="muted" style={{ fontSize: "0.76rem" }}>
        Runs against an ephemeral in-memory SQLite database pre-seeded with this lab&apos;s tables. Press{" "}
        <code>Ctrl+Enter</code> to execute.
      </div>
      <textarea
        className="pg-textarea"
        aria-label="SQL playground query"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void runSql();
          }
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={runSql} disabled={busy}>
          <Play size={13} /> {busy ? "Running..." : "Run SQL Query"}
        </button>
        {result?.ok && (
          <span className="badge badge-done">
            {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {result && !result.ok && result.error && (
        <div className="feedback-box err" style={{ marginTop: 0 }}>
          SQLite error: {result.error}
        </div>
      )}

      {result && result.ok && (
        <div className="pg-table-wrap">
          {result.columns.length === 0 ? (
            <div className="muted" style={{ padding: 10, fontSize: "0.8rem" }}>
              Query executed successfully (no rows returned).
            </div>
          ) : (
            <table className="pg-table">
              <thead>
                <tr>
                  {result.columns.map((col, idx) => (
                    <th key={idx}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.length === 0 ? (
                  <tr>
                    <td colSpan={result.columns.length} className="muted">
                      0 rows returned
                    </td>
                  </tr>
                ) : (
                  result.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx}>{cell === null || cell === undefined ? "NULL" : String(cell)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function HtmlCssQuickPlayground({ activity, mode }: { activity: Activity; mode: "html" | "css" }) {
  const [code, setCode] = useState(() => extractStarterCode(activity));
  const cssDemoHtml = useMemo(
    () =>
      `<header class="toolbar"><strong>DevQuest</strong><nav><button>Tracks</button> <button>Sprint</button></nav></header>
<section class="skill-grid">
  <div class="card" style="padding:12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;">Python • 85%</div>
  <div class="card" style="padding:12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;">Neovim • 92%</div>
  <div class="card" style="padding:12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;">FastAPI • 78%</div>
</section>`,
    []
  );

  const srcDoc = useMemo(() => {
    if (mode === "html") return code;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
body { font-family: system-ui, sans-serif; margin: 14px; color: #0f172a; background: #ffffff; }
${code}
</style>
</head>
<body>
${cssDemoHtml}
</body>
</html>`;
  }, [code, cssDemoHtml, mode]);

  return (
    <div className="playground-body" data-testid={`htmlcss-playground-${activity.id}`}>
      <div className="html-preview-grid">
        <div>
          <div className="muted" style={{ fontSize: "0.75rem", marginBottom: 4 }}>
            {mode === "html" ? "Live HTML Editor" : "Live CSS Editor (applied to sample .toolbar & .skill-grid)"}
          </div>
          <textarea
            className="pg-textarea"
            style={{ minHeight: 220 }}
            aria-label={mode === "html" ? "HTML playground code" : "CSS playground code"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div>
          <div className="muted" style={{ fontSize: "0.75rem", marginBottom: 4 }}>
            Sandboxed Live Preview
          </div>
          <iframe
            title={`${mode.toUpperCase()} Live Preview`}
            className="html-preview-frame"
            srcDoc={srcDoc}
            sandbox=""
          />
        </div>
      </div>
    </div>
  );
}

/* ── Enhanced Neovim Lab Widget (1-Click Konsole + Quick Playgrounds) ────── */
function NvimLabInner({ activity, onResult }: { activity: Activity; onResult: (r: GradeOutcome) => void }) {
  const [ws, setWs] = useState<LaunchWorkspaceResp | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<{ launched: boolean; message: string } | null>(null);
  const [showHints, setShowHints] = useState(false);
  const [showPlayground, setShowPlayground] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [launchingTerminal, setLaunchingTerminal] = useState(false);
  const hints: string[] = activity.spec.hints || [];

  const playgroundKind: "regex" | "sql" | "html" | "css" | null = useMemo(() => {
    const gt = (activity.grader_type || "").toLowerCase();
    const ts = (activity.tech_slug || "").toLowerCase();
    if (gt === "regex" || ts === "regex") return "regex";
    if (gt === "sql" || ts === "sql") return "sql";
    if (gt === "html" || ts === "html") return "html";
    if (gt === "css" || ts === "css") return "css";
    return null;
  }, [activity.grader_type, activity.tech_slug]);

  const prepare = async (reset = false) => {
    setBusy(true);
    try {
      const resp = await api.launchNvim(activity.id, reset);
      setWs(resp);
    } finally {
      setBusy(false);
    }
  };

  const openInKonsole = async () => {
    setLaunchingTerminal(true);
    setTerminalStatus(null);
    try {
      const resp = await api.openTerminal(activity.id, false);
      setWs({
        workspace_dir: resp.workspace_dir,
        primary_file: resp.primary_file,
        nvim_command: resp.nvim_command,
        meta: {},
      });
      setTerminalStatus({
        launched: Boolean(resp.launched),
        message:
          resp.message ||
          (resp.launched
            ? `Launched ${resp.terminal || "Konsole"} + Neovim! Save with :w to auto-grade live.`
            : "Terminal launch unavailable in this environment — copy the command below."),
      });
    } catch (e: any) {
      setTerminalStatus({
        launched: false,
        message: e?.message || "Could not launch desktop terminal — use Prepare Neovim Workspace below.",
      });
    } finally {
      setLaunchingTerminal(false);
    }
  };

  const gradeNow = async () => {
    setBusy(true);
    try {
      const activeWs = ws || (await api.launchNvim(activity.id, false));
      setWs(activeWs);
      const res = await api.gradeWorkspace(activity.id, activeWs.workspace_dir);
      onResult(res);
    } finally {
      setBusy(false);
    }
  };

  const copyCmd = () => {
    if (!ws) return;
    navigator.clipboard?.writeText(ws.nvim_command).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const playgroundLabel =
    playgroundKind === "regex"
      ? "Live Quick Playground — Regex Tester"
      : playgroundKind === "sql"
      ? "Live Quick Playground — SQLite Query Runner"
      : playgroundKind === "html"
      ? "Live Quick Playground — HTML Preview"
      : "Live Quick Playground — CSS Preview";

  return (
    <div>
      <ZySectionBody text={activity.spec.instructions || ""} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          className="btn btn-konsole"
          onClick={openInKonsole}
          disabled={busy || launchingTerminal}
          data-testid={`open-terminal-${activity.id}`}
        >
          <ExternalLink size={15} /> {launchingTerminal ? "Opening Konsole..." : "Open in Konsole + Neovim"}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => prepare(false)} disabled={busy}>
          <Terminal size={15} /> Prepare Neovim Workspace
        </button>
        <button type="button" className="btn btn-green" onClick={gradeNow} disabled={busy}>
          <Play size={15} /> Grade Workspace Now
        </button>
        {ws && (
          <button type="button" className="btn" onClick={() => prepare(true)} disabled={busy}>
            <RotateCcw size={14} /> Reset Starter Files
          </button>
        )}
        {hints.length > 0 && (
          <button type="button" className="btn" onClick={() => setShowHints((v) => !v)}>
            <HelpCircle size={14} /> {showHints ? "Hide Hints" : `Hints (${hints.length})`}
          </button>
        )}
      </div>

      {terminalStatus && (
        <div className={`lab-launch-banner ${terminalStatus.launched ? "launched" : "fallback"}`}>
          <span>{terminalStatus.message}</span>
        </div>
      )}

      {ws && (
        <div className="code-block" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div className="muted" style={{ fontSize: "0.75rem", marginBottom: 4 }}>
              Run in terminal (saving with <code>:w</code> inside Neovim auto-grades live!):
            </div>
            <code>{ws.nvim_command}</code>
          </div>
          <button type="button" className="btn btn-sm" onClick={copyCmd}>
            <Copy size={14} /> {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      {showHints && (
        <div className="feedback-box" style={{ background: "rgba(224,175,104,0.12)", border: "1px solid rgba(224,175,104,0.35)" }}>
          {hints.map((h, i) => (
            <div key={i}>
              <strong>Hint {i + 1}:</strong> <RichText text={h} />
            </div>
          ))}
        </div>
      )}

      {playgroundKind && (
        <div className="playground-box">
          <button
            type="button"
            className="playground-toggle"
            onClick={() => setShowPlayground((v) => !v)}
            data-testid={`playground-toggle-${activity.id}`}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {playgroundKind === "regex" ? (
                <RegexIcon size={15} color="#bb9af7" />
              ) : playgroundKind === "sql" ? (
                <Database size={15} color="#7dcfff" />
              ) : (
                <Code2 size={15} color="#73daca" />
              )}
              {playgroundLabel}
            </span>
            {showPlayground ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showPlayground && playgroundKind === "regex" && <RegexQuickPlayground activity={activity} />}
          {showPlayground && playgroundKind === "sql" && <SqlQuickPlayground activity={activity} />}
          {showPlayground && (playgroundKind === "html" || playgroundKind === "css") && (
            <HtmlCssQuickPlayground activity={activity} mode={playgroundKind} />
          )}
        </div>
      )}
    </div>
  );
}
