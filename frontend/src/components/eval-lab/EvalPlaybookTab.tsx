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
  behavioralAxes: BehavioralAxisDef[];
  onStartScenarioOne: () => void;
  onOpenDryRun: () => void;
}

export function EvalPlaybookTab({
  behavioralAxes,
  onStartScenarioOne,
  onOpenDryRun,
}: EvalPlaybookTabProps) {
  return (
    <section className="eval-section-stack" data-testid="eval-playbook">
      {/* 1. 60-Second Visual Orientation Flow */}
      <div className="card eval-flow-card">
        <div className="eval-section-header">
          <div>
            <h3 className="eval-section-title">What You&apos;ll Do Here (3 Calm Steps)</h3>
            <p className="eval-section-desc">
              Think of AI code eval like structured PR review: inspect real transcripts, pick the
              more trustworthy assistant, and calibrate before working live.
            </p>
          </div>
          <div className="eval-flow-actions">
            <button
              type="button"
              className="btn btn-primary eval-cta-btn"
              data-testid="eval-start-scenario-1-btn"
              onClick={onStartScenarioOne}
            >
              <span>Try Scenario 1 (5 min)</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
            <button type="button" className="btn" onClick={onOpenDryRun}>
              <Wrench size={15} aria-hidden="true" />
              <span>Prep My Repo</span>
            </button>
          </div>
        </div>

        <ol className="eval-flow-grid">
          {HOW_IT_WORKS_FLOW.map((item) => (
            <li key={item.step} className="eval-flow-step">
              <span className="eval-flow-num" aria-hidden="true">
                {item.step}
              </span>
              <div className="eval-flow-copy">
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* 2. Scannable 7-Axis Quick Reference + 3 Golden Rules */}
      <div className="card eval-cheatsheet-card" data-testid="eval-7axis-cheatsheet">
        <div className="eval-section-header">
          <div>
            <h3 className="eval-section-title">The 7 Behavioral Axes at a Glance</h3>
            <p className="eval-section-desc">
              Focus on what the agent actually ran and claimed—not formatting aesthetics.
            </p>
          </div>
        </div>

        <div className="eval-axes-ref-grid compact">
          {behavioralAxes.map((axis, idx) => (
            <article key={axis.slug} className="eval-axis-ref-card compact" title={axis.description}>
              <div className="eval-axis-ref-head">
                <span className="eval-axis-ref-num">{idx + 1}</span>
                <h4>{axis.label}</h4>
                {axis.slug === "clarity" && (
                  <span className="eval-clarity-pill">Final Summary Only</span>
                )}
              </div>
              <p>
                <RichText text={AXIS_SHORT_HINTS[axis.slug] || axis.description} />
              </p>
            </article>
          ))}
        </div>

        <div className="eval-rules-grid" data-testid="eval-golden-rules">
          {GOLDEN_RULES.map((rule) => (
            <div key={rule.id} className="eval-rule-card">
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

      {/* 4. On-Demand Reference Drawers (Zero Wall-of-Text Clutter) */}
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
    </section>
  );
}
