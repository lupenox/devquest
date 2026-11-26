import { BookOpen, ChevronDown, History } from "lucide-react";
import { extractRepoFromModule } from "../repoReference";
import type { MockInterviewSummary, ModuleSummary } from "../types";
import "../repo-practice-library.css";

interface Props {
  packs: ModuleSummary[];
  interviews: MockInterviewSummary[];
  readinessByRepo: Map<string, MockInterviewSummary>;
  onOpenModule: (id: string) => void;
  onStart: (repo: string) => void;
  busy: boolean;
}

export function RepoPracticeLibrary({ packs, interviews, readinessByRepo, onOpenModule, onStart, busy }: Props) {
  function packRow(pack: ModuleSummary) {
    const repo = extractRepoFromModule(pack);
    const title = pack.title.replace(/^Interview Prep:\s*/i, "") || repo;
    const best = readinessByRepo.get(repo.toLowerCase()) ?? readinessByRepo.get(pack.id);
    return (
      <li className="saved-practice-row" key={pack.id}>
        <div className="saved-practice-info">
          <strong>{title}</strong>
          <small>
            {pack.completed_count}/{pack.activity_count} drills mastered · {pack.tech_slug.toUpperCase()}
            {best && ` · ${Math.round(best.readiness_score)}% readiness`}
          </small>
        </div>
        <div className="saved-practice-actions">
          <button type="button" className="btn btn-sm" onClick={() => onStart(repo)} disabled={busy}>Start interview</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenModule(pack.id)}>Open pack</button>
        </div>
      </li>
    );
  }

  return (
    <>
      <section className="card saved-practice" aria-label="Saved study packs">
        <div className="saved-practice-heading">
          <BookOpen size={17} aria-hidden="true" /><h3>Saved study packs</h3>
          <span>{packs.length}</span>
        </div>
        {packs.length ? <ul>{packRow(packs[0])}</ul> : <p>No study packs saved yet.</p>}
        {packs.length > 1 && (
          <details className="saved-practice-more">
            <summary>More study packs ({packs.length - 1}) <ChevronDown size={15} aria-hidden="true" /></summary>
            <ul>{packs.slice(1).map(packRow)}</ul>
          </details>
        )}
      </section>

      {interviews.length > 0 && (
        <details className="card practice-history">
          <summary>
            <History size={17} aria-hidden="true" />
            <strong>Interview history</strong>
            <span>{interviews.length} {interviews.length === 1 ? "session" : "sessions"}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <ul>
            {interviews.map((session) => (
              <li className="saved-practice-row" key={session.id}>
                <div className="saved-practice-info">
                  <strong>{session.repo_full_name}</strong>
                  <small>
                    <time dateTime={session.created_at}>{session.created_at.slice(0, 10)}</time>
                    {" · "}{session.status} · {Math.round(session.readiness_score)}% readiness
                  </small>
                </div>
                <button type="button" className="btn btn-sm" disabled={busy}
                  onClick={() => onStart(session.repo_full_name)}>Practice again</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
