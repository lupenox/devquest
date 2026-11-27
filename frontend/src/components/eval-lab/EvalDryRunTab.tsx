import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  HYGIENE_ITEMS,
  LICENSE_OPTIONS,
  TASK_TYPE_OPTIONS,
} from "./evalLabConstants";

interface EvalDryRunTabProps {
  dryRuns: EvalDryRun[];
  activeDryRunId: string;
  onSelectDryRunId: (id: string) => void;
  onDryRunsChange: (runs: EvalDryRun[]) => void;
  onRefresh: () => Promise<void>;
}

export function EvalDryRunTab({
  dryRuns,
  activeDryRunId,
  onSelectDryRunId,
  onDryRunsChange,
  onRefresh,
}: EvalDryRunTabProps) {
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

  // Active dry-run draft
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

  const activeDryRun: EvalDryRun | undefined = useMemo(
    () => dryRuns.find((r) => r.id === activeDryRunId) || dryRuns[0],
    [dryRuns, activeDryRunId]
  );

  useEffect(() => {
    if (dryRuns.length === 0) {
      setShowCreateForm(true);
    }
  }, [dryRuns.length]);

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

  useEffect(() => {
    syncDryRunDraft(activeDryRun);
    setSaveMessage(null);
    setDryRunError(null);
    setShowWriteupPreview(false);
  }, [activeDryRun?.id, syncDryRunDraft]);

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
      onDryRunsChange([created, ...dryRuns.filter((r) => r.id !== created.id)]);
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
        onDryRunsChange(dryRuns.map((r) => (r.id === updated.id ? updated : r)));
        if (showSavedToast) {
          setSaveMessage(
            allChecked
              ? `Saved — all ${HYGIENE_ITEMS.length} pre-flight checks complete!`
              : "Progress saved"
          );
          window.setTimeout(() => setSaveMessage(null), 2600);
        }
        await onRefresh();
      } catch (err: any) {
        setDryRunError(err?.message || "Could not save dry-run progress.");
      } finally {
        setSavingDryRun(false);
      }
    },
    [
      draftWhatHelped,
      draftWhereSteppedIn,
      draftPreferredNotes,
      draftChecklist,
      dryRuns,
      onDryRunsChange,
      onRefresh,
    ]
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
      onDryRunsChange(remaining);
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

  const isCreating = showCreateForm || dryRuns.length === 0;

  return (
    <section className="eval-section-stack" data-testid="eval-dryrun-workbench">
      {/* Compact Header Bar */}
      <div className="card eval-dryrun-topbar">
        <div>
          <h3 className="eval-section-title">Prep My Repo (Dry-Run Workbench)</h3>
          <p className="eval-section-desc">
            Scope a real OSS task, pass all 6 pre-flight safety checks, and keep your session notes
            organized before starting live.
          </p>
        </div>
        <div className="eval-dryrun-top-actions">
          {isCreating && dryRuns.length > 0 ? (
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
      </div>

      {/* Saved Dry-Run Switcher */}
      {dryRuns.length > 0 && !isCreating && (
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
          <div className="eval-dryrun-form-head">
            <h4>Scope a New Repo Task</h4>
            <p className="muted">
              Define one bounded change in a public MIT / Apache-2.0 repo and how you&apos;ll verify
              it locally.
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
                  <span className="eval-step-badge">Step 1 · Scope</span>
                  <span className="eval-lang-badge">{activeDryRun.license}</span>
                  <span className="eval-diff-badge">{activeDryRun.task_type}</span>
                  <span
                    className={`eval-hygiene-status ${
                      checkedHygieneCount === HYGIENE_ITEMS.length ? "ready" : ""
                    }`}
                  >
                    {checkedHygieneCount === HYGIENE_ITEMS.length
                      ? "Ready to Submit ✓"
                      : `${checkedHygieneCount}/${HYGIENE_ITEMS.length} Pre-Flight`}
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

            {/* Step 2 · 6-Point Pre-Flight Safety Checklist */}
            <div className="eval-hygiene-section" data-testid="eval-hygiene-checklist">
              <div className="eval-hygiene-head">
                <div className="eval-form-step-head">
                  <span className="eval-step-badge">Step 2 · Safety</span>
                  <h4>
                    <ShieldCheck size={15} aria-hidden="true" /> 6-Point Pre-Flight Hygiene
                  </h4>
                </div>
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

            {/* Step 3 · Session Notes & Markdown Export (Collapsible Drawer) */}
            <details className="eval-examples-details" open>
              <summary className="eval-step3-summary">
                <span className="eval-form-step-head">
                  <span className="eval-step-badge">Step 3 · Notes</span>
                  <span>
                    <MessageSquare size={14} aria-hidden="true" /> Session Observation Log &amp;
                    Export
                  </span>
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
              </div>
            </details>
          </article>
        )
      )}
    </section>
  );
}
