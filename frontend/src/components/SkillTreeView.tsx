import React, { useEffect, useState } from "react";
import { CheckCircle2, GitBranch, Lock, Unlock } from "lucide-react";
import { api } from "../api";
import type { SkillTreeNode } from "../types";

interface Props {
  onOpenModule: (moduleId: string) => void;
}

export function SkillTreeView({ onOpenModule }: Props) {
  const [nodes, setNodes] = useState<SkillTreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .skillTree()
      .then((res) => setNodes(res.nodes))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card">Loading skill tree...</div>;

  const grouped: Record<string, SkillTreeNode[]> = {};
  for (const n of nodes) {
    (grouped[n.category] ||= []).push(n);
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card">
        <h3 className="card-title">
          <GitBranch size={18} color="#bb9af7" /> Developer RPG Skill Tree
        </h3>
        <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
          Complete foundational modules to unlock advanced katas and multi-stack Boss Projects (you can still peek at any node to study freely).
        </p>
      </div>

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="card">
          <h4 style={{ margin: "0 0 12px", color: "#93a3be", textTransform: "uppercase", fontSize: "0.8rem" }}>
            {category}
          </h4>
          <div className="tree-grid">
            {items.map((node) => (
              <div
                key={node.id}
                className={`tree-node ${node.completed ? "completed" : ""} ${!node.unlocked ? "locked" : ""}`}
                onClick={() => onOpenModule(node.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onOpenModule(node.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", fontWeight: 700 }}>
                    <span className="tech-dot" style={{ background: node.color }} />
                    {node.tech_name}
                  </div>
                  {node.completed ? (
                    <CheckCircle2 size={16} color="#22c55e" />
                  ) : node.unlocked ? (
                    <Unlock size={15} color="#7aa2f7" />
                  ) : (
                    <Lock size={15} color="#93a3be" />
                  )}
                </div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{node.title}</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }} className="muted">
                  <span>{node.kind} • {node.difficulty}</span>
                  <span>{node.done_acts}/{node.total_acts} mastered</span>
                </div>
                {node.prereq_module_id && (
                  <div className="muted" style={{ fontSize: "0.74rem", marginTop: 6 }}>
                    Requires: <code>{node.prereq_module_id}</code>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
