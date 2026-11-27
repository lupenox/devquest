import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  ListChecks,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../../api";
import type { EvalDryRun } from "../../types";
import { RichText } from "../RichText";
import {
  buildDryRunMarkdown,
  copyTextSafe,
  DRY_RUN_SAMPLE_TEMPLATE,
  HYGIENE_ITEMS,
  LICENSE_OPTIONS,
  TASK_TYPE_OPTIONS,
} from "./evalLabConstants";

interface EvalDryRunTabProps {
  onStep: (step: number) => void;
  dryRuns: EvalDryRun[];
  activeDryRunId: string;
  onSelectDryRunId: (id: string) => void;
  onDryRunsChange: React.Dispatch<React.SetStateAction<EvalDryRun[]>>;
  onRefresh: () => Promise<void>;
}

function buildChecklistState(run: EvalDryRun | undefined): Record<string, boolean> {
  if (!run) return {};
  const nextChecklist: Record<string, boolean> = {};
  for (const item of HYGIENE_ITEMS) {
    nextChecklist[item.key] = Boolean(run.checklist?.[item.key]);
  }
  return nextChecklist;
}

function runHasNotes(run: EvalDryRun | undefined): boolean {
  if (!run) return false;
  return Boolean(
    run.what_helped?.trim() || run.where_stepped_in?.trim() || run.preferred_approach_notes?.trim()
  );
}

