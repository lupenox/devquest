import React from "react";
import {
  Award,
  Bug,
  CheckCircle2,
  Clock,
  Code2,
  Crosshair,
  Crown,
  Flame,
  FolderGit2,
  GitBranch,
  Globe,
  Lock,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  Swords,
  Target,
  Terminal,
  Trophy,
  Zap,
} from "lucide-react";
import type { AchievementItem, DashboardData, Technology } from "../types";

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

function renderAchievementIcon(icon: string, unlocked: boolean) {
  const color = unlocked ? "var(--amber)" : "var(--text-muted)";
  const key = (icon || "").toLowerCase().trim();
  switch (key) {
    case "trophy":
      return <Trophy size={18} color={color} />;
    case "zap":
    case "sprint":
      return <Zap size={18} color={color} />;
    case "bug":
      return <Bug size={18} color={color} />;
    case "flame":
      return <Flame size={18} color={color} />;
    case "swords":
    case "sword":
      return <Swords size={18} color={color} />;
    case "github":
    case "git":
      return <FolderGit2 size={18} color={color} />;
    case "git-branch":
      return <GitBranch size={18} color={color} />;
    case "crosshair":
      return <Crosshair size={18} color={color} />;
    case "globe":
      return <Globe size={18} color={color} />;
    case "crown":
      return <Crown size={18} color={color} />;
    case "target":
      return <Target size={18} color={color} />;
    case "terminal":
    case "vim":
      return <Terminal size={18} color={color} />;
    case "code":
      return <Code2 size={18} color={color} />;
    case "shield":
      return <Shield size={18} color={color} />;
    case "sparkles":
    case "star":
      return <Sparkles size={18} color={color} />;
    case "award":
      return <Award size={18} color={color} />;
    default:
      // Render emoji or custom glyph directly if non-ASCII / short symbol
      if (icon && icon.length <= 4 && !/^[a-z0-9_-]+$/i.test(icon)) {
        return <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>{icon}</span>;
      }
      return <Award size={18} color={color} />;
  }
}

