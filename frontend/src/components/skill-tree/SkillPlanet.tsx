import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Compass, Eye, Pause, Play, Search } from "lucide-react";
import type { SkillTreeNode, MotionMode } from "../../types";
import type { createPlanet } from "./planetScene";
import "./planet.css";
import { closestSkill, indexSkills } from "./skillSearch";

interface CategoryCount {
  name: string;
  count: number;
}

interface Props {
  nodes: SkillTreeNode[];
  allNodes: SkillTreeNode[];
  categories: CategoryCount[];
  activeCategory: string;
  onChangeCategory: (category: string) => void;
  completedTotal: number;
  viewToggle: ReactNode;
  motionMode: MotionMode;
  onBack?: () => void;
  onOpen: (id: string) => void;
}

export function SkillPlanet({
  nodes,
  allNodes,
  categories,
  activeCategory,
  onChangeCategory,
  completedTotal,
  viewToggle,
  motionMode,
  onBack,
  onOpen,
}: Props) {
  // Focused landmark in orbit (for search/preview) vs visited landmark (zoomed in first-person)
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [visitedId, setVisitedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const searching = Boolean(query.trim());

  const index = useMemo(() => indexSkills(nodes), [nodes]);
  const match = useMemo(() => closestSkill(settledQuery, index), [settledQuery, index]);

  // Clear visited/focused landmark if a category filter removes it
  useEffect(() => {
    if (visitedId && !nodes.some((n) => n.id === visitedId)) {
      setVisitedId(null);
    }
    if (focusedId && !nodes.some((n) => n.id === focusedId)) {
      setFocusedId(null);
    }
  }, [nodes, visitedId, focusedId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(query.trim()), 140);
    return () => window.clearTimeout(timer);
  }, [query]);

  // While typing in Find a skill, smoothly rotate the globe to the closest aligned skill
  useEffect(() => {
    if (match && settledQuery === query.trim()) {
      setFocusedId(match);
    }
  }, [match, settledQuery, query]);

  const visitLandmark = useCallback((id: string) => {
    setQuery("");
    setSettledQuery("");
    setFocusedId(id);
    setVisitedId(id);
  }, []);

  const leaveLandmark = useCallback(() => {
    setVisitedId(null);
  }, []);

  // Escape exits first-person view cleanly back to planet orbit
  useEffect(() => {
    if (!visitedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setVisitedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visitedId]);

  const focusedNode = focusedId ? nodes.find((n) => n.id === focusedId) ?? null : null;
  const visitedNode = visitedId ? nodes.find((n) => n.id === visitedId) ?? null : null;
  const visitedPos = visitedNode ? nodes.indexOf(visitedNode) : -1;
  const prerequisite = visitedNode
    ? allNodes.find((n) => n.id === visitedNode.prereq_module_id) ?? null
    : null;
  const following = visitedNode
    ? nodes.filter((n) => n.prereq_module_id === visitedNode.id)
    : [];

  const [preview, setPreview] = useState<SkillTreeNode | null>(null);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
  const motion = !paused && !reduced && motionMode === "full";

  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ReturnType<typeof createPlanet> | null>(null);
  const current = useRef({ focusedId, visitedId, motion, searching });
  current.current = { focusedId, visitedId, motion, searching };

  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!preference) return;
    const change = () => setReduced(preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    setPreview(null);
    setReady(false);
    const element = canvas.current;
    if (!element || !window.WebGL2RenderingContext) return;
    let alive = true;
    const stop = () => {
      engine.current?.dispose();
      engine.current = null;
    };
    const lost = () => {
      stop();
      setReady(false);
    };
    element.addEventListener("webglcontextlost", lost);
    import("./planetScene")
      .then(({ createPlanet }) => {
        if (!alive) return;
        engine.current = createPlanet(
          element,
          nodes,
          visitLandmark,
          () => setPaused(true),
          setPreview
        );
        engine.current.motion(current.current.motion, current.current.searching);
        if (current.current.visitedId) {
          engine.current.visit(current.current.visitedId, true);
        } else if (current.current.focusedId) {
          engine.current.focus(current.current.focusedId, true);
        }
        setReady(true);
      })
      .catch(() => {
        if (alive) lost();
      });
    return () => {
      alive = false;
      element.removeEventListener("webglcontextlost", lost);
      stop();
    };
  }, [nodes, visitLandmark]);

  useEffect(() => {
    engine.current?.motion(motion, searching);
  }, [motion, searching]);

  useEffect(() => {
    if (!engine.current) return;
    if (visitedId) {
      engine.current.visit(visitedId);
    } else {
      engine.current.leave();
      engine.current.focus(focusedId);
    }
  }, [visitedId, focusedId]);

  const activeOrbitLabel = preview ?? focusedNode;
  const isFirstPerson = Boolean(visitedNode);

  return (
    <section
      className={`skill-planet${isFirstPerson ? " is-first-person" : " is-orbit"}`}
      aria-label={isFirstPerson ? `First-person landmark view: ${visitedNode?.title}` : "Skill planet"}
      data-view-mode={isFirstPerson ? "first-person" : "orbit"}
    >
      {/* Full-viewport 3D Frutiger Aero World Canvas */}
      <div className="skill-orbit">
        {!ready && (
          <div
            aria-hidden="true"
            className={isFirstPerson ? "skill-fallback-landmark" : "skill-fallback-globe"}
          />
        )}
        <canvas ref={canvas} aria-hidden="true" data-ready={ready} />
      </div>

      {/* Minimal Top Bar — ONLY a clean Back button on the left + subtle compact search/nav on right */}
      <div className="planet-top-bar">
        <button
          type="button"
          className="tree-back-btn"
          data-testid={isFirstPerson ? "landmark-back-btn" : "skill-tree-back"}
          onClick={isFirstPerson ? leaveLandmark : onBack}
        >
          <ArrowLeft size={16} />
          <span>{isFirstPerson ? "Back to planet" : "Back"}</span>
        </button>

        {!isFirstPerson ? (
          <div className="planet-top-actions">
            <div className="planet-search-wrap">
              <Search size={14} className="planet-search-icon" aria-hidden="true" />
              <label htmlFor="planet-search" className="sr-only">
                Find a skill
              </label>
              <input
                id="planet-search"
                className="planet-search"
                type="search"
                value={query}
                placeholder="Find a skill..."
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setQuery("");
                  } else if (event.key === "Enter" && focusedNode) {
                    event.preventDefault();
                    visitLandmark(focusedNode.id);
                  }
                }}
              />
            </div>

            <select
              className="planet-category-pill"
              aria-label="Filter skill tree by category"
              value={activeCategory}
              onChange={(event) => onChangeCategory(event.target.value)}
            >
              {categories.map((cat) => (
                <option key={cat.name} value={cat.name}>
                  {cat.name} ({cat.count})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="planet-fp-nav">
            <span className="planet-fp-hint">
              <Eye size={14} aria-hidden="true" /> Drag to look up &amp; around
            </span>
            <div className="planet-fp-stepper">
              <button
                type="button"
                aria-label="Previous landmark"
                disabled={visitedPos <= 0}
                onClick={() => visitedPos > 0 && visitLandmark(nodes[visitedPos - 1].id)}
              >
                <ChevronLeft size={16} />
              </button>
              <select
                aria-label="Jump to landmark"
                value={visitedNode?.id || ""}
                onChange={(event) => visitLandmark(event.target.value)}
              >
                {nodes.map((n) => (
                  <option value={n.id} key={n.id}>
                    {n.tech_name} · {n.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Next landmark"
                disabled={visitedPos < 0 || visitedPos >= nodes.length - 1}
                onClick={() =>
                  visitedPos >= 0 &&
                  visitedPos < nodes.length - 1 &&
                  visitLandmark(nodes[visitedPos + 1].id)
                }
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search miss feedback in Orbit View */}
      {!isFirstPerson && searching && query.trim() === settledQuery && !match && (
        <div className="planet-search-miss" role="status">
          No matching skill in this view.
        </div>
      )}

      {/* Orbit View Bottom Dock — quiet prompt / hover caption / quick visit, NO full info until zoomed in */}
      {!isFirstPerson && (
        <div className="planet-orbit-dock">
          {activeOrbitLabel ? (
            <button
              type="button"
              className="landmark-visit-pill"
              data-testid="landmark-visit-pill"
              onClick={() => visitLandmark(activeOrbitLabel.id)}
            >
              <span className="landmark-visit-meta">
                {activeOrbitLabel.tech_name} · {activeOrbitLabel.difficulty}
              </span>
              <strong>{activeOrbitLabel.title}</strong>
              <span className="landmark-visit-cta">
                Visit <ArrowRight size={14} />
              </span>
            </button>
          ) : (
            <div className="planet-orbit-guide">
              <Compass size={15} aria-hidden="true" />
              <span>Drag to spin the world · Click any landmark to explore up close</span>
            </div>
          )}

          <div className="planet-orbit-footer">
            {viewToggle}
            <span className="planet-orbit-count">
              {completedTotal}/{nodes.length} completed
            </span>
            {!ready && nodes.length > 0 && (
              <select
                className="planet-fallback-select"
                aria-label="Visit a landmark"
                value=""
                onChange={(e) => {
                  if (e.target.value) visitLandmark(e.target.value);
                }}
              >
                <option value="">Choose a landmark to visit…</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.tech_name} · {n.title}
                  </option>
                ))}
              </select>
            )}
            {ready && !searching && !reduced && motionMode === "full" && (
              <button
                type="button"
                className="orbit-motion"
                onClick={() => setPaused(!paused)}
              >
                {paused ? <Play size={14} /> : <Pause size={14} />}{" "}
                {paused ? "Rotate planet" : "Pause rotation"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* First-Person View Landmark Details — ONLY appears once zoomed in on a landmark! */}
      {isFirstPerson && visitedNode && (
        <article
          className="landmark-fp-details"
          data-testid="landmark-details"
          aria-live="polite"
          key={visitedNode.id}
        >
          <div className="landmark-fp-badges">
            <span className="landmark-fp-tech">
              <span
                className="landmark-fp-dot"
                style={{ background: visitedNode.color }}
                aria-hidden="true"
              />
              {visitedNode.tech_name}
            </span>
            <span className={`landmark-fp-tier tier-${visitedNode.kind === "project" ? "boss" : visitedNode.difficulty.toLowerCase()}`}>
              {visitedNode.kind === "project" ? "Boss Landmark" : visitedNode.difficulty}
            </span>
            <span className="landmark-fp-status">
              {visitedNode.completed
                ? "Completed"
                : visitedNode.unlocked
                ? "Unlocked"
                : "Locked"}
            </span>
          </div>

          <h2 className="landmark-fp-title">{visitedNode.title}</h2>

          <div className="landmark-fp-progress">
            <span>
              {visitedNode.done_acts}/{visitedNode.total_acts} activities completed
            </span>
            <progress
              aria-label="Module progress"
              max={visitedNode.total_acts || 1}
              value={visitedNode.done_acts}
            />
          </div>

          {(prerequisite || following.length > 0) && (
            <div className="landmark-fp-links">
              {prerequisite && (
                <p className="landmark-fp-prereq">
                  <span>Prerequisite:</span>{" "}
                  <button
                    type="button"
                    className="planet-prereq"
                    onClick={() =>
                      nodes.some((n) => n.id === prerequisite.id)
                        ? visitLandmark(prerequisite.id)
                        : onOpen(prerequisite.id)
                    }
                  >
                    {prerequisite.title}
                  </button>
                </p>
              )}
              {following.length > 0 && (
                <details className="skill-routes">
                  <summary>Connected landmarks ({following.length})</summary>
                  <div className="skill-routes-list">
                    {following.map((node) => (
                      <button
                        type="button"
                        className="planet-prereq"
                        key={node.id}
                        onClick={() => visitLandmark(node.id)}
                      >
                        {node.title}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          <div className="landmark-fp-cta-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onOpen(visitedNode.id)}
            >
              Open module <ArrowRight size={16} />
            </button>
            <button
              type="button"
              className="landmark-fp-orbit-btn"
              onClick={leaveLandmark}
            >
              Return to orbit
            </button>
          </div>
        </article>
      )}
    </section>
  );
}
