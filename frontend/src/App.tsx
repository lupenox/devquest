import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Flame,
  FolderGit2,
  GitBranch,
  LayoutDashboard,
  Palette,
  RefreshCw,
  Search,
  Shield,
  Swords,
  Terminal,
  Trophy,
  Zap,
} from "lucide-react";
import { api, connectEvents } from "./api";
import { BossProjectsView } from "./components/BossProjectsView";
import { CommandPalette } from "./components/CommandPalette";
import { DashboardView, fallbackRankTitle } from "./components/DashboardView";
import { ModuleView } from "./components/ModuleView";
import { RepoInterviewView } from "./components/RepoInterviewView";
import { SkillTreeView } from "./components/SkillTreeView";
import { SprintView } from "./components/SprintView";
import { SyncAndForgeView } from "./components/SyncAndForgeView";
import { TracksView } from "./components/TracksView";
import {
  getCurrentRoute,
  pushRoute,
  subscribePopState,
  type AppRoute,
  type NavTab,
} from "./router";
import type { DashboardData, GradeOutcome, SprintCompleteResp, ThemeId, UnlockedAchievement } from "./types";
import "./dashboard-shell.css";

const NAV_ITEMS = [
  { tab: "dashboard", label: "Mastery Dashboard", compact: "Dashboard", mobile: "Home", Icon: LayoutDashboard },
  { tab: "tracks", label: "Tracks & zyBooks", compact: "Tracks", mobile: "Tracks", Icon: BookOpen },
  { tab: "sprint", label: "AI Break Sprint", compact: "Sprint", mobile: "Sprint", Icon: Zap },
  { tab: "repos", label: "Repo Interview Prep", compact: "Repo prep", mobile: "Repos", Icon: FolderGit2 },
  { tab: "tree", label: "Skill Tree", compact: "Skill tree", mobile: "Tree", Icon: GitBranch },
  { tab: "projects", label: "Boss Projects", compact: "Projects", mobile: null, Icon: Swords },
  { tab: "forge", label: "Sync & AI Forge", compact: "AI Forge", mobile: null, Icon: RefreshCw },
] as const;

const THEME_STORAGE_KEY = "devquest_theme";
const VALID_THEMES: ThemeId[] = [
  "frutiger-aero",
  "emerald-3d",
  "tokyo-night",
  "catppuccin",
  "gruvbox",
  "kanagawa",
];

const THEME_META_COLORS: Record<ThemeId, string> = {
  "frutiger-aero": "#0284c7",
  "emerald-3d": "#041311",
  "tokyo-night": "#0d111a",
  catppuccin: "#11111b",
  gruvbox: "#1d2021",
  kanagawa: "#16161d",
};

