import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  Copy,
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { api } from "../api";
import type {
  EvalChoice,
  EvalDryRun,
  EvalLabOverview,
  EvalScenario,
  EvalSubmitResp,
} from "../types";
import { HighlightedCode, RichText } from "./RichText";
import "../eval-lab.css";

type EvalSubTab = "playbook" | "practice" | "dryrun";

interface EvalLabViewProps {
  onUpdated: () => void;
}

const DEFAULT_LADDER = [
  { id: "spot_first_flaw", title: "1. Spot 1 Diff Flaw", done: false },
  { id: "calibrate_three", title: "2. Calibrate 3 A/B Reviews", done: false },
  { id: "complete_dry_run", title: "3. Complete 1 Dry-Run Plan", done: false },
  { id: "ready_to_ship", title: "4. Ready to Ship!", done: false },
];

const PLAYBOOK_STEPS = [
  {
    step: 1,
    title: "Scope a Safe OSS Task & 3 Acceptance Criteria",
    duration: "5–10 min",
    summary:
      "Pick one bounded bug fix, small feature, or refactor in a permissive open-source repo (`MIT`, `Apache-2.0`, `BSD`). Write 3 concrete, testable pass/fail criteria before touching the assistant.",
    example:
      "Example criteria: (1) returns HTTP `429` with `Retry-After` header, (2) preserves existing `200` JSON schema, (3) passes `pytest` with no skipped or weakened assertions.",
  },
  {
    step: 2,
    title: "Prompt Like a Real Dev",
    duration: "3–5 min",
    summary:
      "Give the assistant the same context you would hand a teammate: exact file paths, constraints, failure reproduction, and the command it should run to verify.",
    example:
      "Share reproduction details and constraints up front — clear prompts surface real differences in assistant reasoning instead of guesswork.",
  },
  {
    step: 3,
    title: "Verify Diffs & Tests Critically",
    duration: "10–15 min",
    summary:
      "Read every changed line and execute the real test suite locally. Watch closely for subtle failure modes: weakened tests, swallowed exceptions, contract drift, O(n²) queries, or unquoted shell variables.",
    example:
      "Never trust a green badge alone — inspect test diffs first to confirm the assistant fixed the root cause rather than relaxing the assertions.",
  },
  {
    step: 4,
    title: "Steer & Log Where You Stepped In",
    duration: "5–10 min",
    summary:
      "When an assistant drifts or misses an edge case, give a focused follow-up citing the exact line, failing test, or invariant. Jot down a 1-line note on what helped vs. where you intervened.",
    example:
      "Short live notes while you work turn the final write-up into a 3-minute polish instead of trying to remember an hour of diffs.",
  },
  {
    step: 5,
    title: "Write Clear Grounded Feedback + Hygiene Check",
    duration: "5 min",
    summary:
      "Lead with your preference, back it with concrete code & test evidence in your own words, and run a fast 5-point hygiene sweep (eligible OSS license, zero secrets, zero PII, real tests run, original wording).",
    example:
      "Specificity beats length: 3 grounded sentences naming the function, edge case, and test result are far stronger than a vague paragraph.",
  },
];

const RED_FLAG_PATTERNS = [
  {
    label: "Reward-Hacked Tests",
    detail: "Deletes or weakens failing assertions to force green CI while the bug remains.",
  },
  {
    label: "Swallowed Errors",
    detail: "Bare `except Exception: pass` or silent fallbacks hiding broken invariants.",
  },
  {
    label: "Broken Contract",
    detail: "Changes public JSON keys, status codes, or component props callers depend on.",
  },
  {
    label: "Unsafe Shell / Edge Cases",
    detail: "Drops `set -euo pipefail`, leaves `$var` unquoted, or mishandles ties / empty inputs.",
  },
];

const CHOICE_OPTIONS: { value: EvalChoice; label: string; short: string }[] = [
  { value: "strongly_a", label: "Strongly Prefer A", short: "Strongly A" },
  { value: "slightly_a", label: "Slightly Prefer A", short: "Slightly A" },
  { value: "tie", label: "Tie / About Equal", short: "Tie" },
  { value: "slightly_b", label: "Slightly Prefer B", short: "Slightly B" },
  { value: "strongly_b", label: "Strongly Prefer B", short: "Strongly B" },
];

const LICENSE_OPTIONS = ["MIT", "Apache-2.0", "BSD-3", "Other Eligible OSS"] as const;
const TASK_TYPE_OPTIONS = ["Bug Fix", "Feature", "Refactor"] as const;

const HYGIENE_ITEMS = [
  {
    key: "eligible_license",
    label: "Eligible license confirmed",
    hint: "Repository uses MIT, Apache-2.0, BSD, or another explicitly permitted OSS license.",
  },
  {
    key: "no_secrets",
    label: "Zero secrets/tokens",
    hint: "No API keys, credentials, private URLs, or `.env` values in prompts, code, or logs.",
  },
  {
    key: "no_pii",
    label: "Zero personal/confidential data",
    hint: "No private emails, customer records, local usernames, or proprietary code.",
  },
  {
    key: "verified_locally",
    label: "Ran real tests & reviewed diff",
    hint: "Executed the verification command locally and read every modified line (including tests).",
  },
  {
    key: "own_words",
    label: "Feedback written in own words",
    hint: "Clear, original engineering critique grounded in specific files, behaviors, and test output.",
  },
] as const;

function normalizeHighlightLang(lang: string): string {
  const lower = (lang || "").toLowerCase();
  if (lower.includes("python") || lower.includes("fastapi") || lower === "py") return "python";
  if (lower.includes("react") || lower.includes("jsx") || lower.includes("tsx")) return "react";
  if (lower.includes("typescript") || lower === "ts") return "typescript";
  if (lower.includes("javascript") || lower === "js") return "javascript";
  if (lower.includes("sql")) return "sql";
  if (lower.includes("bash") || lower.includes("shell") || lower === "sh") return "bash";
  if (lower.includes("c++") || lower.includes("cpp")) return "cpp";
  if (lower.includes("json")) return "json";
  return lower || "python";
}

function formatLangLabel(lang: string): string {
  const lower = (lang || "").toLowerCase();
  if (lower === "python" || lower === "py") return "Python";
  if (lower === "fastapi") return "FastAPI";
  if (lower === "typescript" || lower === "ts") return "TypeScript";
  if (lower === "javascript" || lower === "js") return "JavaScript";
  if (lower === "react" || lower === "tsx" || lower === "jsx") return "React";
  if (lower === "sql") return "SQL";
  if (lower === "bash" || lower === "shell" || lower === "sh") return "Bash";
  return lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : "Code";
}

function formatDifficulty(diff: string): string {
  if (!diff) return "";
  return diff.charAt(0).toUpperCase() + diff.slice(1);
}

