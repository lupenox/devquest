import React, { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  HelpCircle,
  Play,
  RotateCcw,
  Terminal,
} from "lucide-react";
import { api } from "../api";
import type { Activity, GradeOutcome, LaunchWorkspaceResp } from "../types";

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
          <strong>{activity.title}</strong>
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
          <div>{outcome.output}</div>
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
      <p style={{ marginTop: 0 }}>{activity.spec.question}</p>
      {options.map((opt, idx) => (
        <button
          key={idx}
          type="button"
          className={`option-btn ${selected === idx ? "selected" : ""}`}
          onClick={() => setSelected(idx)}
        >
          <span className="badge badge-kind">{String.fromCharCode(65 + idx)}</span>
          <code>{opt}</code>
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
      <p style={{ marginTop: 0 }}>{activity.spec.prompt}</p>
      <div className="code-block" style={{ lineHeight: 2.2 }}>
        {parts.map((part, idx) => (
          <React.Fragment key={idx}>
            <span>{part}</span>
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
      <p style={{ marginTop: 0 }}>{activity.spec.prompt}</p>
      <div style={{ marginBottom: 12 }}>
        {order.map((lineIdx, pos) => (
          <div key={lineIdx} className="parsons-row">
            <pre style={{ margin: 0, whiteSpace: "pre" }}>{lines[lineIdx]}</pre>
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
      <p style={{ marginTop: 0 }}>{activity.spec.prompt}</p>
      <div className="code-block">
        {codeLines.map((ln, idx) => (
          <div key={idx} className={`trace-line ${activeLine === idx + 1 ? "active" : ""}`}>
            <span className="muted" style={{ width: 22, textAlign: "right" }}>
              {idx + 1}
            </span>
            <span>{ln}</span>
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
            background: "#111726",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: "0.85rem" }}>
            <strong>Step {stepIdx + 1}/{steps.length}:</strong> {steps[stepIdx]?.note}
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
              {cp.label} <span className="muted">(line {cp.line})</span>
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

function NvimLabInner({ activity, onResult }: { activity: Activity; onResult: (r: GradeOutcome) => void }) {
  const [ws, setWs] = useState<LaunchWorkspaceResp | null>(null);
  const [showHints, setShowHints] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const hints: string[] = activity.spec.hints || [];

  const prepare = async (reset = false) => {
    setBusy(true);
    try {
      const resp = await api.launchNvim(activity.id, reset);
      setWs(resp);
    } finally {
      setBusy(false);
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

  return (
    <div>
      <p style={{ marginTop: 0, whiteSpace: "pre-line" }}>{activity.spec.instructions}</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
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
              <strong>Hint {i + 1}:</strong> {h}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
