import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Code2,
  RefreshCw,
  Scale,
  Wrench,
} from "lucide-react";
import { api } from "../api";
import type { BehavioralAxisDef, EvalDryRun, EvalLabOverview } from "../types";
import { EvalDryRunTab } from "./eval-lab/EvalDryRunTab";
import {
  DEFAULT_BEHAVIORAL_AXES,
  DEFAULT_LADDER,
  formatLadderTitle,
  type EvalSubTab,
  type PracticeMode,
} from "./eval-lab/evalLabConstants";
import { EvalPlaybookTab } from "./eval-lab/EvalPlaybookTab";
import { EvalPracticeTab } from "./eval-lab/EvalPracticeTab";
import "../eval-lab.css";

interface EvalLabViewProps {
  onUpdated: () => void;
}

export function EvalLabView({ onUpdated }: EvalLabViewProps) {
  const [overview, setOverview] = useState<EvalLabOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EvalSubTab>("playbook");
  const [visitedTabs, setVisitedTabs] = useState<Set<EvalSubTab>>(() => new Set(["playbook"]));
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("quick");
  const [activeScenarioId, setActiveScenarioId] = useState<string>("");
  const [dryRuns, setDryRuns] = useState<EvalDryRun[]>([]);
  const [activeDryRunId, setActiveDryRunId] = useState<string>("");

  const userPickedTabRef = useRef(false);
  const initialLandingAppliedRef = useRef(false);
  const tabButtonRefs = useRef<Partial<Record<EvalSubTab, HTMLButtonElement | null>>>({});

  const selectTab = useCallback((tab: EvalSubTab) => {
    userPickedTabRef.current = true;
    setActiveTab(tab);
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set([...prev, tab])));
  }, []);

  const loadEvalLab = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const data = await api.evalLab();
      setOverview(data);
      const runs = data.dry_runs || [];
      setDryRuns(runs);
      setActiveScenarioId((prev) => {
        if (prev && data.scenarios.some((s) => s.id === prev)) return prev;
        const firstIncomplete = data.scenarios.find((s) => !s.completed);
        return firstIncomplete?.id || data.scenarios[0]?.id || "";
      });
      setActiveDryRunId((prev) => {
        if (prev && runs.some((r) => r.id === prev)) return prev;
        return runs[0]?.id || "";
      });

      // Smart landing: show "How It Works" for newcomers; jump straight to Practice once >= 1 calibrated
      if (!initialLandingAppliedRef.current && !userPickedTabRef.current) {
        initialLandingAppliedRef.current = true;
        if ((data.completed_count ?? 0) >= 1) {
          setActiveTab("practice");
          setVisitedTabs((prev) => (prev.has("practice") ? prev : new Set([...prev, "practice"])));
        }
      }
    } catch (err: any) {
      setLoadError(err?.message || "Could not load AI Code Eval Lab.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvalLab(false);
  }, [loadEvalLab]);

  const behavioralAxes = useMemo<BehavioralAxisDef[]>(
    () => (overview?.axes && overview.axes.length > 0 ? overview.axes : DEFAULT_BEHAVIORAL_AXES),
    [overview?.axes]
  );

  const scenarios = overview?.scenarios ?? [];
  const confidencePct = Math.max(0, Math.min(100, Math.round(overview?.confidence_pct ?? 0)));
  const completedCount = overview?.completed_count ?? 0;
  const totalScenarios = overview?.total_scenarios ?? (scenarios.length || 6);
  const ladderItems = overview?.ladder && overview.ladder.length > 0 ? overview.ladder : DEFAULT_LADDER;
  const nextMilestoneIdx = ladderItems.findIndex((item) => !item.done);
  const firstIncompleteIdx = scenarios.findIndex((s) => !s.completed);
  const nextScenarioNumber = firstIncompleteIdx >= 0 ? firstIncompleteIdx + 1 : 1;
  const nextScenarioMinutes =
    firstIncompleteIdx >= 0
      ? scenarios[firstIncompleteIdx]?.estimated_minutes || 5
      : scenarios[0]?.estimated_minutes || 5;

  const TAB_ORDER: EvalSubTab[] = ["playbook", "practice", "dryrun"];

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, current: EvalSubTab) => {
    const idx = TAB_ORDER.indexOf(current);
    if (idx < 0) return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % TAB_ORDER.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = TAB_ORDER.length - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      const targetTab = TAB_ORDER[nextIdx];
      selectTab(targetTab);
      tabButtonRefs.current[targetTab]?.focus();
    }
  };

  const handleStartScenarioOne = () => {
    const first = scenarios.find((s) => !s.completed) || scenarios[0];
    if (first) {
      setActiveScenarioId(first.id);
    }
    selectTab("practice");
  };

  const handleMilestoneClick = (milestoneId: string) => {
    if (milestoneId === "complete_dry_run" || milestoneId === "ready_to_ship") {
      selectTab("dryrun");
    } else {
      handleStartScenarioOne();
    }
  };

  const handleCalibrated = (nextOverview: EvalLabOverview | undefined) => {
    if (nextOverview) {
      setOverview(nextOverview);
      setDryRuns(nextOverview.dry_runs || []);
    }
    onUpdated();
  };

  const handleDryRunRefresh = async () => {
    await loadEvalLab(true);
    onUpdated();
  };

  return (
    <div className="eval-lab-shell">
      {/* Calm Orientation Header, Primary 3-Tab Switcher & Quiet Milestone Trail */}
      <section className="card eval-hero compact" data-testid="eval-lab-hero">
        <div className="eval-hero-top">
          <div className="eval-hero-copy">
            <div className="eval-title-row">
              <span className="eval-eyebrow">
                <Scale size={14} aria-hidden="true" />
                Zero-Stakes Eval Sandbox
              </span>
              <h2>AI Code Eval Lab</h2>
            </div>
            <p className="eval-subtitle">
              Compare Model A vs B transcripts, calibrate against a senior key, and prep your repo
              before going live.
            </p>
          </div>

          <div className="eval-confidence-box compact">
            <div className="eval-confidence-row">
              <span className="eval-confidence-label">Readiness</span>
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
                {completedCount}/{totalScenarios} calibrated
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {dryRuns.length} {dryRuns.length === 1 ? "repo plan" : "repo plans"}
              </span>
            </div>
          </div>
        </div>

        {/* Single Clear 3-Section Navigation Bar */}
        <div className="eval-subtabs" role="tablist" aria-label="AI Code Eval Lab sections">
          <button
            ref={(el) => {
              tabButtonRefs.current.playbook = el;
            }}
            id="eval-tab-btn-playbook"
            type="button"
            role="tab"
            aria-selected={activeTab === "playbook"}
            aria-controls="eval-panel-playbook"
            tabIndex={activeTab === "playbook" ? 0 : -1}
            className={`eval-subtab ${activeTab === "playbook" ? "active" : ""}`}
            data-testid="eval-tab-playbook"
            onClick={() => selectTab("playbook")}
            onKeyDown={(e) => handleTabKeyDown(e, "playbook")}
          >
            <BookOpen size={15} aria-hidden="true" />
            <span>How It Works</span>
          </button>
          <button
            ref={(el) => {
              tabButtonRefs.current.practice = el;
            }}
            id="eval-tab-btn-practice"
            type="button"
            role="tab"
            aria-selected={activeTab === "practice"}
            aria-controls="eval-panel-practice"
            tabIndex={activeTab === "practice" ? 0 : -1}
            className={`eval-subtab ${activeTab === "practice" ? "active" : ""}`}
            data-testid="eval-tab-practice"
            onClick={() => selectTab("practice")}
            onKeyDown={(e) => handleTabKeyDown(e, "practice")}
          >
            <Code2 size={15} aria-hidden="true" />
            <span>Practice A/B</span>
            <span className="eval-tab-count">
              {completedCount}/{totalScenarios}
            </span>
          </button>
          <button
            ref={(el) => {
              tabButtonRefs.current.dryrun = el;
            }}
            id="eval-tab-btn-dryrun"
            type="button"
            role="tab"
            aria-selected={activeTab === "dryrun"}
            aria-controls="eval-panel-dryrun"
            tabIndex={activeTab === "dryrun" ? 0 : -1}
            className={`eval-subtab ${activeTab === "dryrun" ? "active" : ""}`}
            data-testid="eval-tab-dryrun"
            onClick={() => selectTab("dryrun")}
            onKeyDown={(e) => handleTabKeyDown(e, "dryrun")}
          >
            <Wrench size={15} aria-hidden="true" />
            <span>Prep My Repo</span>
            {dryRuns.length > 0 && <span className="eval-tab-count">{dryRuns.length}</span>}
          </button>
        </div>

        {/* Quiet Inline Milestone Progress Trail (Progress Feedback, Not Competing Tabs) */}
        <ol
          className="eval-milestone-trail"
          data-testid="eval-confidence-ladder"
          aria-label="Confidence Ladder"
        >
          {ladderItems.map((milestone, idx) => {
            const isCurrent = idx === nextMilestoneIdx;
            return (
              <li
                key={milestone.id}
                className={`eval-milestone-item ${milestone.done ? "done" : ""} ${
                  isCurrent ? "current" : ""
                }`}
                data-testid={`eval-ladder-${milestone.id}`}
              >
                <button
                  type="button"
                  className="eval-milestone-link"
                  onClick={() => handleMilestoneClick(milestone.id)}
                  title={milestone.done ? "Completed milestone" : "Jump to this step"}
                >
                  <span className="eval-milestone-dot" aria-hidden="true">
                    {milestone.done ? <Check size={10} /> : null}
                  </span>
                  <span className="eval-milestone-label">
                    {formatLadderTitle(milestone.title, idx)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
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
            Loading AI Code Eval Lab scenarios and repo plans…
          </p>
        </div>
      ) : null}

      {visitedTabs.has("playbook") && (
        <div
          id="eval-panel-playbook"
          role="tabpanel"
          aria-labelledby="eval-tab-btn-playbook"
          className="eval-tabpanel"
          hidden={activeTab !== "playbook"}
        >
          <EvalPlaybookTab
            behavioralAxes={behavioralAxes}
            completedCount={completedCount}
            totalScenarios={totalScenarios}
            nextScenarioNumber={nextScenarioNumber}
            nextScenarioMinutes={nextScenarioMinutes}
            onStartScenarioOne={handleStartScenarioOne}
            onOpenDryRun={() => selectTab("dryrun")}
          />
        </div>
      )}

      {visitedTabs.has("practice") && (
        <div
          id="eval-panel-practice"
          role="tabpanel"
          aria-labelledby="eval-tab-btn-practice"
          className="eval-tabpanel"
          hidden={activeTab !== "practice"}
        >
          <EvalPracticeTab
            scenarios={scenarios}
            behavioralAxes={behavioralAxes}
            completedCount={completedCount}
            totalScenarios={totalScenarios}
            activeScenarioId={activeScenarioId}
            practiceMode={practiceMode}
            onChangePracticeMode={setPracticeMode}
            onSelectScenarioId={setActiveScenarioId}
            onCalibrated={handleCalibrated}
            onOpenDryRun={() => selectTab("dryrun")}
          />
        </div>
      )}

      {visitedTabs.has("dryrun") && (
        <div
          id="eval-panel-dryrun"
          role="tabpanel"
          aria-labelledby="eval-tab-btn-dryrun"
          className="eval-tabpanel"
          hidden={activeTab !== "dryrun"}
        >
          <EvalDryRunTab
            dryRuns={dryRuns}
            activeDryRunId={activeDryRunId}
            onSelectDryRunId={setActiveDryRunId}
            onDryRunsChange={setDryRuns}
            onRefresh={handleDryRunRefresh}
          />
        </div>
      )}
    </div>
  );
}
