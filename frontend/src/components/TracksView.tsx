import { useEffect, useState, type MouseEvent } from "react";
import { ArrowLeft, ChevronRight, Search } from "lucide-react";
import { api } from "../api";
import { routeToPath } from "../router";
import type { Technology } from "../types";
import { TrackSyllabus } from "./TrackSyllabus";
import "../tracks.css";

interface Props {
  techSlug: string | null;
  onSelectTech: (slug: string) => void;
  onAllTracks: () => void;
  onOpenModule: (moduleId: string) => void;
}

function followLink(event: MouseEvent<HTMLAnchorElement>, navigate: () => void) {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  navigate();
  window.scrollTo(0, 0);
}

export function TracksView({ techSlug, onSelectTech, onAllTracks, onOpenModule }: Props) {
  const [technologies, setTechnologies] = useState<Technology[] | null>(null);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    api.tracks().then(({ technologies }) => {
      if (current) setTechnologies(technologies);
    }).catch(() => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, [attempt]);

  if (failed) return (
    <div className="card">
      <p role="alert">The tracks could not be loaded.</p>
      <button type="button" className="btn" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>Try again</button>
    </div>
  );
  if (!technologies) return <div className="card" role="status">Loading tracks…</div>;

  if (techSlug && techSlug !== "all") {
    const selected = technologies.find((t) => t.slug === techSlug);
    return (
      <div className="track-view">
        <div className="track-toolbar">
          <a href="/tracks" onClick={(event) => followLink(event, () => { setQuery(""); onAllTracks(); })}>
            <ArrowLeft size={16} aria-hidden="true" /> All tracks
          </a>
          {selected && (
            <label className="track-switch">Switch track
              <select value={techSlug} onChange={(event) => onSelectTech(event.target.value)}>
                {technologies.map((tech) => <option key={tech.slug} value={tech.slug}>{tech.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {selected
          ? <TrackSyllabus key={selected.slug} tech={selected} onOpenModule={onOpenModule} />
          : <p className="card">This track could not be found.</p>}
      </div>
    );
  }

  const search = query.trim().toLowerCase();
  const groups = new Map<string, Technology[]>();
  let matches = 0;
  let chapters = 0;
  for (const tech of technologies) {
    chapters += tech.modules?.length ?? 0;
    if (!`${tech.name} ${tech.slug} ${tech.category}`.toLowerCase().includes(search)) continue;
    matches++;
    const group = groups.get(tech.category);
    if (group) group.push(tech);
    else groups.set(tech.category, [tech]);
  }

  return (
    <section className="card tracks-directory" aria-labelledby="tracks-heading">
      <div className="tracks-heading-row">
        <div>
          <h2 id="tracks-heading">Learning tracks</h2>
          <p>{technologies.length} technologies · {chapters} chapters</p>
        </div>
        <label className="track-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Find a track" placeholder="Find a track" value={query}
            onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {search && <p className="track-results" role="status">{matches} {matches === 1 ? "track" : "tracks"} found</p>}
      {Array.from(groups, ([category, techs]) => (
        <section className="track-group" key={category}>
          <h3>{category}</h3>
          <ul>
            {techs.map((tech) => {
              const count = tech.modules?.length ?? 0;
              const pct = Math.round(tech.mastery_pct);
              return (
                <li key={tech.slug}>
                  <a className="track-link" data-testid={`track-link-${tech.slug}`}
                    href={routeToPath({ tab: "tracks", techSlug: tech.slug, moduleId: null })}
                    onClick={(event) => followLink(event, () => onSelectTech(tech.slug))}>
                    <span className="directory-track-dot" style={{background: tech.color}} />
                    <span className="directory-track-text">
                      <strong>{tech.name}</strong>
                      <small>{count} {count === 1 ? "chapter" : "chapters"}{tech.xp > 0 || pct > 0 ? ` · ${pct}% mastery` : ""}</small>
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {matches === 0 && (search
        ? <button type="button" className="btn" onClick={() => setQuery("")}>Clear search</button>
        : <p>No learning tracks are available yet.</p>)}
    </section>
  );
}
