import React, { useEffect, useState } from "react";
import { Play, Swords } from "lucide-react";
import { api } from "../api";
import type { ModuleDetail } from "../types";

interface Props {
  onOpenModule: (moduleId: string) => void;
}

export function BossProjectsView({ onOpenModule }: Props) {
  const [projects, setProjects] = useState<ModuleDetail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .projects()
      .then((res) => setProjects(res.projects))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card">Loading Boss Projects...</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h3 className="card-title">
          <Swords size={18} color="#f7768e" /> Boss Projects (Real-World Verifiable Builds)
        </h3>
        <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
          Build real APIs, AI-ops CLI monitors, and C++20 systems directly in Neovim. Each milestone runs real integration tests and awards Boss-tier XP!
        </p>
      </div>

      <div className="grid-2">
        {projects.map((p) => {
          const pct = p.activity_count ? Math.round((p.completed_count / p.activity_count) * 100) : 0;
          return (
            <div key={p.id} className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <span className="badge badge-rusty">Boss Quest</span>
                  <span className="badge badge-kind">{p.tech_slug}</span>
                  <span className="badge badge-unstarted">{p.difficulty}</span>
                </div>
                <h3 style={{ margin: "0 0 6px" }}>{p.title}</h3>
                <p className="muted" style={{ margin: "0 0 10px", fontSize: "0.88rem" }}>{p.subtitle}</p>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pct}%`, background: "#f7768e" }} />
                </div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  {p.completed_count}/{p.activity_count} milestones cleared • ~{p.estimated_minutes} min
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => onOpenModule(p.id)}>
                <Play size={15} /> Enter Boss Arena
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
