import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Code2,
  Layers,
  Play,
  Sparkles,
  Swords,
  Zap,
} from "lucide-react";
import { api } from "../api";
import type { ModuleSummary, Technology } from "../types";

interface Props {
  initialTech: string | null;
  onOpenModule: (moduleId: string) => void;
}

interface NumberedChapter {
  chapterNum: number;
  mod: ModuleSummary;
  isCompleted: boolean;
}

interface SyllabusPart {
  key: "foundations" | "intermediate" | "advanced" | "boss";
  title: string;
  subtitle: string;
  items: NumberedChapter[];
}

function sortAndNumberModules(modules: ModuleSummary[]): NumberedChapter[] {
  const sorted = [...modules].sort((a, b) => {
    const diff = (a.order_index ?? 0) - (b.order_index ?? 0);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
  return sorted.map((mod, idx) => ({
    chapterNum: idx + 1,
    mod,
    isCompleted: mod.activity_count > 0 && mod.completed_count >= mod.activity_count,
  }));
}

function groupIntoSyllabusParts(chapters: NumberedChapter[]): SyllabusPart[] {
  const foundations: NumberedChapter[] = [];
  const intermediate: NumberedChapter[] = [];
  const advanced: NumberedChapter[] = [];
  const boss: NumberedChapter[] = [];

  for (const ch of chapters) {
    const kind = (ch.mod.kind || "").toLowerCase();
    const diff = (ch.mod.difficulty || "").toLowerCase();
    if (kind === "project") {
      boss.push(ch);
    } else if (diff === "advanced") {
      advanced.push(ch);
    } else if (diff === "beginner") {
      foundations.push(ch);
    } else {
      intermediate.push(ch);
    }
  }

  const parts: SyllabusPart[] = [
    {
      key: "foundations",
      title: "Part 1: Foundations (Beginner)",
      subtitle: "Core syntax, control flow, data structures & interactive zyBooks fundamentals",
      items: foundations,
    },
    {
      key: "intermediate",
      title: "Part 2: Intermediate & Katas",
      subtitle: "Real-world engineering idioms, typing, testing, patterns & problem-solving katas",
      items: intermediate,
    },
    {
      key: "advanced",
      title: "Part 3: Advanced & Async",
      subtitle: "Concurrency, async architectures, performance & algorithmic depth",
      items: advanced,
    },
    {
      key: "boss",
      title: "Part 4: Boss Projects",
      subtitle: "Capstone multi-test engineering builds verified directly in Neovim",
      items: boss,
    },
  ];

  return parts.filter((p) => p.items.length > 0);
}

function PartIcon({ partKey }: { partKey: SyllabusPart["key"] }) {
  switch (partKey) {
    case "foundations":
      return <BookOpen size={16} color="var(--accent)" />;
    case "intermediate":
      return <Layers size={16} color="var(--cyan)" />;
    case "advanced":
      return <Zap size={16} color="var(--amber)" />;
    case "boss":
      return <Swords size={16} color="var(--red)" />;
  }
}

export function TracksView({ initialTech, onOpenModule }: Props) {
  const [techs, setTechs] = useState<Technology[]>([]);
  const [activeTech, setActiveTech] = useState<string>(initialTech || "all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setActiveTech(initialTech || "all");
  }, [initialTech]);

  useEffect(() => {
    api
      .tracks()
      .then((res) => setTechs(res.technologies))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card">Loading tracks...</div>;

  const visible = activeTech === "all" ? techs : techs.filter((t) => t.slug === activeTech);
  const isSingleTechSelected = activeTech !== "all" && visible.length === 1;

  const renderChapterCard = (
    ch: NumberedChapter,
    techColor: string,
    isNextUp: boolean,
    showChapterNumber: boolean
  ) => {
    const { mod, chapterNum, isCompleted } = ch;
    const modPct = mod.activity_count > 0 ? Math.round((mod.completed_count / mod.activity_count) * 100) : 0;

    return (
      <div
        key={mod.id}
        className={`track-module-card ${isCompleted ? "completed" : ""} ${isNextUp ? "next-up" : ""}`}
        data-testid={`track-module-${mod.id}`}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 7 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {showChapterNumber && (
                <span className="chapter-pill" data-testid={`chapter-num-${mod.id}`}>
                  Ch. {chapterNum}
                </span>
              )}
              <span className="badge badge-kind">{mod.kind}</span>
              <span className="badge badge-unstarted">{mod.difficulty}</span>
              {mod.source === "generated" && <span className="badge badge-xp">Ollama AI</span>}
              {isNextUp && !isCompleted && (
                <span className="badge badge-warming">
                  <Sparkles size={10} /> Next Up
                </span>
              )}
            </div>
            {isCompleted && (
              <span className="badge badge-done" title="Chapter mastered">
                <CheckCircle2 size={12} /> Done
              </span>
            )}
          </div>

          <strong style={{ display: "block", marginBottom: 4, fontSize: "0.95rem" }}>{mod.title}</strong>
          <p className="muted" style={{ margin: 0, fontSize: "0.83rem", lineHeight: 1.45 }}>
            {mod.subtitle}
          </p>
        </div>

        <div>
          <div className="chapter-mini-bar">
            <div
              className="chapter-mini-fill"
              style={{
                width: `${modPct}%`,
                background: isCompleted ? "var(--green-solid)" : techColor,
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span className="muted" style={{ fontSize: "0.79rem" }}>
              {mod.completed_count}/{mod.activity_count} drills • ~{mod.estimated_minutes} min
            </span>
            <button
              type="button"
              className={`btn btn-sm ${isCompleted ? "" : "btn-primary"}`}
              onClick={() => onOpenModule(mod.id)}
            >
              {mod.kind === "zybooks" ? <BookOpen size={13} /> : <Code2 size={13} />}
              <Play size={12} /> Open
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            type="button"
            className={`btn btn-sm ${activeTech === "all" ? "btn-primary" : ""}`}
            onClick={() => setActiveTech("all")}
          >
            All {techs.length} Technologies
          </button>
          {techs.map((t) => (
            <button
              key={t.slug}
              type="button"
              className={`btn btn-sm ${activeTech === t.slug ? "btn-primary" : ""}`}
              onClick={() => setActiveTech(t.slug)}
            >
              <span className="tech-dot" style={{ background: t.color, marginRight: 2 }} />
              {t.name} ({Math.round(t.mastery_pct)}%)
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        {visible.map((t) => {
          const chapters = sortAndNumberModules(t.modules || []);
          const completedChapters = chapters.filter((c) => c.isCompleted).length;
          const totalMinutes = chapters.reduce((sum, c) => sum + (c.mod.estimated_minutes || 0), 0);
          const nextChapter = chapters.find((c) => !c.isCompleted) || null;
          const showMultiHeader = chapters.length > 1;
          const useTieredRoadmap = isSingleTechSelected && chapters.length >= 5;
          const parts = useTieredRoadmap ? groupIntoSyllabusParts(chapters) : [];
          const chapterPct = chapters.length > 0 ? Math.round((completedChapters / chapters.length) * 100) : 0;

          return (
            <div key={t.slug} className="card" data-testid={`track-section-${t.slug}`}>
              <div className="track-roadmap-header">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="tech-dot" style={{ background: t.color }} />
                  <h3 style={{ margin: 0 }}>{t.name}</h3>
                  <span className="muted" style={{ fontSize: "0.82rem" }}>{t.category}</span>
                  {showMultiHeader && (
                    <span className="badge badge-kind">
                      {chapters.length} Chapters • ~{totalMinutes} min
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: "0.85rem" }}>
                    Lv.{t.level} • <strong>{Math.round(t.mastery_pct)}% Mastery</strong>
                  </div>
                  {showMultiHeader && nextChapter ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      data-testid={`continue-track-${t.slug}`}
                      onClick={() => onOpenModule(nextChapter.mod.id)}
                    >
                      Continue Next Chapter (Ch. {nextChapter.chapterNum}) <ArrowRight size={13} />
                    </button>
                  ) : showMultiHeader && chapters.length > 0 ? (
                    <span className="badge badge-done">
                      <CheckCircle2 size={12} /> All {chapters.length} Chapters Mastered
                    </span>
                  ) : null}
                </div>
              </div>

              {showMultiHeader && (
                <div className="track-roadmap-progress" data-testid={`track-progress-${t.slug}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }} className="muted">
                    <span>
                      Track Roadmap Progress: <strong style={{ color: "var(--text)" }}>{completedChapters}/{chapters.length}</strong> chapters mastered ({chapterPct}%)
                    </span>
                    <span>
                      {t.completed_activities}/{t.total_activities} activities cleared
                    </span>
                  </div>
                  <div className="progress-track" style={{ marginBottom: 0 }}>
                    <div
                      className="progress-fill"
                      style={{
                        width: `${Math.max(t.mastery_pct, completedChapters > 0 ? chapterPct : 0)}%`,
                        background: `linear-gradient(90deg, ${t.color}, var(--green-solid))`,
                      }}
                    />
                  </div>
                </div>
              )}

              {useTieredRoadmap ? (
                <div className="syllabus-parts-list" data-testid={`syllabus-roadmap-${t.slug}`}>
                  {parts.map((part) => {
                    const partDone = part.items.filter((i) => i.isCompleted).length;
                    return (
                      <section
                        key={part.key}
                        className="syllabus-part"
                        data-testid={`syllabus-part-${part.key}`}
                      >
                        <div className="syllabus-part-header">
                          <div>
                            <div className="syllabus-part-title">
                              <PartIcon partKey={part.key} />
                              <span>{part.title}</span>
                            </div>
                            <div className="muted" style={{ fontSize: "0.79rem", marginTop: 2 }}>
                              {part.subtitle}
                            </div>
                          </div>
                          <span className={`badge ${partDone === part.items.length ? "badge-done" : "badge-kind"}`}>
                            {partDone}/{part.items.length} mastered
                          </span>
                        </div>
                        <div className="grid-2">
                          {part.items.map((ch) =>
                            renderChapterCard(
                              ch,
                              t.color,
                              nextChapter?.mod.id === ch.mod.id,
                              true
                            )
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="grid-2">
                  {chapters.map((ch) =>
                    renderChapterCard(
                      ch,
                      t.color,
                      showMultiHeader && nextChapter?.mod.id === ch.mod.id,
                      showMultiHeader
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
