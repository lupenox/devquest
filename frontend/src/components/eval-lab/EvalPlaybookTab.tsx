import React from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  Lightbulb,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { BehavioralAxisDef } from "../../types";
import { RichText } from "../RichText";
import {
  AXIS_SHORT_HINTS,
  GOLDEN_RULES,
  HOW_IT_WORKS_FLOW,
  PLAYBOOK_STEPS,
  RED_FLAG_PATTERNS,
} from "./evalLabConstants";

interface EvalPlaybookTabProps {
  step: number;
  onStep: (step: number) => void;
  example?: { line: string; text: string };
  behavioralAxes: BehavioralAxisDef[];
  completedCount?: number;
  totalScenarios?: number;
  nextScenarioNumber?: number;
  nextScenarioMinutes?: number;
  onStartScenarioOne: () => void;
  onOpenDryRun: () => void;
}

export function EvalPlaybookTab({
  step, onStep, example, behavioralAxes,
  completedCount = 0,
  totalScenarios = 6,
  nextScenarioNumber = 1,
  nextScenarioMinutes = 5,
  onStartScenarioOne,
  onOpenDryRun,
}: EvalPlaybookTabProps) {
  const ctaLabel =
    completedCount === 0
      ? `Try Scenario 1 (${nextScenarioMinutes} min)`
      : completedCount >= totalScenarios
        ? "Review A/B Scenarios"
        : `Continue Scenario ${nextScenarioNumber} (~${nextScenarioMinutes} min)`;

  return (
    <section className="eval-section-stack" data-testid="eval-playbook">
      <div className="card lab-lesson">
        <small>How It Works · {step + 1} of 3</small>
        <h3>{["Compare two model responses", "Cite what you observed", "Check your judgment"][step]}</h3>
        <p>{["Two models received the same programming task. Decide which one met the requirements and find a line that supports your call.",
          "In Practice, select a transcript line to quote it in your evaluation. Explain what that line shows.",
          "After you submit, compare your verdict with the senior reviewer’s reasoning. Open the scoring details to see which signals you picked up or missed."][step]}</p>
        {step === 1 && example && <blockquote>[{example.line}] {example.text}</blockquote>}
        <div className="lab-actions">
          <button type="button" className="btn btn-primary" data-testid="eval-start-scenario-1-btn" onClick={onStartScenarioOne}>
            {completedCount ? ctaLabel : "Try the first scenario"} <ArrowRight size={15}/>
          </button>
          {step > 0 && <button className="btn" onClick={() => onStep(step - 1)}>Back</button>}
          {step < 2 && <button className="btn" onClick={() => onStep(step + 1)}>{step ? "See how calibration works" : "See an evidence example"}</button>}
        </div>
      </div>
      <details className="lab-reference"><summary>Open reference</summary>
      {/* 2. Clean 7-Axis Scannable List + 3 Rules Footer */}
      <div className="card eval-cheatsheet-card" data-testid="eval-7axis-cheatsheet">
        <div className="eval-section-header">
          <div>
            <h3 className="eval-section-title">The 7 Behavioral Axes at a Glance</h3>
            <p className="eval-section-desc">
              Grade what the agent actually ran and claimed — not formatting aesthetics.
            </p>
          </div>
        </div>

        <dl className="eval-axes-list">
          {behavioralAxes.map((axis, idx) => (
            <div key={axis.slug} className="eval-axis-list-row" title={axis.description}>
              <dt className="eval-axis-list-term">
                <span className="eval-axis-ref-num">{idx + 1}</span>
                <span>{axis.label}</span>
                {axis.slug === "clarity" && (
                  <span className="eval-clarity-pill">Final Summary Only</span>
                )}
              </dt>
              <dd className="eval-axis-list-desc">
                <RichText text={AXIS_SHORT_HINTS[axis.slug] || axis.description} />
              </dd>
            </div>
          ))}
        </dl>

        <div className="eval-rules-strip" data-testid="eval-golden-rules">
          {GOLDEN_RULES.map((rule) => (
            <div key={rule.id} className="eval-rule-item">
              <div className="eval-rule-head">
                <ShieldCheck size={14} aria-hidden="true" />
                <strong>{rule.title}</strong>
              </div>
              <p>
                <RichText text={rule.body} />
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 3. First-Task Confidence Tip (Compact) */}
      <div className="card eval-tip-card compact" data-testid="eval-confidence-tip">
        <div className="eval-tip-icon" aria-hidden="true">
          <Lightbulb size={18} />
        </div>
        <div className="eval-tip-body">
          <h4>First-Task Confidence Tip</h4>
          <p>
            Start on a public <strong>MIT or Apache-2.0</strong> repo you already know (under 100 MB,
            no <code>AGENTS.md</code>, zero secrets/PII). Knowing how the tests work removes{" "}
            <strong>80% of the stress</strong> so spotting transcript traps feels natural.
          </p>
        </div>
      </div>

      {/* 4. On-Demand Reference Drawers (Collapsed Until Needed) */}
      <div className="card eval-reference-drawers" data-testid="eval-reference-drawers">
        <details className="eval-drawer" data-testid="eval-drawer-playbook">
          <summary className="eval-drawer-summary">
            <BookOpen size={16} aria-hidden="true" />
            <span>
              <strong>Full 5-Step Live Session Playbook</strong>
              <small>25–40 min step-by-step walkthrough from task scoping to solo write-up</small>
            </span>
            <ChevronDown size={16} className="eval-drawer-chevron" aria-hidden="true" />
          </summary>
          <div className="eval-drawer-body">
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
        </details>

        <details className="eval-drawer" data-testid="eval-drawer-traps">
          <summary className="eval-drawer-summary">
            <ShieldAlert size={16} aria-hidden="true" />
            <span>
              <strong>4 High-Signal Behavioral Traps to Watch For</strong>
              <small>Quick pre-session cheat list of the most common model failure modes</small>
            </span>
            <ChevronDown size={16} className="eval-drawer-chevron" aria-hidden="true" />
          </summary>
          <div className="eval-drawer-body">
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
          </div>
        </details>
      </div>
      </details>
    </section>
  );
}
