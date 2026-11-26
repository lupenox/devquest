import React, { useEffect, useMemo, useState } from "react";
import {
  Award,
  BookOpen,
  CheckCircle2,
  FolderGit2,
  Lock,
  MessageSquareCode,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "../api";
import type {
  GitHubRepo,
  GitHubStatus,
  MockInterviewAnswerResp,
  MockInterviewQuestion,
  MockInterviewRubric,
  MockInterviewStartResp,
  MockInterviewSummary,
  ModuleSummary,
  OllamaModel,
} from "../types";
import "../labs.css";

interface Props {
  onOpenModule: (moduleId: string) => void;
  onUpdated: () => void;
}

export function extractRepoFromModule(
  mod: Pick<ModuleSummary, "id" | "title" | "content">
): string {
  const prefix = "Interview Prep:";
  if (mod.title.startsWith(prefix)) {
    return mod.title.slice(prefix.length).trim();
  }
  const ghResource = mod.content?.external_resources?.find((r) =>
    r.url.includes("github.com/")
  );
  if (ghResource) {
    const m = ghResource.url.match(/github\.com\/([^/\s]+\/[^/\s#?]+)/i);
    if (m?.[1]) return m[1].replace(/\.git$/i, "");
  }
  return mod.id.replace(/^repo-interview-/, "");
}

function readinessClass(score: number): string {
  if (score >= 80) return "readiness-high";
  if (score >= 55) return "readiness-mid";
  return "readiness-low";
}

function rubricBarColor(score: number): string {
  if (score >= 20) return "#22c55e";
  if (score >= 14) return "var(--accent, #7aa2f7)";
  return "var(--amber, #e0af68)";
}

interface TurnHistoryItem {
  question: MockInterviewQuestion;
  answer: string;
  rubric: MockInterviewRubric;
}

export interface MockInterviewPanelProps {
  session: MockInterviewStartResp;
  selectedModel?: string;
  onClose: () => void;
  onSessionUpdated: () => void;
  onRestart: (repo: string) => void;
}

export function MockInterviewPanel({
  session,
  selectedModel,
  onClose,
  onSessionUpdated,
  onRestart,
}: MockInterviewPanelProps) {
  const [currentIndex, setCurrentIndex] = useState(session.current_index ?? 0);
  const [totalQuestions, setTotalQuestions] = useState(
    session.total_questions || session.questions?.length || 4
  );
  const [currentQuestion, setCurrentQuestion] = useState<MockInterviewQuestion | null>(
    session.question || null
  );
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestResp, setLatestResp] = useState<MockInterviewAnswerResp | null>(null);
  const [history, setHistory] = useState<TurnHistoryItem[]>([]);
  const [completed, setCompleted] = useState(session.status === "completed");
  const [readiness, setReadiness] = useState<number>(session.readiness_score ?? 0);

  useEffect(() => {
    setCurrentIndex(session.current_index ?? 0);
    setTotalQuestions(session.total_questions || session.questions?.length || 4);
    setCurrentQuestion(session.question || null);
    setAnswer("");
    setError(null);
    setLatestResp(null);
    setHistory([]);
    setCompleted(session.status === "completed");
    setReadiness(session.readiness_score ?? 0);
  }, [session.session_id]);

  const submitAnswer = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = answer.trim();
    if (!trimmed || submitting || completed) return;

    const activeQ = currentQuestion;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await api.interviewAnswer(
        session.session_id,
        trimmed,
        selectedModel || undefined
      );
      setLatestResp(resp);
      setReadiness(Math.round(resp.readiness_score ?? 0));
      setTotalQuestions(resp.total_questions || totalQuestions);
      if (activeQ && resp.rubric) {
        setHistory((prev) => [...prev, { question: activeQ, answer: trimmed, rubric: resp.rubric }]);
      }
      setAnswer("");
      if (resp.completed || resp.status === "completed" || !resp.next_question) {
        setCompleted(true);
        setCurrentQuestion(null);
      } else {
        setCurrentIndex(resp.current_index ?? currentIndex + 1);
        setCurrentQuestion(resp.next_question);
      }
      onSessionUpdated();
    } catch (err: any) {
      setError(err?.message || "Failed to grade interview response");
    } finally {
      setSubmitting(false);
    }
  };

  const rubricAxes = useMemo(() => {
    const r = latestResp?.rubric;
    if (!r) return [];
    return [
      { key: "clarity", label: "Clarity", score: r.clarity },
      { key: "accuracy", label: "Technical Accuracy", score: r.accuracy },
      { key: "code_refs", label: "Code References", score: r.code_refs },
      { key: "tradeoffs", label: "Trade-Offs", score: r.tradeoffs },
    ];
  }, [latestResp]);

  const avgRubric = useMemo(() => {
    if (history.length === 0) return null;
    const sum = history.reduce(
      (acc, h) => ({
        clarity: acc.clarity + h.rubric.clarity,
        accuracy: acc.accuracy + h.rubric.accuracy,
        code_refs: acc.code_refs + h.rubric.code_refs,
        tradeoffs: acc.tradeoffs + h.rubric.tradeoffs,
      }),
      { clarity: 0, accuracy: 0, code_refs: 0, tradeoffs: 0 }
    );
    const n = history.length;
    return [
      { key: "clarity", label: "Clarity", score: Math.round(sum.clarity / n) },
      { key: "accuracy", label: "Technical Accuracy", score: Math.round(sum.accuracy / n) },
      { key: "code_refs", label: "Code References", score: Math.round(sum.code_refs / n) },
      { key: "tradeoffs", label: "Trade-Offs", score: Math.round(sum.tradeoffs / n) },
    ];
  }, [history]);

  const displayReadiness = Math.round(readiness);

  return (
    <div className="mock-panel" data-testid="mock-interview-panel">
      <div className="mock-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <MessageSquareCode size={19} color="#bb9af7" />
            <strong style={{ fontSize: "1.02rem" }}>
              Staff-Engineer Mock Interview — {session.repo_full_name}
            </strong>
            <span className="badge badge-xp">
              {completed ? "Completed" : `Q${Math.min(currentIndex + 1, totalQuestions)}/${totalQuestions}`}
            </span>
            {(history.length > 0 || completed) && (
              <span
                className={`readiness-badge ${readinessClass(displayReadiness)}`}
                data-testid="mock-interview-readiness"
              >
                <Award size={12} /> Readiness {displayReadiness}%
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
            Grounded in real repo architecture, files &amp; trade-offs • 4-axis Staff rubric (Clarity, Technical Accuracy, Code References, Trade-Offs)
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onRestart(session.repo_full_name)}
            disabled={submitting}
          >
            <RotateCcw size={13} /> Restart
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close mock interview">
            <X size={14} /> Close
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="progress-track" style={{ margin: 0 }}>
        <div
          className="progress-fill"
          style={{
            width: `${completed ? 100 : Math.round((history.length / Math.max(1, totalQuestions)) * 100)}%`,
            background: "linear-gradient(90deg, var(--accent-2, #bb9af7), var(--green, #73daca))",
          }}
        />
      </div>

      {error && <div className="feedback-box err" style={{ marginTop: 0 }}>{error}</div>}

      {/* Latest Answer 4-Axis Rubric & Coaching Feedback */}
      {latestResp?.rubric && (
        <div className="mock-feedback-card" data-testid="mock-interview-rubric">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <strong style={{ fontSize: "0.9rem" }}>
              Q{(latestResp.answered_index ?? history.length - 1) + 1} Rubric Evaluation —{" "}
              <span style={{ color: "var(--green, #73daca)" }}>{latestResp.rubric.total}/100</span>
            </strong>
            {latestResp.rubric.graded_by && (
              <span className="badge badge-kind">Graded by {latestResp.rubric.graded_by}</span>
            )}
          </div>

          <div className="mock-rubric-grid">
            {rubricAxes.map((axis) => (
              <div key={axis.key} className="mock-rubric-card">
                <div className="mock-rubric-top">
                  <span>{axis.label}</span>
                  <strong>{axis.score}/25</strong>
                </div>
                <div className="mock-rubric-track">
                  <div
                    className="mock-rubric-fill"
                    style={{
                      width: `${Math.min(100, Math.round((axis.score / 25) * 100))}%`,
                      background: rubricBarColor(axis.score),
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: "0.87rem", lineHeight: 1.55 }}>
            <strong>Staff Coaching Feedback:</strong> {latestResp.rubric.feedback}
          </div>

          {latestResp.rubric.ideal_points && latestResp.rubric.ideal_points.length > 0 && (
            <div>
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--accent)" }}>
                Ideal Talking Points to Mention:
              </div>
              <ul className="mock-ideal-list">
                {latestResp.rubric.ideal_points.map((pt, i) => (
                  <li key={i}>{pt}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Active Question Prompt & Answer Form */}
      {!completed && currentQuestion && (
        <form onSubmit={submitAnswer} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="mock-question-card" data-testid="mock-interview-question">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="badge badge-kind">
                Question {Math.min(currentIndex + 1, totalQuestions)} of {totalQuestions}
              </span>
              {currentQuestion.category && (
                <span className="badge badge-unstarted">{currentQuestion.category}</span>
              )}
            </div>
            <div style={{ fontWeight: 700, fontSize: "0.98rem", lineHeight: 1.5 }}>
              {currentQuestion.question}
            </div>
            {(currentQuestion.context_hint || currentQuestion.focus) && (
              <div className="mock-hint">
                <strong>Context hint:</strong> {currentQuestion.context_hint || currentQuestion.focus}
              </div>
            )}
          </div>

          <div>
            <textarea
              className="mock-answer-textarea"
              aria-label="Mock interview answer"
              data-testid="mock-interview-answer"
              placeholder="Walk through your architecture, name concrete files/functions, and discuss trade-offs... (Ctrl+Enter to submit)"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submitAnswer();
                }
              }}
              disabled={submitting}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              Tip: Cite specific filenames, routes/functions, edge cases &amp; trade-offs to score 20+/25 per axis.
            </span>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!answer.trim() || submitting}
              data-testid="mock-interview-submit"
            >
              <Send size={14} /> {submitting ? "Grading Answer..." : "Submit Answer"}
            </button>
          </div>
        </form>
      )}

      {/* Final Interview Readiness Summary */}
      {completed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="mock-interview-summary">
          <div className="mock-summary-banner">
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div className="mock-score-circle">
                <span style={{ fontSize: "1.35rem", lineHeight: 1 }}>{displayReadiness}%</span>
                <span style={{ fontSize: "0.62rem", textTransform: "uppercase", color: "#86efac" }}>
                  Ready
                </span>
              </div>
              <div>
                <h4 style={{ margin: "0 0 4px", fontSize: "1.05rem" }}>
                  Interview Readiness Summary — {session.repo_full_name}
                </h4>
                <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                  {displayReadiness >= 80
                    ? "Strong Staff-ready defense! You cited concrete architecture, code paths, and engineering trade-offs."
                    : displayReadiness >= 60
                    ? "Solid foundation—tighten specific file/function citations and failure-mode trade-offs to push past 80%."
                    : "Good warmup! Review the ideal talking points above and run another round to build fluency."}
                </p>
                {latestResp?.xp_awarded ? (
                  <div style={{ marginTop: 6 }}>
                    <span className="badge badge-xp">+{latestResp.xp_awarded} Interview XP Earned</span>
                  </div>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onRestart(session.repo_full_name)}
            >
              <RotateCcw size={14} /> Practice Another Round
            </button>
          </div>

          {avgRubric && (
            <div className="mock-rubric-grid">
              {avgRubric.map((axis) => (
                <div key={axis.key} className="mock-rubric-card">
                  <div className="mock-rubric-top">
                    <span>Avg {axis.label}</span>
                    <strong>{axis.score}/25</strong>
                  </div>
                  <div className="mock-rubric-track">
                    <div
                      className="mock-rubric-fill"
                      style={{
                        width: `${Math.min(100, Math.round((axis.score / 25) * 100))}%`,
                        background: rubricBarColor(axis.score),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RepoInterviewView({ onOpenModule, onUpdated }: Props) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [packs, setPacks] = useState<ModuleSummary[]>([]);
  const [interviews, setInterviews] = useState<MockInterviewSummary[]>([]);
  const [models, setModels] = useState<OllamaModel[]>([]);

  const [usernameInput, setUsernameInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [customRepo, setCustomRepo] = useState("");
  const [filter, setFilter] = useState("");
  const [useOllama, setUseOllama] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");

  const [busyRepo, setBusyRepo] = useState<string | null>(null);
  const [startingMockRepo, setStartingMockRepo] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<MockInterviewStartResp | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInterviews = async () => {
    try {
      const iv = await api.interviews();
      setInterviews(iv.interviews || []);
    } catch {
      // keep existing state if interviews endpoint unavailable
    }
  };

  const loadAll = async () => {
    try {
      const [st, pk, ol, iv] = await Promise.all([
        api.githubStatus(),
        api.githubStudyPacks(),
        api.ollamaModels(),
        api.interviews().catch(() => ({ interviews: [] as MockInterviewSummary[] })),
      ]);
      setStatus(st);
      setPacks(pk.packs);
      setModels(ol.models);
      setInterviews(iv.interviews || []);
      if (ol.models.length > 0 && !selectedModel) {
        setSelectedModel(ol.models[0].name);
      }
      if (st.username) {
        setUsernameInput(st.username);
        const r = await api.githubRepos();
        setRepos(r.repos);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load GitHub data");
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Index best persisted readiness score by normalized repo name & module_id
  const readinessByRepo = useMemo(() => {
    const map = new Map<string, MockInterviewSummary>();
    for (const iv of interviews) {
      const key = iv.repo_full_name.toLowerCase();
      const prev = map.get(key);
      if (!prev || iv.readiness_score >= prev.readiness_score) {
        map.set(key, iv);
      }
      if (iv.module_id) {
        const prevMod = map.get(iv.module_id);
        if (!prevMod || iv.readiness_score >= prevMod.readiness_score) {
          map.set(iv.module_id, iv);
        }
      }
    }
    return map;
  }, [interviews]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const st = await api.githubConnect(usernameInput, tokenInput || undefined);
      setStatus(st);
      setTokenInput("");
      const r = await api.githubRepos(st.connected ? undefined : usernameInput);
      setRepos(r.repos);
      setMessage(st.connected ? `Connected to GitHub as ${st.username} (${st.auth_source})` : "Saved GitHub handle.");
    } catch (err: any) {
      setError(err?.message || "GitHub connection failed");
    }
  };

  const handleSyncXp = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await api.runSync("github");
      const first = res.results[0];
      setMessage(
        first?.ok
          ? `Synced ${first.repo_count} GitHub repos (+${first.xp_awarded || 0} Git XP)`
          : first?.error || "Sync complete"
      );
      onUpdated();
    } catch (err: any) {
      setError(err?.message || "GitHub sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const analyzeRepo = async (repoRef: string) => {
    if (!repoRef.trim()) return;
    setBusyRepo(repoRef);
    setError(null);
    setMessage(
      useOllama
        ? `Inspecting ${repoRef} and generating Staff-Engineer interview grill questions via Ollama...`
        : `Inspecting ${repoRef} architecture, entrypoints, symbols & building interview study pack...`
    );
    try {
      const res = await api.githubAnalyze(repoRef.trim(), useOllama, selectedModel || undefined);
      onUpdated();
      await loadAll();
      onOpenModule(res.module.id);
    } catch (err: any) {
      setError(err?.message || `Failed to analyze ${repoRef}`);
    } finally {
      setBusyRepo(null);
    }
  };

  const startMockInterview = async (repoRef: string) => {
    const clean = repoRef.trim();
    if (!clean) return;
    setStartingMockRepo(clean);
    setError(null);
    setMessage(null);
    try {
      const session = await api.interviewStart(clean, selectedModel || undefined);
      setActiveSession(session);
      await loadInterviews();
    } catch (err: any) {
      setError(err?.message || `Could not start mock interview for ${clean}`);
    } finally {
      setStartingMockRepo(null);
    }
  };

  const filteredRepos = repos.filter(
    (r) =>
      r.full_name.toLowerCase().includes(filter.toLowerCase()) ||
      r.description.toLowerCase().includes(filter.toLowerCase()) ||
      r.language.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Live Conversational Staff-Engineer Mock Interviewer */}
      {activeSession && (
        <MockInterviewPanel
          session={activeSession}
          selectedModel={selectedModel || undefined}
          onClose={() => setActiveSession(null)}
          onSessionUpdated={() => {
            void loadInterviews();
            onUpdated();
          }}
          onRestart={(repo) => void startMockInterview(repo)}
        />
      )}

      {/* GitHub Connector + Manual Repo Analyzer & Mock Interview Launcher */}
      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">
            <FolderGit2 size={18} color="#7aa2f7" /> GitHub Connector
          </h3>
          {status?.connected ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <CheckCircle2 size={16} color="#22c55e" />
                  <strong>{status.name || status.username}</strong>
                  <span className="badge badge-done">@{status.username}</span>
                  <span className="badge badge-kind">{status.auth_source}</span>
                </div>
                <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                  {status.public_repos ?? 0} public • {status.private_repos ?? 0} private repos accessible
                </div>
              </div>
              <button type="button" className="btn btn-sm" onClick={handleSyncXp} disabled={syncing}>
                <RefreshCw size={13} /> {syncing ? "Syncing..." : "Sync XP"}
              </button>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
              DevQuest automatically uses your local <code>gh</code> CLI login, or enter a GitHub username / optional Personal Access Token below.
            </p>
          )}

          <form onSubmit={handleConnect} style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                className="input-field"
                style={{ flex: "1 1 150px" }}
                placeholder="GitHub username (e.g. lupenox)"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
              />
              <input
                className="input-field"
                style={{ flex: "1 1 170px" }}
                type="password"
                placeholder="Optional PAT (leave blank to use gh CLI)"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                Connect
              </button>
            </div>
          </form>
        </div>

        <div className="card">
          <h3 className="card-title">
            <Sparkles size={18} color="#bb9af7" /> Study Any GitHub Repo for Interviews
          </h3>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
            Paste any <code>owner/repo</code> or GitHub URL to build an interactive study pack or launch a live 4-question Staff-Engineer Mock Interview.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <input
              className="input-field"
              style={{ flex: "1 1 200px" }}
              placeholder="owner/repo or https://github.com/owner/repo"
              value={customRepo}
              onChange={(e) => setCustomRepo(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!customRepo.trim() || Boolean(busyRepo) || Boolean(startingMockRepo)}
              onClick={() => analyzeRepo(customRepo)}
            >
              {busyRepo === customRepo ? "Analyzing..." : "Build Study Pack"}
            </button>
            <button
              type="button"
              className="btn btn-konsole"
              disabled={!customRepo.trim() || Boolean(busyRepo) || Boolean(startingMockRepo)}
              onClick={() => startMockInterview(customRepo)}
              data-testid="custom-start-mock-interview"
            >
              <MessageSquareCode size={14} />
              {startingMockRepo === customRepo.trim() ? "Starting..." : "Start Mock Interview"}
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.84rem", cursor: "pointer", flexWrap: "wrap" }}>
            <input
              type="checkbox"
              checked={useOllama}
              onChange={(e) => setUseOllama(e.target.checked)}
              disabled={models.length === 0}
            />
            <span>Use Local Ollama for Staff-Engineer Questions &amp; Grading</span>
            {models.length > 0 && (
              <select
                className="select-field"
                style={{ width: "auto", padding: "3px 8px", fontSize: "0.78rem" }}
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            )}
          </label>
        </div>
      </div>

      {message && <div className="feedback-box ok" style={{ marginTop: 0 }}>{message}</div>}
      {error && <div className="feedback-box err" style={{ marginTop: 0 }}>{error}</div>}

      {/* Persisted Mock Interview Readiness History */}
      {interviews.length > 0 && (
        <div className="card">
          <h3 className="card-title">
            <Award size={17} color="#e0af68" /> Mock Interview Readiness History ({interviews.length})
          </h3>
          <div className="grid-2">
            {interviews.slice(0, 6).map((iv) => {
              const score = Math.round(iv.readiness_score || 0);
              return (
                <div key={iv.id} className="repo-card-item">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <strong>{iv.repo_full_name}</strong>
                    <span className={`readiness-badge ${readinessClass(score)}`}>
                      Readiness {score}%
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span className="muted" style={{ fontSize: "0.78rem" }}>
                      Status: {iv.status}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={Boolean(startingMockRepo)}
                      onClick={() => startMockInterview(iv.repo_full_name)}
                    >
                      <MessageSquareCode size={13} />{" "}
                      {startingMockRepo === iv.repo_full_name ? "Starting..." : "Start Mock Interview"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Generated Repo Interview Study Packs */}
      <div className="card">
        <h3 className="card-title">
          <BookOpen size={17} color="#73daca" /> Your Repo Interview Study Packs ({packs.length})
        </h3>
        {packs.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: "0.86rem" }}>
            No repo study packs yet—click <strong>Study for Interview</strong> or <strong>Start Mock Interview</strong> on any repository below!
          </p>
        ) : (
          <div className="grid-2">
            {packs.map((p) => {
              const repoFullName = extractRepoFromModule(p);
              const iv = readinessByRepo.get(repoFullName.toLowerCase()) || readinessByRepo.get(p.id);
              const score = iv ? Math.round(iv.readiness_score) : null;
              return (
                <div key={p.id} className="repo-card-item">
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong>{p.title}</strong>
                      {score !== null && (
                        <span className={`readiness-badge ${readinessClass(score)}`}>
                          <Award size={11} /> {score}% Ready
                        </span>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                      {p.completed_count}/{p.activity_count} defense drills mastered • {p.tech_slug.toUpperCase()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-konsole"
                      disabled={Boolean(startingMockRepo)}
                      onClick={() => startMockInterview(repoFullName)}
                    >
                      <MessageSquareCode size={13} />
                      {startingMockRepo === repoFullName ? "Starting..." : "Start Mock Interview"}
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenModule(p.id)}>
                      <Play size={13} /> Defend
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Connected GitHub Repositories Picker */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            Your GitHub Repositories ({filteredRepos.length})
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 260 }}>
            <Search size={15} color="#93a3be" />
            <input
              className="input-field"
              placeholder="Filter repos by name or language..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>

        {filteredRepos.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No repositories loaded yet.</p>
        ) : (
          <div className="grid-2">
            {filteredRepos.map((r) => {
              const iv = readinessByRepo.get(r.full_name.toLowerCase());
              const score = iv ? Math.round(iv.readiness_score) : null;
              return (
                <div key={r.full_name} className="repo-card-item">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                      <strong>{r.full_name}</strong>
                      <span className="badge badge-kind">{r.language}</span>
                      {r.private && (
                        <span className="badge badge-warming">
                          <Lock size={10} /> Private
                        </span>
                      )}
                      {score !== null && (
                        <span className={`readiness-badge ${readinessClass(score)}`}>
                          <Award size={11} /> {score}% Ready
                        </span>
                      )}
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: "0.83rem" }}>
                      {r.description || "No description"}
                    </p>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <a
                      href={r.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="muted"
                      style={{ fontSize: "0.78rem" }}
                    >
                      View on GitHub
                    </a>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-konsole btn-sm"
                        disabled={Boolean(busyRepo) || Boolean(startingMockRepo)}
                        onClick={() => startMockInterview(r.full_name)}
                      >
                        <MessageSquareCode size={13} />
                        {startingMockRepo === r.full_name ? "Starting..." : "Start Mock Interview"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={Boolean(busyRepo) || Boolean(startingMockRepo)}
                        onClick={() => analyzeRepo(r.full_name)}
                      >
                        <BookOpen size={13} />
                        {busyRepo === r.full_name ? "Building..." : "Study for Interview"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
