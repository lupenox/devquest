import React, { useEffect, useState } from "react";
import { ArrowLeft, Award, BookOpen, ExternalLink, MessageSquareCode } from "lucide-react";
import { api } from "../api";
import type { GradeOutcome, MockInterviewStartResp, ModuleDetail } from "../types";
import { ActivityCard } from "./ActivityWidgets";
import { extractRepoFromModule, MockInterviewPanel } from "./RepoInterviewView";
import "../labs.css";

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
  const [mockSession, setMockSession] = useState<MockInterviewStartResp | null>(null);
  const [mockStarting, setMockStarting] = useState(false);
  const [mockError, setMockError] = useState<string | null>(null);
  const [repoReadiness, setRepoReadiness] = useState<number | null>(null);

  const load = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await api.module(moduleId);
      setMod(data);
      if (data.kind === "repo_interview") {
        const repoName = extractRepoFromModule(data).toLowerCase();
        api
          .interviews()
          .then((res) => {
            const matches = (res.interviews || []).filter(
              (iv) => iv.repo_full_name.toLowerCase() === repoName || iv.module_id === data.id
            );
            if (matches.length > 0) {
              const best = Math.max(...matches.map((m) => Math.round(m.readiness_score || 0)));
              setRepoReadiness(best);
            } else {
              setRepoReadiness(null);
            }
          })
          .catch(() => {});
      }
    } catch (e: any) {
      if (!silent) {
        setError(e?.message || "Failed to load module");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    setMockSession(null);
    setMockError(null);
    setRepoReadiness(null);
    load(false);
  }, [moduleId]);

  useEffect(() => {
    if (liveOutcome && mod?.activities.some((a) => a.id === liveOutcome.activity_id) && liveOutcome.passed) {
      load(true);
    }
  }, [liveOutcome]);

  const startLiveMock = async (repoFullName: string) => {
    setMockStarting(true);
    setMockError(null);
    try {
      const session = await api.interviewStart(repoFullName);
      setMockSession(session);
    } catch (e: any) {
      setMockError(e?.message || "Could not launch mock interview session");
    } finally {
      setMockStarting(false);
    }
  };

  if (loading) return <div className="card">Loading interactive zyBooks module...</div>;
  if (error || !mod) return <div className="card">{error || "Module not found"}</div>;

  const doneCount = mod.activities.filter((a) => a.completed).length;
  const pct = mod.activities.length ? Math.round((doneCount / mod.activities.length) * 100) : 0;
  const isRepoInterview = mod.kind === "repo_interview";
  const repoFullName = isRepoInterview ? extractRepoFromModule(mod) : "";

  return (
    <div>
      <button type="button" className="btn" onClick={onBack} style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> Back
      </button>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
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

      {/* Repo Interview Quick Launch Banner & Inline Staff-Engineer Mock Interview */}
      {isRepoInterview && (
        <div style={{ marginBottom: 16 }}>
          {!mockSession ? (
            <div className="repo-interview-banner">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <MessageSquareCode size={18} color="#bb9af7" />
                  <strong>Ready to defend {repoFullName} out loud?</strong>
                  {repoReadiness !== null && (
                    <span
                      className={`readiness-badge ${
                        repoReadiness >= 80
                          ? "readiness-high"
                          : repoReadiness >= 55
                          ? "readiness-mid"
                          : "readiness-low"
                      }`}
                    >
                      <Award size={11} /> Best Readiness {repoReadiness}%
                    </span>
                  )}
                </div>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.83rem" }}>
                  Run a 4-question conversational Staff-Engineer mock interview grounded in this repo&apos;s actual code &amp; architecture.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-konsole"
                disabled={mockStarting}
                onClick={() => startLiveMock(repoFullName)}
                data-testid="module-mock-interview-btn"
              >
                <MessageSquareCode size={15} />
                {mockStarting ? "Starting Mock Interview..." : "Practice Live Mock Interview"}
              </button>
            </div>
          ) : (
            <MockInterviewPanel
              session={mockSession}
              onClose={() => setMockSession(null)}
              onSessionUpdated={() => {
                onProgressUpdated();
                void load(true);
              }}
              onRestart={(repo) => void startLiveMock(repo)}
            />
          )}
          {mockError && <div className="feedback-box err">{mockError}</div>}
        </div>
      )}

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

      {/* Interactive Participation, Debugger Sims & Neovim Challenge Activities */}
      <h3 style={{ margin: "20px 0 12px" }}>Interactive Participation &amp; Neovim Labs</h3>
      {mod.activities.map((act) => (
        <ActivityCard
          key={act.id}
          activity={act}
          liveOutcome={liveOutcome?.activity_id === act.id ? liveOutcome : null}
          onGraded={() => {
            onProgressUpdated();
            void load(true);
          }}
        />
      ))}
    </div>
  );
}
