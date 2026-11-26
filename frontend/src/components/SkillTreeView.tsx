import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, GitBranch, Lock, Swords, Unlock } from "lucide-react";
import { api } from "../api";
import type { SkillTreeNode } from "../types";
import "../labs.css";

interface Props {
  onOpenModule: (moduleId: string) => void;
}

interface ComputedEdge {
  key: string;
  from: string;
  to: string;
  d: string;
  status: "completed" | "unlocked" | "locked";
}

function tierTitle(colIdx: number, totalCols: number, hasBossTier: boolean): string {
  if (colIdx === 0) return "Tier 1 • Foundations";
  if (hasBossTier && colIdx === totalCols - 1) return `Tier ${colIdx + 1} • Boss Projects`;
  if (colIdx === 1) return "Tier 2 • Intermediate & Katas";
  return `Tier ${colIdx + 1} • Advanced Mastery`;
}

export function SkillTreeView({ onOpenModule }: Props) {
  const [nodes, setNodes] = useState<SkillTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [computedEdges, setComputedEdges] = useState<ComputedEdge[]>([]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    api
      .skillTree()
      .then((res) => setNodes(res.nodes))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      counts.set(n.category, (counts.get(n.category) || 0) + 1);
    }
    return [
      { name: "All", count: nodes.length },
      ...Array.from(counts.entries()).map(([name, count]) => ({ name, count })),
    ];
  }, [nodes]);

  const visibleNodes = useMemo(() => {
    if (activeCategory === "All") return nodes;
    return nodes.filter((n) => n.category === activeCategory);
  }, [nodes, activeCategory]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, SkillTreeNode>();
    for (const n of visibleNodes) map.set(n.id, n);
    return map;
  }, [visibleNodes]);

  // Compute topological dependency columns so every prereq_module_id -> id flows left-to-right
  const { columns, hasBossTier, visibleEdges, nodeColRow } = useMemo(() => {
    const depthMemo = new Map<string, number>();

    const getDepth = (id: string, visiting = new Set<string>()): number => {
      if (depthMemo.has(id)) return depthMemo.get(id)!;
      const n = nodeMap.get(id);
      if (!n || !n.prereq_module_id || !nodeMap.has(n.prereq_module_id) || visiting.has(id)) {
        depthMemo.set(id, 0);
        return 0;
      }
      visiting.add(id);
      const d = getDepth(n.prereq_module_id, visiting) + 1;
      depthMemo.set(id, d);
      return d;
    };

    for (const n of visibleNodes) {
      getDepth(n.id);
    }

    const nonProjectMax = visibleNodes.reduce((mx, n) => {
      if (n.kind === "project") return mx;
      return Math.max(mx, depthMemo.get(n.id) || 0);
    }, 0);

    const hasBoss = visibleNodes.some((n) => n.kind === "project");
    const bossCol = hasBoss ? Math.max(2, nonProjectMax + 1) : nonProjectMax;

    const colBuckets = new Map<number, SkillTreeNode[]>();
    for (const n of visibleNodes) {
      let col = depthMemo.get(n.id) || 0;
      if (n.kind === "project") {
        col = Math.max(bossCol, col);
      }
      const bucket = colBuckets.get(col) || [];
      bucket.push(n);
      colBuckets.set(col, bucket);
    }

    const maxCol = Math.max(0, ...Array.from(colBuckets.keys()));
    const cols: SkillTreeNode[][] = [];
    const posIndex = new Map<string, { col: number; row: number }>();

    for (let c = 0; c <= maxCol; c++) {
      const bucket = colBuckets.get(c) || [];
      // Order column 0 by category then tech_name; subsequent columns near their prereq's row to reduce crossings
      if (c === 0) {
        bucket.sort((a, b) =>
          a.category.localeCompare(b.category) ||
          a.tech_name.localeCompare(b.tech_name) ||
          a.title.localeCompare(b.title)
        );
      } else {
        bucket.sort((a, b) => {
          const pa = a.prereq_module_id ? posIndex.get(a.prereq_module_id)?.row ?? 999 : 999;
          const pb = b.prereq_module_id ? posIndex.get(b.prereq_module_id)?.row ?? 999 : 999;
          return pa - pb || a.tech_name.localeCompare(b.tech_name) || a.title.localeCompare(b.title);
        });
      }
      bucket.forEach((n, row) => posIndex.set(n.id, { col: c, row }));
      if (bucket.length > 0) {
        cols.push(bucket);
      }
    }

    // Re-index compact column indices
    const compactPos = new Map<string, { col: number; row: number }>();
    cols.forEach((colNodes, cIdx) => {
      colNodes.forEach((n, rIdx) => compactPos.set(n.id, { col: cIdx, row: rIdx }));
    });

    const edges: { from: string; to: string; status: "completed" | "unlocked" | "locked" }[] = [];
    for (const n of visibleNodes) {
      if (n.prereq_module_id && nodeMap.has(n.prereq_module_id)) {
        const src = nodeMap.get(n.prereq_module_id)!;
        const status: "completed" | "unlocked" | "locked" =
          src.completed && n.completed
            ? "completed"
            : src.completed || n.unlocked
            ? "unlocked"
            : "locked";
        edges.push({ from: src.id, to: n.id, status });
      }
    }

    return {
      columns: cols,
      hasBossTier: hasBoss,
      visibleEdges: edges,
      nodeColRow: compactPos,
    };
  }, [visibleNodes, nodeMap]);

  // Connected chain set for hover highlighting
  const highlightedIds = useMemo(() => {
    if (!hoveredId) return null;
    const set = new Set<string>([hoveredId]);
    // Walk ancestors
    let cur = nodeMap.get(hoveredId);
    let guard = 0;
    while (cur?.prereq_module_id && nodeMap.has(cur.prereq_module_id) && guard < 20) {
      set.add(cur.prereq_module_id);
      cur = nodeMap.get(cur.prereq_module_id);
      guard++;
    }
    // Walk descendants
    let added = true;
    while (added) {
      added = false;
      for (const n of visibleNodes) {
        if (n.prereq_module_id && set.has(n.prereq_module_id) && !set.has(n.id)) {
          set.add(n.id);
          added = true;
        }
      }
    }
    return set;
  }, [hoveredId, nodeMap, visibleNodes]);

  // Measure node positions to render crisp SVG cubic-bezier connectors
  const recalcPaths = () => {
    const stage = stageRef.current;
    const stageRect = stage?.getBoundingClientRect();
    const hasDomLayout = Boolean(stageRect && stageRect.width > 0 && stageRect.height > 0);

    const next: ComputedEdge[] = [];
    for (const edge of visibleEdges) {
      const fromEl = nodeRefs.current.get(edge.from);
      const toEl = nodeRefs.current.get(edge.to);
      let x1: number;
      let y1: number;
      let x2: number;
      let y2: number;

      if (hasDomLayout && stageRect && fromEl && toEl) {
        const r1 = fromEl.getBoundingClientRect();
        const r2 = toEl.getBoundingClientRect();
        x1 = r1.right - stageRect.left;
        y1 = r1.top + r1.height / 2 - stageRect.top;
        x2 = r2.left - stageRect.left;
        y2 = r2.top + r2.height / 2 - stageRect.top;
      } else {
        // Fallback deterministic coordinates (e.g. JSDOM tests before layout)
        const p1 = nodeColRow.get(edge.from) || { col: 0, row: 0 };
        const p2 = nodeColRow.get(edge.to) || { col: 1, row: 0 };
        x1 = p1.col * 310 + 250;
        y1 = p1.row * 130 + 90;
        x2 = p2.col * 310 + 10;
        y2 = p2.row * 130 + 90;
      }

      const dx = Math.max(42, Math.abs(x2 - x1) * 0.48);
      const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      next.push({
        key: `${edge.from}->${edge.to}`,
        from: edge.from,
        to: edge.to,
        d,
        status: edge.status,
      });
    }
    setComputedEdges(next);
  };

  useLayoutEffect(() => {
    recalcPaths();
    const stage = stageRef.current;
    let ro: ResizeObserver | null = null;
    if (stage && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => recalcPaths());
      ro.observe(stage);
    }
    const onResize = () => recalcPaths();
    window.addEventListener("resize", onResize);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [visibleEdges, columns]);

  if (loading) return <div className="card">Loading skill tree...</div>;

  const completedTotal = visibleNodes.filter((n) => n.completed).length;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card">
        <div className="st-header-row">
          <div>
            <h3 className="card-title" style={{ marginBottom: 6 }}>
              <GitBranch size={18} color="#bb9af7" /> Developer RPG Skill Tree
            </h3>
            <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
              Progress left-to-right from Foundations through Intermediate Katas to Boss Projects. Hover any node to trace its mastery path, or click to jump straight in!
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <span className="badge badge-done">
              {completedTotal}/{visibleNodes.length} Nodes Completed
            </span>
            <div className="st-legend">
              <span className="st-legend-item">
                <span className="st-swatch completed" /> Completed
              </span>
              <span className="st-legend-item">
                <span className="st-swatch unlocked" /> Unlocked
              </span>
              <span className="st-legend-item">
                <span className="st-swatch locked" /> Locked
              </span>
            </div>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="st-filter-row" role="tablist" aria-label="Filter skill tree by category">
          {categories.map((cat) => (
            <button
              key={cat.name}
              type="button"
              role="tab"
              aria-selected={activeCategory === cat.name}
              className={`st-filter-pill ${activeCategory === cat.name ? "active" : ""}`}
              onClick={() => setActiveCategory(cat.name)}
            >
              {cat.name} ({cat.count})
            </button>
          ))}
        </div>
      </div>

      {/* Layered SVG + Node Canvas */}
      <div className="card" style={{ padding: "16px 14px" }}>
        {columns.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No skill nodes match this category.</p>
        ) : (
          <div className="st-canvas-scroll">
            <div className="st-stage" ref={stageRef} data-testid="skill-tree-svg-stage">
              <svg className="st-svg-layer" aria-hidden="true" data-testid="skill-tree-connectors">
                <defs>
                  <marker id="st-arrow-completed" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#22c55e" />
                  </marker>
                  <marker id="st-arrow-unlocked" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#7aa2f7" />
                  </marker>
                  <marker id="st-arrow-locked" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#93a3be" />
                  </marker>
                </defs>
                {computedEdges.map((edge) => {
                  const isHighlighted =
                    highlightedIds !== null &&
                    highlightedIds.has(edge.from) &&
                    highlightedIds.has(edge.to);
                  const isDimmed = highlightedIds !== null && !isHighlighted;
                  return (
                    <path
                      key={edge.key}
                      d={edge.d}
                      className={`st-edge st-edge-${edge.status} ${
                        isHighlighted ? "st-edge-highlight" : isDimmed ? "st-edge-dim" : ""
                      }`}
                      markerEnd={`url(#st-arrow-${edge.status})`}
                      data-edge-from={edge.from}
                      data-edge-to={edge.to}
                    />
                  );
                })}
              </svg>

              <div
                className="st-columns"
                style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(245px, 1fr))` }}
              >
                {columns.map((colNodes, cIdx) => {
                  const isBossCol = hasBossTier && cIdx === columns.length - 1;
                  return (
                    <div key={cIdx} className="st-tier-col">
                      <div className="st-tier-header">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {isBossCol && <Swords size={13} color="#e0af68" />}
                          {tierTitle(cIdx, columns.length, hasBossTier)}
                        </span>
                        <span className="muted">{colNodes.length}</span>
                      </div>

                      {colNodes.map((node) => {
                        const pct = node.total_acts
                          ? Math.round((node.done_acts / node.total_acts) * 100)
                          : 0;
                        const inChain = highlightedIds?.has(node.id) ?? false;
                        return (
                          <div
                            key={node.id}
                            ref={(el) => {
                              if (el) nodeRefs.current.set(node.id, el);
                              else nodeRefs.current.delete(node.id);
                            }}
                            className={`st-node ${node.completed ? "completed" : ""} ${
                              !node.unlocked ? "locked" : ""
                            } ${inChain ? "chain-highlight" : ""}`}
                            data-testid={`tree-node-${node.id}`}
                            onClick={() => onOpenModule(node.id)}
                            onMouseEnter={() => setHoveredId(node.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onOpenModule(node.id);
                              }
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 5,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                  fontSize: "0.78rem",
                                  fontWeight: 700,
                                }}
                              >
                                <span className="tech-dot" style={{ background: node.color, marginRight: 2 }} />
                                {node.tech_name}
                              </div>
                              {node.completed ? (
                                <CheckCircle2 size={16} color="#22c55e" />
                              ) : node.unlocked ? (
                                <Unlock size={14} color="#7aa2f7" />
                              ) : (
                                <Lock size={14} color="#93a3be" />
                              )}
                            </div>

                            <div style={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.3, marginBottom: 6 }}>
                              {node.title}
                            </div>

                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                fontSize: "0.75rem",
                              }}
                              className="muted"
                            >
                              <span>
                                {node.kind} • {node.difficulty}
                              </span>
                              <span>
                                {node.done_acts}/{node.total_acts}
                              </span>
                            </div>

                            <div className="st-node-progress">
                              <div
                                className="st-node-progress-fill"
                                style={{
                                  width: `${pct}%`,
                                  background: node.completed ? "#22c55e" : node.color,
                                }}
                              />
                            </div>

                            {node.prereq_module_id && (
                              <div className="muted" style={{ fontSize: "0.71rem", marginTop: 6 }}>
                                Prereq: <code>{node.prereq_module_id}</code>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
