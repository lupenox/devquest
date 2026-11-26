import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Code2,
  FolderGit2,
  GitBranch,
  Palette,
  RefreshCw,
  Search,
  Sparkles,
  Swords,
  Zap,
} from "lucide-react";
import { api } from "../api";
import type { NavTab } from "../router";
import type { SearchResults, Technology, ThemeId } from "../types";

interface PaletteItem {
  id: string;
  group: "Modules & Packs" | "Activities" | "Technologies" | "Quick Actions";
  title: string;
  subtitle: string;
  badge?: string;
  color?: string;
  keywords: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  currentTheme: ThemeId;
  technologies?: Technology[];
  onNavigateTab: (tab: NavTab, sprintMinutes?: number) => void;
  onSelectTech: (slug: string) => void;
  onOpenModule: (moduleId: string) => void;
  onChangeTheme: (theme: ThemeId) => void;
  onSyncGithub: () => void;
}

const THEMES: { id: ThemeId; label: string; desc: string }[] = [
  { id: "frutiger-aero", label: "Frutiger Aero", desc: "Glossy aqua sky glass, bokeh orbs & leaf green (Default)" },
  { id: "emerald-3d", label: "Emerald 3D Glass", desc: "Luminous 3D frosted emerald & Neovim mint" },
  { id: "tokyo-night", label: "Tokyo Night", desc: "Deep indigo night palette" },
  { id: "catppuccin", label: "Catppuccin Mocha", desc: "Pastel lavender & dark mocha" },
  { id: "gruvbox", label: "Gruvbox Dark", desc: "Retro warm amber & olive" },
  { id: "kanagawa", label: "Kanagawa Wave", desc: "Japanese ink wave blue" },
];

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = target.toLowerCase();
  if (hay.includes(q)) return true;
  let qi = 0;
  for (let i = 0; i < hay.length && qi < q.length; i++) {
    if (hay[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette({
  open,
  onClose,
  currentTheme,
  technologies = [],
  onNavigateTab,
  onSelectTech,
  onOpenModule,
  onChangeTheme,
  onSyncGithub,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.search(query.trim());
        if (!cancelled) {
          setResults(res);
        }
      } catch {
        if (!cancelled) {
          setResults(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query.trim() ? 100 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const quickActions = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      {
        id: "action-sprint-5",
        group: "Quick Actions",
        title: "Start 5-Min AI Break Sprint",
        subtitle: "4 rapid-fire drills with Combo XP multiplier",
        badge: "Sprint",
        keywords: "start 5 min ai break sprint rapid drills combo",
        run: () => onNavigateTab("sprint", 5),
      },
      {
        id: "action-sprint-2",
        group: "Quick Actions",
        title: "Start 2-Min Quick Sprint",
        subtitle: "2 fast warmup drills between training runs",
        badge: "Sprint",
        keywords: "start 2 min quick sprint warmup",
        run: () => onNavigateTab("sprint", 2),
      },
      {
        id: "action-repos",
        group: "Quick Actions",
        title: "Open Repo Interview Prep",
        subtitle: "Study packs & Staff-Engineer Mock Interviewer",
        badge: "Interview",
        keywords: "open repo interview prep github mock interviewer",
        run: () => onNavigateTab("repos"),
      },
      {
        id: "action-sync-github",
        group: "Quick Actions",
        title: "Sync GitHub XP & Profile",
        subtitle: "Refresh connected GitHub repositories and XP",
        badge: "Sync",
        keywords: "sync github xp repos profile refresh",
        run: () => onSyncGithub(),
      },
      {
        id: "action-tree",
        group: "Quick Actions",
        title: "Open RPG Skill Tree",
        subtitle: "Visualize module prerequisite graph and tiers",
        badge: "Tree",
        keywords: "open rpg skill tree graph prerequisites",
        run: () => onNavigateTab("tree"),
      },
      {
        id: "action-projects",
        group: "Quick Actions",
        title: "Open Boss Projects",
        subtitle: "Real-world verifiable Neovim builds",
        badge: "Boss",
        keywords: "open boss projects arena",
        run: () => onNavigateTab("projects"),
      },
      {
        id: "action-forge",
        group: "Quick Actions",
        title: "Open Sync & AI Forge",
        subtitle: "Generate local Ollama zyBooks lessons & sync platforms",
        badge: "Ollama",
        keywords: "open sync ai forge ollama generate leetcode codewars",
        run: () => onNavigateTab("forge"),
      },
      ...THEMES.map((t) => ({
        id: `action-theme-${t.id}`,
        group: "Quick Actions" as const,
        title: `Switch Theme → ${t.label}`,
        subtitle: t.id === currentTheme ? `${t.desc} (Active)` : t.desc,
        badge: "Theme",
        keywords: `switch theme color palette neovim ${t.id} ${t.label} ${t.desc}`,
        run: () => onChangeTheme(t.id),
      })),
    ];
    return actions;
  }, [currentTheme, onChangeTheme, onNavigateTab, onSyncGithub]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    const out: PaletteItem[] = [];
    const seenModules = new Set<string>();

    const pushModulesAndPacks = () => {
      if (!results) return;
      for (const m of results.modules || []) {
        if (seenModules.has(m.id)) continue;
        seenModules.add(m.id);
        out.push({
          id: `mod-${m.id}`,
          group: "Modules & Packs",
          title: m.title,
          subtitle: `${m.tech_slug.toUpperCase()} • ${m.kind}${m.subtitle ? ` — ${m.subtitle}` : ""}`,
          badge: m.kind,
          keywords: `${m.id} ${m.title} ${m.tech_slug} ${m.subtitle || ""}`,
          run: () => onOpenModule(m.id),
        });
      }
      for (const p of results.packs || []) {
        if (seenModules.has(p.id)) continue;
        seenModules.add(p.id);
        out.push({
          id: `pack-${p.id}`,
          group: "Modules & Packs",
          title: p.title,
          subtitle: `Repo Study Pack • ${p.tech_slug.toUpperCase()}`,
          badge: "Repo Pack",
          keywords: `${p.id} ${p.title} ${p.tech_slug}`,
          run: () => onOpenModule(p.id),
        });
      }
    };

    const pushActivities = () => {
      if (!results) return;
      for (const a of results.activities || []) {
        out.push({
          id: `act-${a.id}`,
          group: "Activities",
          title: a.title,
          subtitle: `${a.tech_slug.toUpperCase()} • ${a.activity_type.replace("_", " ")} • ${a.module_id}`,
          badge: a.xp_reward ? `+${a.xp_reward} XP` : a.activity_type,
          keywords: `${a.id} ${a.title} ${a.tech_slug} ${a.module_id}`,
          run: () => onOpenModule(a.module_id),
        });
      }
    };

    const pushTechs = () => {
      const sourceTechs =
        results && results.technologies
          ? results.technologies
          : technologies.filter((t) => fuzzyMatch(q, `${t.name} ${t.slug} ${t.category}`));
      for (const t of sourceTechs) {
        out.push({
          id: `tech-${t.slug}`,
          group: "Technologies",
          title: t.name,
          subtitle: `${t.category}${typeof t.mastery_pct === "number" ? ` • ${Math.round(t.mastery_pct)}% mastery` : ""}`,
          badge: "Track",
          color: t.color,
          keywords: `${t.slug} ${t.name} ${t.category}`,
          run: () => onSelectTech(t.slug),
        });
      }
    };

    const matchingActions = quickActions.filter((a) => fuzzyMatch(q, `${a.title} ${a.subtitle} ${a.keywords}`));

    if (q) {
      pushModulesAndPacks();
      pushActivities();
      pushTechs();
      out.push(...matchingActions);
    } else {
      out.push(...matchingActions.slice(0, 7));
      pushModulesAndPacks();
      pushTechs();
    }

    return out.slice(0, 28);
  }, [query, results, quickActions, technologies, onOpenModule, onSelectTech]);

  useEffect(() => {
    setActiveIdx(0);
  }, [items.length, query]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-palette-idx="${activeIdx}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
      (el as HTMLElement).scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx, open]);

  if (!open) return null;

  const execute = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) setActiveIdx((idx) => (idx + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) setActiveIdx((idx) => (idx - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(items[activeIdx]);
    }
  };

  const renderIcon = (item: PaletteItem) => {
    if (item.group === "Technologies") {
      return <span className="tech-dot" style={{ background: item.color || "var(--accent)", marginRight: 0 }} />;
    }
    if (item.group === "Modules & Packs") return <BookOpen size={15} color="var(--accent)" />;
    if (item.group === "Activities") return <Code2 size={15} color="var(--green)" />;
    if (item.id.includes("sprint")) return <Zap size={15} color="var(--amber)" />;
    if (item.id.includes("theme")) return <Palette size={15} color="var(--accent-2)" />;
    if (item.id.includes("repos")) return <FolderGit2 size={15} color="var(--cyan)" />;
    if (item.id.includes("sync")) return <RefreshCw size={15} color="var(--green)" />;
    if (item.id.includes("tree")) return <GitBranch size={15} color="var(--accent-2)" />;
    if (item.id.includes("projects")) return <Swords size={15} color="var(--red)" />;
    return <Sparkles size={15} color="var(--accent)" />;
  };

  let lastGroup = "";

  return (
    <div
      className="cmd-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      data-testid="command-palette"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div className="cmd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input-row">
          <Search size={17} color="var(--accent)" />
          <input
            ref={inputRef}
            className="cmd-input"
            data-testid="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search technologies, modules, activities (e.g. pdb, sql, sprint, catppuccin)..."
            aria-label="Command palette search"
          />
          {loading && <span className="muted" style={{ fontSize: "0.75rem" }}>Searching...</span>}
          <kbd className="kbd">Esc</kbd>
        </div>

        <div className="cmd-list" ref={listRef}>
          {items.length === 0 ? (
            <div className="muted" style={{ padding: "24px 16px", textAlign: "center", fontSize: "0.88rem" }}>
              No matching modules, technologies, or commands for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            items.map((item, idx) => {
              const showHeader = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <React.Fragment key={item.id}>
                  {showHeader && <div className="cmd-group-title">{item.group}</div>}
                  <button
                    type="button"
                    data-palette-idx={idx}
                    data-testid={`palette-item-${item.id}`}
                    className={`cmd-item ${idx === activeIdx ? "selected" : ""}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => execute(item)}
                  >
                    <div className="cmd-item-main">
                      <span className="cmd-item-icon">{renderIcon(item)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="cmd-item-title">{item.title}</div>
                        <div className="cmd-item-sub">{item.subtitle}</div>
                      </div>
                    </div>
                    {item.badge && <span className="badge badge-kind">{item.badge}</span>}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>

        <div className="cmd-footer">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> navigate
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> open
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