function humanizeSlug(slug: string): string {
  return slug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function buildDryRunMarkdown(
  run: EvalDryRun,
  draft: {
    what_helped: string;
    where_stepped_in: string;
    preferred_approach_notes: string;
    checklist: Record<string, boolean>;
  }
): string {
  const criteriaLines =
    run.acceptance_criteria.length > 0
      ? run.acceptance_criteria.map((c, idx) => `${idx + 1}. ${c}`).join("\n")
      : "- (No acceptance criteria recorded yet)";

  const checklistLines = HYGIENE_ITEMS.map(
    (item) => `- [${draft.checklist[item.key] ? "x" : " "}] ${item.label}`
  ).join("\n");

  return [
    `# AI Code Evaluation Write-Up — ${run.repo_name}`,
    "",
    `- **Repository / Project:** ${run.repo_name}`,
    `- **License:** ${run.license}`,
    `- **Task Type:** ${run.task_type}`,
    `- **Verification Command:** \`${run.verify_command || "(not specified)"}\``,
    "",
    "## Task Goal",
    run.goal || "(No task goal specified)",
    "",
    "## Acceptance Criteria",
    criteriaLines,
    "",
    "## Assistant Observation Log",
    "### What Helped Me Move Faster",
    draft.what_helped.trim() || "_(Add notes on where the assistant saved time or generated clean scaffolding)_",
    "",
    "### Where I Had to Step In",
    draft.where_stepped_in.trim() || "_(Add notes on edge cases, test checks, or corrections you applied)_",
    "",
    "### Why I Preferred My Chosen Approach",
    draft.preferred_approach_notes.trim() || "_(Summarize your grounded preference citing specific files and test runs)_",
    "",
    "## Pre-Submit Hygiene Checklist",
    checklistLines,
  ].join("\n");
}

function formatLadderTitle(title: string, idx: number): string {
  const trimmed = (title || "").trim();
  if (/^\d+\./.test(trimmed)) return trimmed;
  return `${idx + 1}. ${trimmed}`;
}

export function EvalLabView({ onUpdated }: EvalLabViewProps) {
  const [overview, setOverview] = useState<EvalLabOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EvalSubTab>("playbook");

  // Sub-tab 2: A/B Practice state
  const [activeScenarioId, setActiveScenarioId] = useState<string>("");
  const [choice, setChoice] = useState<EvalChoice | null>(null);
  const [spottedTags, setSpottedTags] = useState<string[]>([]);
  const [rationale, setRationale] = useState("");
  const [followupPrompt, setFollowupPrompt] = useState("");
  const [submittingScenario, setSubmittingScenario] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultsByScenario, setResultsByScenario] = useState<Record<string, EvalSubmitResp>>({});
  const [copiedFollowup, setCopiedFollowup] = useState(false);

  // Sub-tab 3: Dry-Run Workbench state
  const [dryRuns, setDryRuns] = useState<EvalDryRun[]>([]);
  const [activeDryRunId, setActiveDryRunId] = useState<string>("");
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  // Create form fields
  const [newRepoName, setNewRepoName] = useState("");
  const [newLicense, setNewLicense] = useState<string>("MIT");
  const [newTaskType, setNewTaskType] = useState<string>("Bug Fix");
  const [newGoal, setNewGoal] = useState("");
  const [newAc1, setNewAc1] = useState("");
  const [newAc2, setNewAc2] = useState("");
  const [newAc3, setNewAc3] = useState("");
  const [newVerifyCmd, setNewVerifyCmd] = useState("");
  const [creatingDryRun, setCreatingDryRun] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Active dry-run editable draft
  const [draftWhatHelped, setDraftWhatHelped] = useState("");
  const [draftWhereSteppedIn, setDraftWhereSteppedIn] = useState("");
  const [draftPreferredNotes, setDraftPreferredNotes] = useState("");
  const [draftChecklist, setDraftChecklist] = useState<Record<string, boolean>>({});
  const [savingDryRun, setSavingDryRun] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [copiedWriteup, setCopiedWriteup] = useState(false);
  const [copiedVerifyCmd, setCopiedVerifyCmd] = useState(false);
  const [showWriteupPreview, setShowWriteupPreview] = useState(false);

  const calibrationRef = useRef<HTMLDivElement>(null);

  const syncDryRunDraft = useCallback((run: EvalDryRun | undefined) => {
    if (!run) {
      setDraftWhatHelped("");
      setDraftWhereSteppedIn("");
      setDraftPreferredNotes("");
      setDraftChecklist({});
      return;
    }
    setDraftWhatHelped(run.what_helped || "");
    setDraftWhereSteppedIn(run.where_stepped_in || "");
    setDraftPreferredNotes(run.preferred_approach_notes || "");
    const nextChecklist: Record<string, boolean> = {};
    for (const item of HYGIENE_ITEMS) {
      nextChecklist[item.key] = Boolean(run.checklist?.[item.key]);
    }
    setDraftChecklist(nextChecklist);
  }, []);

  const loadEvalLab = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setLoadError(null);
      try {
        const data = await api.evalLab();
        setOverview(data);
        const runs = data.dry_runs || [];
        setDryRuns(runs);
        setActiveScenarioId((prev) => {
          if (prev && data.scenarios.some((s) => s.id === prev)) return prev;
          return data.scenarios[0]?.id || "";
        });
        setActiveDryRunId((prev) => {
          if (prev && runs.some((r) => r.id === prev)) return prev;
          return runs[0]?.id || "";
        });
        if (runs.length === 0) {
          setShowCreateForm(true);
        }
      } catch (err: any) {
        setLoadError(err?.message || "Could not load AI Code Eval Lab.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadEvalLab(false);
  }, [loadEvalLab]);

  const scenarios = overview?.scenarios ?? [];
  const activeScenario: EvalScenario | undefined = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) || scenarios[0],
    [scenarios, activeScenarioId]
  );

  const activeDryRun: EvalDryRun | undefined = useMemo(
    () => dryRuns.find((r) => r.id === activeDryRunId) || dryRuns[0],
    [dryRuns, activeDryRunId]
  );

  useEffect(() => {
    syncDryRunDraft(activeDryRun);
    setSaveMessage(null);
    setDryRunError(null);
    setShowWriteupPreview(false);
  }, [activeDryRun?.id, syncDryRunDraft]);

  const selectScenario = (scenario: EvalScenario) => {
    setActiveScenarioId(scenario.id);
    setChoice(null);
    setSpottedTags([]);
    setRationale("");
    setFollowupPrompt("");
    setSubmitError(null);
    setCopiedFollowup(false);
  };

  const handleStartScenarioOne = () => {
    const first = scenarios[0];
    if (first) {
      selectScenario(first);
    }
    setActiveTab("practice");
  };

  const toggleTag = (slug: string) => {
    setSpottedTags((prev) =>
      prev.includes(slug) ? prev.filter((item) => item !== slug) : [...prev, slug]
    );
  };

  const handleSubmitScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeScenario) return;
    if (!choice) {
      setSubmitError("Pick a preference in Step 1 before submitting your evaluation.");
      return;
    }
    setSubmittingScenario(true);
    setSubmitError(null);
    try {
      const resp = await api.submitEvalScenario(activeScenario.id, {
        choice,
        spotted_tags: spottedTags,
        rationale: rationale.trim(),
        followup_prompt: followupPrompt.trim(),
      });
      setResultsByScenario((prev) => ({ ...prev, [activeScenario.id]: resp }));
      if (resp.overview) {
        setOverview(resp.overview);
        setDryRuns(resp.overview.dry_runs || []);
      }
      onUpdated();
      window.setTimeout(() => {
        calibrationRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 60);
    } catch (err: any) {
      setSubmitError(err?.message || "Could not submit your scenario review.");
    } finally {
      setSubmittingScenario(false);
    }
  };

  const handleCreateDryRun = async (e: React.FormEvent) => {
    e.preventDefault();
    const repo = newRepoName.trim();
    const goal = newGoal.trim();
    if (!repo || !goal) {
      setCreateError("Add both a Repo / Project Name and a concise Task Goal to create your plan.");
      return;
    }
    setCreatingDryRun(true);
    setCreateError(null);
    const criteria = [newAc1, newAc2, newAc3].map((c) => c.trim()).filter(Boolean);
    const initialChecklist: Record<string, boolean> = {};
    for (const item of HYGIENE_ITEMS) {
      initialChecklist[item.key] = false;
    }
    try {
      const created = await api.createEvalDryRun({
        repo_name: repo,
        license: newLicense,
        task_type: newTaskType,
        goal,
        acceptance_criteria: criteria,
        verify_command: newVerifyCmd.trim(),
        what_helped: "",
        where_stepped_in: "",
        preferred_approach_notes: "",
        checklist: initialChecklist,
        status: "in_progress",
      });
      setNewRepoName("");
      setNewGoal("");
      setNewAc1("");
      setNewAc2("");
      setNewAc3("");
      setNewVerifyCmd("");
      setShowCreateForm(false);
      setDryRuns((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
      setActiveDryRunId(created.id);
      syncDryRunDraft(created);
      await loadEvalLab(true);
      onUpdated();
    } catch (err: any) {
      setCreateError(err?.message || "Could not create dry-run plan.");
    } finally {
      setCreatingDryRun(false);
    }
  };

  const persistDryRun = useCallback(
    async (
      run: EvalDryRun,
      overrides?: {
        what_helped?: string;
        where_stepped_in?: string;
        preferred_approach_notes?: string;
        checklist?: Record<string, boolean>;
      },
      showSavedToast = true
    ) => {
      const nextWhatHelped = overrides?.what_helped ?? draftWhatHelped;
      const nextWhereSteppedIn = overrides?.where_stepped_in ?? draftWhereSteppedIn;
      const nextPreferredNotes = overrides?.preferred_approach_notes ?? draftPreferredNotes;
      const nextChecklist = overrides?.checklist ?? draftChecklist;
      const allChecked = HYGIENE_ITEMS.every((item) => Boolean(nextChecklist[item.key]));
      const nextStatus = allChecked ? "completed" : "in_progress";

      setSavingDryRun(true);
      setDryRunError(null);
      try {
        const updated = await api.updateEvalDryRun(run.id, {
          repo_name: run.repo_name,
          license: run.license,
          task_type: run.task_type,
          goal: run.goal,
          acceptance_criteria: run.acceptance_criteria,
          verify_command: run.verify_command,
          what_helped: nextWhatHelped,
          where_stepped_in: nextWhereSteppedIn,
          preferred_approach_notes: nextPreferredNotes,
          checklist: nextChecklist,
          status: nextStatus,
        });
        setDryRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        if (showSavedToast) {
          setSaveMessage(allChecked ? "Saved — all 5 hygiene checks complete!" : "Progress saved");
          window.setTimeout(() => setSaveMessage(null), 2600);
        }
        await loadEvalLab(true);
        onUpdated();
      } catch (err: any) {
        setDryRunError(err?.message || "Could not save dry-run progress.");
      } finally {
        setSavingDryRun(false);
      }
    },
    [draftWhatHelped, draftWhereSteppedIn, draftPreferredNotes, draftChecklist, loadEvalLab, onUpdated]
  );

  const handleToggleChecklist = (key: string) => {
    if (!activeDryRun) return;
    const nextChecklist = {
      ...draftChecklist,
      [key]: !draftChecklist[key],
    };
    setDraftChecklist(nextChecklist);
    void persistDryRun(activeDryRun, { checklist: nextChecklist }, false);
  };

  const handleDeleteDryRun = async (runId: string) => {
    setDryRunError(null);
    try {
      await api.deleteEvalDryRun(runId);
      const remaining = dryRuns.filter((r) => r.id !== runId);
      setDryRuns(remaining);
      const nextActive = remaining[0];
      setActiveDryRunId(nextActive?.id || "");
      syncDryRunDraft(nextActive);
      if (remaining.length === 0) {
        setShowCreateForm(true);
      }
      await loadEvalLab(true);
      onUpdated();
    } catch (err: any) {
      setDryRunError(err?.message || "Could not delete dry-run plan.");
    }
  };

  const handleCopyWriteup = async () => {
    if (!activeDryRun) return;
    const md = buildDryRunMarkdown(activeDryRun, {
      what_helped: draftWhatHelped,
      where_stepped_in: draftWhereSteppedIn,
      preferred_approach_notes: draftPreferredNotes,
      checklist: draftChecklist,
    });
    const ok = await copyTextSafe(md);
    if (ok) {
      setCopiedWriteup(true);
      window.setTimeout(() => setCopiedWriteup(false), 2400);
    } else {
      setShowWriteupPreview(true);
    }
  };

  const handleCopyVerifyCommand = async () => {
    if (!activeDryRun?.verify_command) return;
    const ok = await copyTextSafe(activeDryRun.verify_command);
    if (ok) {
      setCopiedVerifyCmd(true);
      window.setTimeout(() => setCopiedVerifyCmd(false), 2000);
    }
  };

  const confidencePct = Math.max(0, Math.min(100, Math.round(overview?.confidence_pct ?? 0)));
  const completedCount = overview?.completed_count ?? 0;
  const totalScenarios = overview?.total_scenarios ?? (scenarios.length || 6);
  const ladderItems = overview?.ladder && overview.ladder.length > 0 ? overview.ladder : DEFAULT_LADDER;

  const activeResult = activeScenario ? resultsByScenario[activeScenario.id] : undefined;
  const activeScenarioIdx = activeScenario
    ? scenarios.findIndex((s) => s.id === activeScenario.id)
    : -1;
  const nextScenario =
    activeScenarioIdx >= 0 && activeScenarioIdx + 1 < scenarios.length
      ? scenarios[activeScenarioIdx + 1]
      : null;

  const tagLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (activeScenario) {
      for (const t of activeScenario.available_tags) {
        map[t.slug] = t.label;
      }
    }
    return map;
  }, [activeScenario]);

  const checkedHygieneCount = HYGIENE_ITEMS.filter((item) => Boolean(draftChecklist[item.key])).length;

  const markdownPreview = useMemo(() => {
    if (!activeDryRun) return "";
    return buildDryRunMarkdown(activeDryRun, {
      what_helped: draftWhatHelped,
      where_stepped_in: draftWhereSteppedIn,
      preferred_approach_notes: draftPreferredNotes,
      checklist: draftChecklist,
    });
  }, [activeDryRun, draftWhatHelped, draftWhereSteppedIn, draftPreferredNotes, draftChecklist]);

  return (
    <div className="eval-lab-shell">
      {/* 1. Header & Confidence Ladder */}
      <section className="card eval-hero" data-testid="eval-lab-hero">
        <div className="eval-hero-top">
          <div className="eval-hero-copy">
            <span className="eval-eyebrow">
              <Scale size={15} aria-hidden="true" />
              Zero-Stakes Evaluation Sandbox
            </span>
            <h2>AI Code Eval Lab</h2>
            <p className="eval-subtitle">
              Practice evaluating AI coding assistants step-by-step in a zero-stakes sandbox before
              taking on live tasks
            </p>
          </div>

          <div className="eval-confidence-box">
            <div className="eval-confidence-row">
              <span className="eval-confidence-label">Eval Confidence</span>
              <strong className="eval-confidence-value" data-testid="eval-confidence-pct">
                {confidencePct}%
              </strong>
            </div>
            <div
              className="progress-track eval-confidence-track"
              role="progressbar"
              aria-label="Eval Confidence percentage"
              aria-valuenow={confidencePct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="progress-fill eval-confidence-fill"
                style={{ width: `${confidencePct}%` }}
              />
            </div>
            <div className="eval-confidence-meta">
              <span>
                {completedCount}/{totalScenarios} scenarios calibrated
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {dryRuns.length} dry-run {dryRuns.length === 1 ? "plan" : "plans"}
              </span>
            </div>
          </div>
        </div>

        <div className="eval-ladder" data-testid="eval-confidence-ladder" aria-label="Confidence Ladder">
          <div className="eval-ladder-heading">
            <Sparkles size={14} aria-hidden="true" />
            <span>Confidence Ladder</span>
          </div>
          <ol className="eval-ladder-grid">
            {ladderItems.map((milestone, idx) => (
              <li
                key={milestone.id}
                className={`eval-ladder-step ${milestone.done ? "done" : ""}`}
                data-testid={`eval-ladder-${milestone.id}`}
              >
                <span className="eval-ladder-dot" aria-hidden="true">
                  {milestone.done ? <Check size={14} /> : idx + 1}
                </span>
                <span className="eval-ladder-title">{formatLadderTitle(milestone.title, idx)}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* 3 Clean Segmented Sub-Tabs */}
        <div className="eval-subtabs" role="tablist" aria-label="AI Code Eval Lab sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "playbook"}
            className={`eval-subtab ${activeTab === "playbook" ? "active" : ""}`}
            data-testid="eval-tab-playbook"
            onClick={() => setActiveTab("playbook")}
          >
            <BookOpen size={15} aria-hidden="true" />
            <span>Start Here (Playbook)</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "practice"}
            className={`eval-subtab ${activeTab === "practice" ? "active" : ""}`}
            data-testid="eval-tab-practice"
            onClick={() => setActiveTab("practice")}
          >
            <Code2 size={15} aria-hidden="true" />
            <span>A/B Practice ({totalScenarios} Scenarios)</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "dryrun"}
            className={`eval-subtab ${activeTab === "dryrun" ? "active" : ""}`}
            data-testid="eval-tab-dryrun"
            onClick={() => setActiveTab("dryrun")}
          >
            <Wrench size={15} aria-hidden="true" />
            <span>Dry-Run Workbench</span>
            {dryRuns.length > 0 && <span className="eval-tab-count">{dryRuns.length}</span>}
          </button>
        </div>
      </section>

      {loadError && (
        <div className="card eval-error-banner" role="alert">
          <div className="eval-error-content">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{loadError}</span>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => loadEvalLab(false)}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {loading && !overview ? (
        <div className="card eval-loading-card">
          <p className="muted" style={{ margin: 0 }}>
            Loading AI Code Eval Lab scenarios and dry-run plans…
          </p>
        </div>
      ) : null}

      {/* SUB-TAB 1 — Start Here (Zero-Overwhelm Playbook) */}
      {activeTab === "playbook" && (
        <section className="eval-section-stack" data-testid="eval-playbook">
          <div className="card eval-playbook-card">
            <div className="eval-section-header">
              <div>
                <h3 className="eval-section-title">
                  The 5-Step Code Evaluation Playbook
                </h3>
                <p className="eval-section-desc">
                  Evaluating an AI coding assistant is just structured PR review — break a big task
                  into five calm, repeatable steps so you never feel stuck staring at a blank screen.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary eval-cta-btn"
                data-testid="eval-start-scenario-1-btn"
                onClick={handleStartScenarioOne}
              >
                <span>Try Scenario 1 (5 min) →</span>
              </button>
            </div>

            <ol className="eval-playbook-steps">
              {PLAYBOOK_STEPS.map((item) => (
                <li key={item.step} className="eval-playbook-step">
                  <div className="eval-step-num" aria-hidden="true">
                    {item.step}
                  </div>
                  <div className="eval-step-body">
                    <div className="eval-step-head">
                      <h4>{item.title}</h4>
                      <span className="eval-step-time">{item.duration}</span>
                    </div>
                    <p className="eval-step-summary">
                      <RichText text={item.summary} />
                    </p>
                    <p className="eval-step-example">
                      <RichText text={item.example} />
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="card eval-tip-card" data-testid="eval-confidence-tip">
            <div className="eval-tip-icon" aria-hidden="true">
              <Lightbulb size={20} />
            </div>
            <div className="eval-tip-body">
              <h4>First-Task Confidence Tip</h4>
              <p>
                Working on an eligible <strong>MIT, Apache-2.0, or BSD</strong> open-source
                repository you already know well — even one of your own public OSS projects, kept
                completely free of secrets, tokens, or personal/PII data — removes{" "}
                <strong>80% of the friction</strong> on your first task. Because you already know
                how the tests run and what clean code looks like there, spotting assistant shortcuts
                becomes second nature.
              </p>
            </div>
          </div>

          <div className="card eval-redflags-card">
            <div className="eval-redflags-head">
              <ShieldCheck size={17} aria-hidden="true" />
              <h4>4 High-Signal Diff Red Flags to Watch For</h4>
            </div>
            <div className="eval-redflags-grid">
              {RED_FLAG_PATTERNS.map((flag) => (
                <div key={flag.label} className="eval-redflag-item">
                  <strong>{flag.label}</strong>
                  <p>
                    <RichText text={flag.detail} />
                  </p>
                </div>
              ))}
            </div>

            <div className="eval-playbook-footer">
              <button
                type="button"
                className="btn btn-primary eval-cta-btn"
                onClick={handleStartScenarioOne}
              >
                <span>Try Scenario 1 (5 min) →</span>
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setActiveTab("dryrun")}
              >
                <Wrench size={15} aria-hidden="true" />
                <span>Plan a Local Dry-Run</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* SUB-TAB 2 — A/B Code Eval Practice */}
      {activeTab === "practice" && (
        <section className="eval-section-stack">
          <div className="card eval-picker-card">
            <div className="eval-picker-header">
              <div>
                <h3 className="eval-section-title">Choose a Practice Scenario</h3>
                <p className="eval-section-desc">
                  Compare two AI assistant diffs side by side, tag what you caught, and calibrate
                  your write-up against a senior reviewer key.
                </p>
              </div>
              <span className="eval-progress-chip">
                {completedCount}/{totalScenarios} Calibrated
              </span>
            </div>

            <div className="eval-scenarios-grid" data-testid="eval-scenarios-list">
              {scenarios.map((sc, idx) => {
                const isActive = activeScenario?.id === sc.id;
                return (
                  <button
                    key={sc.id}
                    type="button"
                    className={`eval-scenario-pill ${isActive ? "active" : ""} ${sc.completed ? "completed" : ""}`}
                    data-testid={`eval-scenario-pill-${sc.id}`}
                    aria-pressed={isActive}
                    onClick={() => selectScenario(sc)}
                  >
                    <div className="eval-scenario-pill-top">
                      <span className="eval-lang-badge">{formatLangLabel(sc.language)}</span>
                      <span className="eval-diff-badge">{formatDifficulty(sc.difficulty)}</span>
                      {sc.completed && (
                        <span className="eval-calibrated-badge">
                          <CheckCircle2 size={12} aria-hidden="true" />
                          Calibrated ✓
                        </span>
                      )}
                    </div>
                    <strong className="eval-scenario-pill-title">
                      {idx + 1}. {sc.title}
                    </strong>
                    <div className="eval-scenario-pill-meta">
                      <span>~{sc.estimated_minutes} min</span>
                      {typeof sc.best_score === "number" && sc.completed && (
                        <span>Best {sc.best_score}/100</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {activeScenario && (
            <div className="eval-section-stack" data-testid="eval-scenario-active">
              {/* Scenario Brief Card */}
              <div className="card eval-brief-card">
                <div className="eval-brief-top">
                  <div>
                    <div className="eval-brief-badges">
                      <span className="eval-lang-badge">
                        {formatLangLabel(activeScenario.language)}
                      </span>
                      <span className="eval-diff-badge">
                        {formatDifficulty(activeScenario.difficulty)}
                      </span>
                      <span className="eval-time-badge">
                        ~{activeScenario.estimated_minutes} min
                      </span>
                      {activeScenario.completed && (
                        <span className="eval-calibrated-badge">
                          <CheckCircle2 size={12} aria-hidden="true" />
                          Calibrated ✓
                        </span>
                      )}
                    </div>
                    <h3 className="eval-scenario-heading">{activeScenario.title}</h3>
                  </div>
                </div>

                <div className="eval-brief-grid">
                  <div className="eval-brief-box">
                    <h4>
                      <FileText size={14} aria-hidden="true" /> Context
                    </h4>
                    <p>
                      <RichText text={activeScenario.context} />
                    </p>
                  </div>
                  <div className="eval-brief-box">
                    <h4>
                      <MessageSquare size={14} aria-hidden="true" /> Task Prompt Sent to Both
                      Assistants
                    </h4>
                    <p>
                      <RichText text={activeScenario.task_prompt} />
                    </p>
                  </div>
                </div>

                <div className="eval-criteria-box">
                  <h4>
                    <ListChecks size={14} aria-hidden="true" /> Acceptance Criteria
                  </h4>
                  <ul>
                    {activeScenario.acceptance_criteria.map((criterion, idx) => (
                      <li key={idx}>
                        <CheckCircle2 size={14} aria-hidden="true" />
                        <span>
                          <RichText text={criterion} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Side-by-Side Approach A vs Approach B */}
              <div className="eval-ab-grid">
                {(
                  [
                    { side: "a", tag: "Approach A", data: activeScenario.approach_a },
                    { side: "b", tag: "Approach B", data: activeScenario.approach_b },
                  ] as const
                ).map(({ side, tag, data }) => (
                  <article
                    key={side}
                    className={`card eval-approach-card side-${side}`}
                    data-testid={`eval-approach-${side}`}
                  >
                    <div className="eval-approach-header">
                      <span className={`eval-side-pill side-${side}`}>{tag}</span>
                      {data.label && data.label.trim().toLowerCase() !== tag.toLowerCase() ? (
                        <h4>{data.label}</h4>
                      ) : (
                        <span className="eval-approach-sub">Candidate Diff</span>
                      )}
                    </div>
                    <p className="eval-approach-summary">
                      <RichText text={data.summary} />
                    </p>

                    <div className="eval-approach-code">
                      <HighlightedCode
                        code={data.code}
                        lang={normalizeHighlightLang(activeScenario.language)}
                      />
                    </div>

                    <div className="eval-test-output">
                      <div className="eval-test-output-head">
                        <Terminal size={13} aria-hidden="true" />
                        <span>Simulated Test Run Output</span>
                      </div>
                      <pre>
                        <code>{data.test_output}</code>
                      </pre>
                    </div>
                  </article>
                ))}
              </div>

              {/* Evaluation Submission Form */}
              <form className="card eval-review-form" onSubmit={handleSubmitScenario}>
                <div className="eval-form-step">
                  <div className="eval-form-step-head">
                    <span className="eval-step-badge">Step 1</span>
                    <h4>Pick Your Preference</h4>
                  </div>
                  <p className="eval-form-hint">
                    Which assistant produced the safer, cleaner, contract-preserving change?
                  </p>
                  <div
                    className="eval-choice-group"
                    role="radiogroup"
                    aria-label="Pick your preference"
                  >
                    {CHOICE_OPTIONS.map((opt) => {
                      const selected = choice === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`eval-choice-btn ${selected ? "selected" : ""}`}
                          data-testid={`eval-choice-${opt.value}`}
                          onClick={() => {
                            setChoice(opt.value);
                            setSubmitError(null);
                          }}
                        >
                          <span className="eval-choice-dot" aria-hidden="true" />
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="eval-form-step">
                  <div className="eval-form-step-head">
                    <span className="eval-step-badge">Step 2</span>
                    <h4>Tag Issues &amp; Strengths You Caught</h4>
                    <span className="eval-tag-count">{spottedTags.length} selected</span>
                  </div>
                  <p className="eval-form-hint">
                    Select every concrete strength or failure mode you spotted across both diffs.
                  </p>
                  <div className="eval-tags-wrap">
                    {activeScenario.available_tags.map((tag) => {
                      const selected = spottedTags.includes(tag.slug);
                      return (
                        <button
                          key={tag.slug}
                          type="button"
                          aria-pressed={selected}
                          className={`eval-tag-chip ${selected ? "selected" : ""}`}
                          data-testid={`eval-tag-${tag.slug}`}
                          onClick={() => toggleTag(tag.slug)}
                        >
                          <Tag size={13} aria-hidden="true" />
                          <span>{tag.label}</span>
                          {selected && <Check size={13} aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="eval-form-step">
                  <div className="eval-form-step-head">
                    <span className="eval-step-badge">Step 3</span>
                    <h4>Your Critique (In Your Own Words)</h4>
                  </div>
                  <div className="eval-textarea-stack">
                    <div className="eval-field-group">
                      <label htmlFor="eval-rationale">
                        Why did you prefer that approach? Cite specific code lines, edge cases, and
                        test behavior.
                      </label>
                      <textarea
                        id="eval-rationale"
                        aria-label="Your evaluation rationale"
                        className="eval-textarea"
                        rows={4}
                        value={rationale}
                        onChange={(e) => setRationale(e.target.value)}
                        placeholder="Example: Approach B fixes the actual expiration check using monotonic time and preserves strict assertions, whereas Approach A weakens the failing test assertion so CI passes while the bug stays broken..."
                      />
                    </div>

                    <div className="eval-field-group">
                      <label htmlFor="eval-followup">
                        Optional — Follow-Up Prompt to Assistant{" "}
                        <span className="muted">(how you would steer the weaker response)</span>
                      </label>
                      <textarea
                        id="eval-followup"
                        aria-label="Follow-up prompt"
                        className="eval-textarea"
                        rows={2}
                        value={followupPrompt}
                        onChange={(e) => setFollowupPrompt(e.target.value)}
                        placeholder="Example: Please restore the original strict expiration test assertion and fix the TTL comparison inside is_expired() instead of modifying the test..."
                      />
                    </div>
                  </div>
                </div>

                {submitError && (
                  <div className="feedback-box err" role="alert">
                    {submitError}
                  </div>
                )}

                <div className="eval-form-actions">
                  <button
                    type="submit"
                    className="btn btn-primary eval-submit-btn"
                    data-testid="eval-submit-btn"
                    disabled={submittingScenario || !choice}
                  >
                    <ClipboardCheck size={16} aria-hidden="true" />
                    <span>
                      {submittingScenario
                        ? "Calibrating Review…"
                        : "Submit & Compare with Senior Key"}
                    </span>
                  </button>
                  {!choice && (
                    <span className="eval-submit-hint">
                      Pick a preference in Step 1 to enable calibration.
                    </span>
                  )}
                </div>
              </form>

              {/* Calibration Result Card */}
              {activeResult && (
                <section
                  ref={calibrationRef}
                  className={`card eval-calibration-card ${activeResult.aligned ? "aligned" : "diverged"}`}
                  data-testid="eval-calibration-result"
                  aria-live="polite"
                >
                  <div className="eval-calibration-top">
                    <div className="eval-calibration-status">
                      <span
                        className={`eval-align-pill ${activeResult.aligned ? "ok" : "warn"}`}
                      >
                        {activeResult.aligned ? (
                          <>
                            <CheckCircle2 size={15} aria-hidden="true" />
                            Aligned with Senior Reviewer Key
                          </>
                        ) : (
                          <>
                            <Lightbulb size={15} aria-hidden="true" />
                            Different Call — Compare &amp; Calibrate
                          </>
                        )}
                      </span>
                      <span className="eval-expected-note">
                        Senior Key: <strong>Approach {activeResult.expected_side.toUpperCase()}</strong>
                      </span>
                    </div>

                    <div className="eval-calibration-rewards">
                      <span className="eval-score-pill">
                        Rubric {activeResult.rubric.total}/100
                      </span>
                      {activeResult.xp_awarded > 0 && (
                        <span className="eval-xp-pill" data-testid="eval-xp-badge">
                          <Sparkles size={13} aria-hidden="true" />+{activeResult.xp_awarded} XP
                        </span>
                      )}
                    </div>
                  </div>

                  {activeResult.unlocked_achievements &&
                    activeResult.unlocked_achievements.length > 0 && (
                      <div className="eval-achievement-banner">
                        <Award size={16} aria-hidden="true" />
                        <span>
                          Achievement Unlocked:{" "}
                          <strong>
                            {activeResult.unlocked_achievements.map((a) => a.name).join(", ")}
                          </strong>
                        </span>
                      </div>
                    )}

                  {/* Matched vs Missed Tags */}
                  <div className="eval-tag-calibration">
                    <div className="eval-tag-cal-col">
                      <h5>Matched Key Issues ({activeResult.matched_tags.length})</h5>
                      {activeResult.matched_tags.length > 0 ? (
                        <div className="eval-tag-pills-row">
                          {activeResult.matched_tags.map((slug) => (
                            <span key={slug} className="eval-cal-tag matched">
                              <Check size={12} aria-hidden="true" />
                              {tagLabelMap[slug] || humanizeSlug(slug)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="muted eval-cal-empty">
                          No key tags matched yet — review the missed signals below.
                        </p>
                      )}
                    </div>

                    <div className="eval-tag-cal-col">
                      <h5>Missed Key Signals ({activeResult.missed_tags.length})</h5>
                      {activeResult.missed_tags.length > 0 ? (
                        <div className="eval-tag-pills-row">
                          {activeResult.missed_tags.map((slug) => (
                            <span key={slug} className="eval-cal-tag missed">
                              {tagLabelMap[slug] || humanizeSlug(slug)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="eval-cal-perfect">
                          You caught every key signal in this diff!
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 4-Axis Feedback Bars */}
                  <div className="eval-rubric-section" data-testid="eval-rubric-bars">
                    <h5>4-Axis Evaluation Quality Rubric</h5>
                    <div className="eval-rubric-grid">
                      {(
                        [
                          { label: "Stance Clarity", value: activeResult.rubric.stance_clarity },
                          { label: "Code Evidence", value: activeResult.rubric.code_evidence },
                          {
                            label: "Verification Focus",
                            value: activeResult.rubric.verification_focus,
                          },
                          {
                            label: "Actionable Steering",
                            value: activeResult.rubric.actionable_steering,
                          },
                        ] as const
                      ).map((axis) => {
                        const pct = Math.max(0, Math.min(100, (axis.value / 25) * 100));
                        return (
                          <div key={axis.label} className="eval-rubric-card">
                            <div className="eval-rubric-top">
                              <span>{axis.label}</span>
                              <strong>{axis.value}/25</strong>
                            </div>
                            <div className="eval-rubric-track">
                              <div
                                className="eval-rubric-fill"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Coaching Tips */}
                  {activeResult.coaching_tips && activeResult.coaching_tips.length > 0 && (
                    <div className="eval-coaching-box">
                      <h5>Coaching Notes for Your Write-Up</h5>
                      <ul>
                        {activeResult.coaching_tips.map((tip, idx) => (
                          <li key={idx}>
                            <RichText text={tip} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Senior Reference Explanation */}
                  <div className="eval-reference-box">
                    <h5>Senior Reviewer Reference Explanation</h5>
                    <p>
                      <RichText text={activeResult.reference_explanation} />
                    </p>
                  </div>

                  {/* Sample Steering Follow-Up */}
                  {activeResult.sample_followup && (
                    <div className="eval-followup-box">
                      <div className="eval-followup-head">
                        <h5>Example Follow-Up Steering Prompt</h5>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={async () => {
                            const ok = await copyTextSafe(activeResult.sample_followup);
                            if (ok) {
                              setCopiedFollowup(true);
                              window.setTimeout(() => setCopiedFollowup(false), 2000);
                            }
                          }}
                        >
                          {copiedFollowup ? (
                            <>
                              <Check size={13} aria-hidden="true" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy size={13} aria-hidden="true" /> Copy Prompt
                            </>
                          )}
                        </button>
                      </div>
                      <p>
                        <RichText text={activeResult.sample_followup} />
                      </p>
                    </div>
                  )}

                  <div className="eval-calibration-footer">
                    {nextScenario ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => selectScenario(nextScenario)}
                      >
                        <span>Next Scenario: {nextScenario.title}</span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setActiveTab("dryrun")}
                      >
                        <span>Open Dry-Run Workbench</span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </section>
      )}

      {/* SUB-TAB 3 — Dry-Run Task Workbench */}
      {activeTab === "dryrun" && (
        <section className="eval-section-stack" data-testid="eval-dryrun-workbench">
          <div className="card eval-dryrun-topbar">
            <div>
              <h3 className="eval-section-title">Dry-Run Task Workbench</h3>
              <p className="eval-section-desc">
                Scope a real open-source task locally, log assistant observations as you go, verify
                all 5 hygiene checks, and export a clean markdown evaluation write-up.
              </p>
            </div>
            <div className="eval-dryrun-top-actions">
              <button
                type="button"
                className="btn btn-primary"
                data-testid="eval-dryrun-new-toggle"
                onClick={() => setShowCreateForm((prev) => !prev)}
              >
                <Plus size={15} aria-hidden="true" />
                <span>{showCreateForm && dryRuns.length > 0 ? "Hide New Plan Form" : "New Dry-Run Plan"}</span>
              </button>
            </div>
          </div>

          {/* Saved Dry-Run Switcher */}
          {dryRuns.length > 0 && (
            <div className="eval-dryrun-switcher" aria-label="Saved dry-run plans">
              {dryRuns.map((run) => {
                const isSelected = activeDryRun?.id === run.id;
                const doneChecks = HYGIENE_ITEMS.filter((h) => Boolean(run.checklist?.[h.key])).length;
                return (
                  <button
                    key={run.id}
                    type="button"
                    className={`eval-dryrun-chip ${isSelected ? "active" : ""}`}
                    data-testid={`eval-dryrun-tab-${run.id}`}
                    onClick={() => setActiveDryRunId(run.id)}
                  >
                    <span className="eval-dryrun-chip-repo">{run.repo_name}</span>
                    <span className="eval-dryrun-chip-meta">
                      {run.license} · {doneChecks}/5 hygiene
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Create New Dry-Run Form */}
          {(showCreateForm || dryRuns.length === 0) && (
            <form
              className="card eval-dryrun-form"
              data-testid="eval-dryrun-form"
              onSubmit={handleCreateDryRun}
            >
              <div className="eval-dryrun-form-head">
                <h4>Scope a New Local Dry-Run Task</h4>
                <p className="muted">
                  Pick a small, verifiable change in an eligible OSS repo so you can rehearse the
                  full eval workflow end to end.
                </p>
              </div>

              <div className="eval-form-grid">
                <div className="eval-field-group">
                  <label htmlFor="dryrun-repo">Repo / Project Name</label>
                  <input
                    id="dryrun-repo"
                    type="text"
                    className="input-field"
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value)}
                    placeholder="e.g., my-oss-org/fast-cli"
                  />
                </div>

                <div className="eval-field-group">
                  <label htmlFor="dryrun-license">License</label>
                  <select
                    id="dryrun-license"
                    className="select-field"
                    value={newLicense}
                    onChange={(e) => setNewLicense(e.target.value)}
                  >
                    {LICENSE_OPTIONS.map((lic) => (
                      <option key={lic} value={lic}>
                        {lic}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="eval-field-group">
                  <label htmlFor="dryrun-task-type">Task Type</label>
                  <select
                    id="dryrun-task-type"
                    className="select-field"
                    value={newTaskType}
                    onChange={(e) => setNewTaskType(e.target.value)}
                  >
                    {TASK_TYPE_OPTIONS.map((tt) => (
                      <option key={tt} value={tt}>
                        {tt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="eval-field-group">
                <label htmlFor="dryrun-goal">Task Goal</label>
                <textarea
                  id="dryrun-goal"
                  className="eval-textarea"
                  rows={2}
                  value={newGoal}
                  onChange={(e) => setNewGoal(e.target.value)}
                  placeholder="Describe the bounded bug fix, feature, or refactor in 1–2 crisp sentences..."
                />
              </div>

              <div className="eval-criteria-inputs">
                <span className="eval-criteria-inputs-label">3 Acceptance Criteria</span>
                <div className="eval-criteria-row">
                  <label htmlFor="dryrun-ac-1" className="eval-ac-num">
                    1.
                  </label>
                  <input
                    id="dryrun-ac-1"
                    type="text"
                    className="input-field"
                    value={newAc1}
                    onChange={(e) => setNewAc1(e.target.value)}
                    placeholder="Behavior check #1 (e.g., handles empty input without raising)"
                  />
                </div>
                <div className="eval-criteria-row">
                  <label htmlFor="dryrun-ac-2" className="eval-ac-num">
                    2.
                  </label>
                  <input
                    id="dryrun-ac-2"
                    type="text"
                    className="input-field"
                    value={newAc2}
                    onChange={(e) => setNewAc2(e.target.value)}
                    placeholder="Contract check #2 (e.g., preserves existing response fields)"
                  />
                </div>
                <div className="eval-criteria-row">
                  <label htmlFor="dryrun-ac-3" className="eval-ac-num">
                    3.
                  </label>
                  <input
                    id="dryrun-ac-3"
                    type="text"
                    className="input-field"
                    value={newAc3}
                    onChange={(e) => setNewAc3(e.target.value)}
                    placeholder="Verification check #3 (e.g., adds unit test covering edge case)"
                  />
                </div>
              </div>

              <div className="eval-field-group">
                <label htmlFor="dryrun-verify-cmd">Verification Command</label>
                <input
                  id="dryrun-verify-cmd"
                  type="text"
                  className="input-field eval-mono-input"
                  value={newVerifyCmd}
                  onChange={(e) => setNewVerifyCmd(e.target.value)}
                  placeholder="e.g., uv run pytest -v"
                />
              </div>

              {createError && (
                <div className="feedback-box err" role="alert">
                  {createError}
                </div>
              )}

              <div className="eval-form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  data-testid="eval-dryrun-create-btn"
                  disabled={creatingDryRun}
                >
                  <Plus size={15} aria-hidden="true" />
                  <span>{creatingDryRun ? "Creating Plan…" : "Create Dry-Run Plan"}</span>
                </button>
              </div>
            </form>
          )}

          {/* Active Dry-Run Workspace Card */}
          {activeDryRun && (
            <article className="card eval-dryrun-active" data-testid="eval-dryrun-active">
              <div className="eval-dryrun-header">
                <div className="eval-dryrun-title-block">
                  <div className="eval-brief-badges">
                    <span className="eval-lang-badge">{activeDryRun.license}</span>
                    <span className="eval-diff-badge">{activeDryRun.task_type}</span>
                    <span
                      className={`eval-hygiene-status ${
                        checkedHygieneCount === HYGIENE_ITEMS.length ? "ready" : ""
                      }`}
                    >
                      {checkedHygieneCount === HYGIENE_ITEMS.length
                        ? "Ready to Submit ✓"
                        : `${checkedHygieneCount}/5 Hygiene Checks`}
                    </span>
                  </div>
                  <h4>{activeDryRun.repo_name}</h4>
                  <p className="eval-dryrun-goal">
                    <RichText text={activeDryRun.goal} />
                  </p>
                </div>

                <button
                  type="button"
                  className="btn btn-sm eval-delete-btn"
                  data-testid="eval-dryrun-delete-btn"
                  onClick={() => handleDeleteDryRun(activeDryRun.id)}
                  aria-label={`Delete dry-run plan for ${activeDryRun.repo_name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  <span>Delete</span>
                </button>
              </div>

              <div className="eval-dryrun-meta-grid">
                <div className="eval-brief-box">
                  <h4>
                    <ListChecks size={14} aria-hidden="true" /> Acceptance Criteria
                  </h4>
                  {activeDryRun.acceptance_criteria.length > 0 ? (
                    <ol className="eval-dryrun-ac-list">
                      {activeDryRun.acceptance_criteria.map((c, idx) => (
                        <li key={idx}>
                          <RichText text={c} />
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted">No criteria listed for this dry-run.</p>
                  )}
                </div>

                <div className="eval-brief-box">
                  <h4>
                    <Terminal size={14} aria-hidden="true" /> Verification Command
                  </h4>
                  {activeDryRun.verify_command ? (
                    <div className="eval-verify-cmd-row">
                      <code>{activeDryRun.verify_command}</code>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={handleCopyVerifyCommand}
                      >
                        {copiedVerifyCmd ? (
                          <>
                            <Check size={13} aria-hidden="true" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={13} aria-hidden="true" /> Copy
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <p className="muted">No verification command specified.</p>
                  )}
                </div>
              </div>

              {/* Assistant Observation Log */}
              <div className="eval-observation-section">
                <h4>
                  <MessageSquare size={15} aria-hidden="true" /> Assistant Observation Log
                </h4>
                <div className="eval-observation-grid">
                  <div className="eval-field-group">
                    <label htmlFor="dryrun-what-helped">What helped me move faster</label>
                    <textarea
                      id="dryrun-what-helped"
                      className="eval-textarea"
                      rows={3}
                      value={draftWhatHelped}
                      onChange={(e) => setDraftWhatHelped(e.target.value)}
                      placeholder="Where did the assistant save real engineering time (e.g., scaffolding tests, locating call sites)?"
                    />
                  </div>

                  <div className="eval-field-group">
                    <label htmlFor="dryrun-where-stepped-in">Where I had to step in</label>
                    <textarea
                      id="dryrun-where-stepped-in"
                      className="eval-textarea"
                      rows={3}
                      value={draftWhereSteppedIn}
                      onChange={(e) => setDraftWhereSteppedIn(e.target.value)}
                      placeholder="What edge cases, broken assumptions, or test issues required your steering or manual fix?"
                    />
                  </div>

                  <div className="eval-field-group">
                    <label htmlFor="dryrun-preferred-notes">
                      Why I preferred my chosen approach
                    </label>
                    <textarea
                      id="dryrun-preferred-notes"
                      className="eval-textarea"
                      rows={3}
                      value={draftPreferredNotes}
                      onChange={(e) => setDraftPreferredNotes(e.target.value)}
                      placeholder="Summarize your grounded preference citing specific functions, diffs, and local test runs..."
                    />
                  </div>
                </div>
              </div>

              {/* 5-Point Pre-Submit Hygiene Checklist */}
              <div className="eval-hygiene-section" data-testid="eval-hygiene-checklist">
                <div className="eval-hygiene-head">
                  <h4>
                    <ShieldCheck size={15} aria-hidden="true" /> 5-Point Pre-Submit Hygiene
                    Checklist
                  </h4>
                  <span className="eval-hygiene-counter">
                    {checkedHygieneCount}/{HYGIENE_ITEMS.length} verified
                  </span>
                </div>

                <div className="eval-hygiene-list">
                  {HYGIENE_ITEMS.map((item) => {
                    const checked = Boolean(draftChecklist[item.key]);
                    return (
                      <label
                        key={item.key}
                        className={`eval-hygiene-item ${checked ? "checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          data-testid={`eval-hygiene-${item.key}`}
                          onChange={() => handleToggleChecklist(item.key)}
                        />
                        <span className="eval-hygiene-text">
                          <strong>{item.label}</strong>
                          <small>{item.hint}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {dryRunError && (
                <div className="feedback-box err" role="alert">
                  {dryRunError}
                </div>
              )}

              <div className="eval-dryrun-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="eval-dryrun-save-btn"
                  disabled={savingDryRun}
                  onClick={() => persistDryRun(activeDryRun)}
                >
                  <CheckCircle2 size={15} aria-hidden="true" />
                  <span>{savingDryRun ? "Saving…" : "Save Progress"}</span>
                </button>

                <button
                  type="button"
                  className="btn btn-green"
                  data-testid="eval-dryrun-copy-btn"
                  onClick={handleCopyWriteup}
                >
                  {copiedWriteup ? (
                    <>
                      <Check size={15} aria-hidden="true" />
                      <span>Copied Write-Up!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={15} aria-hidden="true" />
                      <span>Copy Evaluation Write-Up</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowWriteupPreview((prev) => !prev)}
                >
                  <FileText size={15} aria-hidden="true" />
                  <span>{showWriteupPreview ? "Hide Markdown" : "Preview Markdown"}</span>
                </button>

                {saveMessage && (
                  <span className="eval-save-status" role="status">
                    <Check size={14} aria-hidden="true" />
                    {saveMessage}
                  </span>
                )}
              </div>

              {showWriteupPreview && (
                <div className="eval-writeup-preview">
                  <div className="eval-writeup-preview-head">
                    <span>Generated Markdown Write-Up</span>
                  </div>
                  <pre>
                    <code>{markdownPreview}</code>
                  </pre>
                </div>
              )}
            </article>
          )}
        </section>
      )}
    </div>
  );
}
