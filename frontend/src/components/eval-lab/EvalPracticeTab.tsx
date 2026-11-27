import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  Code2,
  Copy,
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Plus,
  Quote,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { api } from "../../api";
import type {
  AxisRatingInput,
  BehavioralAxisDef,
  BehavioralAxisSlug,
  EvalChoice,
  EvalLabOverview,
  EvalScenario,
  EvalSubmitResp,
  ForcedChoiceRating,
  TranscriptLine,
} from "../../types";
import { HighlightedCode, RichText } from "../RichText";
import {
  AXIS_SHORT_HINTS,
  CHOICE_OPTIONS,
  countSentences,
  copyTextSafe,
  emptyAxisRatings,
  extractCitedLines,
  FORCED_CHOICE_A_OPTIONS,
  FORCED_CHOICE_B_OPTIONS,
  FORCED_CHOICE_LABEL_MAP,
  formatDifficulty,
  formatLangLabel,
  formatRoleLabel,
  hasTranscriptQuote,
  humanizeSlug,
  normalizeHighlightLang,
  type EvidenceViewMode,
  type PracticeMode,
} from "./evalLabConstants";

interface ScenarioDraft {
  evidenceView: EvidenceViewMode;
  choice: EvalChoice | null;
  spottedTags: string[];
  rationale: string;
  followupPrompt: string;
  showFollowupInQuick: boolean;
  axisRatings: Record<string, AxisRatingInput>;
  decidingAxes: string[];
  seniorEngineerNote: string;
  overallSummary: string;
  otherIssues: string;
}

function createEmptyScenarioDraft(
  scenario: EvalScenario | undefined,
  behavioralAxes: BehavioralAxisDef[]
): ScenarioDraft {
  const hasT = Boolean(
    scenario?.transcript_a &&
      scenario.transcript_a.length > 0 &&
      scenario?.transcript_b &&
      scenario.transcript_b.length > 0
  );
  return {
    evidenceView: hasT ? "transcripts" : "codediff",
    choice: null,
    spottedTags: [],
    rationale: "",
    followupPrompt: "",
    showFollowupInQuick: false,
    axisRatings: emptyAxisRatings(behavioralAxes),
    decidingAxes: [],
    seniorEngineerNote: "",
    overallSummary: "",
    otherIssues: "",
  };
}

interface EvalPracticeTabProps {
  onStep: (step: number) => void;
  scenarios: EvalScenario[];
  behavioralAxes: BehavioralAxisDef[];
  activeScenarioId: string;
  practiceMode?: PracticeMode;
  onChangePracticeMode?: (mode: PracticeMode) => void;
  onSelectScenarioId: (id: string) => void;
  onCalibrated: (overview: EvalLabOverview | undefined) => void;
  onOpenDryRun: () => void;
}