export function DashboardView({
  data,
  onSelectTech,
  onOpenModule,
  onGoToForge,
  onStartSprint,
}: Props) {
  const byCategory: Record<string, Technology[]> = {};
  for (const t of data.technologies) {
    (byCategory[t.category] ||= []).push(t);
  }

  // Last 14 calendar days heatmap
  const heatDays: { day: string; xp: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    heatDays.push({ day: key, xp: data.daily_totals[key] || 0 });
  }

  const dailyPct = Math.min(100, Math.round((data.today_xp / Math.max(1, data.daily_xp_target)) * 100));
  const rankTitle = data.rank_title || fallbackRankTitle(data.level);
  const achievements: AchievementItem[] = data.achievements || [];
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const dailyWarmup = data.daily_warmup || [];

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Player Rank & AI Training Break Sprint Quick-Launch Banner */}
      <div className="card rank-hero-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="rank-badge" data-testid="player-rank-badge">
            <Shield size={16} />
            <span>Lv.{data.level} {rankTitle}</span>
          </div>
          <span className="muted" style={{ fontSize: "0.86rem" }}>
            {data.completed_activities} of {data.total_activities} drills mastered • {data.streak_days}-day streak
          </span>
        </div>

        {onStartSprint && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
              <Zap size={13} style={{ verticalAlign: "middle", marginRight: 3, color: "var(--amber)" }} />
              AI Break Sprint:
            </span>
            <button
              type="button"
              className="btn btn-sm"
              data-testid="quick-sprint-2"
              onClick={() => onStartSprint(2)}
            >
              2m Quick
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-testid="quick-sprint-5"
              onClick={() => onStartSprint(5)}
            >
              <Zap size={13} /> 5m Sprint
            </button>
            <button
              type="button"
              className="btn btn-sm"
              data-testid="quick-sprint-10"
              onClick={() => onStartSprint(10)}
            >
              10m Deep
            </button>
          </div>
        )}
      </div>

      {/* Quick-Burst Action Strip (built for 5-min AI training breaks!) */}
      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">
            <Sparkles size={17} color="var(--amber)" />{" "}
            {dailyWarmup.length > 0 ? "Daily Warmup & Quick-Burst Quests" : "Quick-Burst Quests (While Training AI)"}
          </h3>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
            Jump straight into your next 5-minute zyBooks drill, due review, or Neovim lab.
          </p>

          {dailyWarmup.length > 0 && (
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }} data-testid="daily-warmup-list">
              {dailyWarmup.map((item) => (
                <div key={`warmup-${item.activity_id}`} className="surface-row">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{item.title}</span>
                      <span className="badge badge-xp">{item.reason}</span>
                    </div>
                    <div className="muted" style={{ fontSize: "0.78rem", marginTop: 2 }}>
                      {item.tech_slug.toUpperCase()} • {item.activity_type.replace("_", " ")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => onOpenModule(item.module_id)}
                  >
                    <Play size={13} /> +{item.xp_reward} XP
                  </button>
                </div>
              ))}
            </div>
          )}

          {dailyWarmup.length === 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              {data.recommended_next.map((rec) => (
                <div key={rec.activity_id} className="surface-row">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{rec.title}</div>
                    <div className="muted" style={{ fontSize: "0.78rem" }}>
                      {rec.tech_slug.toUpperCase()} • {rec.module_title} • ~{rec.estimated_minutes}m
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => onOpenModule(rec.module_id)}
                  >
                    <Play size={13} /> +{rec.xp_reward} XP
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="code-block" style={{ marginTop: 12, fontSize: "0.8rem" }}>
            <Terminal size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Terminal shortcut: <code>devquest next</code> or <code>devquest next python</code> opens directly in Neovim!
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">
            <Flame size={17} color="var(--red)" /> Daily Goal &amp; 14-Day Momentum
          </h3>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
            <span>Today&apos;s XP Progress</span>
            <strong>
              {data.today_xp} / {data.daily_xp_target} XP ({dailyPct}%)
            </strong>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${dailyPct}%`, background: "linear-gradient(90deg, var(--red), var(--amber), var(--green))" }}
            />
          </div>

          <div className="muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
            Last 14 days activity (hover for XP):
          </div>
          <div className="heatmap">
            {heatDays.map((h) => {
              const alpha = h.xp === 0 ? 0.08 : Math.min(0.95, 0.25 + h.xp / 150);
              return (
                <div
                  key={h.day}
                  className="heat-cell"
                  title={`${h.day}: ${h.xp} XP`}
                  style={{
                    background: h.xp > 0 ? `rgba(115, 218, 202, ${alpha})` : "var(--bg-code)",
                    borderColor: h.xp > 0 ? "var(--green)" : "var(--border-subtle)",
                  }}
                />
              );
            })}
          </div>

          {data.due_reviews.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", fontWeight: 700, marginBottom: 6 }}>
                <RefreshCw size={14} color="var(--cyan)" /> Spaced-Repetition Due ({data.due_reviews.length})
              </div>
              {data.due_reviews.slice(0, 2).map((rev) => (
                <button
                  key={rev.activity_id}
                  type="button"
                  className="btn btn-sm"
                  style={{ marginRight: 6, marginBottom: 6 }}
                  onClick={() => onOpenModule(rev.module_id)}
                >
                  <Clock size={13} /> Refresh: {rev.title}
                </button>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 14, fontSize: "0.82rem" }}>
              Spaced-repetition queue is clear! Complete modules to schedule automatic mastery refreshes.
            </div>
          )}
        </div>
      </div>

      {/* Achievements Shelf */}
      {achievements.length > 0 && (
        <div className="card" data-testid="achievements-shelf">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <h3 className="card-title" style={{ margin: 0 }}>
              <Trophy size={18} color="var(--amber)" /> RPG Achievements Shelf
            </h3>
            <span className="badge badge-xp">
              {unlockedCount} / {achievements.length} Unlocked
            </span>
          </div>
          <div className="achievements-grid">
            {achievements.map((ach) => (
              <div
                key={ach.slug}
                data-testid={`achievement-${ach.slug}`}
                className={`achievement-card ${ach.unlocked ? "unlocked" : "locked"}`}
              >
                <div className="achievement-icon">
                  {renderAchievementIcon(ach.icon, ach.unlocked)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <strong style={{ fontSize: "0.86rem" }}>{ach.name}</strong>
                    {ach.unlocked ? (
                      <CheckCircle2 size={14} color="var(--green-solid)" />
                    ) : (
                      <Lock size={13} color="var(--text-muted)" />
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: "0.76rem", marginTop: 2 }}>
                    {ach.description}
                  </div>
                  {ach.unlocked && ach.unlocked_at && (
                    <div style={{ fontSize: "0.7rem", color: "var(--green)", marginTop: 4 }}>
                      Unlocked {ach.unlocked_at.slice(0, 10)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Technology Mastery Progress Bars */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            <Award size={18} color="var(--accent)" /> {data.technologies.length}-Technology Mastery Matrix
          </h3>
          <button type="button" className="btn btn-sm" onClick={onGoToForge}>
            + Generate New zyBooks Module (Local Ollama)
          </button>
        </div>

        {Object.entries(byCategory).map(([category, techs]) => (
          <div key={category} style={{ marginBottom: 18 }}>
            <div className="muted" style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              {category}
            </div>
            <div className="tech-grid">
              {techs.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  className="tech-card"
                  data-testid={`tech-card-${t.slug}`}
                  onClick={() => onSelectTech(t.slug)}
                >
                  <div className="tech-header">
                    <div style={{ display: "flex", alignItems: "center", fontWeight: 700 }}>
                      <span className="tech-dot" style={{ background: t.color }} />
                      {t.name}
                    </div>
                    <span className={`badge badge-${t.freshness}`}>{t.freshness}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }} className="muted">
                    <span>Lv.{t.level} • {t.xp} XP</span>
                    <strong style={{ color: "var(--text)" }}>{Math.round(t.mastery_pct)}%</strong>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.max(t.mastery_pct, t.xp > 0 ? 4 : 0)}%`, background: t.color }}
                    />
                  </div>
                  <div className="muted" style={{ fontSize: "0.76rem" }}>
                    {t.completed_activities}/{t.total_activities} activities mastered
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Recent XP Ledger */}
      <div className="card">
        <h3 className="card-title">Recent XP Activity Log</h3>
        {data.recent_xp.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No XP earned yet—click any technology card above or run <code>devquest next</code> to start your streak!
          </p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {data.recent_xp.map((entry) => (
              <div key={entry.id} className="surface-row" style={{ padding: "8px 12px", fontSize: "0.86rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="tech-dot" style={{ background: entry.color }} />
                  <strong>{entry.tech_name}</strong>
                  <span className="muted">{entry.reason}</span>
                </div>
                <span className="badge badge-done">+{entry.amount} XP</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
