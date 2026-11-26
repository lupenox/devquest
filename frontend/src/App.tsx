import React, { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Flame,
  FolderGit2,
  GitBranch,
  LayoutDashboard,
  RefreshCw,
  Swords,
  Terminal,
} from "lucide-react";
import { api, connectEvents } from "./api";
import { BossProjectsView } from "./components/BossProjectsView";
import { DashboardView } from "./components/DashboardView";
import { ModuleView } from "./components/ModuleView";
import { RepoInterviewView } from "./components/RepoInterviewView";
import { SkillTreeView } from "./components/SkillTreeView";
import { SyncAndForgeView } from "./components/SyncAndForgeView";
import { TracksView } from "./components/TracksView";
import type { DashboardData, GradeOutcome } from "./types";

type Tab = "dashboard" | "tracks" | "repos" | "tree" | "projects" | "forge";

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [wsOnline, setWsOnline] = useState(false);
  const [liveOutcome, setLiveOutcome] = useState<GradeOutcome | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await api.dashboard();
      setDashboard(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to connect to DevQuest backend");
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    return connectEvents((evt) => {
      if (evt.type === "activity_graded") {
        const res = evt.payload as GradeOutcome;
        setLiveOutcome(res);
        loadDashboard();
        if (res.passed) {
          const bonusTxt = res.par_bonus ? ` + ${res.par_bonus} Vim Par Bonus!` : "";
          setToast(`✓ ${res.tech_name} Mastery ${Math.round(res.tech_mastery_pct)}% (+${res.xp_awarded} XP${bonusTxt})`);
          setTimeout(() => setToast(null), 4500);
        }
      } else if (evt.type === "sync_complete" || evt.type === "module_generated") {
        loadDashboard();
      }
    }, setWsOnline);
  }, [loadDashboard]);

  const openTech = (slug: string) => {
    setSelectedTech(slug);
    setActiveModuleId(null);
    setTab("tracks");
  };

  const openModule = (id: string) => {
    setActiveModuleId(id);
  };

  const levelPct = dashboard
    ? Math.min(100, Math.round((dashboard.xp_in_level / Math.max(1, dashboard.xp_for_next)) * 100))
    : 0;

  return (
    <div className="app-shell">
      <header className="hud-header">
        <div className="brand-row">
          <div className="brand-icon">
            <Terminal size={22} />
          </div>
          <div>
            <h1 className="brand-title">DevQuest</h1>
            <p className="brand-sub">Neovim-First • zyBooks • LeetCode • Boss Projects • $0/mo</p>
          </div>
        </div>

        <div className="hud-stats">
          {dashboard && (
            <>
              <div className="hud-pill" data-testid="hud-level">
                <span className="level-badge">Lv.{dashboard.level}</span>
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700 }}>{dashboard.total_xp} XP</div>
                  <div className="xp-mini-bar">
                    <div className="xp-mini-fill" style={{ width: `${levelPct}%` }} />
                  </div>
                </div>
              </div>
              <div className="hud-pill" data-testid="hud-streak">
                <Flame size={16} color="#f7768e" />
                <strong>{dashboard.streak_days}d</strong>
                <span className="muted">streak</span>
              </div>
              <div className="hud-pill">
                <strong>{dashboard.completed_activities}/{dashboard.total_activities}</strong>
                <span className="muted">mastered</span>
              </div>
            </>
          )}
          <div className="hud-pill" title="Live Neovim WebSocket connection">
            <span className={`ws-dot ${wsOnline ? "online" : ""}`} />
            <span style={{ fontSize: "0.8rem" }}>{wsOnline ? "Neovim Live" : "Reconnecting"}</span>
          </div>
        </div>
      </header>

      <nav className="nav-tabs" aria-label="Main navigation">
        <button
          type="button"
          className={`nav-btn ${tab === "dashboard" && !activeModuleId ? "active" : ""}`}
          onClick={() => { setActiveModuleId(null); setTab("dashboard"); }}
        >
          <LayoutDashboard size={15} /> Mastery Dashboard
        </button>
        <button
          type="button"
          className={`nav-btn ${tab === "tracks" && !activeModuleId ? "active" : ""}`}
          onClick={() => { setActiveModuleId(null); setTab("tracks"); }}
        >
          <BookOpen size={15} /> Tracks &amp; zyBooks
        </button>
        <button
          type="button"
          className={`nav-btn ${tab === "repos" && !activeModuleId ? "active" : ""}`}
          onClick={() => { setActiveModuleId(null); setTab("repos"); }}
        >
          <FolderGit2 size={15} /> Repo Interview Prep
        </button>
        <button
          type="button"
          className={`nav-btn ${tab === "tree" && !activeModuleId ? "active" : ""}`}
          onClick={() => { setActiveModuleId(null); setTab("tree"); }}
        >
          <GitBranch size={15} /> Skill Tree
        </button>
        <button
          type="button"
          className={`nav-btn ${tab === "projects" && !activeModuleId ? "active" : ""}`}
          onClick={() => { setActiveModuleId(null); setTab("projects"); }}
        >
          <Swords size={15} /> Boss Projects
        </button>
        <button
          type="button"
          className={`nav-btn ${tab === "forge" && !activeModuleId ? "active" : ""}`}
          onClick={() => { setActiveModuleId(null); setTab("forge"); }}
        >
          <RefreshCw size={15} /> Sync &amp; AI Forge
        </button>
      </nav>

      {error && (
        <div className="feedback-box err" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <main>
        {activeModuleId ? (
          <ModuleView
            moduleId={activeModuleId}
            liveOutcome={liveOutcome}
            onBack={() => setActiveModuleId(null)}
            onProgressUpdated={loadDashboard}
          />
        ) : !dashboard ? (
          <div className="card">Loading DevQuest RPG Mastery Dashboard...</div>
        ) : tab === "dashboard" ? (
          <DashboardView
            data={dashboard}
            onSelectTech={openTech}
            onOpenModule={openModule}
            onGoToForge={() => setTab("forge")}
          />
        ) : tab === "tracks" ? (
          <TracksView initialTech={selectedTech} onOpenModule={openModule} />
        ) : tab === "repos" ? (
          <RepoInterviewView onOpenModule={openModule} onUpdated={loadDashboard} />
        ) : tab === "tree" ? (
          <SkillTreeView onOpenModule={openModule} />
        ) : tab === "projects" ? (
          <BossProjectsView onOpenModule={openModule} />
        ) : (
          <SyncAndForgeView dashboard={dashboard} onSynced={loadDashboard} onOpenModule={openModule} />
        )}
      </main>

      {toast && (
        <div className="toast" role="status" data-testid="xp-toast">
          {toast}
        </div>
      )}
    </div>
  );
}
export default App;
