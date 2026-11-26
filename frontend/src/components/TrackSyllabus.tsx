import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import type { ModuleSummary, Technology } from "../types";
import { RichText } from "./RichText";
import "../track-syllabus.css";

interface Props {
  tech: Technology;
  onOpenModule: (moduleId: string) => void;
}

const partTitles = {
  foundations: "Foundations",
  intermediate: "Intermediate & katas",
  advanced: "Advanced & async",
  boss: "Boss projects",
} as const;

function syllabusPart(mod: ModuleSummary): keyof typeof partTitles {
  if (mod.kind.toLowerCase() === "project") return "boss";
  switch (mod.difficulty.toLowerCase()) {
    case "advanced": return "advanced";
    case "beginner": return "foundations";
    default: return "intermediate";
  }
}

const kindLabels: Record<string, string> = {
  zybooks: "zyBooks", project: "Project", kata: "Kata",
  neovim_drill: "Neovim drill", repo_interview: "Repo interview",
};

export function TrackSyllabus({ tech, onOpenModule }: Props) {
  const chapters = [...(tech.modules ?? [])]
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.id.localeCompare(b.id))
    .map((mod, index) => ({
      mod,
      number: index + 1,
      done: mod.activity_count > 0 && mod.completed_count >= mod.activity_count,
      part: syllabusPart(mod),
    }));
  const next = chapters.find((chapter) => !chapter.done);
  const mastered = chapters.filter((chapter) => chapter.done).length;
  const minutes = chapters.reduce((sum, { mod }) => sum + (mod.estimated_minutes || 0), 0);
  const mastery = Math.round(tech.mastery_pct);

  function chapterRow(chapter: typeof chapters[number]) {
    const { mod, number, done } = chapter;
    return (
      <li key={mod.id}>
        <button type="button" className="syllabus-chapter" data-testid={`track-module-${mod.id}`}
          onClick={() => onOpenModule(mod.id)}>
          <span className="syllabus-number" data-testid={`chapter-num-${mod.id}`}>Ch. {number}</span>
          <span className="syllabus-chapter-text">
            <strong><RichText text={mod.title} /></strong>
            {mod.subtitle && <span className="syllabus-description"><RichText text={mod.subtitle} /></span>}
            <span className="syllabus-chapter-meta">
              {kindLabels[mod.kind] ?? mod.kind.replaceAll("_", " ")} · {mod.difficulty} · {mod.estimated_minutes} min · {mod.completed_count}/{mod.activity_count} drills
              {mod.source === "generated" && " · Ollama AI"}
            </span>
          </span>
          <span className="syllabus-chapter-end">
            {done && <span className="syllabus-done"><CheckCircle2 size={14} aria-hidden="true" /> Mastered</span>}
            {next === chapter && <span className="syllabus-next">Up next</span>}
            <ChevronRight size={16} aria-hidden="true" />
          </span>
        </button>
      </li>
    );
  }

  return (
    <section className="syllabus-view" aria-label={`${tech.name} track`} data-testid={`track-section-${tech.slug}`}>
      <header className="card syllabus-intro">
        <div className="syllabus-heading">
          <div>
            <h2><span className="syllabus-dot" style={{ background: tech.color }} />{tech.name}</h2>
            <p>{tech.category} · {chapters.length} {chapters.length === 1 ? "chapter" : "chapters"} · {minutes} min</p>
          </div>
          {next && (
            <button type="button" className="btn btn-primary syllabus-start" data-testid={`continue-track-${tech.slug}`}
              onClick={() => onOpenModule(next.mod.id)}>
              {tech.completed_activities > 0 ? "Continue" : "Start"} chapter {next.number} <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
          {!next && chapters.length > 0 && <span className="syllabus-done"><CheckCircle2 size={16} aria-hidden="true" /> Track mastered</span>}
        </div>
        <div className="syllabus-progress" data-testid={`track-progress-${tech.slug}`}>
          <div className="syllabus-stats">
            <span>{mastered}/{chapters.length} chapters mastered · {tech.completed_activities}/{tech.total_activities} drills</span>
            <strong>Level {tech.level} · {mastery}% mastery</strong>
          </div>
          <div className="syllabus-meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(0, mastery))}%`, background: tech.color }} />
          </div>
        </div>
      </header>

      <div className="card syllabus-index" data-testid={`syllabus-roadmap-${tech.slug}`}>
        {chapters.length >= 5 ? Object.entries(partTitles).map(([key, title]) => {
          const items = chapters.filter((chapter) => chapter.part === key);
          if (!items.length) return null;
          const partDone = items.filter((chapter) => chapter.done).length;
          return (
            <details key={`${tech.slug}-${key}`} open={next?.part === key} data-testid={`syllabus-part-${key}`}>
              <summary>
                <strong>{title}</strong>
                <span>{partDone}/{items.length} mastered</span>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <ol className="syllabus-chapters">{items.map(chapterRow)}</ol>
            </details>
          );
        }) : chapters.length ? (
          <ol className="syllabus-chapters">{chapters.map(chapterRow)}</ol>
        ) : <p className="syllabus-empty">No chapters in this track yet.</p>}
      </div>
    </section>
  );
}
