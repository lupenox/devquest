import { ArrowRight, Calendar, ChevronDown, Clock, Shield, Sparkles, Timer } from "lucide-react";
import { pushRoute } from "../router";
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
  onOpenRepos?: () => void;
}

function formatCountdown(hoursUntil: number): string {
  if (!Number.isFinite(hoursUntil) || hoursUntil <= 0) return "Today";
  if (hoursUntil < 1) return "Today (<1h left)";
  if (hoursUntil < 24) return `Today · ${Math.ceil(hoursUntil)}h left`;
  const days = Math.floor(hoursUntil / 24);
  const remHours = Math.round(hoursUntil % 24);
  if (remHours === 24) return `${days + 1}d left`;
  return remHours > 0 ? `${days}d ${remHours}h left` : `${days}d left`;
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

export function DashboardView({ data, onSelectTech, onOpenModule, onGoToForge, onStartSprint, onOpenRepos }: Props) {
  const practice: Practice[] = data.daily_warmup?.length ? data.daily_warmup : data.recommended_next;
  const [next, ...more] = practice;
  const goalPct = Math.min(100, Math.round(data.today_xp / Math.max(1, data.daily_xp_target) * 100));
  const rankTitle = data.rank_title || fallbackRankTitle(data.level);
  const upcoming = data.upcoming_campaign ?? null;

  const openRepos = () => {
    if (onOpenRepos) {
      onOpenRepos();
      return;
    }
    pushRoute({ tab: "repos", techSlug: null, moduleId: null });
    window.dispatchEvent(new Event("popstate"));
  };

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
      {upcoming && (
        <section
          className="card upcoming-interview-banner"
          aria-labelledby="upcoming-interview-heading"
          data-testid="upcoming-interview-banner"
        >
          <div className="upcoming-interview-main">
            <div className="upcoming-interview-eyebrow">
              <span className="upcoming-pill">
                <Calendar size={14} aria-hidden="true" /> Upcoming interview
              </span>
              <span className="upcoming-countdown">{formatCountdown(upcoming.hours_until)}</span>
              {upcoming.duration_minutes > 0 && (
                <span className="upcoming-meta-chip">{upcoming.duration_minutes} min</span>
              )}
            </div>
            <h2 id="upcoming-interview-heading">
              {upcoming.company} — {upcoming.role}
            </h2>
            <p className="upcoming-interview-next">
              {upcoming.next_item_title ? (
                <>
                  Next study item: <strong>{upcoming.next_item_title}</strong>
                </>
              ) : (
                <>
                  {upcoming.mastered_items}/{upcoming.total_items} drills ready
                </>
              )}
              {upcoming.interviewer_name ? ` · with ${upcoming.interviewer_name}` : ""}
            </p>
          </div>

          <div className="upcoming-interview-side">
            <div className="upcoming-readiness">
              <div className="goal-label">
                <span>Readiness</span>
                <strong>{Math.round(upcoming.readiness_pct)}%</strong>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Upcoming interview readiness"
                aria-valuenow={Math.round(upcoming.readiness_pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={`${Math.round(upcoming.readiness_pct)}%`}
              >
                <div
                  className="progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, Math.round(upcoming.readiness_pct)))}%`,
                    background: "linear-gradient(90deg, var(--accent), var(--green-solid))",
                  }}
                />
              </div>
              <small className="muted">
                {upcoming.mastered_items}/{upcoming.total_items} drills ready
              </small>
            </div>
            <button type="button" className="btn btn-primary upcoming-interview-cta" onClick={openRepos}>
              Study Interview Plan <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        </section>
      )}
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
