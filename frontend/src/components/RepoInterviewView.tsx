import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  BookOpen,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  GitBranch,
  MessageSquareCode,
  RefreshCw,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { api } from "../api";
import type {
  GitHubRepo,
  GitHubStatus,
  InterviewCampaignDetail,
  InterviewCampaignSummary,
  MockInterviewAnswerResp,
  MockInterviewQuestion,
  MockInterviewRubric,
  MockInterviewStartResp,
  MockInterviewSummary,
  ModuleSummary,
  OllamaModel,
} from "../types";
import {
  formatCountdown,
  formatInterviewDate,
  InterviewCampaignView,
  NewCampaignModal,
} from "./InterviewCampaignView";
import { RepoBrowser } from "./RepoBrowser";
import { RepoPracticeLibrary } from "./RepoPracticeLibrary";
import "../labs.css";
import "../dashboard-library.css";
import "../repo-prep.css";
import "../interview-campaigns.css";

export { extractRepoFromModule } from "../repoReference";

interface Props {
  onOpenModule: (moduleId: string) => void;
  onUpdated: () => void;
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

function normalizeInterviews(items: MockInterviewSummary[] | undefined): MockInterviewSummary[] {
  return (items || []).map((item) => ({
    ...item,
    created_at: typeof item.created_at === "string" ? item.created_at : "",
    updated_at: typeof item.updated_at === "string" ? item.updated_at : "",
  }));
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
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <MessageSquareCode size={19} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden="true" />
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
                <Award size={12} aria-hidden="true" /> Readiness {displayReadiness}%
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
            Grounded in real repo architecture, files &amp; trade-offs • 4-axis Staff rubric (Clarity, Technical Accuracy, Code References, Trade-Offs)
          </div>
        </div>
        <div className="mock-header-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onRestart(session.repo_full_name)}
            disabled={submitting}
          >
            <RotateCcw size={13} aria-hidden="true" /> Restart
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close mock interview">
            <X size={14} aria-hidden="true" /> Close
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
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

          <div className="mock-submit-row">
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              Tip: Cite specific filenames, routes/functions, edge cases &amp; trade-offs to score 20+/25 per axis.
            </span>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!answer.trim() || submitting}
              data-testid="mock-interview-submit"
            >
              <Send size={14} aria-hidden="true" /> {submitting ? "Grading Answer..." : "Submit Answer"}
            </button>
          </div>
        </form>
      )}

      {/* Final Interview Readiness Summary */}
      {completed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="mock-interview-summary">
          <div className="mock-summary-banner">
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div className="mock-score-circle">
                <span style={{ fontSize: "1.35rem", lineHeight: 1 }}>{displayReadiness}%</span>
                <span style={{ fontSize: "0.62rem", textTransform: "uppercase", color: "#86efac" }}>
                  Ready
                </span>
              </div>
              <div style={{ minWidth: 0, flex: "1 1 12rem" }}>
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
              <RotateCcw size={14} aria-hidden="true" /> Practice Another Round
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
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [packs, setPacks] = useState<ModuleSummary[]>([]);
  const [interviews, setInterviews] = useState<MockInterviewSummary[]>([]);
  const [models, setModels] = useState<OllamaModel[]>([]);

  // Interview Campaigns state
  const [campaigns, setCampaigns] = useState<InterviewCampaignSummary[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<InterviewCampaignDetail | null>(null);
  const [loadingCampaignId, setLoadingCampaignId] = useState<string | null>(null);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [usernameInput, setUsernameInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [customRepo, setCustomRepo] = useState("");
  const [useOllama, setUseOllama] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");

  const [busyRepo, setBusyRepo] = useState<string | null>(null);
  const [startingMockRepo, setStartingMockRepo] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<MockInterviewStartResp | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repoInputRef = useRef<HTMLInputElement>(null);

  const loadInterviews = async () => {
    try {
      const iv = await api.interviews();
      setInterviews(normalizeInterviews(iv.interviews));
    } catch {
      // keep existing state if interviews endpoint unavailable
    }
  };

  const loadCampaigns = async () => {
    try {
      const res = await api.campaigns();
      setCampaigns(res.campaigns || []);
    } catch {
      // keep existing state if campaigns endpoint unavailable
    }
  };

  useEffect(() => {
    let active = true;
    const loadAll = async () => {
      setLoadingRepos(true);
      try {
        const [st, pk, ol, iv, cp] = await Promise.all([
          api.githubStatus(),
          api.githubStudyPacks(),
          api.ollamaModels(),
          api.interviews().catch(() => ({ interviews: [] as MockInterviewSummary[] })),
          api.campaigns().catch(() => ({ campaigns: [] as InterviewCampaignSummary[] })),
        ]);
        if (!active) return;

        setStatus(st);
        setPacks(pk.packs || []);
        setModels(ol.models || []);
        setInterviews(normalizeInterviews(iv.interviews));
        setCampaigns(cp.campaigns || []);
        if (ol.models && ol.models.length > 0) {
          setSelectedModel((prev) =>
            prev && ol.models.some((m) => m.name === prev) ? prev : ol.models[0].name
          );
        }
        if (st.username) {
          setUsernameInput(st.username);
        }
        if (st.username || st.connected) {
          try {
            const r = await api.githubRepos();
            if (active) setRepos(r.repos || []);
          } catch (repoErr: any) {
            if (active) setError(repoErr?.message || "Failed to load GitHub repositories");
          }
        } else {
          setRepos([]);
        }
      } catch (e: any) {
        if (active) setError(e?.message || "Failed to load GitHub data");
      } finally {
        if (active) setLoadingRepos(false);
      }
    };
    void loadAll();
    return () => {
      active = false;
    };
  }, []);

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

  const openCampaign = async (campaignId: string) => {
    setLoadingCampaignId(campaignId);
    setError(null);
    try {
      const detail = await api.campaign(campaignId);
      setActiveCampaign(detail);
      window.scrollTo(0, 0);
    } catch (err: any) {
      setError(err?.message || "Failed to load interview study plan");
    } finally {
      setLoadingCampaignId(null);
    }
  };

  const handleCampaignCreated = (created: InterviewCampaignDetail) => {
    setShowNewCampaign(false);
    setCampaigns((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
    setActiveCampaign(created);
    onUpdated();
    window.scrollTo(0, 0);
  };

  const handleCampaignUpdated = (updated: InterviewCampaignDetail) => {
    setActiveCampaign(updated);
    setCampaigns((prev) =>
      prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
    );
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    if (confirmDeleteId !== campaignId) {
      setConfirmDeleteId(campaignId);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await api.deleteCampaign(campaignId);
      setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
      if (activeCampaign?.id === campaignId) {
        setActiveCampaign(null);
      }
      onUpdated();
    } catch (err: any) {
      setError(err?.message || "Failed to delete interview campaign");
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setError(null);
    setMessage(null);
    try {
      const st = await api.githubConnect(usernameInput, tokenInput || undefined);
      setStatus(st);
      setTokenInput("");
      setLoadingRepos(true);
      const r = await api.githubRepos(st.connected ? undefined : usernameInput);
      setRepos(r.repos || []);
      setMessage(
        st.connected
          ? `Connected to GitHub as ${st.username} (${st.auth_source})`
          : "Saved GitHub handle."
      );
    } catch (err: any) {
      setError(err?.message || "GitHub connection failed");
    } finally {
      setConnecting(false);
      setLoadingRepos(false);
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
    const clean = repoRef.trim();
    if (!clean) return;
    setBusyRepo(clean);
    setError(null);
    setMessage(
      useOllama
        ? `Inspecting ${clean} and generating Staff-Engineer study pack via Ollama...`
        : `Inspecting ${clean} architecture, entrypoints & building interview study pack...`
    );
    try {
      const res = await api.githubAnalyze(
        clean,
        useOllama,
        useOllama ? selectedModel || undefined : undefined
      );
      onUpdated();
      onOpenModule(res.module.id);
    } catch (err: any) {
      setError(err?.message || `Failed to analyze ${clean}`);
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
      const session = await api.interviewStart(
        clean,
        useOllama ? selectedModel || undefined : undefined
      );
      setActiveSession(session);
      await loadInterviews();
    } catch (err: any) {
      setError(err?.message || `Could not start mock interview for ${clean}`);
    } finally {
      setStartingMockRepo(null);
    }
  };

  const handleChooseRepo = (fullName: string) => {
    setCustomRepo(fullName);
    setError(null);
    repoInputRef.current?.focus();
  };

  const isBusy = Boolean(busyRepo) || Boolean(startingMockRepo);
  const trimmedRepo = customRepo.trim();

  // Active Interview Campaign Workspace inside /repos
  if (activeCampaign) {
    return (
      <>
        <InterviewCampaignView
          campaign={activeCampaign}
          selectedModel={useOllama ? selectedModel || undefined : undefined}
          onBack={() => {
            setActiveCampaign(null);
            void loadCampaigns();
            void loadInterviews();
          }}
          onUpdated={() => {
            onUpdated();
            void loadInterviews();
          }}
          onCampaignChange={handleCampaignUpdated}
          onSelectRepo={(repoFullName) => {
            setActiveCampaign(null);
            setCustomRepo(repoFullName);
            window.setTimeout(() => repoInputRef.current?.focus(), 0);
          }}
          renderMockPanel={(panelProps) => <MockInterviewPanel {...panelProps} />}
        />
        <NewCampaignModal
          open={showNewCampaign}
          repos={repos}
          models={models}
          defaultModel={selectedModel || undefined}
          onClose={() => setShowNewCampaign(false)}
          onCreated={handleCampaignCreated}
        />
      </>
    );
  }

  return (
    <div className="repo-prep">
      {/* Live Conversational Staff-Engineer Mock Interviewer */}
      {activeSession && (
        <MockInterviewPanel
          session={activeSession}
          selectedModel={useOllama ? selectedModel || undefined : undefined}
          onClose={() => setActiveSession(null)}
          onSessionUpdated={() => {
            void loadInterviews();
            onUpdated();
          }}
          onRestart={(repo) => void startMockInterview(repo)}
        />
      )}

      {/* Reusable Time-Boxed Interview Campaigns */}
      <section
        className="card campaigns-section"
        data-testid="interview-campaigns-section"
        aria-labelledby="campaigns-heading"
      >
        <div className="campaigns-header">
          <div className="campaigns-title-group">
            <CalendarClock size={18} aria-hidden="true" />
            <h3 id="campaigns-heading">Interview campaigns</h3>
            {campaigns.length > 0 && (
              <span className="badge badge-kind">{campaigns.length} active</span>
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowNewCampaign(true)}
            data-testid="new-campaign-btn"
          >
            + New Interview Campaign
          </button>
        </div>

        {campaigns.length === 0 ? (
          <p className="campaigns-empty-text">
            Turn an upcoming interview date, resume, and prep brief into a calm day-by-day active-recall schedule with spoken countdown timers and a 1-page pre-call skim sheet.
          </p>
        ) : (
          <div className="campaign-list">
            {campaigns.map((camp) => {
              const pct = Math.round(camp.readiness_pct || 0);
              const fillColor =
                pct >= 80
                  ? "var(--green-solid)"
                  : pct >= 45
                  ? "var(--accent)"
                  : "var(--amber)";
              return (
                <article
                  key={camp.id}
                  className="campaign-card"
                  data-testid={`campaign-card-${camp.id}`}
                >
                  <div className="campaign-card-top">
                    <div className="campaign-card-heading">
                      <strong>{camp.company}</strong>
                      <span className="campaign-role">{camp.role}</span>
                    </div>
                    <div className="campaign-badges">
                      <span className="campaign-countdown">
                        <Clock size={12} aria-hidden="true" />
                        {formatCountdown(camp.hours_until)}
                      </span>
                      <span className="badge badge-unstarted">{camp.duration_minutes} min</span>
                    </div>
                  </div>

                  <div className="campaign-meta-line">
                    <span className="campaign-meta-item">
                      <Calendar size={13} aria-hidden="true" />
                      {formatInterviewDate(camp.interview_at)}
                    </span>
                    {camp.interviewer_name && <span>· {camp.interviewer_name}</span>}
                    <span>· ~{camp.remaining_minutes} min remaining</span>
                  </div>

                  <div className="campaign-readiness-row">
                    <div className="campaign-readiness-label">
                      <span>Readiness</span>
                      <strong>
                        {pct}% ({camp.mastered_items}/{camp.total_items} drills ready)
                      </strong>
                    </div>
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-label={`${camp.company} readiness`}
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="progress-fill"
                        style={{ width: `${pct}%`, background: fillColor }}
                      />
                    </div>
                  </div>

                  {camp.next_item_title && (
                    <p className="campaign-next-item">
                      Next up: <span>{camp.next_item_title}</span>
                    </p>
                  )}

                  <div className="campaign-card-actions">
                    <div className="campaign-card-actions-left">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={loadingCampaignId === camp.id}
                        onClick={() => void openCampaign(camp.id)}
                        data-testid={`open-campaign-${camp.id}`}
                      >
                        {loadingCampaignId === camp.id ? "Opening…" : "Open Study Plan"}
                      </button>
                      {camp.meeting_url && (
                        <a
                          href={camp.meeting_url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-sm campaign-meeting-link"
                        >
                          <Video size={13} aria-hidden="true" /> Open Meeting{" "}
                          <ExternalLink size={11} aria-hidden="true" />
                        </a>
                      )}
                    </div>
                    <div className="campaign-card-actions-right">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void handleDeleteCampaign(camp.id)}
                        aria-label={`Delete ${camp.company} campaign`}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        {confirmDeleteId === camp.id ? "Confirm delete" : "Delete"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Focused Primary Repo Interview Prep Card */}
      <section className="card repo-prep-hero" aria-labelledby="repo-prep-heading">
        <div className="repo-prep-eyebrow">
          <span className="repo-prep-eyebrow-label">
            <Sparkles size={15} aria-hidden="true" />
            <span>Codebase defense &amp; mock interviews</span>
          </span>
          {status?.connected && status.username && (
            <span className="badge badge-done">@{status.username}</span>
          )}
        </div>

        <h2 id="repo-prep-heading">Repo interview prep</h2>
        <p className="repo-prep-lead">
          Paste any <code>owner/repo</code> or GitHub URL—or pick one from your connected repositories below—to build a study pack or run a 4-question Staff-Engineer mock interview.
        </p>

        <form
          className="repo-prep-form"
          onSubmit={(e) => {
            e.preventDefault();
            void analyzeRepo(customRepo);
          }}
        >
          <div className="repo-field">
            <label htmlFor="repo-target-input">Repository</label>
            <input
              ref={repoInputRef}
              id="repo-target-input"
              type="text"
              className="input-field"
              placeholder="owner/repo or https://github.com/owner/repo"
              value={customRepo}
              onChange={(e) => setCustomRepo(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="repo-prep-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!trimmedRepo || isBusy}
            >
              <BookOpen size={15} aria-hidden="true" />
              {busyRepo ? "Building study pack…" : "Build study pack"}
            </button>
            <button
              type="button"
              className="btn btn-konsole"
              disabled={!trimmedRepo || isBusy}
              onClick={() => void startMockInterview(customRepo)}
              data-testid="custom-start-mock-interview"
            >
              <MessageSquareCode size={15} aria-hidden="true" />
              {startingMockRepo === trimmedRepo && trimmedRepo
                ? "Starting interview…"
                : "Start mock interview"}
            </button>
          </div>
        </form>
      </section>

      {message && (
        <div className="feedback-box ok repo-prep-feedback" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="feedback-box err repo-prep-feedback" role="alert">
          {error}
        </div>
      )}

      {/* Saved Study Packs & Collapsible Interview History */}
      <RepoPracticeLibrary
        packs={packs}
        interviews={interviews}
        readinessByRepo={readinessByRepo}
        onOpenModule={onOpenModule}
        onStart={(repo) => void startMockInterview(repo)}
        busy={isBusy}
      />

      {/* Collapsible Connected GitHub Repositories Browser */}
      <RepoBrowser
        repos={repos}
        readinessByRepo={readinessByRepo}
        onChoose={handleChooseRepo}
        loading={loadingRepos}
      />

      {/* Collapsible GitHub Connection Settings */}
      <details className="card repo-disclosure" data-testid="github-connection">
        <summary className="library-summary">
          <GitBranch size={17} aria-hidden="true" />
          <strong>GitHub connection</strong>
          <span className="library-count">
            {status?.connected
              ? `@${status.username}`
              : status?.username
              ? `@${status.username}`
              : "Not connected"}
          </span>
          <ChevronDown size={16} className="library-chevron" aria-hidden="true" />
        </summary>
        <div className="repo-disclosure-body">
          <div className="repo-connection-status">
            <div className="repo-connection-meta">
              {status?.connected ? (
                <>
                  <div className="repo-connection-identity">
                    <CheckCircle2 size={15} className="repo-connected-icon" aria-hidden="true" />
                    <strong>{status.name || status.username}</strong>
                    <span className="badge badge-done">@{status.username}</span>
                    <span className="badge badge-kind">{status.auth_source}</span>
                  </div>
                  <p className="muted repo-connection-note">
                    {status.public_repos ?? 0} public · {status.private_repos ?? 0} private repos accessible
                  </p>
                </>
              ) : (
                <p className="muted repo-connection-note">
                  DevQuest automatically uses your local <code>gh</code> CLI login, or connect with a username and optional Personal Access Token below.
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleSyncXp}
              disabled={syncing || (!status?.connected && !status?.username)}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {syncing ? "Syncing…" : "Sync XP"}
            </button>
          </div>

          <form className="repo-connect-form" onSubmit={handleConnect}>
            <div className="repo-field">
              <label htmlFor="github-username-input">GitHub username</label>
              <input
                id="github-username-input"
                type="text"
                className="input-field"
                placeholder="e.g. octocat"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="repo-field">
              <label htmlFor="github-token-input">Personal access token (optional)</label>
              <input
                id="github-token-input"
                type="password"
                className="input-field"
                placeholder="Leave blank to use gh CLI"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="repo-connect-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={connecting}>
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </div>
          </form>
        </div>
      </details>

      {/* Collapsible Local Ollama Model Settings */}
      <details className="card repo-disclosure" data-testid="model-settings">
        <summary className="library-summary">
          <SlidersHorizontal size={17} aria-hidden="true" />
          <strong>Model settings</strong>
          <span className="library-count">
            {useOllama && selectedModel
              ? selectedModel
              : models.length > 0
              ? "Built-in"
              : "Offline"}
          </span>
          <ChevronDown size={16} className="library-chevron" aria-hidden="true" />
        </summary>
        <div className="repo-disclosure-body">
          <label className="repo-checkbox-row" htmlFor="repo-use-ollama">
            <input
              id="repo-use-ollama"
              type="checkbox"
              checked={useOllama}
              onChange={(e) => setUseOllama(e.target.checked)}
              disabled={models.length === 0}
            />
            <span>Use Ollama to build study packs</span>
          </label>

          <div className="repo-field">
            <label htmlFor="repo-local-model">Local model</label>
            <select
              id="repo-local-model"
              className="select-field"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={models.length === 0}
            >
              {models.length === 0 ? (
                <option value="">No local Ollama models detected</option>
              ) : (
                models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <p className="muted repo-settings-hint">
            {models.length > 0
              ? "When enabled, DevQuest uses your selected local Ollama model to craft repo-specific study packs and mock interview evaluations."
              : "Start Ollama locally to unlock AI-generated study pack questions. Built-in static repository analysis works offline."}
          </p>
        </div>
      </details>

      {/* Reusable "+ New Interview Campaign" Wizard Modal */}
      <NewCampaignModal
        open={showNewCampaign}
        repos={repos}
        models={models}
        defaultModel={selectedModel || undefined}
        onClose={() => setShowNewCampaign(false)}
        onCreated={handleCampaignCreated}
      />
    </div>
  );
}
