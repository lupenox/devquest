import {
  Award, BookOpen, Bug, CheckCircle2, ChevronDown, ChevronRight, Code2, Crosshair,
  Crown, Flame, FolderGit2, GitBranch, Globe, History, Lock, Plus, Shield, Sparkles,
  Swords, Target, Terminal, Trophy, Zap, type LucideIcon,
} from "lucide-react";
import type { DashboardData, Technology } from "../types";
import "../dashboard-library.css";

interface Props {
  data: DashboardData;
  onSelectTech: (slug: string) => void;
  onGoToForge: () => void;
}

const achievementIcons = new Map<string, LucideIcon>([
  ["award", Award], ["trophy", Trophy], ["zap", Zap], ["sprint", Zap],
  ["bug", Bug], ["flame", Flame], ["swords", Swords], ["sword", Swords],
  ["github", FolderGit2], ["git", FolderGit2], ["git-branch", GitBranch],
  ["crosshair", Crosshair], ["globe", Globe], ["crown", Crown], ["target", Target],
  ["terminal", Terminal], ["vim", Terminal], ["code", Code2], ["shield", Shield],
  ["sparkles", Sparkles], ["star", Sparkles],
]);

function AchievementIcon({ icon }: { icon: string }) {
  const Icon = achievementIcons.get(icon.trim().toLowerCase());
  if (Icon) return <Icon size={17} aria-hidden="true" />;
  if (icon && icon.length <= 4 && !/^[a-z0-9_-]+$/i.test(icon)) {
    return <span aria-hidden="true">{icon}</span>;
  }
  return <Award size={17} aria-hidden="true" />;
}

function LibrarySummary({ icon: Icon, title, count }: { icon: LucideIcon; title: string; count: string }) {
  return (
    <summary className="library-summary">
      <Icon size={18} aria-hidden="true" />
      <strong>{title}</strong>
      <span className="library-count">{count}</span>
      <ChevronDown size={16} className="library-chevron" aria-hidden="true" />
    </summary>
  );
}

const dayLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function RecentDays({ totals }: { totals: DashboardData["daily_totals"] }) {
  const today = new Date();
  return (
    <figure className="library-history">
      <figcaption>XP over the last 14 days</figcaption>
      <ol>
        {Array.from({ length: 14 }, (_, i) => {
          const date = new Date(today);
          date.setUTCDate(today.getUTCDate() - 13 + i);
          const iso = date.toISOString().slice(0, 10);
          const xp = totals[iso] || 0;
          const alpha = Math.min(.95, .35 + xp / 140);
          return (
            <li key={iso} title={`${iso}: ${xp} XP`}>
              <time dateTime={iso}>{dayLabel.format(date)}</time>
              <span className="heat-cell" aria-hidden="true"
                style={xp > 0 ? { background: `rgba(var(--heat-active-rgb), ${alpha})` } : undefined} />
              <b>{xp} XP</b>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

export function DashboardLibrary({ data, onSelectTech, onGoToForge }: Props) {
  const byCategory = new Map<string, Technology[]>();
  for (const tech of data.technologies) {
    const group = byCategory.get(tech.category);
    if (group) group.push(tech);
    else byCategory.set(tech.category, [tech]);
  }
  const achievements = data.achievements ?? [];
  const unlocked = achievements.filter((achievement) => achievement.unlocked).length;
  const recentCount = data.recent_xp.length;
  return (
    <section className="card dashboard-library" aria-label="Learning tracks and progress">
      <details data-testid="learning-tracks">
        <LibrarySummary icon={BookOpen} title="Learning tracks"
          count={`${data.technologies.length} ${data.technologies.length === 1 ? "technology" : "technologies"}`} />
        <div className="library-content">
          <button type="button" className="btn btn-sm" onClick={onGoToForge}>
            <Plus size={15} aria-hidden="true" /> Generate module
          </button>
          {Array.from(byCategory, ([category, techs]) => (
            <div className="library-track-group" key={category}>
              <h3>{category}</h3>
              {techs.map((tech) => (
                <button type="button" key={tech.slug} data-testid={`tech-card-${tech.slug}`}
                  className="library-track" onClick={() => onSelectTech(tech.slug)}>
                  <span className="library-track-name">
                    <span className="tech-dot" style={{ background: tech.color }} />
                    <strong>{tech.name}</strong>
                  </span>
                  <span className="library-track-level">Lv.{tech.level} · {tech.xp} XP</span>
                  <span className="library-track-freshness">{tech.freshness}</span>
                  <span className="library-track-mastery">
                    <span>{tech.completed_activities}/{tech.total_activities} mastered</span>
                    <span className="library-track-meter" aria-hidden="true">
                      <span style={{ width: `${tech.mastery_pct}%`, background: tech.color }} />
                    </span>
                    <b>{Math.round(tech.mastery_pct)}%</b>
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          ))}
        </div>
      </details>

      <details data-testid="achievements-shelf">
        <LibrarySummary icon={Trophy} title="Achievements" count={`${unlocked} / ${achievements.length} unlocked`} />
        <div className="library-content">
          {achievements.length === 0 && <p className="library-empty">No achievements available yet.</p>}
          <ul className="library-achievements">
            {achievements.map((ach) => (
              <li key={ach.slug} data-testid={`achievement-${ach.slug}`}
                className={`library-achievement ${ach.unlocked ? "unlocked" : "locked"}`}>
                <span className="library-achievement-icon"><AchievementIcon icon={ach.icon} /></span>
                <div>
                  <strong>{ach.name}</strong>
                  <p>{ach.description}</p>
                  {ach.unlocked && ach.unlocked_at && (
                    <small>Unlocked <time dateTime={ach.unlocked_at}>{ach.unlocked_at.slice(0, 10)}</time></small>
                  )}
                </div>
                {ach.unlocked ? (
                  <CheckCircle2 size={15} role="img" aria-label="Unlocked" />
                ) : (
                  <Lock size={14} role="img" aria-label="Locked" />
                )}
              </li>
            ))}
          </ul>
        </div>
      </details>

      <details data-testid="recent-xp">
        <LibrarySummary icon={History} title="Recent XP"
          count={recentCount ? `${recentCount} ${recentCount === 1 ? "entry" : "entries"}` : "No activity"} />
        <div className="library-content">
          <RecentDays totals={data.daily_totals} />
          {recentCount === 0 ? (
            <p className="library-empty">Complete a drill to earn your first XP.</p>
          ) : (
            <ul className="library-ledger">
              {data.recent_xp.map((entry) => (
                <li key={entry.id}>
                  <strong><span className="tech-dot" style={{ background: entry.color }} />{entry.tech_name}</strong>
                  <span>{entry.reason}</span>
                  <b>{entry.amount >= 0 ? "+" : ""}{entry.amount} XP</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
