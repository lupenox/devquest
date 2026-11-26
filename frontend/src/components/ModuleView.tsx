import React, { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, ExternalLink } from "lucide-react";
import { api } from "../api";
import type { GradeOutcome, ModuleDetail } from "../types";
import { ActivityCard } from "./ActivityWidgets";

interface Props {
  moduleId: string;
  liveOutcome: GradeOutcome | null;
  onBack: () => void;
  onProgressUpdated: () => void;
}

export function ModuleView({ moduleId, liveOutcome, onBack, onProgressUpdated }: Props) {
  const [mod, setMod] = useState<ModuleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.module(moduleId);
      setMod(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load module");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [moduleId]);

  useEffect(() => {
    if (liveOutcome && mod?.activities.some((a) => a.id === liveOutcome.activity_id) && liveOutcome.passed) {
      load();
    }
  }, [liveOutcome]);

  if (loading) return <div className="card">Loading interactive zyBooks module...</div>;
  if (error || !mod) return <div className="card">{error || "Module not found"}</div>;

  const doneCount = mod.activities.filter((a) => a.completed).length;
  const pct = mod.activities.length ? Math.round((doneCount / mod.activities.length) * 100) : 0;

  return (
    <div>
      <button type="button" className="btn" onClick={onBack} style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> Back
      </button>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="tech-dot" style={{ background: mod.technology.color }} />
              <strong>{mod.technology.name}</strong>
              <span className="badge badge-kind">{mod.kind}</span>
              <span className="badge badge-unstarted">{mod.difficulty}</span>
              <span className="muted" style={{ fontSize: "0.82rem" }}>~{mod.estimated_minutes} min</span>
            </div>
            <h2 style={{ margin: "0 0 6px" }}>{mod.title}</h2>
            <p className="muted" style={{ margin: 0 }}>{mod.subtitle}</p>
          </div>
          <div style={{ minWidth: 180 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}>
              <span>Module Progress</span>
              <strong>{doneCount}/{mod.activities.length} ({pct}%)</strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%`, background: mod.technology.color }} />
            </div>
          </div>
        </div>
        {mod.content.external_resources && mod.content.external_resources.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {mod.content.external_resources.map((r) => (
              <a
                key={r.url}
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm"
                style={{ textDecoration: "none" }}
              >
                <ExternalLink size={13} /> {r.label}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* zyBooks Active Reading Sections */}
      {mod.content.sections.map((sec, idx) => (
        <section key={idx} className="zy-section">
          <h3 className="card-title">
            <BookOpen size={17} color="#7aa2f7" /> {sec.title}
          </h3>
          <p style={{ margin: "0 0 8px", lineHeight: 1.65 }}>{sec.body}</p>
          {sec.code_example && <pre className="code-block">{sec.code_example}</pre>}
        </section>
      ))}

      {/* Interactive Participation & Neovim Challenge Activities */}
      <h3 style={{ margin: "20px 0 12px" }}>Interactive Participation &amp; Neovim Labs</h3>
      {mod.activities.map((act) => (
        <ActivityCard
          key={act.id}
          activity={act}
          liveOutcome={liveOutcome?.activity_id === act.id ? liveOutcome : null}
          onGraded={() => {
            onProgressUpdated();
            load();
          }}
        />
      ))}
    </div>
  );
}
