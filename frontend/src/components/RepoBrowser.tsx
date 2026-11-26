import { useRef, useState } from "react";
import { ChevronDown, ExternalLink, FolderGit2, Lock, Search } from "lucide-react";
import type { GitHubRepo, MockInterviewSummary } from "../types";
import "../dashboard-library.css";
import "../repo-browser.css";

interface Props {
  repos: GitHubRepo[];
  readinessByRepo: Map<string, MockInterviewSummary>;
  onChoose: (fullName: string) => void;
  loading: boolean;
}

const PAGE_SIZE = 6;

export function RepoBrowser({ repos, readinessByRepo, onChoose, loading }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const details = useRef<HTMLDetailsElement>(null);
  const search = query.trim().toLowerCase();
  const matches = repos.filter((repo) =>
    [repo.full_name, repo.language, repo.description].some((field) => field?.toLowerCase().includes(search))
  );
  const pages = Math.ceil(matches.length / PAGE_SIZE);
  const current = Math.min(page, Math.max(0, pages - 1));
  const start = current * PAGE_SIZE;
  const visible = matches.slice(start, start + PAGE_SIZE);

  function choose(fullName: string) {
    if (details.current) details.current.open = false;
    onChoose(fullName);
  }

  return (
    <details className="card repo-browser" ref={details} data-testid="repo-browser">
      <summary className="library-summary">
        <FolderGit2 size={18} aria-hidden="true" />
        <strong>GitHub repositories</strong>
        <span className="library-count">{loading ? "Loading…" : repos.length}</span>
        <ChevronDown size={16} className="library-chevron" aria-hidden="true" />
      </summary>
      <div className="repo-browser-content" aria-busy={loading}>
        {repos.length > 0 && (
          <label className="repo-browser-filter">
            <Search size={16} aria-hidden="true" />
            <input type="search" aria-label="Filter repositories by name or language"
              placeholder="Filter by name or language" value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
          </label>
        )}
        {visible.length ? (
          <>
            <ul className="repo-browser-list">
              {visible.map((repo) => {
                const interview = readinessByRepo.get(repo.full_name.toLowerCase());
                return (
                  <li key={repo.full_name}>
                    <div className="repo-browser-entry">
                      <a href={repo.html_url} target="_blank" rel="noreferrer"
                        aria-label={`${repo.full_name} on GitHub`}>
                        {repo.full_name} <ExternalLink size={13} aria-hidden="true" />
                      </a>
                      <div className="repo-browser-meta">
                        {repo.language && <span>{repo.language}</span>}
                        {repo.private && <span><Lock size={12} aria-hidden="true" /> Private</span>}
                        {interview && <span>{Math.round(interview.readiness_score)}% ready</span>}
                      </div>
                      {repo.description && <p>{repo.description}</p>}
                    </div>
                    <button type="button" className="btn btn-sm" aria-label={`Use repository ${repo.full_name}`}
                      onClick={() => choose(repo.full_name)}>Use repository</button>
                  </li>
                );
              })}
            </ul>
            <div className="repo-browser-footer">
              <span role="status">{start + 1}–{start + visible.length} of {matches.length}</span>
              {pages > 1 && (
                <div className="repo-browser-pagination">
                  <button type="button" className="btn btn-sm" disabled={current === 0}
                    onClick={() => setPage(current - 1)}>Previous</button>
                  <button type="button" className="btn btn-sm" disabled={current + 1 >= pages}
                    onClick={() => setPage(current + 1)}>Next</button>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="repo-browser-empty" role="status">
            {loading ? "Loading repositories…" : repos.length ? "No matching repositories." : "No repositories loaded."}
          </p>
        )}
      </div>
    </details>
  );
}