export function EvalDryRunTab({
  onStep,
  dryRuns,
  activeDryRunId,
  onSelectDryRunId,
  onDryRunsChange,
  onRefresh,
}: EvalDryRunTabProps) {
  const initialActive = dryRuns.find((r) => r.id === activeDryRunId) || dryRuns[0];
  const [checksStep, setChecksStep] = useState(false);
  const [reviewStep, setReviewStep] = useState(false);
  useEffect(() => { setReviewStep(false); }, [activeDryRunId]);
  const [showCreateForm, setShowCreateForm] = useState<boolean>(dryRuns.length === 0);

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

  // Active dry-run draft (lazily initialized from the active plan to prevent stale-zero mount flash)
  const [draftWhatHelped, setDraftWhatHelped] = useState(() => initialActive?.what_helped || "");
  const [draftWhereSteppedIn, setDraftWhereSteppedIn] = useState(
    () => initialActive?.where_stepped_in || ""
  );
  const [draftPreferredNotes, setDraftPreferredNotes] = useState(
    () => initialActive?.preferred_approach_notes || ""
  );
  const [draftChecklist, setDraftChecklist] = useState<Record<string, boolean>>(() =>
    buildChecklistState(initialActive)
  );
  const [notesOpen, setNotesOpen] = useState<boolean>(() => runHasNotes(initialActive));
  const [savingDryRun, setSavingDryRun] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [copiedWriteup, setCopiedWriteup] = useState(false);
  const [copiedVerifyCmd, setCopiedVerifyCmd] = useState(false);
  const [showWriteupPreview, setShowWriteupPreview] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const syncedRunIdRef = useRef<string | undefined>(initialActive?.id);
  const latestChecklistRef = useRef<Record<string, boolean>>(buildChecklistState(initialActive));
  const lastConfirmedChecklistRef = useRef<Record<string, boolean>>(
    buildChecklistState(initialActive)
  );
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightSavesRef = useRef<number>(0);

  const saveTimerRef = useRef<number | undefined>(undefined);
  const copyWriteupTimerRef = useRef<number | undefined>(undefined);
  const copyVerifyTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (copyWriteupTimerRef.current) window.clearTimeout(copyWriteupTimerRef.current);
      if (copyVerifyTimerRef.current) window.clearTimeout(copyVerifyTimerRef.current);
    };
  }, []);

  const activeDryRun: EvalDryRun | undefined = useMemo(
    () => dryRuns.find((r) => r.id === activeDryRunId) || dryRuns[0],
    [dryRuns, activeDryRunId]
  );

  const prevDryRunsLenRef = useRef<number>(dryRuns.length);

  useEffect(() => {
    if (dryRuns.length === 0) {
      setShowCreateForm(true);
    } else if (prevDryRunsLenRef.current === 0) {
      setShowCreateForm(false);
    }
    prevDryRunsLenRef.current = dryRuns.length;
  }, [dryRuns.length]);

  const syncDryRunDraft = useCallback((run: EvalDryRun | undefined) => {
    syncedRunIdRef.current = run?.id;
    const nextChecklist = buildChecklistState(run);
    latestChecklistRef.current = nextChecklist;
    lastConfirmedChecklistRef.current = nextChecklist;
    if (!run) {
      setDraftWhatHelped("");
      setDraftWhereSteppedIn("");
      setDraftPreferredNotes("");
      setDraftChecklist({});
      setNotesOpen(false);
      return;
    }
    setDraftWhatHelped(run.what_helped || "");
    setDraftWhereSteppedIn(run.where_stepped_in || "");
    setDraftPreferredNotes(run.preferred_approach_notes || "");
    setDraftChecklist(nextChecklist);
    setNotesOpen(runHasNotes(run));
  }, []);

  useEffect(() => {
    if (syncedRunIdRef.current === activeDryRun?.id) return;
    syncDryRunDraft(activeDryRun);
    setSaveMessage(null);
    setDryRunError(null);
    setShowWriteupPreview(false);
    setConfirmDeleteId(null);
  }, [activeDryRun, syncDryRunDraft]);

  const fillSamplePlan = () => {
    setNewRepoName(DRY_RUN_SAMPLE_TEMPLATE.repo_name);
    setNewLicense(DRY_RUN_SAMPLE_TEMPLATE.license);
    setNewTaskType(DRY_RUN_SAMPLE_TEMPLATE.task_type);
    setNewGoal(DRY_RUN_SAMPLE_TEMPLATE.goal);
    setNewAc1(DRY_RUN_SAMPLE_TEMPLATE.ac1);
    setNewAc2(DRY_RUN_SAMPLE_TEMPLATE.ac2);
    setNewAc3(DRY_RUN_SAMPLE_TEMPLATE.ac3);
    setNewVerifyCmd(DRY_RUN_SAMPLE_TEMPLATE.verify_command);
    setCreateError(null);
  };

  const handleCreateDryRun = async (e: React.FormEvent) => {
    e.preventDefault();
    const repo = newRepoName.trim();
    const goal = newGoal.trim();
    if (!repo || !goal) {
      setCreateError("Add both a Repo / Project Name and a concise Task Goal to create your plan.");
      return;
    }
    if (!checksStep) {
      setCreateError(null);
      setChecksStep(true);
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
      setChecksStep(false);
      onDryRunsChange((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
      onSelectDryRunId(created.id);
      syncDryRunDraft(created);
      await onRefresh();
    } catch (err: any) {
      setCreateError(err?.message || "Could not create dry-run plan.");
    } finally {
      setCreatingDryRun(false);
    }
  };

  const persistDryRun = useCallback(
    (
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
      const nextChecklist = overrides?.checklist ?? latestChecklistRef.current;
      const allChecked = HYGIENE_ITEMS.every((item) => Boolean(nextChecklist[item.key]));
      const nextStatus = allChecked ? "completed" : "in_progress";
      const isChecklistUpdate = Boolean(overrides?.checklist);

      inFlightSavesRef.current += 1;
      setSavingDryRun(true);
      setDryRunError(null);

      const runTask = async () => {
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
          if (syncedRunIdRef.current === updated.id) {
            const confirmed = buildChecklistState(updated);
            lastConfirmedChecklistRef.current = confirmed;
            if (inFlightSavesRef.current === 1) {
              latestChecklistRef.current = confirmed;
              setDraftChecklist(confirmed);
            }
          }
          onDryRunsChange((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
          if (showSavedToast) {
            setSaveMessage(
              allChecked
                ? `Saved — all ${HYGIENE_ITEMS.length} pre-flight checks complete!`
                : "Progress saved"
            );
            if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = window.setTimeout(() => setSaveMessage(null), 2600);
          }
          await onRefresh();
        } catch (err: any) {
          if (isChecklistUpdate && syncedRunIdRef.current === run.id && inFlightSavesRef.current === 1) {
            const rollback = { ...lastConfirmedChecklistRef.current };
            latestChecklistRef.current = rollback;
            setDraftChecklist(rollback);
          }
          setDryRunError(err?.message || "Could not save dry-run progress.");
        } finally {
          inFlightSavesRef.current = Math.max(0, inFlightSavesRef.current - 1);
          setSavingDryRun(inFlightSavesRef.current > 0);
        }
      };

      saveQueueRef.current = saveQueueRef.current.then(runTask, runTask);
      return saveQueueRef.current;
    },
    [
      draftWhatHelped,
      draftWhereSteppedIn,
      draftPreferredNotes,
      onDryRunsChange,
      onRefresh,
    ]
  );

  const handleToggleChecklist = (key: string) => {
    if (!activeDryRun) return;
    const nextChecklist = {
      ...latestChecklistRef.current,
      [key]: !latestChecklistRef.current[key],
    };
    latestChecklistRef.current = nextChecklist;
    setDraftChecklist(nextChecklist);
    void persistDryRun(activeDryRun, { checklist: nextChecklist }, false);
  };

  const handleDeleteDryRun = async (runId: string) => {
    setDryRunError(null);
    setConfirmDeleteId(null);
    try {
      await api.deleteEvalDryRun(runId);
      const remaining = dryRuns.filter((r) => r.id !== runId);
      onDryRunsChange((prev) => prev.filter((r) => r.id !== runId));
      const nextActive = remaining[0];
      onSelectDryRunId(nextActive?.id || "");
      syncDryRunDraft(nextActive);
      if (remaining.length === 0) {
        setShowCreateForm(true);
      }
      await onRefresh();
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
      if (copyWriteupTimerRef.current) window.clearTimeout(copyWriteupTimerRef.current);
      copyWriteupTimerRef.current = window.setTimeout(() => setCopiedWriteup(false), 2400);
    } else {
      setShowWriteupPreview(true);
    }
  };

  const handleCopyVerifyCommand = async () => {
    if (!activeDryRun?.verify_command) return;
    const ok = await copyTextSafe(activeDryRun.verify_command);
    if (ok) {
      setCopiedVerifyCmd(true);
      if (copyVerifyTimerRef.current) window.clearTimeout(copyVerifyTimerRef.current);
      copyVerifyTimerRef.current = window.setTimeout(() => setCopiedVerifyCmd(false), 2000);
    }
  };

  const checkedHygieneCount = HYGIENE_ITEMS.filter((item) => Boolean(draftChecklist[item.key])).length;
  const hygienePct = Math.round((checkedHygieneCount / HYGIENE_ITEMS.length) * 100);
  const allHygienePassed = checkedHygieneCount === HYGIENE_ITEMS.length;

  const markdownPreview = useMemo(() => {
    if (!activeDryRun) return "";
    return buildDryRunMarkdown(activeDryRun, {
      what_helped: draftWhatHelped,
      where_stepped_in: draftWhereSteppedIn,
      preferred_approach_notes: draftPreferredNotes,
      checklist: draftChecklist,
    });
  }, [activeDryRun, draftWhatHelped, draftWhereSteppedIn, draftPreferredNotes, draftChecklist]);

  const isCreating = showCreateForm || dryRuns.length === 0;

  const step = isCreating ? (checksStep ? 1 : 0) : (reviewStep ? 3 : 2);
  useEffect(() => onStep(step), [onStep, step]);
  return (
    <section className="eval-section-stack" data-testid="eval-dryrun-workbench">
      {/* Compact Header Bar */}
      <div className="card eval-dryrun-topbar">
        <div>
          <small>Prep My Repo · {step + 1} of 4</small>
          <h3 className="eval-section-title">{["Scope the task", "Define acceptance checks", "Work through the checklist", "Review your write-up"][step]}</h3>
          <p className="eval-section-desc">
            Scope a real OSS task, pass all 6 pre-flight safety checks, and keep your session notes
            organized before starting live.
          </p>
        </div>
        {dryRuns.length > 0 && (
          <div className="eval-dryrun-top-actions">
            {isCreating ? (
              <button
                type="button"
                className="btn"
                data-testid="eval-dryrun-new-toggle"
                onClick={() => setShowCreateForm(false)}
              >
                <X size={15} aria-hidden="true" />
                <span>Back to Active Plan</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="eval-dryrun-new-toggle"
                onClick={() => setShowCreateForm(true)}
              >
                <Plus size={15} aria-hidden="true" />
                <span>New Dry-Run Plan</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Saved Dry-Run Switcher (shown only when switching between multiple plans) */}
      {dryRuns.length > 1 && !isCreating && (
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
                onClick={() => onSelectDryRunId(run.id)}
              >
                <span className="eval-dryrun-chip-repo">{run.repo_name}</span>
                <span className="eval-dryrun-chip-meta">
                  {run.license} · {doneChecks}/{HYGIENE_ITEMS.length} safe
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Mutually Exclusive View: Either Create Form OR Guided Active Workspace */}
      {isCreating ? (
        <form
          className="card eval-dryrun-form"
          data-testid="eval-dryrun-form"
          onSubmit={handleCreateDryRun}
        >
          <div hidden={checksStep} className="eval-dryrun-form-head row">
            <div>
              <h4>Scope a New Repo Task</h4>
              <p className="muted">
                Define one bounded change in a public MIT / Apache-2.0 repo and how you&apos;ll
                verify it locally.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              data-testid="eval-dryrun-fill-sample"
              onClick={fillSamplePlan}
            >
              <Sparkles size={13} aria-hidden="true" />
              <span>Fill Sample</span>
            </button>
          </div>

          <div hidden={checksStep} className="eval-dryrun-form-group">
            <span className="eval-group-kicker">1. Repo &amp; Goal</span>
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
          </div>

          <div hidden={!checksStep} className="eval-dryrun-form-group">
            <span className="eval-group-kicker">2. How You&apos;ll Verify It (Optional)</span>
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

            <div className="eval-criteria-inputs">
              <span className="eval-criteria-inputs-label">
                Acceptance Criteria <span className="muted">(up to 3 concrete pass/fail checks)</span>
              </span>
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
              <span>{!checksStep ? "Define acceptance checks" : creatingDryRun ? "Creating Plan…" : "Create Dry-Run Plan"}</span>
            </button>
            {checksStep && <button type="button" className="btn" onClick={() => setChecksStep(false)}>Back</button>}
            {dryRuns.length > 0 && (
              <button type="button" className="btn" onClick={() => setShowCreateForm(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        activeDryRun && (
          <article className="card eval-dryrun-active" data-testid="eval-dryrun-active">
            {/* Step 1 · Scoped Task & Verify Command */}
            <div className="eval-dryrun-header">
              <div className="eval-dryrun-title-block">
                <div className="eval-brief-badges">
                  <span className="eval-step-badge">1</span>
                  <span className="eval-lang-badge">{activeDryRun.license}</span>
                  <span className="eval-diff-badge">{activeDryRun.task_type}</span>
                  <span
                    className={`eval-hygiene-status ${allHygienePassed ? "ready" : ""}`}
                  >
                    {allHygienePassed
                      ? "Ready to Submit ✓"
                      : `${checkedHygieneCount}/${HYGIENE_ITEMS.length} Pre-Flight`}
                  </span>
                </div>
                <h4>{activeDryRun.repo_name}</h4>
                <p className="eval-dryrun-goal">
                  <RichText text={activeDryRun.goal} />
                </p>
              </div>

              {confirmDeleteId === activeDryRun.id ? (
                <div className="eval-delete-confirm">
                  <button
                    type="button"
                    className="btn btn-sm eval-delete-btn"
                    data-testid="eval-dryrun-confirm-delete-btn"
                    onClick={() => handleDeleteDryRun(activeDryRun.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span>Confirm Delete</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm eval-delete-btn"
                  data-testid="eval-dryrun-delete-btn"
                  onClick={() => setConfirmDeleteId(activeDryRun.id)}
                  aria-label={`Delete dry-run plan for ${activeDryRun.repo_name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  <span>Delete</span>
                </button>
              )}
            </div>

            {dryRunError && (
              <div className="feedback-box err" role="alert">
                {dryRunError}
              </div>
            )}

            <div hidden={reviewStep} className="eval-dryrun-meta-grid">
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

            {/* Step 2 · 6-Point Pre-Flight Safety Checklist */}
            <div hidden={reviewStep} className="eval-hygiene-section" data-testid="eval-hygiene-checklist">
              <div className="eval-hygiene-head">
                <div className="eval-form-step-head">
                  <span className="eval-step-badge">2</span>
                  <h4>
                    <ShieldCheck size={15} aria-hidden="true" /> 6-Point Pre-Flight Hygiene
                  </h4>
                </div>
                <span className="eval-hygiene-counter">
                  {checkedHygieneCount}/{HYGIENE_ITEMS.length} verified
                </span>
              </div>

              <div
                className="progress-track eval-hygiene-progress"
                role="progressbar"
                aria-label="Pre-flight hygiene checklist progress"
                aria-valuenow={hygienePct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="progress-fill eval-confidence-fill"
                  style={{ width: `${hygienePct}%` }}
                />
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
                        <small>
                          <RichText text={item.hint} />
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <button className="btn" onClick={() => {
              setReviewStep(!reviewStep);
              if (!reviewStep) { setNotesOpen(true); setShowWriteupPreview(true); }
            }}>{reviewStep ? "Back to checklist" : "Review write-up"}</button>
            {/* Step 3 · Session Notes & Markdown Export (Tidy Collapsible Drawer) */}
            <details
              className="eval-examples-details"
              hidden={!reviewStep} data-testid="eval-dryrun-notes-drawer"
              open={notesOpen}
            >
              <summary
                className="eval-step3-summary"
                onClick={(e) => {
                  e.preventDefault();
                  setNotesOpen((prev) => !prev);
                }}
              >
                <span className="eval-form-step-head">
                  <span className="eval-step-badge">3</span>
                  <span>
                    <MessageSquare size={14} aria-hidden="true" /> Session Notes &amp; Markdown
                    Export
                  </span>
                  {allHygienePassed && !notesOpen && (
                    <span className="eval-linter-pill ok">Ready — click to log notes</span>
                  )}
                </span>
                <ChevronDown size={15} className="eval-drawer-chevron" aria-hidden="true" />
              </summary>
              <div className="eval-examples-body">
                <div className="eval-observation-grid">
                  <div className="eval-field-group">
                    <label htmlFor="dryrun-what-helped">What helped me move faster</label>
                    <textarea
                      id="dryrun-what-helped"
                      className="eval-textarea"
                      rows={3}
                      value={draftWhatHelped}
                      onChange={(e) => setDraftWhatHelped(e.target.value)}
                      placeholder="Where did the assistant save real engineering time?"
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
                      placeholder="What edge cases, assumptions, or test issues needed steering?"
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
                      placeholder="Summarize your preference citing transcript quotes and test runs..."
                    />
                  </div>
                </div>

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
              </div>
            </details>
          </article>
        )
      )}
    </section>
  );
}
