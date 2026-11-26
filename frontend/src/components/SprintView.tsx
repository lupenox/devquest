import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Award,
  CheckCircle2,
  Clock,
  Flame,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";
import { api } from "../api";
import type { Activity, GradeOutcome, SprintCompleteResp, Technology } from "../types";
import { ActivityCard } from "./ActivityWidgets";

interface Props {
  technologies: Technology[];
  initialDuration?: number;
  liveOutcome: GradeOutcome | null;
  onSprintCompleted: (resp: SprintCompleteResp) => void;
  onBackToDashboard: () => void;
}

type SprintPhase = "setup" | "active" | "summary";

const DURATIONS = [
  { minutes: 2, drills: "2 drills", label: "Quick Burst", desc: "Perfect for a quick epoch or compile check." },
  { minutes: 5, drills: "4 drills", label: "AI Break Classic", desc: "Balanced rapid-fire drills with 3x combo potential." },
  { minutes: 10, drills: "6 drills", label: "Deep Focus Sprint", desc: "Extended multi-tech gauntlet for big bonus XP." },
];

export function comboMultiplierLabel(combo: number): string {
  if (combo >= 3) return "3x";
  if (combo === 2) return "2x";
  if (combo === 1) return "1.5x";
  return "1x";
}

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function SprintView({
  technologies,
  initialDuration,
  liveOutcome,
  onSprintCompleted,
  onBackToDashboard,
}: Props) {
  const [phase, setPhase] = useState<SprintPhase>("setup");
  const [durationMinutes, setDurationMinutes] = useState<number>(
    initialDuration === 2 || initialDuration === 5 || initialDuration === 10 ? initialDuration : 5
  );
  const [techSlug, setTechSlug] = useState<string>("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(300);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [passedIds, setPassedIds] = useState<string[]>([]);
  const [earnedXp, setEarnedXp] = useState(0);
  const [currentPassed, setCurrentPassed] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SprintCompleteResp | null>(null);
  const finishingRef = useRef(false);

  useEffect(() => {
    if (initialDuration === 2 || initialDuration === 5 || initialDuration === 10) {
      setDurationMinutes(initialDuration);
    }
  }, [initialDuration]);

  const finishSprint = useCallback(
    async (finalCompleted: number, finalMaxCombo: number) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      setPhase("summary");
      setLoading(true);
      setError(null);
      try {
        const res = await api.sprintComplete(durationMinutes, finalCompleted, finalMaxCombo);
        setSummary(res);
        onSprintCompleted(res);
      } catch (e: any) {
        setError(e?.message || "Could not record sprint bonus XP");
      } finally {
        setLoading(false);
      }
    },
    [durationMinutes, onSprintCompleted]
  );

  // Live countdown timer during active sprint
  useEffect(() => {
    if (phase !== "active") return;
    if (secondsLeft <= 0) {
      finishSprint(passedIds.length, maxCombo);
      return;
    }
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, secondsLeft, finishSprint, passedIds.length, maxCombo]);

  const startSprint = async () => {
    setLoading(true);
    setError(null);
    finishingRef.current = false;
    try {
      const res = await api.sprintStart(durationMinutes, techSlug || null);
      if (!res.activities || res.activities.length === 0) {
        setError("No drills matched that filter. Try 'All Technologies'.");
        return;
      }
      setActivities(res.activities);
      setCurrentIdx(0);
      setSecondsLeft((res.duration_minutes || durationMinutes) * 60);
      setCombo(0);
      setMaxCombo(0);
      setPassedIds([]);
      setEarnedXp(0);
      setCurrentPassed(false);
      setSummary(null);
      setPhase("active");
    } catch (e: any) {
      setError(e?.message || "Failed to start sprint");
    } finally {
      setLoading(false);
    }
  };

  const handleDrillGraded = (outcome: GradeOutcome) => {
    if (outcome.passed) {
      setCurrentPassed(true);
      if (!passedIds.includes(outcome.activity_id)) {
        const nextPassed = [...passedIds, outcome.activity_id];
        const nextCombo = combo + 1;
        const nextMax = Math.max(maxCombo, nextCombo);
        setPassedIds(nextPassed);
        setCombo(nextCombo);
        setMaxCombo(nextMax);
        setEarnedXp((xp) => xp + (outcome.xp_awarded || 0));
      }
    } else {
      setCombo(0);
    }
  };

  const goNextDrill = () => {
    if (currentIdx + 1 >= activities.length) {
      finishSprint(passedIds.length, maxCombo);
    } else {
      setCurrentIdx((i) => i + 1);
      setCurrentPassed(false);
    }
  };

  const skipDrill = () => {
    setCombo(0);
    if (currentIdx + 1 >= activities.length) {
      finishSprint(passedIds.length, maxCombo);
    } else {
      setCurrentIdx((i) => i + 1);
      setCurrentPassed(false);
    }
  };

  if (phase === "setup") {
    return (
      <div style={{ display: "grid", gap: 18 }}>
        <div className="card sprint-banner">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h2 className="card-title" style={{ fontSize: "1.25rem", marginBottom: 6 }}>
                <Zap size={20} color="var(--amber)" /> AI Training Break Sprint Arena
              </h2>
              <p className="muted" style={{ margin: 0, fontSize: "0.9rem", maxWidth: 680 }}>
                Waiting for a build, test run, or model checkpoint? Chain rapid-fire interactive drills back-to-back to ignite your{" "}
                <strong style={{ color: "var(--amber)" }}>1x → 1.5x → 2x → 3x Combo Multiplier</strong> and earn Sprint Bonus XP!
              </p>
            </div>
            <span className="badge badge-xp">
              <Flame size={12} /> 3x Combo unlocks Sprint Sniper badge
            </span>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">1. Choose Sprint Duration</h3>
          <div className="sprint-duration-grid">
            {DURATIONS.map((d) => (
              <button
                key={d.minutes}
                type="button"
                data-testid={`sprint-dur-${d.minutes}`}
                className={`sprint-dur-card ${durationMinutes === d.minutes ? "selected" : ""}`}
                onClick={() => setDurationMinutes(d.minutes)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <strong style={{ fontSize: "1.1rem" }}>{d.minutes} min</strong>
                  <span className="badge badge-kind">{d.drills}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 4 }}>{d.label}</div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>{d.desc}</div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 240px", maxWidth: 340 }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, marginBottom: 6 }}>
                2. Optional Technology Focus
              </label>
              <select
                className="select-field"
                aria-label="Sprint technology filter"
                value={techSlug}
                onChange={(e) => setTechSlug(e.target.value)}
              >
                <option value="">All Technologies (Smart Mix)</option>
                {technologies.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name} ({Math.round(t.mastery_pct)}%)
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              data-testid="sprint-start-btn"
              disabled={loading}
              onClick={startSprint}
              style={{ padding: "10px 20px", fontSize: "0.95rem" }}
            >
              <Play size={16} /> {loading ? "Building Sprint Deck..." : `Launch ${durationMinutes}-Min Sprint`}
            </button>
          </div>

          {error && <div className="feedback-box err">{error}</div>}
        </div>
      </div>
    );
  }

  if (phase === "active") {
    const current = activities[currentIdx];
    const progressPct = Math.round(((currentIdx + (currentPassed ? 1 : 0)) / Math.max(1, activities.length)) * 100);
    const comboLabel = comboMultiplierLabel(combo);
    const comboTier = combo >= 3 ? "combo-3" : combo >= 2 ? "combo-2" : combo >= 1 ? "combo-1" : "";

    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div className="card sprint-hud">
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div className="hud-pill" data-testid="sprint-timer">
                <Clock size={16} color={secondsLeft <= 30 ? "var(--red)" : "var(--cyan)"} />
                <strong style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "1rem" }}>
                  {formatClock(secondsLeft)}
                </strong>
              </div>
              <div className={`combo-pill ${comboTier}`} data-testid="sprint-combo">
                <Flame size={15} />
                <strong>{comboLabel} Combo</strong>
                <span style={{ fontSize: "0.75rem", opacity: 0.85 }}>({combo} streak)</span>
              </div>
              <div className="hud-pill">
                <CheckCircle2 size={15} color="var(--green)" />
                <strong>
                  Drill {currentIdx + 1} / {activities.length}
                </strong>
                <span className="muted">({passedIds.length} cleared)</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={skipDrill}>
                <SkipForward size={14} /> Skip
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => finishSprint(passedIds.length, maxCombo)}
              >
                Finish Early
              </button>
            </div>
          </div>

          <div className="progress-track" style={{ marginTop: 12, marginBottom: 0 }}>
            <div
              className="progress-fill"
              style={{
                width: `${progressPct}%`,
                background: "linear-gradient(90deg, var(--accent), var(--amber), var(--green))",
              }}
            />
          </div>
        </div>

        {current && (
          <ActivityCard
            key={current.id}
            activity={current}
            liveOutcome={liveOutcome?.activity_id === current.id ? liveOutcome : null}
            onGraded={handleDrillGraded}
          />
        )}

        {currentPassed && (
          <div
            className="card"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              borderColor: "var(--green-solid)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={18} color="var(--green)" />
              <strong>
                Drill cleared! Combo is now {comboLabel}!
              </strong>
            </div>
            <button
              type="button"
              className="btn btn-green"
              data-testid="sprint-next-btn"
              onClick={goNextDrill}
            >
              {currentIdx + 1 >= activities.length ? (
                <>
                  <Trophy size={15} /> Finish Sprint &amp; Claim Combo Bonus
                </>
              ) : (
                <>
                  Next Drill <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Summary phase
  const bestLabel = comboMultiplierLabel(maxCombo);
  return (
    <div className="card" data-testid="sprint-summary" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Trophy size={24} color="var(--amber)" />
        <div>
          <h2 style={{ margin: 0 }}>Sprint Complete!</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.88rem" }}>
            {durationMinutes}-minute AI Training Break session logged.
          </p>
        </div>
      </div>

      <div className="sprint-duration-grid">
        <div className="surface-card">
          <div className="muted" style={{ fontSize: "0.8rem" }}>Drills Cleared</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: 4 }}>
            {passedIds.length} / {activities.length}
          </div>
        </div>
        <div className="surface-card">
          <div className="muted" style={{ fontSize: "0.8rem" }}>Peak Combo</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: 4, color: "var(--amber)" }}>
            {bestLabel}
          </div>
        </div>
        <div className="surface-card">
          <div className="muted" style={{ fontSize: "0.8rem" }}>Combo Bonus XP</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: 4, color: "var(--green)" }} data-testid="sprint-bonus-xp">
            {loading ? "..." : `+${summary?.bonus_xp ?? 0} XP`}
          </div>
          <div className="muted" style={{ fontSize: "0.75rem" }}>+{earnedXp} drill XP earned</div>
        </div>
      </div>

      {error && <div className="feedback-box err">{error}</div>}

      {summary?.unlocked_achievements && summary.unlocked_achievements.length > 0 && (
        <div className="feedback-box ok" style={{ marginTop: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Award size={16} /> <strong>New Achievements Unlocked!</strong>
          </div>
          {summary.unlocked_achievements.map((a) => (
            <div key={a.slug}>
              {a.name} (+{a.bonus_xp} XP)
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            finishingRef.current = false;
            setPhase("setup");
          }}
        >
          <RotateCcw size={15} /> Run Another Sprint
        </button>
        <button type="button" className="btn" onClick={onBackToDashboard}>
          Back to Mastery Dashboard
        </button>
      </div>
    </div>
  );
}