export function EvalPracticeTab({
  scenarios,
  behavioralAxes,
  activeScenarioId, onStep,
  practiceMode: controlledMode,
  onChangePracticeMode,
  onSelectScenarioId,
  onCalibrated,
  onOpenDryRun,
}: EvalPracticeTabProps) {
  const [steps, setSteps] = useState<Record<string, number>>({});
  const step = steps[activeScenarioId] ?? 0;
  const [side, setSide] = useState("a");
  const [openEvidenceId, setOpenEvidenceId] = useState("");
  const go = (next: number) => setSteps(prev => ({...prev, [activeScenarioId]: next}));
  useEffect(() => onStep(step), [onStep, step]);
  const [localPracticeMode, setLocalPracticeMode] = useState<PracticeMode>("quick");
  const practiceMode = controlledMode ?? localPracticeMode;
  const setPracticeMode = (next: PracticeMode) => {
    setLocalPracticeMode(next);
    onChangePracticeMode?.(next);
  };

  // Per-scenario unsaved drafts keyed by scenario.id so switching scenarios preserves edits
  const [draftsByScenario, setDraftsByScenario] = useState<Record<string, ScenarioDraft>>({});
  const [axisMatrixOpen, setAxisMatrixOpen] = useState(true);
  const [decidingWarn, setDecidingWarn] = useState<string | null>(null);
  const [quoteTargetState, setQuoteTargetState] = useState<{ scenarioId: string; target: string }>({
    scenarioId: "",
    target: "rationale",
  });
  const [quotedFlash, setQuotedFlash] = useState<{ scenarioId: string; text: string } | null>(null);

  const [submittingByScenario, setSubmittingByScenario] = useState<Record<string, boolean>>({});
  const [submitErrorByScenario, setSubmitErrorByScenario] = useState<Record<string, string>>({});
  const [resultsByScenario, setResultsByScenario] = useState<Record<string, EvalSubmitResp & { submittedChoice: EvalChoice }>>({});
  const [submittedModeByScenario, setSubmittedModeByScenario] = useState<
    Record<string, PracticeMode>
  >({});
  const [copiedFollowup, setCopiedFollowup] = useState(false);

  const calibrationRef = useRef<HTMLDivElement>(null);
  const choiceButtonRefs = useRef<Partial<Record<EvalChoice, HTMLButtonElement | null>>>({});
  const quoteFlashTimer = useRef<number | undefined>(undefined);
  const copiedFollowupTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (quoteFlashTimer.current) window.clearTimeout(quoteFlashTimer.current);
      if (copiedFollowupTimer.current) window.clearTimeout(copiedFollowupTimer.current);
    };
  }, []);

  const activeScenario: EvalScenario | undefined = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) || scenarios[0],
    [scenarios, activeScenarioId]
  );
  const activeId = activeScenario?.id || "";
  const activeIdRef = useRef<string>(activeId);
  activeIdRef.current = activeId;

  const fallbackDraft = useMemo(
    () => createEmptyScenarioDraft(activeScenario, behavioralAxes),
    [activeScenario, behavioralAxes]
  );
  const activeDraft = (activeId && draftsByScenario[activeId]) || fallbackDraft;
  const {
    evidenceView,
    choice,
    spottedTags,
    rationale,
    followupPrompt,
    showFollowupInQuick,
    axisRatings,
    decidingAxes,
    seniorEngineerNote,
    overallSummary,
    otherIssues,
  } = activeDraft;

  const updateActiveDraft = (updater: (draft: ScenarioDraft) => ScenarioDraft) => {
    if (!activeId) return;
    setDraftsByScenario((prev) => {
      const current = prev[activeId] || createEmptyScenarioDraft(activeScenario, behavioralAxes);
      return {
        ...prev,
        [activeId]: updater(current),
      };
    });
  };

  const setEvidenceView = (next: EvidenceViewMode) =>
    updateActiveDraft((d) => ({ ...d, evidenceView: next }));
  const setChoice = (next: EvalChoice | null) =>
    updateActiveDraft((d) => ({ ...d, choice: next }));
  const setRationale = (next: string) => updateActiveDraft((d) => ({ ...d, rationale: next }));
  const setFollowupPrompt = (next: string) =>
    updateActiveDraft((d) => ({ ...d, followupPrompt: next }));
  const setShowFollowupInQuick = (next: boolean) =>
    updateActiveDraft((d) => ({ ...d, showFollowupInQuick: next }));
  const setSeniorEngineerNote = (next: string) =>
    updateActiveDraft((d) => ({ ...d, seniorEngineerNote: next }));
  const setOverallSummary = (next: string) =>
    updateActiveDraft((d) => ({ ...d, overallSummary: next }));
  const setOtherIssues = (next: string) =>
    updateActiveDraft((d) => ({ ...d, otherIssues: next }));

  const submittingScenario = Boolean(activeId && submittingByScenario[activeId]);
  const submitError = (activeId && submitErrorByScenario[activeId]) || null;
  const setScenarioSubmitError = (scenarioId: string, msg: string | null) => {
    if (!scenarioId) return;
    setSubmitErrorByScenario((prev) => {
      if (msg === null) {
        if (!(scenarioId in prev)) return prev;
        const { [scenarioId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [scenarioId]: msg };
    });
  };

  const rawQuoteTarget =
    quoteTargetState.scenarioId === activeId ? quoteTargetState.target : "rationale";
  const activeQuoteTarget = useMemo(() => {
    if (practiceMode === "quick") return "rationale";
    if (rawQuoteTarget.startsWith("axis:")) {
      if (!axisMatrixOpen) return "rationale";
      const slug = rawQuoteTarget.slice(5);
      const entry = axisRatings[slug];
      const hasSideRating = Boolean(
        entry?.rating && (entry.rating.startsWith("a_") || entry.rating.startsWith("b_"))
      );
      const hasNote = Boolean(entry?.note?.trim());
      if (!hasSideRating && !hasNote) return "rationale";
    }
    return rawQuoteTarget;
  }, [practiceMode, rawQuoteTarget, axisMatrixOpen, axisRatings]);
  const setActiveQuoteTarget = (target: string) =>
    setQuoteTargetState({ scenarioId: activeId, target });

  // Clear transient UI feedback & reset quote target whenever the selected scenario changes
  const prevScenarioIdRef = useRef<string>(activeId);
  useEffect(() => {
    if (!activeId || activeId === prevScenarioIdRef.current) return;
    prevScenarioIdRef.current = activeId;
    setDecidingWarn(null);
    setQuoteTargetState({ scenarioId: activeId, target: "rationale" });
    setQuotedFlash(null);
    if (quoteFlashTimer.current) {
      window.clearTimeout(quoteFlashTimer.current);
      quoteFlashTimer.current = undefined;
    }
    if (copiedFollowupTimer.current) {
      window.clearTimeout(copiedFollowupTimer.current);
      copiedFollowupTimer.current = undefined;
    }
    setCopiedFollowup(false);
  }, [activeId]);

  // Persist sanitized quote target so re-expanding a collapsed matrix or re-rating an axis never revives a stale target
  useEffect(() => {
    if (
      activeId &&
      (quoteTargetState.scenarioId !== activeId || quoteTargetState.target !== activeQuoteTarget)
    ) {
      setQuoteTargetState({ scenarioId: activeId, target: activeQuoteTarget });
    }
  }, [activeId, quoteTargetState.scenarioId, quoteTargetState.target, activeQuoteTarget]);

  const activeResult = activeScenario ? resultsByScenario[activeScenario.id] : undefined;
  const activeScenarioIdx = activeScenario
    ? scenarios.findIndex((s) => s.id === activeScenario.id)
    : -1;
  const nextScenario =
    activeScenarioIdx >= 0 && activeScenarioIdx + 1 < scenarios.length
      ? scenarios[activeScenarioIdx + 1]
      : null;

  const hasTranscripts = Boolean(
    activeScenario?.transcript_a &&
      activeScenario.transcript_a.length > 0 &&
      activeScenario?.transcript_b &&
      activeScenario.transcript_b.length > 0
  );
  const effectiveEvidenceView: EvidenceViewMode = hasTranscripts ? evidenceView : "codediff";

  // Live write-up linters
  const seniorMentionsModelAB = /\bmodel\s*[ab]\b/i.test(seniorEngineerNote);
  const overallSentenceCount = countSentences(overallSummary);
  const overallSentenceOk = overallSentenceCount >= 5 && overallSentenceCount <= 7;
  const overallNamesBothModels =
    /\bmodel\s*a\b/i.test(overallSummary) && /\bmodel\s*b\b/i.test(overallSummary);
  const visibleWriteupText = useMemo(() => {
    if (practiceMode === "quick") {
      return rationale;
    }
    const axisNotes = Object.values(axisRatings)
      .map((a) => a.note)
      .join(" ");
    return `${rationale} ${overallSummary} ${axisNotes}`;
  }, [practiceMode, rationale, overallSummary, axisRatings]);
  const quoteDetected = hasTranscriptQuote(visibleWriteupText);
  const citedLines = useMemo(() => extractCitedLines(visibleWriteupText), [visibleWriteupText]);
  const ratedAxesCount = Object.values(axisRatings).filter((a) => Boolean(a.rating)).length;
  const hasAnyAxisNote = Object.values(axisRatings).some((a) => Boolean(a.note.trim()));
  const unratedAxesCount = behavioralAxes.filter((ax) => !axisRatings[ax.slug]?.rating).length;

  const quoteTargetLabel = useMemo(() => {
    if (activeQuoteTarget === "overall") return "Overall Verdict";
    if (activeQuoteTarget.startsWith("axis:")) {
      const slug = activeQuoteTarget.slice(5);
      const ax = behavioralAxes.find((a) => a.slug === slug);
      return `${ax?.label || humanizeSlug(slug)} note`;
    }
    return "Your Critique";
  }, [activeQuoteTarget, behavioralAxes]);

  const tagLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (activeScenario) {
      for (const t of activeScenario.available_tags) {
        map[t.slug] = t.label;
      }
    }
    return map;
  }, [activeScenario]);

  const toggleTag = (slug: string) => {
    updateActiveDraft((d) => ({
      ...d,
      spottedTags: d.spottedTags.includes(slug)
        ? d.spottedTags.filter((item) => item !== slug)
        : [...d.spottedTags, slug],
    }));
  };

  const updateAxisRating = (slug: BehavioralAxisSlug, rating: ForcedChoiceRating | "") => {
    const currentNote = axisRatings[slug]?.note || "";
    const clearsAxis = !rating || rating === "na";
    const removedDeciding = clearsAxis && decidingAxes.includes(slug);
    updateActiveDraft((d) => ({
      ...d,
      axisRatings: {
        ...d.axisRatings,
        [slug]: { rating, note: d.axisRatings[slug]?.note || "" },
      },
      decidingAxes: clearsAxis
        ? d.decidingAxes.filter((item) => item !== slug)
        : d.decidingAxes,
    }));
    if (removedDeciding) {
      setDecidingWarn(null);
    }
    if (clearsAxis && activeQuoteTarget === `axis:${slug}` && !currentNote.trim()) {
      setActiveQuoteTarget("rationale");
    }
  };

  const handleChoiceKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIdx: number) => {
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIdx = (currentIdx + 1) % CHOICE_OPTIONS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIdx = (currentIdx - 1 + CHOICE_OPTIONS.length) % CHOICE_OPTIONS.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = CHOICE_OPTIONS.length - 1;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const target = CHOICE_OPTIONS[nextIdx];
      setChoice(target.value);
      setScenarioSubmitError(activeId, null);
      choiceButtonRefs.current[target.value]?.focus();
    }
  };

  const updateAxisNote = (slug: BehavioralAxisSlug, note: string) => {
    updateActiveDraft((d) => ({
      ...d,
      axisRatings: {
        ...d.axisRatings,
        [slug]: { rating: d.axisRatings[slug]?.rating || "", note },
      },
    }));
  };

  const markUnratedAxesNa = () => {
    updateActiveDraft((d) => {
      const next = { ...d.axisRatings };
      for (const ax of behavioralAxes) {
        const cur = next[ax.slug] || { rating: "", note: "" };
        if (!cur.rating) {
          next[ax.slug] = { ...cur, rating: "na" };
        }
      }
      return { ...d, axisRatings: next };
    });
  };

  const resetAllAxes = () => {
    updateActiveDraft((d) => ({
      ...d,
      axisRatings: emptyAxisRatings(behavioralAxes),
      decidingAxes: [],
    }));
    setDecidingWarn(null);
    if (activeQuoteTarget.startsWith("axis:")) {
      setActiveQuoteTarget("rationale");
    }
  };

  const toggleDecidingAxis = (slug: string) => {
    if (decidingAxes.includes(slug)) {
      setDecidingWarn(null);
      updateActiveDraft((d) => ({
        ...d,
        decidingAxes: d.decidingAxes.filter((a) => a !== slug),
      }));
      return;
    }
    if (decidingAxes.length >= 2) {
      setDecidingWarn("Pick at most 2 deciding axes — unselect one before adding another.");
      return;
    }
    setDecidingWarn(null);
    updateActiveDraft((d) => {
      if (d.decidingAxes.includes(slug) || d.decidingAxes.length >= 2) return d;
      return {
        ...d,
        decidingAxes: [...d.decidingAxes, slug],
      };
    });
  };

  const insertTranscriptQuote = (item: TranscriptLine) => {
    const cleanText = item.text.replace(/\s+/g, " ").trim();
    const snippet = cleanText.length > 140 ? `${cleanText.slice(0, 137).trimEnd()}...` : cleanText;
    const quoted = `"[${item.line}] ${snippet}"`;
    const scenarioId = activeScenario?.id || "";

    if (activeQuoteTarget === "overall") {
      updateActiveDraft((d) => ({
        ...d,
        overallSummary: d.overallSummary.trim() ? `${d.overallSummary.trimEnd()} ${quoted}` : quoted,
      }));
      setQuotedFlash({ scenarioId, text: `Quoted [${item.line}] into Overall Verdict` });
    } else if (activeQuoteTarget.startsWith("axis:")) {
      const slug = activeQuoteTarget.slice(5) as BehavioralAxisSlug;
      updateActiveDraft((d) => {
        const cur = d.axisRatings[slug]?.note || "";
        return {
          ...d,
          axisRatings: {
            ...d.axisRatings,
            [slug]: {
              rating: d.axisRatings[slug]?.rating || "",
              note: cur.trim() ? `${cur.trimEnd()} ${quoted}` : quoted,
            },
          },
        };
      });
      const label = behavioralAxes.find((a) => a.slug === slug)?.label || humanizeSlug(slug);
      setQuotedFlash({ scenarioId, text: `Quoted [${item.line}] into ${label} note` });
    } else {
      updateActiveDraft((d) => ({
        ...d,
        rationale: d.rationale.trim() ? `${d.rationale.trimEnd()} ${quoted}` : quoted,
      }));
      setQuotedFlash({ scenarioId, text: `Quoted [${item.line}] into Your Critique` });
    }

    if (quoteFlashTimer.current) window.clearTimeout(quoteFlashTimer.current);
    quoteFlashTimer.current = window.setTimeout(() => setQuotedFlash(null), 2400);
  };

  const handleSubmitScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeScenario) return;
    const submittedScenarioId = activeScenario.id;
    if (submittingByScenario[submittedScenarioId]) return;
    if (!choice) {
      setScenarioSubmitError(
        submittedScenarioId,
        "Pick who handled this better in Step 1 before calibrating."
      );
      return;
    }
    setSubmittingByScenario((prev) => ({ ...prev, [submittedScenarioId]: true }));
    setScenarioSubmitError(submittedScenarioId, null);

    const isFullSubmit = practiceMode === "full";
    const populatedAxes: Record<string, AxisRatingInput> = {};
    if (isFullSubmit) {
      for (const [slug, val] of Object.entries(axisRatings)) {
        if (val && (val.rating || val.note.trim())) {
          populatedAxes[slug] = { rating: val.rating, note: val.note.trim() };
        }
      }
    }

    // Only allow deciding axes that actually favor Model A or Model B
    const validDecidingAxes = isFullSubmit
      ? decidingAxes.filter((slug) => {
          const r = axisRatings[slug]?.rating || "";
          return r.startsWith("a_") || r.startsWith("b_");
        })
      : [];

    try {
      const resp = await api.submitEvalScenario(submittedScenarioId, {
        choice,
        spotted_tags: spottedTags,
        rationale: rationale.trim(),
        followup_prompt: followupPrompt.trim(),
        ...(isFullSubmit && Object.keys(populatedAxes).length > 0
          ? { axis_ratings: populatedAxes }
          : {}),
        ...(validDecidingAxes.length > 0 ? { deciding_axes: validDecidingAxes } : {}),
        ...(isFullSubmit && seniorEngineerNote.trim()
          ? { senior_engineer_note: seniorEngineerNote.trim() }
          : {}),
        ...(isFullSubmit && overallSummary.trim()
          ? { overall_summary: overallSummary.trim() }
          : {}),
        ...(isFullSubmit && otherIssues.trim() ? { other_issues: otherIssues.trim() } : {}),
      });
      setResultsByScenario((prev) => ({ ...prev, [submittedScenarioId]: { ...resp, submittedChoice: choice } }));
      setSubmittedModeByScenario((prev) => ({ ...prev, [submittedScenarioId]: practiceMode }));
      onCalibrated(resp.overview);
      setSteps(prev => ({...prev, [submittedScenarioId]: 3}));
    } catch (err: any) {
      setScenarioSubmitError(
        submittedScenarioId,
        err?.message || "Could not submit your scenario review."
      );
    } finally {
      setSubmittingByScenario((prev) => {
        const { [submittedScenarioId]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const seniorRefExample =
    activeResult?.senior_engineer_example || activeScenario?.senior_engineer_example || "";
  const overallRefExample = activeResult?.overall_example || activeScenario?.overall_example || "";
  const resultHasDeepData = Boolean(
    activeResult &&
      ((activeScenario && submittedModeByScenario[activeScenario.id] === "full") ||
        activeResult.axis_calibration?.some((row) => Boolean(row.user_rating)))
  );
  const showDeepCalibrationOpen = resultHasDeepData || practiceMode === "full";
  const showFollowupBox =
    practiceMode === "full" || showFollowupInQuick || Boolean(followupPrompt.trim());

  return (
    <section className="eval-section-stack">
      {activeScenario && (
        <div className="eval-section-stack" data-testid="eval-scenario-active">
          <div className="lab-chapter" aria-live="polite">
            <small>Practice · {step + 1} of 4</small>
            <h3>{["Scenario brief", "Compare responses", "Give your verdict", "Review feedback"][step]}</h3>
            <div className="lab-actions">
              {step > 0 && <button className="btn" onClick={() => go(step - 1)}>Back</button>}
              {step < 2 && <button className="btn btn-primary" onClick={() => go(step + 1)}>{step ? "Give verdict" : "Compare responses"}</button>}
              {step === 2 && activeResult && <button className="btn" onClick={() => go(3)}>View last feedback</button>}
              {step === 2 && <button className="btn" aria-expanded={openEvidenceId === activeScenarioId}
                onClick={() => setOpenEvidenceId(openEvidenceId === activeScenarioId ? "" : activeScenarioId)}>
                {openEvidenceId === activeScenarioId ? "Close evidence" : "Reopen evidence"}
              </button>}
            </div>
          </div>
          {/* 2. Clean Mission Brief */}
          <div hidden={step !== 0} className="card eval-brief-card compact">
            <div className="eval-brief-top">
              <div className="eval-brief-heading-wrap">
                <h3 className="eval-scenario-heading">{activeScenario.title}</h3>
                <div className="eval-brief-submeta">
                  <span>{formatLangLabel(activeScenario.language)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDifficulty(activeScenario.difficulty)}</span>
                  <span aria-hidden="true">·</span>
                  <span>~{activeScenario.estimated_minutes} min</span>
                  {activeScenario.completed && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="eval-calibrated-inline">
                        <CheckCircle2 size={12} aria-hidden="true" />
                        Calibrated
                        {typeof activeScenario.best_score === "number"
                          ? ` (${activeScenario.best_score}/100)`
                          : ""}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="eval-brief-two-col">
              <div className="eval-brief-box">
                <h4>
                  <FileText size={13} aria-hidden="true" /> Context &amp; Task Prompt
                </h4>
                <p className="eval-context-line">
                  <RichText text={activeScenario.context} />
                </p>
                <div className="eval-prompt-quote">
                  <strong>Prompt sent to both models:</strong>{" "}
                  <RichText text={activeScenario.task_prompt} />
                </div>
              </div>

              <div className="eval-criteria-box">
                <h4>
                  <ListChecks size={13} aria-hidden="true" /> Acceptance Criteria
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
          </div>

          {/* 3. Unified Evidence Toolbar + Side-by-Side Model A vs Model B */}
          <div hidden={step !== 1 && !(step === 2 && openEvidenceId === activeScenarioId)} className="eval-evidence-block" data-model={side}>
            <div className="lab-model-switch" role="group" aria-label="Visible model">
              {["a", "b"].map(model => <button className="btn" key={model} aria-pressed={side === model}
                onClick={() => setSide(model)}>Model {model.toUpperCase()}</button>)}
            </div>
            <div className="eval-evidence-toolbar">
              {hasTranscripts && (
                <div
                  className="eval-view-toggle"
                  data-testid="eval-view-toggle"
                  role="group"
                  aria-label="Evidence display mode"
                >
                  <button
                    type="button"
                    className={`eval-view-btn ${
                      effectiveEvidenceView === "transcripts" ? "active" : ""
                    }`}
                    data-testid="eval-view-transcripts"
                    aria-pressed={effectiveEvidenceView === "transcripts"}
                    onClick={() => setEvidenceView("transcripts")}
                  >
                    <MessageSquare size={14} aria-hidden="true" />
                    <span>Transcripts</span>
                  </button>
                  <button
                    type="button"
                    className={`eval-view-btn ${
                      effectiveEvidenceView === "codediff" ? "active" : ""
                    }`}
                    data-testid="eval-view-codediff"
                    aria-pressed={effectiveEvidenceView === "codediff"}
                    onClick={() => setEvidenceView("codediff")}
                  >
                    <Code2 size={14} aria-hidden="true" />
                    <span>Code Diff</span>
                  </button>
                </div>
              )}

              {effectiveEvidenceView === "transcripts" && hasTranscripts && (
                <div className="eval-quote-bar-inline" data-testid="eval-quote-target-bar">
                  <Quote size={13} aria-hidden="true" />
                  {practiceMode === "quick" ? (
                    <span>
                      Click any transcript line to quote into <strong>Your Critique</strong>
                    </span>
                  ) : (
                    <div className="eval-quote-hint-left">
                      <span>Click any line to quote into:</span>
                      <div className="eval-quote-targets" role="group" aria-label="Quote destination">
                        <button
                          type="button"
                          className={`eval-quote-target-btn ${
                            activeQuoteTarget === "rationale" ? "active" : ""
                          }`}
                          onClick={() => setActiveQuoteTarget("rationale")}
                        >
                          Your Critique
                        </button>
                        <button
                          type="button"
                          className={`eval-quote-target-btn ${
                            activeQuoteTarget === "overall" ? "active" : ""
                          }`}
                          onClick={() => setActiveQuoteTarget("overall")}
                        >
                          Overall Verdict
                        </button>
                        {activeQuoteTarget.startsWith("axis:") && (
                          <span className="eval-quote-target-btn active">{quoteTargetLabel}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {quotedFlash && quotedFlash.scenarioId === activeScenario.id && (
                    <span className="eval-quoted-flash" role="status">
                      <Check size={13} aria-hidden="true" />
                      {quotedFlash.text}
                    </span>
                  )}
                </div>
              )}
            </div>

            {effectiveEvidenceView === "transcripts" && hasTranscripts ? (
              <div className="eval-ab-grid" data-testid="eval-transcripts-grid">
                {(
                  [
                    {
                      side: "a",
                      modelLabel: "Model A",
                      approach: activeScenario.approach_a,
                      lines: activeScenario.transcript_a || [],
                    },
                    {
                      side: "b",
                      modelLabel: "Model B",
                      approach: activeScenario.approach_b,
                      lines: activeScenario.transcript_b || [],
                    },
                  ] as const
                ).map(({ side, modelLabel, approach, lines }) => (
                  <article
                    key={side}
                    className={`card eval-approach-card eval-transcript-card side-${side}`}
                    data-testid={`eval-transcript-${side}`}
                  >
                    <div className="eval-approach-header">
                      <span className={`eval-side-pill side-${side}`}>{modelLabel}</span>
                      <span className="eval-approach-sub">Session Transcript</span>
                    </div>
                    <p className="eval-approach-summary">
                      <RichText text={approach.summary} />
                    </p>

                    <div className="eval-transcript-list">
                      {lines.map((item) => {
                        const isCited = citedLines.has(item.line.toUpperCase());
                        return (
                          <button
                            key={item.line}
                            type="button"
                            className={`eval-transcript-line role-${item.role} ${
                              isCited ? "is-cited" : ""
                            }`}
                            data-testid={`eval-transcript-line-${item.line}`}
                            onClick={() => insertTranscriptQuote(item)}
                            title={`Click to quote [${item.line}] into ${quoteTargetLabel}`}
                          >
                            <span className="eval-line-marker">[{item.line}]</span>
                            <span className="eval-line-body">
                              <span className="eval-line-meta-row">
                                <span className={`eval-role-badge role-${item.role}`}>
                                  {formatRoleLabel(item.role)}
                                </span>
                                {isCited ? (
                                  <span className="eval-line-cited-badge">
                                    <Check size={11} aria-hidden="true" /> Cited
                                  </span>
                                ) : (
                                  <span className="eval-line-quote-cue" aria-hidden="true">
                                    + Quote
                                  </span>
                                )}
                              </span>
                              <span className="eval-transcript-text">
                                {item.role === "assistant" || item.role === "final_summary" ? (
                                  <RichText text={item.text} />
                                ) : (
                                  item.text
                                )}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
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
            )}
          </div>

          {/* 4. Calm Guided Evaluation Form (Quick Review default + Progressive 7-Axis Rubric) */}
          <form hidden={step !== 2} className="card eval-review-form" onSubmit={handleSubmitScenario}>
            <div className="eval-form-mode-bar">
              <div>
                <h4 className="eval-form-main-title">Your Evaluation</h4>
                <p className="eval-form-hint">
                  {practiceMode === "quick"
                    ? "Just 2 steps: pick the better model and explain why."
                    : "Full rehearsal: rate only the axes with signal, then practice the live write-up format."}
                </p>
              </div>
              <div
                className="eval-view-toggle eval-mode-toggle"
                data-testid="eval-practice-mode-toggle"
                role="group"
                aria-label="Practice form depth"
              >
                <button
                  type="button"
                  className={`eval-view-btn ${practiceMode === "quick" ? "active" : ""}`}
                  data-testid="eval-mode-quick"
                  aria-pressed={practiceMode === "quick"}
                  onClick={() => setPracticeMode("quick")}
                >
                  <Zap size={13} aria-hidden="true" />
                  <span>Quick Review</span>
                </button>
                <button
                  type="button"
                  className={`eval-view-btn ${practiceMode === "full" ? "active" : ""}`}
                  data-testid="eval-mode-full"
                  aria-pressed={practiceMode === "full"}
                  onClick={() => setPracticeMode("full")}
                >
                  <SlidersHorizontal size={13} aria-hidden="true" />
                  <span>Full 7-Axis Rubric</span>
                </button>
              </div>
            </div>

            {/* Step 1 — Clean A ↔ B Visual Spectrum Preference (Required) */}
            <div className="eval-form-step">
              <div className="eval-form-step-head">
                <span className="eval-step-badge">1</span>
                <h4>Which model handled this better?</h4>
                <span className="eval-req-note">Required</span>
              </div>
              <div
                className="eval-choice-group spectrum"
                role="radiogroup"
                aria-label="Pick your preference"
              >
                {CHOICE_OPTIONS.map((opt, idx) => {
                  const selected = choice === opt.value;
                  const isFocusable = selected || (!choice && idx === 0);
                  return (
                    <button
                      key={opt.value}
                      ref={(el) => {
                        choiceButtonRefs.current[opt.value] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={opt.label}
                      tabIndex={isFocusable ? 0 : -1}
                      className={`eval-choice-btn side-${opt.side} ${selected ? "selected" : ""}`}
                      data-testid={`eval-choice-${opt.value}`}
                      onClick={() => {
                        setChoice(opt.value);
                        setScenarioSubmitError(activeId, null);
                      }}
                      onKeyDown={(e) => handleChoiceKeyDown(e, idx)}
                    >
                      <span className="eval-choice-dot" aria-hidden="true" />
                      <span>{opt.short}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2 — Primary Critique + Understated Optional Signals */}
            <div className="eval-form-step">
              <div className="eval-form-step-head">
                <span className="eval-step-badge">2</span>
                <h4>Explain Why</h4>
                <span className={`eval-linter-pill ${quoteDetected ? "ok" : "neutral"}`}>
                  {quoteDetected ? (
                    <>
                      <Check size={12} aria-hidden="true" /> Quote cited
                    </>
                  ) : (
                    <span>Tip: click a line above to quote</span>
                  )}
                </span>
              </div>

              <div className="eval-field-group">
                <label htmlFor="eval-rationale" className="eval-sr-sublabel">
                  Your Critique{" "}
                  <span className="muted">
                    {practiceMode === "full"
                      ? "(optional scratchpad if you fill Overall Verdict below)"
                      : "(cite transcript lines or test output)"}
                  </span>
                </label>
                <textarea
                  id="eval-rationale"
                  aria-label="Your evaluation rationale"
                  className="eval-textarea"
                  rows={3}
                  value={rationale}
                  onFocus={() => setActiveQuoteTarget("rationale")}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder='Example: Strongly prefer Model B because Model A claimed "[A6] tests pass" despite the failure in [A4], while Model B fixed the root cause...'
                />
              </div>

              {/* Quiet, Clearly Optional Quick Signal Tags */}
              <div className="eval-optional-tags-row">
                <span className="eval-optional-label">
                  Optional quick tags
                  {spottedTags.length > 0 ? ` (${spottedTags.length} selected)` : ""}:
                </span>
                <div className="eval-tags-wrap subtle">
                  {activeScenario.available_tags.map((tag) => {
                    const selected = spottedTags.includes(tag.slug);
                    return (
                      <button
                        key={tag.slug}
                        type="button"
                        aria-pressed={selected}
                        className={`eval-tag-chip subtle ${selected ? "selected" : ""}`}
                        data-testid={`eval-tag-${tag.slug}`}
                        onClick={() => toggleTag(tag.slug)}
                      >
                        <Tag size={12} aria-hidden="true" />
                        <span>{tag.label}</span>
                        {selected && <Check size={12} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optional Follow-Up Prompt: Tucked neatly away in Quick mode, open in Full mode */}
              {showFollowupBox ? (
                <div className="eval-field-group eval-followup-field">
                  <div className="eval-label-with-linter">
                    <label htmlFor="eval-followup">
                      Optional Follow-Up Prompt{" "}
                      <span className="muted">(how you&apos;d steer the weaker assistant)</span>
                    </label>
                    {practiceMode === "quick" && !followupPrompt.trim() && (
                      <button
                        type="button"
                        className="eval-inline-link muted-link"
                        onClick={() => setShowFollowupInQuick(false)}
                      >
                        Hide
                      </button>
                    )}
                  </div>
                  <textarea
                    id="eval-followup"
                    aria-label="Follow-up prompt"
                    className="eval-textarea"
                    rows={2}
                    value={followupPrompt}
                    onChange={(e) => setFollowupPrompt(e.target.value)}
                    placeholder="Example: Restore the strict expiration assertion and fix the monotonic TTL check in get()..."
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="eval-add-optional-btn"
                  data-testid="eval-toggle-followup-btn"
                  onClick={() => setShowFollowupInQuick(true)}
                >
                  <Plus size={13} aria-hidden="true" />
                  <span>Add optional follow-up steering prompt</span>
                </button>
              )}
            </div>

            {/* Full 7-Axis Rubric Extension (Hidden cleanly in Quick Review) */}
            {practiceMode === "full" && (
              <>
                {/* Step 3 — Progressive 7-Axis Forced-Choice Matrix */}
                <div className="eval-7axis-panel" data-testid="eval-7axis-matrix">
                  <div className="eval-7axis-header">
                    <div className="eval-7axis-header-left">
                      <span className="eval-step-badge">3</span>
                      <h4>7-Axis Behavioral Rubric</h4>
                      <span className="eval-matrix-meta">
                        {ratedAxesCount}/7 rated · {decidingAxes.length}/2 deciding
                      </span>
                    </div>
                    <div className="eval-7axis-tools">
                      {unratedAxesCount > 0 && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          data-testid="eval-axes-mark-rest-na"
                          onClick={markUnratedAxesNa}
                        >
                          Set rest N/A ({unratedAxesCount})
                        </button>
                      )}
                      {(ratedAxesCount > 0 || decidingAxes.length > 0 || hasAnyAxisNote) && (
                        <button
                          type="button"
                          className="btn btn-sm eval-quiet-btn"
                          data-testid="eval-axes-reset"
                          onClick={resetAllAxes}
                          title="Clear all axis ratings and notes"
                        >
                          <RotateCcw size={13} aria-hidden="true" />
                          <span>Reset</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-expanded={axisMatrixOpen}
                        onClick={() => setAxisMatrixOpen((prev) => !prev)}
                      >
                        {axisMatrixOpen ? (
                          <>
                            <ChevronUp size={14} aria-hidden="true" /> Collapse
                          </>
                        ) : (
                          <>
                            <ChevronDown size={14} aria-hidden="true" /> Expand 7 Axes
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <p className="eval-matrix-guidance">
                    Most scenarios only have signal on 2–3 axes. Rate the ones that stood out
                    (selecting A or B reveals its <strong>Deciding</strong> toggle and note box),
                    then click <strong>Set rest N/A</strong>.
                  </p>

                  {decidingWarn && (
                    <div className="eval-inline-warn" role="status">
                      <AlertTriangle size={14} aria-hidden="true" />
                      <span>{decidingWarn}</span>
                    </div>
                  )}

                  {axisMatrixOpen && (
                    <div className="eval-7axis-rows">
                      {behavioralAxes.map((axis) => {
                        const entry = axisRatings[axis.slug] || { rating: "", note: "" };
                        const isDeciding = decidingAxes.includes(axis.slug);
                        const isRatedA = entry.rating.startsWith("a_");
                        const isRatedB = entry.rating.startsWith("b_");
                        const isRatedNa = entry.rating === "na";
                        const canMarkDeciding = isRatedA || isRatedB;
                        const showAxisDetail = canMarkDeciding || Boolean(entry.note.trim());
                        const decidingAtCap = decidingAxes.length >= 2 && !isDeciding;

                        return (
                          <div
                            key={axis.slug}
                            className={`eval-7axis-row progressive ${
                              isRatedA ? "rated-a" : isRatedB ? "rated-b" : isRatedNa ? "rated-na" : ""
                            } ${isDeciding ? "is-deciding" : ""}`}
                          >
                            <div className="eval-7axis-main">
                              <div className="eval-7axis-info" title={axis.description}>
                                <div className="eval-7axis-label-line">
                                  <strong>{axis.label}</strong>
                                  {axis.slug === "clarity" && (
                                    <span className="eval-clarity-pill">Final Summary Only</span>
                                  )}
                                </div>
                                <small>{AXIS_SHORT_HINTS[axis.slug] || axis.description}</small>
                              </div>

                              <select
                                className="select-field eval-axis-select"
                                data-testid={`eval-axis-select-${axis.slug}`}
                                aria-label={`${axis.label} forced-choice rating`}
                                value={entry.rating}
                                onChange={(e) =>
                                  updateAxisRating(
                                    axis.slug,
                                    e.target.value as ForcedChoiceRating | ""
                                  )
                                }
                              >
                                <option value="">— Skip / Unrated —</option>
                                <optgroup label="Model A Better">
                                  {FORCED_CHOICE_A_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label="Model B Better">
                                  {FORCED_CHOICE_B_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </optgroup>
                                <option value="na">N/A (No signal)</option>
                              </select>
                            </div>

                            {showAxisDetail && (
                              <div
                                className={`eval-7axis-detail ${
                                  canMarkDeciding ? "" : "note-only"
                                }`}
                              >
                                {canMarkDeciding && (
                                  <button
                                    type="button"
                                    className={`eval-deciding-btn ${isDeciding ? "active" : ""} ${
                                      decidingAtCap ? "capped" : ""
                                    }`}
                                    data-testid={`eval-axis-deciding-${axis.slug}`}
                                    aria-pressed={isDeciding}
                                    title={
                                      decidingAtCap
                                        ? "2 deciding axes already selected — unselect one first"
                                        : "Mark as one of up to 2 deciding axes"
                                    }
                                    onClick={() => toggleDecidingAxis(axis.slug)}
                                  >
                                    <Star
                                      size={12}
                                      fill={isDeciding ? "currentColor" : "none"}
                                      aria-hidden="true"
                                    />
                                    <span>{isDeciding ? "Deciding" : "Mark Deciding"}</span>
                                  </button>
                                )}

                                <input
                                  type="text"
                                  className="input-field eval-axis-note-input"
                                  data-testid={`eval-axis-note-${axis.slug}`}
                                  aria-label={`${axis.label} cited note`}
                                  value={entry.note}
                                  onFocus={() => setActiveQuoteTarget(`axis:${axis.slug}`)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") e.preventDefault();
                                  }}
                                  onChange={(e) => updateAxisNote(axis.slug, e.target.value)}
                                  placeholder={`1-line quote-backed note for ${axis.label}…`}
                                />

                                {!canMarkDeciding && entry.note.trim() && (
                                  <button
                                    type="button"
                                    className="btn btn-sm eval-quiet-btn"
                                    aria-label={`Clear ${axis.label} note`}
                                    title={`Clear ${axis.label} note`}
                                    onClick={() => updateAxisNote(axis.slug, "")}
                                  >
                                    <X size={12} aria-hidden="true" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Step 4 — Structured Live-Session Write-Ups */}
                <div
                  className="eval-structured-writeups"
                  data-testid="eval-structured-writeups"
                >
                  <div className="eval-structured-head">
                    <div className="eval-form-step-head">
                      <span className="eval-step-badge">4</span>
                      <h5>Live-Session Write-Up Rehearsal</h5>
                    </div>
                    <span className="muted">
                      Live linters check neutral Senior Approach &amp; 5–7 sentence Overall Verdict
                    </span>
                  </div>

                  <div className="eval-field-group">
                    <div className="eval-label-with-linter">
                      <label htmlFor="eval-senior-note">
                        Senior Engineer Approach{" "}
                        <span className="muted">(ideal neutral approach — no Model A/B)</span>
                      </label>
                      <span
                        className={`eval-linter-pill ${
                          seniorMentionsModelAB
                            ? "warn"
                            : seniorEngineerNote.trim()
                              ? "ok"
                              : "neutral"
                        }`}
                        data-testid="eval-senior-linter"
                        role="status"
                      >
                        {seniorMentionsModelAB ? (
                          <>
                            <AlertTriangle size={12} aria-hidden="true" />
                            Remove &ldquo;Model A / Model B&rdquo; mentions!
                          </>
                        ) : seniorEngineerNote.trim() ? (
                          <>
                            <Check size={12} aria-hidden="true" />
                            Neutral (no Model A/B)
                          </>
                        ) : (
                          <span>Keep neutral — no Model A or Model B</span>
                        )}
                      </span>
                    </div>
                    <textarea
                      id="eval-senior-note"
                      aria-label="Senior engineer approach"
                      className={`eval-textarea ${seniorMentionsModelAB ? "input-warn" : ""}`}
                      rows={3}
                      value={seniorEngineerNote}
                      onChange={(e) => setSeniorEngineerNote(e.target.value)}
                      placeholder="In 3–4 neutral sentences, explain how a strong engineer would diagnose, fix, and verify this task without mentioning either model..."
                    />
                  </div>

                  <div className="eval-field-group">
                    <label htmlFor="eval-overall">
                      Overall Verdict (5–7 sentences){" "}
                      <span className="muted">
                        (name Model A &amp; Model B, weigh ≤ 2 deciding axes, cite quotes)
                      </span>
                    </label>
                    <textarea
                      id="eval-overall"
                      aria-label="Overall verdict"
                      className="eval-textarea"
                      rows={4}
                      value={overallSummary}
                      onFocus={() => setActiveQuoteTarget("overall")}
                      onChange={(e) => setOverallSummary(e.target.value)}
                      placeholder='Write a 5–7 sentence verdict comparing Model A and Model B on your 1–2 deciding axes, backed by direct transcript quotes like "[A4] ..."...'
                    />
                    <div className="eval-linter-row" data-testid="eval-overall-linters">
                      <span
                        className={`eval-linter-pill ${
                          overallSentenceCount === 0
                            ? "neutral"
                            : overallSentenceOk
                              ? "ok"
                              : "warn"
                        }`}
                        data-testid="eval-overall-sentences"
                      >
                        {overallSentenceCount}{" "}
                        {overallSentenceCount === 1 ? "sentence" : "sentences"} (aim 5–7)
                      </span>
                      <span
                        className={`eval-linter-pill ${
                          overallNamesBothModels ? "ok" : "neutral"
                        }`}
                      >
                        {overallNamesBothModels ? (
                          <>
                            <Check size={12} aria-hidden="true" /> Model A &amp; B named
                          </>
                        ) : (
                          <span>Name Model A &amp; B</span>
                        )}
                      </span>
                      <span
                        className={`eval-linter-pill ${
                          decidingAxes.length >= 1 && decidingAxes.length <= 2
                            ? "ok"
                            : decidingAxes.length > 2
                              ? "warn"
                              : "neutral"
                        }`}
                      >
                        {decidingAxes.length}/2 deciding axes
                      </span>
                      <span className={`eval-linter-pill ${quoteDetected ? "ok" : "neutral"}`}>
                        {quoteDetected ? (
                          <>
                            <Check size={12} aria-hidden="true" /> Quote cited
                          </>
                        ) : (
                          <span>Cite a line</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="eval-field-group">
                    <label htmlFor="eval-other-issues">
                      Other Behavioral Issues{" "}
                      <span className="muted">(optional — leave blank unless real)</span>
                    </label>
                    <input
                      id="eval-other-issues"
                      type="text"
                      aria-label="Other behavioral issues"
                      className="input-field"
                      value={otherIssues}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.preventDefault();
                      }}
                      onChange={(e) => setOtherIssues(e.target.value)}
                      placeholder="Leave blank unless real (e.g., repeated looping tool calls not covered above)"
                    />
                  </div>
                </div>
              </>
            )}

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
                    : "Submit for calibration"}
                </span>
              </button>

              <div className="eval-readiness-summary" aria-live="polite">
                {!choice ? (
                  <span className="eval-submit-hint">
                    Pick a model in Step 1 to enable calibration.
                  </span>
                ) : practiceMode === "quick" ? (
                  <button
                    type="button"
                    className="eval-inline-link"
                    onClick={() => setPracticeMode("full")}
                  >
                    Want 7-axis practice? Switch to Full 7-Axis Rubric
                  </button>
                ) : null}
              </div>
            </div>
          </form>

          {/* 5. Layered Calibration Result Card */}
          {step === 3 && activeResult && (
            <section
              ref={calibrationRef}
              className={`card eval-calibration-card ${
                activeResult.aligned ? "aligned" : "diverged"
              }`}
              data-testid="eval-calibration-result"
              aria-live="polite"
            >
              {/* Immediate Verdict + Senior Key Takeaway + Next CTA */}
              <div className="eval-calibration-top">
                <div className="eval-calibration-status">
                  <span className={`eval-align-pill ${activeResult.aligned ? "ok" : "warn"}`}>
                    {activeResult.aligned ? (
                      <>
                        <CheckCircle2 size={15} aria-hidden="true" />
                        Aligned with Senior Key
                      </>
                    ) : (
                      <>
                        <Lightbulb size={15} aria-hidden="true" />
                        Different Call — Compare &amp; Calibrate
                      </>
                    )}
                  </span>
                  <span className="eval-expected-note">
                    Your verdict: <strong>{CHOICE_OPTIONS.find(option => option.value === activeResult.submittedChoice)?.label}</strong> · Senior key: <strong>Model {activeResult.expected_side.toUpperCase()}</strong>
                  </span>
                </div>

                <div className="eval-calibration-rewards">
                  <span className="eval-score-pill">Rubric {activeResult.rubric.total}/100</span>
                  {activeResult.xp_awarded > 0 && (
                    <span className="eval-xp-pill" data-testid="eval-xp-badge">
                      <Sparkles size={13} aria-hidden="true" />+{activeResult.xp_awarded} XP
                    </span>
                  )}
                  {nextScenario ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onSelectScenarioId(nextScenario.id)}
                    >
                      <span>Next Scenario</span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={onOpenDryRun}
                    >
                      <span>Prep My Repo</span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
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

              <div className="eval-reference-box">
                <h5>Senior Reviewer Takeaway</h5>
                <p>
                  <RichText text={activeResult.reference_explanation} />
                </p>
              </div>

              <details className="lab-reference"><summary>Detailed scoring and coaching</summary>
              <div className="eval-tag-calibration">
                <div className="eval-tag-cal-col">
                  <h5>Matched Signals ({activeResult.matched_tags.length})</h5>
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
                      No key tags matched yet — check the missed signals beside this.
                    </p>
                  )}
                </div>

                <div className="eval-tag-cal-col">
                  <h5>Missed Signals ({activeResult.missed_tags.length})</h5>
                  {activeResult.missed_tags.length > 0 ? (
                    <div className="eval-tag-pills-row">
                      {activeResult.missed_tags.map((slug) => (
                        <span key={slug} className="eval-cal-tag missed">
                          {tagLabelMap[slug] || humanizeSlug(slug)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="eval-cal-perfect">You caught every key signal!</p>
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
                          <div className="eval-rubric-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 7-Axis Behavioral Calibration & Write-Up Checks (open in Full mode, tidy drawer in Quick mode) */}
              {activeResult.axis_calibration &&
                activeResult.axis_calibration.length > 0 &&
                (showDeepCalibrationOpen ? (
                  <div
                    className="eval-axis-cal-section"
                    data-testid="eval-axis-calibration-table"
                  >
                    <h5>7-Axis Behavioral Calibration</h5>
                    <div className="eval-axis-cal-list">
                      <div className="eval-axis-cal-head" aria-hidden="true">
                        <span>Axis</span>
                        <span>Your Rating</span>
                        <span>Key</span>
                        <span>Status</span>
                        <span>Senior Note</span>
                      </div>
                      {activeResult.axis_calibration.map((row) => (
                        <div
                          key={row.axis}
                          className={`eval-axis-cal-row ${row.matched ? "matched" : "missed"}`}
                        >
                          <div className="eval-axis-cal-name">
                            <strong>{row.label}</strong>
                            {row.deciding && (
                              <span className="eval-deciding-tag">Deciding</span>
                            )}
                          </div>
                          <span className="eval-axis-cal-cell">
                            {FORCED_CHOICE_LABEL_MAP[row.user_rating] ||
                              (row.user_rating ? humanizeSlug(row.user_rating) : "Not rated")}
                          </span>
                          <span className="eval-axis-cal-cell">
                            {row.expected_winner === "na"
                              ? "N/A"
                              : `Model ${row.expected_winner.toUpperCase()}`}
                          </span>
                          <span className={`eval-cal-status ${row.matched ? "ok" : "warn"}`}>
                            {row.matched ? "Aligned ✓" : "Compare"}
                          </span>
                          <span className="eval-axis-cal-why">
                            <RichText text={row.why} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <details
                    className="eval-examples-details"
                    data-testid="eval-axis-calibration-table"
                  >
                    <summary>
                      <span>View 7-Axis Senior Key Breakdown (7 axes)</span>
                    </summary>
                    <div className="eval-examples-body">
                      <div className="eval-axis-cal-list">
                        {activeResult.axis_calibration.map((row) => (
                          <div key={row.axis} className="eval-axis-cal-row compact-key">
                            <div className="eval-axis-cal-name">
                              <strong>{row.label}</strong>
                              {row.deciding && (
                                <span className="eval-deciding-tag">Deciding</span>
                              )}
                            </div>
                            <span className="eval-axis-cal-cell">
                              {row.expected_winner === "na"
                                ? "N/A"
                                : `Model ${row.expected_winner.toUpperCase()}`}
                            </span>
                            <span className="eval-axis-cal-why">
                              <RichText text={row.why} />
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                ))}

              {activeResult.writeup_checks &&
                activeResult.writeup_checks.length > 0 &&
                showDeepCalibrationOpen && (
                  <div className="eval-checks-section" data-testid="eval-writeup-checks">
                    <h5>Write-Up Quality Checks</h5>
                    <ul className="eval-checks-list">
                      {activeResult.writeup_checks.map((chk) => (
                        <li
                          key={chk.id}
                          className={`eval-check-row ${chk.passed ? "ok" : "warn"}`}
                        >
                          {chk.passed ? (
                            <CheckCircle2 size={15} aria-hidden="true" />
                          ) : (
                            <AlertTriangle size={15} aria-hidden="true" />
                          )}
                          <div>
                            <strong>{chk.label}: </strong>
                            <span>
                              <RichText text={chk.message} />
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              {/* Coaching & Reference Examples Drawer */}
              {(seniorRefExample ||
                overallRefExample ||
                activeResult.sample_followup ||
                (activeResult.coaching_tips && activeResult.coaching_tips.length > 0)) && (
                <details
                  className="eval-examples-details"
                  data-testid="eval-reference-examples"
                >
                  <summary>
                    <span>
                      Coaching Tips, Senior Reference Examples &amp; Sample Follow-Up Prompt
                    </span>
                  </summary>
                  <div className="eval-examples-body">
                    {activeResult.coaching_tips && activeResult.coaching_tips.length > 0 && (
                      <div className="eval-example-block">
                        <h6>Coaching Notes</h6>
                        <ul className="eval-inline-list">
                          {activeResult.coaching_tips.map((tip, idx) => (
                            <li key={idx}>
                              <RichText text={tip} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {seniorRefExample && (
                      <div className="eval-example-block">
                        <h6>Senior Engineer Approach (Zero Model A/B Mentions)</h6>
                        <p>
                          <RichText text={seniorRefExample} />
                        </p>
                      </div>
                    )}
                    {overallRefExample && (
                      <div className="eval-example-block">
                        <h6>Overall Verdict Example (5–7 Sentences, ≤ 2 Deciding Axes)</h6>
                        <p>
                          <RichText text={overallRefExample} />
                        </p>
                      </div>
                    )}
                    {activeResult.sample_followup && (
                      <div className="eval-example-block">
                        <div className="eval-followup-head">
                          <h6>Example Follow-Up Steering Prompt</h6>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={async () => {
                              const copiedForId = activeScenario.id;
                              const ok = await copyTextSafe(activeResult.sample_followup);
                              if (ok && activeIdRef.current === copiedForId) {
                                setCopiedFollowup(true);
                                if (copiedFollowupTimer.current) {
                                  window.clearTimeout(copiedFollowupTimer.current);
                                }
                                copiedFollowupTimer.current = window.setTimeout(
                                  () => setCopiedFollowup(false),
                                  2000
                                );
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
                  </div>
                </details>
              )}
              </details>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
