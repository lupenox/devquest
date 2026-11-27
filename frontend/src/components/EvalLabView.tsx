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
  const [activeScenarioId, setActiveScenarioId] = useState<string>("");
  const [dryRuns, setDryRuns] = useState<EvalDryRun[]>([]);
  const [activeDryRunId, setActiveDryRunId] = useState<string>("");

  const userPickedTabRef = useRef(false);
  const initialLandingAppliedRef = useRef(false);

  const selectTab = useCallback((tab: EvalSubTab) => {
    userPickedTabRef.current = true;
    setActiveTab(tab);
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

      // Smart landing: show "1. How It Works" for newcomers; jump straight to Practice once >= 1 calibrated
      if (!initialLandingAppliedRef.current && !userPickedTabRef.current) {
        initialLandingAppliedRef.current = true;
        if ((data.completed_count ?? 0) >= 1) {
          setActiveTab("practice");
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
      {/* Compact Orientation Header & Interactive 4-Step Progress Bar */}
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
              Learn the 7 behavioral signals, compare Model A vs B transcripts, and verify your own
              repo before starting a live session.
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

        {/* Interactive Slim 4-Step Confidence Ladder */}
        <ol
          className="eval-ladder-grid slim"
          data-testid="eval-confidence-ladder"
          aria-label="Confidence Ladder"
        >
          {ladderItems.map((milestone, idx) => {
            const isCurrent = idx === nextMilestoneIdx;
            return (
              <li
                key={milestone.id}
                className={`eval-ladder-step ${milestone.done ? "done" : ""} ${
                  isCurrent ? "current" : ""
                }`}
                data-testid={`eval-ladder-${milestone.id}`}
              >
                <button
                  type="button"
                  className="eval-ladder-btn"
                  onClick={() => handleMilestoneClick(milestone.id)}
                  title={milestone.done ? "Completed milestone" : "Click to work on this step"}
                >
                  <span className="eval-ladder-dot" aria-hidden="true">
                    {milestone.done ? <Check size={12} /> : idx + 1}
                  </span>
                  <span className="eval-ladder-title">{formatLadderTitle(milestone.title, idx)}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Numbered 3-Step Segmented Workflow Tabs */}
        <div className="eval-subtabs" role="tablist" aria-label="AI Code Eval Lab sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "playbook"}
            className={`eval-subtab ${activeTab === "playbook" ? "active" : ""}`}
            data-testid="eval-tab-playbook"
            onClick={() => selectTab("playbook")}
          >
            <BookOpen size={15} aria-hidden="true" />
            <span>1. How It Works</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "practice"}
            className={`eval-subtab ${activeTab === "practice" ? "active" : ""}`}
            data-testid="eval-tab-practice"
            onClick={() => selectTab("practice")}
          >
            <Code2 size={15} aria-hidden="true" />
            <span>2. Practice A/B ({totalScenarios})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "dryrun"}
            className={`eval-subtab ${activeTab === "dryrun" ? "active" : ""}`}
            data-testid="eval-tab-dryrun"
            onClick={() => selectTab("dryrun")}
          >
            <Wrench size={15} aria-hidden="true" />
            <span>3. Prep My Repo</span>
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
            Loading AI Code Eval Lab scenarios and repo plans…
          </p>
        </div>
      ) : null}

      {activeTab === "playbook" && (
        <EvalPlaybookTab
          behavioralAxes={behavioralAxes}
          onStartScenarioOne={handleStartScenarioOne}
          onOpenDryRun={() => selectTab("dryrun")}
        />
      )}

      {activeTab === "practice" && (
        <EvalPracticeTab
          scenarios={scenarios}
          behavioralAxes={behavioralAxes}
          completedCount={completedCount}
          totalScenarios={totalScenarios}
          activeScenarioId={activeScenarioId}
          onSelectScenarioId={setActiveScenarioId}
          onCalibrated={handleCalibrated}
          onOpenDryRun={() => selectTab("dryrun")}
        />
      )}

      {activeTab === "dryrun" && (
        <EvalDryRunTab
          dryRuns={dryRuns}
          activeDryRunId={activeDryRunId}
          onSelectDryRunId={setActiveDryRunId}
          onDryRunsChange={setDryRuns}
          onRefresh={handleDryRunRefresh}
        />
      )}
    </div>
  );
}