function loadInitialTheme(): ThemeId {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    if (saved && VALID_THEMES.includes(saved)) return saved;
  } catch {
    // ignore storage errors
  }
  return "frutiger-aero";
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => getCurrentRoute());
  const [theme, setTheme] = useState<ThemeId>(() => loadInitialTheme());
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [wsOnline, setWsOnline] = useState(false);
  const [liveOutcome, setLiveOutcome] = useState<GradeOutcome | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [achievementToast, setAchievementToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const returnRouteRef = useRef<AppRoute>({ tab: "dashboard", techSlug: null, moduleId: null });
  const internalNavDepthRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const achTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const showAchievementToast = useCallback((items: UnlockedAchievement[]) => {
    if (!items || items.length === 0) return;
    const summary = items
      .map((a) => `${a.name}${a.bonus_xp ? ` (+${a.bonus_xp} XP)` : ""}`)
      .join(" • ");
    setAchievementToast(`Achievement Unlocked: ${summary}`);
    if (achTimerRef.current) window.clearTimeout(achTimerRef.current);
    achTimerRef.current = window.setTimeout(() => setAchievementToast(null), 5500);
  }, []);

  const applyTheme = useCallback((next: ThemeId) => {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", THEME_META_COLORS[theme] || "#0284c7");
    }
  }, [theme]);

  // URL History API synchronization
  useEffect(() => {
    return subscribePopState((nextRoute) => {
      setRoute(nextRoute);
    });
  }, []);

  const navigate = useCallback((next: AppRoute) => {
    if (!next.moduleId) {
      returnRouteRef.current = next;
    }
    internalNavDepthRef.current += 1;
    pushRoute(next);
    setRoute(next);
  }, []);

  // Global keyboard shortcuts: Ctrl+K / Cmd+K and '/' outside inputs
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableElement(e.target)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
          showToast(
            `✓ ${res.tech_name} Mastery ${Math.round(res.tech_mastery_pct)}% (+${res.xp_awarded} XP${bonusTxt})`
          );
        }
        if (res.unlocked_achievements && res.unlocked_achievements.length > 0) {
          showAchievementToast(res.unlocked_achievements);
        }
      } else if (evt.type === "achievement_unlocked") {
        loadDashboard();
        const payload = evt.payload;
        if (Array.isArray(payload)) {
          showAchievementToast(payload);
        } else if (Array.isArray(payload?.achievements)) {
          showAchievementToast(payload.achievements);
        } else if (payload && payload.name) {
          showAchievementToast([payload as UnlockedAchievement]);
        }
      } else if (
        evt.type === "sync_complete" ||
        evt.type === "module_generated" ||
        evt.type === "sprint_completed" ||
        evt.type === "interview_completed"
      ) {
        loadDashboard();
      }
    }, setWsOnline);
  }, [loadDashboard, showToast, showAchievementToast]);

  const openTab = useCallback(
    (tab: NavTab, sprintMinutes?: number) => {
      navigate({
        tab,
        techSlug: null,
        moduleId: null,
        sprintMinutes: tab === "sprint" ? sprintMinutes : undefined,
      });
    },
    [navigate]
  );

  const openTech = useCallback(
    (slug: string) => {
      navigate({ tab: "tracks", techSlug: slug, moduleId: null });
    },
    [navigate]
  );

  const openModule = useCallback(
    (id: string) => {
      if (!route.moduleId) {
        returnRouteRef.current = route;
      }
      navigate({ ...route, moduleId: id });
    },
    [navigate, route]
  );

  const handleBackFromModule = useCallback(() => {
    // A chapter opened from a syllabus retains its origin in browser history after reload.
    const entry = window.history.state;
    const openedFromTrack = entry?.tab === "tracks" && entry.techSlug && entry.moduleId === route.moduleId;
    if ((internalNavDepthRef.current > 0 || openedFromTrack) && window.history.length > 1) {
      internalNavDepthRef.current = Math.max(0, internalNavDepthRef.current - 1);
      window.history.back();
    } else {
      navigate(returnRouteRef.current);
    }
  }, [navigate, route.moduleId]);

  const handleSyncGithub = useCallback(async () => {
    try {
      const res = await api.runSync("github");
      const first = res.results?.[0];
      showToast(
        first?.ok
          ? `✓ Synced ${first.repo_count ?? ""} GitHub repos (+${first.xp_awarded || 0} XP)`
          : first?.error || "GitHub sync finished"
      );
      loadDashboard();
    } catch (e: any) {
      showToast(`GitHub sync failed: ${e?.message || "error"}`);
    }
  }, [loadDashboard, showToast]);

  const handleSprintCompleted = useCallback(
    (resp: SprintCompleteResp) => {
      loadDashboard();
      if (resp.bonus_xp > 0) {
        showToast(`⚡ Sprint Complete! +${resp.bonus_xp} Combo Bonus XP`);
      }
      if (resp.unlocked_achievements && resp.unlocked_achievements.length > 0) {
        showAchievementToast(resp.unlocked_achievements);
      }
    },
    [loadDashboard, showToast, showAchievementToast]
  );

  const levelPct = dashboard
    ? Math.min(100, Math.round((dashboard.xp_in_level / Math.max(1, dashboard.xp_for_next)) * 100))
    : 0;

  const activeTab = route.tab;
  const activeModuleId = route.moduleId;
  const useCompactShell = !activeModuleId && (activeTab === "dashboard" || activeTab === "tracks");
  const rankTitle = dashboard ? dashboard.rank_title || fallbackRankTitle(dashboard.level) : null;

  const connection = (
    <div className="hud-pill connection-status" title="Live Neovim WebSocket connection">
      <span className={`ws-dot ${wsOnline ? "online" : ""}`} />
      <span style={{ fontSize: "0.8rem" }}>{wsOnline ? "Neovim Live" : "Reconnecting"}</span>
    </div>
  );

  return (
    <div className={useCompactShell ? "app-shell dashboard-shell" : "app-shell"}>
      <header className="hud-header">
        <a
          className="brand-row brand-home"
          href="/"
          aria-label="DevQuest home"
          onClick={(event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            openTab("dashboard");
          }}
        >
          <div className="brand-icon"><Terminal size={22} /></div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h1 className="brand-title">DevQuest</h1>
              {!useCompactShell && rankTitle && (
                <span className="rank-chip" data-testid="hud-rank">
                  <Shield size={12} /> {rankTitle}
                </span>
              )}
            </div>
            {!useCompactShell && <p className="brand-sub">Neovim-First • zyBooks • AI Break Sprints • Boss Projects • $0/mo</p>}
          </div>
        </a>
        {useCompactShell && connection}

        <div className="hud-stats">
          <button
            type="button"
            className="cmd-trigger"
            data-testid="cmd-palette-trigger"
            aria-label="Search commands and lessons"
            onClick={() => setPaletteOpen(true)}
            title="Open Command Palette (Ctrl+K or /)"
          >
            <Search size={14} />
            <span>Search...</span>
            <kbd className="kbd">Ctrl+K</kbd>
          </button>

          <label className="hud-pill theme-pill" title="Switch Neovim Color Theme">
            <Palette size={14} color="var(--accent-2)" />
            <select
              className="theme-select"
              data-testid="theme-switcher"
              aria-label="Color Theme"
              value={theme}
              onChange={(e) => applyTheme(e.target.value as ThemeId)}
            >
              <option value="frutiger-aero">Frutiger Aero</option>
              <option value="emerald-3d">Emerald 3D Glass</option>
              <option value="tokyo-night">Tokyo Night</option>
              <option value="catppuccin">Catppuccin Mocha</option>
              <option value="gruvbox">Gruvbox Dark</option>
              <option value="kanagawa">Kanagawa Wave</option>
            </select>
          </label>

          {dashboard && !useCompactShell && (
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
                <Flame size={16} color="var(--red)" />
                <strong>{dashboard.streak_days}d</strong>
                <span className="muted">streak</span>
              </div>
              <div className="hud-pill hud-hide-sm">
                <strong>{dashboard.completed_activities}/{dashboard.total_activities}</strong>
                <span className="muted">mastered</span>
              </div>
            </>
          )}
          {!useCompactShell && connection}
        </div>
      </header>

      <nav className="nav-tabs" aria-label="Main navigation">
        {NAV_ITEMS.map(({ tab, label, compact, Icon }) => {
          const active = activeTab === tab && !activeModuleId;
          return (
            <button
              key={tab}
              type="button"
              className={`nav-btn${active ? " active" : ""}`}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              onClick={() => openTab(tab)}
            >
              <Icon size={15} /> {useCompactShell ? compact : label}
            </button>
          );
        })}
      </nav>

      {error && (
        <div className="feedback-box err" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <main>
        {activeModuleId ? (
          <ModuleView
            key={activeModuleId}
            moduleId={activeModuleId}
            liveOutcome={liveOutcome}
            onBack={handleBackFromModule}
            onProgressUpdated={loadDashboard}
          />
        ) : !dashboard ? (
          <div className="card">Loading DevQuest RPG Mastery Dashboard...</div>
        ) : activeTab === "dashboard" ? (
          <DashboardView
            data={dashboard}
            onSelectTech={openTech}
            onOpenModule={openModule}
            onGoToForge={() => openTab("forge")}
            onStartSprint={(mins) => openTab("sprint", mins)}
          />
        ) : activeTab === "tracks" ? (
          <TracksView
            techSlug={route.techSlug}
            onSelectTech={openTech}
            onAllTracks={() => openTab("tracks")}
            onOpenModule={openModule}
          />
        ) : activeTab === "sprint" ? (
          <SprintView
            technologies={dashboard.technologies}
            initialDuration={route.sprintMinutes}
            liveOutcome={liveOutcome}
            onSprintCompleted={handleSprintCompleted}
            onBackToDashboard={() => openTab("dashboard")}
          />
        ) : activeTab === "repos" ? (
          <RepoInterviewView onOpenModule={openModule} onUpdated={loadDashboard} />
        ) : activeTab === "tree" ? (
          <SkillTreeView onOpenModule={openModule} />
        ) : activeTab === "projects" ? (
          <BossProjectsView onOpenModule={openModule} />
        ) : (
          <SyncAndForgeView dashboard={dashboard} onSynced={loadDashboard} onOpenModule={openModule} />
        )}
      </main>

      {/* Mobile PWA Bottom Navigation Bar */}
      {!useCompactShell && (
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          {NAV_ITEMS.filter((item) => item.mobile).map(({ tab, mobile, Icon }) => {
            const active = activeTab === tab && !activeModuleId;
            return (
              <button
                key={tab}
                type="button"
                className={`mobile-nav-btn${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => openTab(tab)}
              >
                <Icon size={18} /><span>{mobile}</span>
              </button>
            );
          })}
        </nav>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        currentTheme={theme}
        technologies={dashboard?.technologies}
        onNavigateTab={openTab}
        onSelectTech={openTech}
        onOpenModule={openModule}
        onChangeTheme={applyTheme}
        onSyncGithub={handleSyncGithub}
      />

      {(toast || achievementToast) && (
        <div className="toast-stack">
          {achievementToast && (
            <div className="toast toast-achievement" role="status" data-testid="achievement-toast">
              <Trophy size={16} color="var(--amber)" style={{ flexShrink: 0 }} />
              <span>{achievementToast}</span>
            </div>
          )}
          {toast && (
            <div className="toast" role="status" data-testid="xp-toast">
              {toast}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
export default App;
