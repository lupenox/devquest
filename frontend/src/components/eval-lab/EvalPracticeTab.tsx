import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Code2,
  Copy,
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Quote,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Terminal,
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
  FORCED_CHOICE_LABEL_MAP,
  FORCED_CHOICE_OPTIONS,
  formatDifficulty,
  formatLangLabel,
  formatRoleLabel,
  hasTranscriptQuote,
  humanizeSlug,
  normalizeHighlightLang,
  type EvidenceViewMode,
  type PracticeMode,
} from "./evalLabConstants";

interface EvalPracticeTabProps {
  scenarios: EvalScenario[];
  behavioralAxes: BehavioralAxisDef[];
  completedCount: number;
  totalScenarios: number;
  activeScenarioId: string;
  onSelectScenarioId: (id: string) => void;
  onCalibrated: (overview: EvalLabOverview | undefined) => void;
  onOpenDryRun: () => void;
}

export function EvalPracticeTab({
  scenarios,
  behavioralAxes,
  completedCount,
  totalScenarios,
  activeScenarioId,
  onSelectScenarioId,
  onCalibrated,
  onOpenDryRun,
}: EvalPracticeTabProps) {
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("quick");
  const [evidenceView, setEvidenceView] = useState<EvidenceViewMode>("transcripts");
  const [choice, setChoice] = useState<EvalChoice | null>(null);
  const [spottedTags, setSpottedTags] = useState<string[]>([]);
  const [rationale, setRationale] = useState("");
  const [followupPrompt, setFollowupPrompt] = useState("");

  // Deep 7-Axis & Structured Write-Up state (used in Full Live Rehearsal mode)
  const [axisMatrixOpen, setAxisMatrixOpen] = useState(true);
  const [axisRatings, setAxisRatings] = useState<Record<string, AxisRatingInput>>(() =>
    emptyAxisRatings(behavioralAxes)
  );
  const [decidingAxes, setDecidingAxes] = useState<string[]>([]);
  const [decidingWarn, setDecidingWarn] = useState<string | null>(null);
  const [seniorEngineerNote, setSeniorEngineerNote] = useState("");
  const [overallSummary, setOverallSummary] = useState("");
  const [otherIssues, setOtherIssues] = useState("");
  const [activeQuoteTarget, setActiveQuoteTarget] = useState<string>("rationale");
  const [quotedFlash, setQuotedFlash] = useState<string | null>(null);

  const [submittingScenario, setSubmittingScenario] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultsByScenario, setResultsByScenario] = useState<Record<string, EvalSubmitResp>>({});
  const [copiedFollowup, setCopiedFollowup] = useState(false);

  const calibrationRef = useRef<HTMLDivElement>(null);
  const quoteFlashTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (quoteFlashTimer.current) window.clearTimeout(quoteFlashTimer.current);
    };
  }, []);

  const activeScenario: EvalScenario | undefined = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) || scenarios[0],
    [scenarios, activeScenarioId]
  );

  // Reset form cleanly whenever the selected scenario changes
  const prevScenarioIdRef = useRef<string>(activeScenario?.id || "");
  useEffect(() => {
    const nextId = activeScenario?.id || "";
    if (!nextId || nextId === prevScenarioIdRef.current) return;
    prevScenarioIdRef.current = nextId;
    setEvidenceView(
      activeScenario?.transcript_a && activeScenario.transcript_a.length > 0
        ? "transcripts"
        : "codediff"
    );
    setChoice(null);
    setSpottedTags([]);
    setRationale("");
    setFollowupPrompt("");
    setAxisRatings(emptyAxisRatings(behavioralAxes));
    setDecidingAxes([]);
    setDecidingWarn(null);
    setSeniorEngineerNote("");
    setOverallSummary("");
    setOtherIssues("");
    setActiveQuoteTarget("rationale");
    setSubmitError(null);
    setCopiedFollowup(false);
  }, [activeScenario, behavioralAxes]);

  // If switching back to Quick Practice while quote target was Overall or Axis, reset cleanly to Critique
  useEffect(() => {
    if (practiceMode === "quick" && activeQuoteTarget !== "rationale") {
      setActiveQuoteTarget("rationale");
    }
  }, [practiceMode, activeQuoteTarget]);

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
  const combinedWriteupText = useMemo(() => {
    const axisNotes = Object.values(axisRatings)
      .map((a) => a.note)
      .join(" ");
    return `${rationale} ${overallSummary} ${axisNotes}`;
  }, [rationale, overallSummary, axisRatings]);
  const quoteDetected = hasTranscriptQuote(combinedWriteupText);
  const ratedAxesCount = Object.values(axisRatings).filter((a) => Boolean(a.rating)).length;

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
    setSpottedTags((prev) =>
      prev.includes(slug) ? prev.filter((item) => item !== slug) : [...prev, slug]
    );
  };

  const updateAxisRating = (slug: BehavioralAxisSlug, rating: ForcedChoiceRating | "") => {
    setAxisRatings((prev) => ({
      ...prev,
      [slug]: { rating, note: prev[slug]?.note || "" },
    }));
  };

  const updateAxisNote = (slug: BehavioralAxisSlug, note: string) => {
    setAxisRatings((prev) => ({
      ...prev,
      [slug]: { rating: prev[slug]?.rating || "", note },
    }));
  };

  const toggleDecidingAxis = (slug: string) => {
    setDecidingAxes((prev) => {
      if (prev.includes(slug)) {
        setDecidingWarn(null);
        return prev.filter((a) => a !== slug);
      }
      if (prev.length >= 2) {
        setDecidingWarn("Pick at most 2 deciding axes — unselect one before adding another.");
        return prev;
      }
      setDecidingWarn(null);
      return [...prev, slug];
    });
  };

  const insertTranscriptQuote = (item: TranscriptLine) => {
    const cleanText = item.text.replace(/\s+/g, " ").trim();
    const snippet = cleanText.length > 140 ? `${cleanText.slice(0, 137).trimEnd()}...` : cleanText;
    const quoted = `"[${item.line}] ${snippet}"`;

    if (activeQuoteTarget === "overall") {
      setOverallSummary((prev) => (prev.trim() ? `${prev.trimEnd()} ${quoted}` : quoted));
      setQuotedFlash(`Quoted [${item.line}] into Overall Verdict`);
    } else if (activeQuoteTarget.startsWith("axis:")) {
      const slug = activeQuoteTarget.slice(5) as BehavioralAxisSlug;
      setAxisRatings((prev) => {
        const cur = prev[slug]?.note || "";
        return {
          ...prev,
          [slug]: {
            rating: prev[slug]?.rating || "",
            note: cur.trim() ? `${cur.trimEnd()} ${quoted}` : quoted,
          },
        };
      });
      const label = behavioralAxes.find((a) => a.slug === slug)?.label || humanizeSlug(slug);
      setQuotedFlash(`Quoted [${item.line}] into ${label} note`);
    } else {
      setRationale((prev) => (prev.trim() ? `${prev.trimEnd()} ${quoted}` : quoted));
      setQuotedFlash(`Quoted [${item.line}] into Your Critique`);
    }

    if (quoteFlashTimer.current) window.clearTimeout(quoteFlashTimer.current);
    quoteFlashTimer.current = window.setTimeout(() => setQuotedFlash(null), 2400);
  };

  const handleSubmitScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeScenario) return;
    if (!choice) {
      setSubmitError("Pick who handled this better in Step 1 before calibrating.");
      return;
    }
    setSubmittingScenario(true);
    setSubmitError(null);

    const populatedAxes: Record<string, AxisRatingInput> = {};
    for (const [slug, val] of Object.entries(axisRatings)) {
      if (val && (val.rating || val.note.trim())) {
        populatedAxes[slug] = { rating: val.rating, note: val.note.trim() };
      }
    }

    try {
      const resp = await api.submitEvalScenario(activeScenario.id, {
        choice,
        spotted_tags: spottedTags,
        rationale: rationale.trim(),
        followup_prompt: followupPrompt.trim(),
        ...(Object.keys(populatedAxes).length > 0 ? { axis_ratings: populatedAxes } : {}),
        ...(decidingAxes.length > 0 ? { deciding_axes: decidingAxes } : {}),
        ...(seniorEngineerNote.trim() ? { senior_engineer_note: seniorEngineerNote.trim() } : {}),
        ...(overallSummary.trim() ? { overall_summary: overallSummary.trim() } : {}),
        ...(otherIssues.trim() ? { other_issues: otherIssues.trim() } : {}),
      });
      setResultsByScenario((prev) => ({ ...prev, [activeScenario.id]: resp }));
      onCalibrated(resp.overview);
      window.setTimeout(() => {
        calibrationRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 60);
    } catch (err: any) {
      setSubmitError(err?.message || "Could not submit your scenario review.");
    } finally {
      setSubmittingScenario(false);
    }
  };

  const seniorRefExample =
    activeResult?.senior_engineer_example || activeScenario?.senior_engineer_example || "";
  const overallRefExample = activeResult?.overall_example || activeScenario?.overall_example || "";
  const showDeepCalibrationOpen =
    practiceMode === "full" ||
    ratedAxesCount > 0 ||
    Boolean(seniorEngineerNote.trim()) ||
    Boolean(overallSummary.trim());

  return (
    <section className="eval-section-stack">
      {/* 1. Slim Scenario Strip */}
      <div className="card eval-picker-card compact">
        <div className="eval-picker-header">
          <div className="eval-picker-title-row">
            <h3 className="eval-section-title">Practice Scenarios</h3>
            <span className="eval-progress-chip">
              {completedCount}/{totalScenarios} calibrated
            </span>
          </div>
          <span className="eval-picker-hint">Pick any scenario below to review Model A vs B</span>
        </div>

        <div className="eval-scenarios-strip" data-testid="eval-scenarios-list">
          {scenarios.map((sc, idx) => {
            const isActive = activeScenario?.id === sc.id;
            return (
              <button
                key={sc.id}
                type="button"
                className={`eval-scenario-pill compact ${isActive ? "active" : ""} ${
                  sc.completed ? "completed" : ""
                }`}
                data-testid={`eval-scenario-pill-${sc.id}`}
                aria-pressed={isActive}
                onClick={() => onSelectScenarioId(sc.id)}
              >
                <span className="eval-scenario-pill-line">
                  <strong className="eval-scenario-pill-title">
                    {idx + 1}. {sc.title}
                  </strong>
                  {sc.completed && (
                    <CheckCircle2
                      size={14}
                      className="eval-pill-done-icon"
                      aria-label="Calibrated"
                    />
                  )}
                </span>
                <span className="eval-scenario-pill-sub">
                  <span className="eval-lang-badge">{formatLangLabel(sc.language)}</span>
                  <span>~{sc.estimated_minutes}m</span>
                  {typeof sc.best_score === "number" && sc.completed && (
                    <span className="eval-pill-score">{sc.best_score}/100</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {activeScenario && (
        <div className="eval-section-stack" data-testid="eval-scenario-active">
          {/* 2. Concise Mission Brief + Evidence Mode Toggle */}
          <div className="card eval-brief-card compact">
            <div className="eval-brief-top">
              <div>
                <div className="eval-brief-badges">
                  <span className="eval-lang-badge">
                    {formatLangLabel(activeScenario.language)}
                  </span>
                  <span className="eval-diff-badge">
                    {formatDifficulty(activeScenario.difficulty)}
                  </span>
                  <span className="eval-time-badge">~{activeScenario.estimated_minutes} min</span>
                  {activeScenario.completed && (
                    <span className="eval-calibrated-badge">
                      <CheckCircle2 size={12} aria-hidden="true" />
                      Calibrated
                    </span>
                  )}
                </div>
                <h3 className="eval-scenario-heading">{activeScenario.title}</h3>
              </div>

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

          {/* 3. Side-by-Side Evidence (Transcripts OR Code Diff) */}
          {effectiveEvidenceView === "transcripts" && hasTranscripts ? (
            <div className="eval-transcripts-wrap" data-testid="eval-transcripts-grid">
              <div className="eval-quote-hint-bar" data-testid="eval-quote-target-bar">
                <div className="eval-quote-hint-left">
                  <Quote size={14} aria-hidden="true" />
                  <span>Click any line below to insert a quote into:</span>
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
                    {practiceMode === "full" && (
                      <button
                        type="button"
                        className={`eval-quote-target-btn ${
                          activeQuoteTarget === "overall" ? "active" : ""
                        }`}
                        onClick={() => setActiveQuoteTarget("overall")}
                      >
                        Overall Verdict
                      </button>
                    )}
                    {activeQuoteTarget.startsWith("axis:") && (
                      <span className="eval-quote-target-btn active">{quoteTargetLabel}</span>
                    )}
                  </div>
                </div>
                {quotedFlash && (
                  <span className="eval-quoted-flash" role="status">
                    <Check size={13} aria-hidden="true" />
                    {quotedFlash}
                  </span>
                )}
              </div>

              <div className="eval-ab-grid">
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
                      {lines.map((item) => (
                        <button
                          key={item.line}
                          type="button"
                          className={`eval-transcript-line role-${item.role}`}
                          data-testid={`eval-transcript-line-${item.line}`}
                          onClick={() => insertTranscriptQuote(item)}
                          title={`Click to quote [${item.line}] into ${quoteTargetLabel}`}
                        >
                          <span className="eval-line-marker">[{item.line}]</span>
                          <span className="eval-line-body">
                            <span className={`eval-role-badge role-${item.role}`}>
                              {formatRoleLabel(item.role)}
                            </span>
                            <span className="eval-transcript-text">{item.text}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
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

          {/* 4. Guided Review Form (Quick Practice default + 1-click Full Live Rehearsal) */}
          <form className="card eval-review-form" onSubmit={handleSubmitScenario}>
            <div className="eval-form-mode-bar">
              <div>
                <h4 className="eval-form-main-title">Your Evaluation</h4>
                <p className="eval-form-hint">
                  {practiceMode === "quick"
                    ? "Quick Practice: pick the winner, tag what stood out, and explain why—submit anytime."
                    : "Full Live Rehearsal: includes the 7-Axis Matrix plus live-linter Senior & 5–7 sentence Overall boxes."}
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
                  <span>Quick Practice</span>
                </button>
                <button
                  type="button"
                  className={`eval-view-btn ${practiceMode === "full" ? "active" : ""}`}
                  data-testid="eval-mode-full"
                  aria-pressed={practiceMode === "full"}
                  onClick={() => setPracticeMode("full")}
                >
                  <SlidersHorizontal size={13} aria-hidden="true" />
                  <span>Full Live Rehearsal</span>
                </button>
              </div>
            </div>

            {/* Step 1 — Overall Preference (Required) */}
            <div className="eval-form-step">
              <div className="eval-form-step-head">
                <span className="eval-step-badge">Step 1 · Required</span>
                <h4>Which model handled this better?</h4>
              </div>
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

            {/* Step 2 — Tag Signals & Short Critique */}
            <div className="eval-form-step">
              <div className="eval-form-step-head">
                <span className="eval-step-badge">Step 2</span>
                <h4>Tag What You Spotted &amp; Explain Why</h4>
                <span className="eval-tag-count">{spottedTags.length} tags selected</span>
              </div>

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

              <div className="eval-textarea-stack">
                <div className="eval-field-group">
                  <div className="eval-label-with-linter">
                    <label htmlFor="eval-rationale">
                      Your Critique{" "}
                      <span className="muted">(cite transcript lines or test output)</span>
                    </label>
                    <span className={`eval-linter-pill ${quoteDetected ? "ok" : "neutral"}`}>
                      {quoteDetected ? (
                        <>
                          <Check size={12} aria-hidden="true" /> Transcript quote cited
                        </>
                      ) : (
                        <span>Click any line above to quote</span>
                      )}
                    </span>
                  </div>
                  <textarea
                    id="eval-rationale"
                    aria-label="Your evaluation rationale"
                    className="eval-textarea"
                    rows={3}
                    value={rationale}
                    onFocus={() => setActiveQuoteTarget("rationale")}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder='Example: Strongly prefer Model B because Model A claimed "[A4] All tests pass" despite failing output, while Model B fixed the root cause...'
                  />
                </div>

                <div className="eval-field-group">
                  <label htmlFor="eval-followup">
                    Optional Follow-Up Prompt{" "}
                    <span className="muted">(how you&apos;d steer the weaker assistant)</span>
                  </label>
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
              </div>
            </div>

            {/* Full Live Rehearsal Extension (Hidden cleanly in Quick Practice) */}
            {practiceMode === "full" && (
              <>
                {/* Step 3 — 7-Axis Forced-Choice Matrix */}
                <div className="eval-7axis-panel" data-testid="eval-7axis-matrix">
                  <div className="eval-7axis-header">
                    <div className="eval-7axis-header-left">
                      <span className="eval-step-badge">Step 3 · 7-Axis Matrix</span>
                      <h4>Behavioral Forced-Choice Ratings</h4>
                      <span className="eval-matrix-meta">
                        {ratedAxesCount}/7 rated · Deciding: {decidingAxes.length}/2
                      </span>
                    </div>
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
                        return (
                          <div
                            key={axis.slug}
                            className={`eval-7axis-row ${isDeciding ? "is-deciding" : ""}`}
                          >
                            <div className="eval-7axis-info" title={axis.description}>
                              <div className="eval-7axis-label-line">
                                <strong>{axis.label}</strong>
                                {axis.slug === "clarity" && (
                                  <span className="eval-clarity-pill">Final Summary</span>
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
                              {FORCED_CHOICE_OPTIONS.map((opt) => (
                                <option key={opt.value || "none"} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              className={`eval-deciding-btn ${isDeciding ? "active" : ""}`}
                              data-testid={`eval-axis-deciding-${axis.slug}`}
                              aria-pressed={isDeciding}
                              onClick={() => toggleDecidingAxis(axis.slug)}
                            >
                              {isDeciding ? (
                                <>
                                  <Check size={12} aria-hidden="true" /> Deciding
                                </>
                              ) : (
                                <span>Deciding</span>
                              )}
                            </button>

                            <input
                              type="text"
                              className="input-field eval-axis-note-input"
                              data-testid={`eval-axis-note-${axis.slug}`}
                              aria-label={`${axis.label} cited note`}
                              value={entry.note}
                              onFocus={() => setActiveQuoteTarget(`axis:${axis.slug}`)}
                              onChange={(e) => updateAxisNote(axis.slug, e.target.value)}
                              placeholder={`1-line quote-backed note for ${axis.label}…`}
                            />
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
                      <span className="eval-step-badge">Step 4 · Live Write-Ups</span>
                      <h5>Structured Write-Up Rehearsal (Live Linters)</h5>
                    </div>
                    <span className="muted">
                      Practice the exact neutral Senior Engineer &amp; 5–7 sentence Overall Verdict
                      format
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
                          <span>Must not mention Model A or Model B</span>
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
                        {overallSentenceCount === 1 ? "sentence" : "sentences"} — aim for 5–7
                      </span>
                      <span
                        className={`eval-linter-pill ${
                          overallNamesBothModels ? "ok" : "neutral"
                        }`}
                      >
                        {overallNamesBothModels ? (
                          <>
                            <Check size={12} aria-hidden="true" /> Model A &amp; Model B named
                          </>
                        ) : (
                          <span>Name both Model A &amp; Model B</span>
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
                            <Check size={12} aria-hidden="true" /> Quote detected
                          </>
                        ) : (
                          <span>Click a line to quote</span>
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
                    : "Submit & Compare with Senior Key"}
                </span>
              </button>

              <div className="eval-readiness-summary" aria-live="polite">
                {!choice ? (
                  <span className="eval-submit-hint">
                    Pick a preference in Step 1 to enable calibration.
                  </span>
                ) : (
                  <span className="eval-ready-pills">
                    <span className="eval-linter-pill ok">
                      <Check size={11} aria-hidden="true" /> Preference set
                    </span>
                    {spottedTags.length > 0 && (
                      <span className="eval-linter-pill ok">{spottedTags.length} tags</span>
                    )}
                    {quoteDetected && (
                      <span className="eval-linter-pill ok">Quote cited</span>
                    )}
                    {practiceMode === "quick" && (
                      <button
                        type="button"
                        className="eval-inline-link"
                        onClick={() => setPracticeMode("full")}
                      >
                        Want 7-axis practice? Switch to Full Rehearsal
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>
          </form>

          {/* 5. Layered Calibration Result Card */}
          {activeResult && (
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
                    Senior Key: <strong>Model {activeResult.expected_side.toUpperCase()}</strong>
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

              {/* Matched vs Missed Tags */}
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
                          <div key={row.axis} className="eval-axis-cal-row">
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
                            <span className="eval-axis-cal-why" style={{ gridColumn: "span 3" }}>
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
                  </div>
                </details>
              )}
            </section>
          )}
        </div>
      )}
    </section>
  );
}
