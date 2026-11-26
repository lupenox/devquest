import React from "react";
import { Award, Clock, Flame, Play, RefreshCw, Sparkles, Terminal } from "lucide-react";
import type { DashboardData, Technology } from "../types";

interface Props {
  data: DashboardData;
  onSelectTech: (slug: string) => void;
  onOpenModule: (moduleId: string) => void;
  onGoToForge: () => void;
}

export function DashboardView({ data, onSelectTech, onOpenModule, onGoToForge }: Props) {
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

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Quick-Burst Action Strip (built for 5-min AI training breaks!) */}
      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">
            <Sparkles size={17} color="#e0af68" /> Quick-Burst Quests (While Training AI)
          </h3>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
            Jump straight into your next 5-minute zyBooks drill or Neovim lab.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {data.recommended_next.map((rec) => (
              <div
                key={rec.activity_id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: "#131928",
                  border: "1px solid #26314c",
                  borderRadius: 10,
                }}
              >
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
          <div className="code-block" style={{ marginTop: 12, fontSize: "0.8rem" }}>
            <Terminal size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Terminal shortcut: <code>devquest next</code> or <code>devquest next python</code> opens directly in Neovim!
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">
            <Flame size={17} color="#f7768e" /> Daily Goal &amp; 14-Day Momentum
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
              style={{ width: `${dailyPct}%`, background: "linear-gradient(90deg,#f7768e,#e0af68,#73daca)" }}
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
                    background: h.xp > 0 ? `rgba(115, 218, 202, ${alpha})` : "#0d1322",
                    borderColor: h.xp > 0 ? "rgba(115,218,202,0.5)" : "#222c45",
                  }}
                />
              );
            })}
          </div>

          {data.due_reviews.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", fontWeight: 700, marginBottom: 6 }}>
                <RefreshCw size={14} color="#7dcfff" /> Spaced-Repetition Due ({data.due_reviews.length})
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

      {/* All 16 Technology Mastery Progress Bars */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            <Award size={18} color="#7aa2f7" /> 16-Technology Mastery Matrix
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
                    <strong style={{ color: "#e6edf7" }}>{Math.round(t.mastery_pct)}%</strong>
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
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  background: "#131928",
                  borderRadius: 8,
                  fontSize: "0.86rem",
                }}
              >
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
