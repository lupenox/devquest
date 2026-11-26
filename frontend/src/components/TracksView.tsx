import React, { useEffect, useState } from "react";
import { BookOpen, Code2, Play } from "lucide-react";
import { api } from "../api";
import type { Technology } from "../types";

interface Props {
  initialTech: string | null;
  onOpenModule: (moduleId: string) => void;
}

export function TracksView({ initialTech, onOpenModule }: Props) {
  const [techs, setTechs] = useState<Technology[]>([]);
  const [activeTech, setActiveTech] = useState<string>(initialTech || "all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (initialTech) setActiveTech(initialTech);
  }, [initialTech]);

  useEffect(() => {
    api
      .tracks()
      .then((res) => setTechs(res.technologies))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card">Loading tracks...</div>;

  const visible = activeTech === "all" ? techs : techs.filter((t) => t.slug === activeTech);

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            type="button"
            className={`btn btn-sm ${activeTech === "all" ? "btn-primary" : ""}`}
            onClick={() => setActiveTech("all")}
          >
            All 16 Technologies
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

      <div style={{ display: "grid", gap: 14 }}>
        {visible.map((t) => (
          <div key={t.slug} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="tech-dot" style={{ background: t.color }} />
                <h3 style={{ margin: 0 }}>{t.name}</h3>
                <span className="muted" style={{ fontSize: "0.82rem" }}>{t.category}</span>
              </div>
              <div style={{ fontSize: "0.85rem" }}>
                Lv.{t.level} • <strong>{Math.round(t.mastery_pct)}% Mastery</strong>
              </div>
            </div>

            <div className="grid-2">
              {(t.modules || []).map((m) => (
                <div
                  key={m.id}
                  style={{
                    background: "#131928",
                    border: "1px solid #26314c",
                    borderRadius: 10,
                    padding: 14,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                      <span className="badge badge-kind">{m.kind}</span>
                      <span className="badge badge-unstarted">{m.difficulty}</span>
                      {m.source === "generated" && <span className="badge badge-xp">Ollama AI</span>}
                    </div>
                    <strong style={{ display: "block", marginBottom: 4 }}>{m.title}</strong>
                    <p className="muted" style={{ margin: 0, fontSize: "0.84rem" }}>
                      {m.subtitle}
                    </p>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      {m.completed_count}/{m.activity_count} done • ~{m.estimated_minutes} min
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onOpenModule(m.id)}
                    >
                      {m.kind === "zybooks" ? <BookOpen size={13} /> : <Code2 size={13} />}
                      <Play size={12} /> Open
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
