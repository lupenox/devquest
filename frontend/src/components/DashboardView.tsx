import { ArrowRight, ChevronDown, Clock, Shield, Sparkles, Timer } from "lucide-react";
import type { DashboardData } from "../types";
import { RichText } from "./RichText";
import { DashboardLibrary } from "./DashboardLibrary";
import "../dashboard.css";

interface Props {
  data: DashboardData;
  onSelectTech: (slug: string) => void;
  onOpenModule: (moduleId: string) => void;
  onGoToForge: () => void;
  onStartSprint?: (durationMinutes?: number) => void;
}

export function fallbackRankTitle(level: number): string {
  if (level >= 10) return "Staff Architect";
  if (level >= 7) return "Systems Crafter";
  if (level >= 5) return "Full-Stack Vanguard";
  if (level >= 3) return "Bug Hunter";
  return "Modal Initiate";
}

type Practice = NonNullable<DashboardData["daily_warmup"]>[number] | DashboardData["recommended_next"][number];

function drillTitle(item: { title: string }) {
  return <RichText text={item.title.replace(/^Participation Activity:\s*/i, "")} />;
}

export function DashboardView({ data, onSelectTech, onOpenModule, onGoToForge, onStartSprint }: Props) {
  const practice: Practice[] = data.daily_warmup?.length ? data.daily_warmup : data.recommended_next;
  const [next, ...more] = practice;
  const goalPct = Math.min(100, Math.round(data.today_xp / Math.max(1, data.daily_xp_target) * 100));
  const rankTitle = data.rank_title || fallbackRankTitle(data.level);

  function practiceMeta(item: Practice) {
    const tech = data.technologies.find((t) => t.slug === item.tech_slug)?.name || item.tech_slug;
    const detail = "reason" in item ? item.reason : `${item.module_title} · ~${item.estimated_minutes} min`;
    return <>{tech} · {item.activity_type.replaceAll("_", " ")} · {detail}</>;
  }

  function reviewButton(review: DashboardData["due_reviews"][number]) {
    return (
      <button key={review.activity_id} type="button" onClick={() => onOpenModule(review.module_id)}>
        <span>{drillTitle(review)}</span> <ArrowRight size={14} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="dashboard-home">
      <div className="dashboard-today">
        <section className="practice-panel" aria-labelledby="practice-heading" data-testid="daily-warmup-list">
          <header className="practice-caption">
            <span><Sparkles size={16} aria-hidden="true" /> Daily practice</span>
            {next && <span>+{next.xp_reward} XP</span>}
          </header>
          <h2 id="practice-heading">{next ? drillTitle(next) : "No suggested drills"}</h2>
          {next && <p className="practice-meta">{practiceMeta(next)}</p>}
          {next && (
            <button type="button" className="practice-start" onClick={() => onOpenModule(next.module_id)}>
              Start practice <ArrowRight size={17} aria-hidden="true" />
            </button>
          )}

          <details className="practice-alternatives">
            <summary>{more.length ? `More practice (${more.length})` : "Terminal shortcuts"}<ChevronDown size={15} aria-hidden="true" /></summary>
            {more.map((item) => (
              <button type="button" className="practice-alternative" key={item.activity_id} onClick={() => onOpenModule(item.module_id)}>
                <span><strong>{drillTitle(item)}</strong><small>{practiceMeta(item)}</small></span>
                <span>+{item.xp_reward} XP</span>
              </button>
            ))}
            <p className="terminal-tip">Open a drill in Neovim with <code>devquest next</code> or <code>devquest next python</code>.</p>
          </details>

          {onStartSprint && (
            <div className="practice-sprints" role="group" aria-label="Timed sprint">
              <span><Timer size={16} aria-hidden="true" /> Timed sprint</span>
              <div>
                {[2, 5, 10].map((minutes) => (
                  <button key={minutes} type="button" data-testid={`quick-sprint-${minutes}`}
                    aria-label={`Start ${minutes}-minute sprint`} onClick={() => onStartSprint(minutes)}>
                    {minutes} min
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="card progress-panel" aria-labelledby="progress-heading">
          <h2 id="progress-heading">Your progress</h2>
          <div className="goal-label"><span>Daily goal</span><strong>{data.today_xp} / {data.daily_xp_target} XP</strong></div>
          <div className="progress-track" role="progressbar" aria-label="Daily XP goal" aria-valuenow={goalPct}
            aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${goalPct}%`}>
            <div className="progress-fill" style={{ width: `${goalPct}%`, background: "var(--green-solid)" }} />
          </div>
          <dl className="player-metrics">
            <div><dt>Total XP</dt><dd>{data.total_xp}</dd></div>
            <div><dt>Streak</dt><dd>{data.streak_days}<small> {data.streak_days === 1 ? "day" : "days"}</small></dd></div>
            <div><dt>Drills mastered</dt><dd>{data.completed_activities}<small> / {data.total_activities}</small></dd></div>
          </dl>
          <div className="progress-rank">
            <Shield size={19} aria-hidden="true" />
            <div>
              <strong data-testid="player-rank-badge">Lv.{data.level} {rankTitle}</strong>
              <small>{Math.max(0, data.xp_for_next - data.xp_in_level)} XP to level {data.level + 1}</small>
            </div>
          </div>
          <div className="dashboard-reviews">
            {data.due_reviews.length ? (
              <>
                <strong>{data.due_reviews.length} {data.due_reviews.length === 1 ? "review" : "reviews"} due</strong>
                {data.due_reviews.slice(0, 2).map(reviewButton)}
                {data.due_reviews.length > 2 && (
                  <details>
                    <summary>More reviews ({data.due_reviews.length - 2})</summary>
                    {data.due_reviews.slice(2).map(reviewButton)}
                  </details>
                )}
              </>
            ) : <span><Clock size={14} aria-hidden="true" /> No reviews due</span>}
          </div>
        </section>
      </div>
      <DashboardLibrary data={data} onSelectTech={onSelectTech} onGoToForge={onGoToForge} />
    </div>
  );
}
