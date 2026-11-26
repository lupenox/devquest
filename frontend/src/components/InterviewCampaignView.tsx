import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FolderGit2,
  MessageSquareCode,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Timer,
  Upload,
  User,
  Video,
  X,
} from "lucide-react";
import { api } from "../api";
import type {
  CampaignConfidence,
  CampaignItem,
  CreateCampaignReq,
  GitHubRepo,
  InterviewCampaignDetail,
  InterviewCampaignSummary,
  MockInterviewStartResp,
  OllamaModel,
} from "../types";
import { RichText } from "./RichText";
import "../interview-campaigns.css";

export function formatInterviewDate(iso: string): string {
  if (!iso) return "Date TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

export function formatCountdown(hoursUntil: number): string {
  if (!Number.isFinite(hoursUntil)) return "Upcoming";
  if (hoursUntil <= -2) return "Past";
  if (hoursUntil <= 0) return "Today";
  if (hoursUntil < 1) return "< 1h left";
  if (hoursUntil < 24) return `${Math.round(hoursUntil)}h left`;
  const days = Math.floor(hoursUntil / 24);
  const remHours = Math.round(hoursUntil % 24);
  return remHours > 0 ? `${days}d ${remHours}h left` : `${days}d left`;
}

function defaultInterviewLocalInput(): string {
  const target = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  target.setHours(13, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
}

function localDateTimeToIso(localValue: string): string {
  if (!localValue) return new Date(Date.now() + 3 * 86400 * 1000).toISOString();
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) return localValue;
  return parsed.toISOString();
}

function categoryStyleClass(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("pitch") || c.includes("intro")) return "cat-pitch";
  if (c.includes("debug") || c.includes("test")) return "cat-debug";
  if (c.includes("gap")) return "cat-gap";
  if (c.includes("ask") || c.includes("question")) return "cat-ask";
  return "";
}

function confidenceLabel(confidence: CampaignConfidence): string {
  switch (confidence) {
    case "nailed":
      return "Nailed It";
    case "ready":
      return "Ready";
    case "shaky":
      return "Shaky";
    default:
      return "Needs Work";
  }
}

function formatSeconds(sec: number): string {
  const clamped = Math.max(0, Math.floor(sec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const CONFIDENCE_OPTIONS: { value: CampaignConfidence; label: string }[] = [
  { value: "unreviewed", label: "Needs Work" },
  { value: "shaky", label: "Shaky" },
  { value: "ready", label: "Ready" },
  { value: "nailed", label: "Nailed It" },
];

interface DrillCardProps {
  campaignId: string;
  item: CampaignItem;
  onRated: (updatedItem: CampaignItem, updatedSummary: InterviewCampaignSummary, xpAwarded: number) => void;
}

function CampaignDrillCard({ campaignId, item, onRated }: DrillCardProps) {
  const targetSec = Math.max(15, item.target_seconds || 60);
  const [secondsLeft, setSecondsLeft] = useState(targetSec);
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [notesDraft, setNotesDraft] = useState(item.notes || "");
  const [saving, setSaving] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [xpFlash, setXpFlash] = useState<number | null>(null);

  useEffect(() => {
    setNotesDraft(item.notes || "");
  }, [item.id, item.notes]);

  useEffect(() => {
    setSecondsLeft(targetSec);
    setRunning(false);
  }, [item.id, targetSec]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const pctRemaining = Math.max(0, Math.min(100, Math.round((secondsLeft / targetSec) * 100)));
  const timerState = secondsLeft === 0 ? "expired" : pctRemaining <= 25 ? "warn" : "normal";
  const keyPoints = Array.isArray(item.key_points) ? item.key_points : [];
  const notesDirty = notesDraft !== (item.notes || "");

  const toggleTimer = () => {
    if (running) {
      setRunning(false);
    } else if (secondsLeft === 0) {
      setSecondsLeft(targetSec);
      setRunning(true);
    } else {
      setRunning(true);
    }
  };

  const resetTimer = () => {
    setRunning(false);
    setSecondsLeft(targetSec);
  };

  const submitRating = async (confidence: CampaignConfidence) => {
    setSaving(true);
    setRateError(null);
    try {
      const resp = await api.practiceCampaignItem(campaignId, item.id, confidence, notesDraft);
      onRated(resp.item, resp.campaign, resp.xp_awarded || 0);
      if (resp.xp_awarded > 0) {
        setXpFlash(resp.xp_awarded);
        window.setTimeout(() => setXpFlash(null), 3500);
      }
    } catch (err: any) {
      setRateError(err?.message || "Could not save practice progress");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      className={`card drill-card conf-${item.confidence}`}
      data-testid={`campaign-item-${item.id}`}
    >
      <div className="drill-header">
        <div className="drill-badges">
          <span className={`drill-cat-badge ${categoryStyleClass(item.category)}`}>
            {item.category}
          </span>
          <span className="drill-target-pill">
            <Timer size={12} aria-hidden="true" /> Target: {targetSec}s
          </span>
          <span className="drill-target-pill">~{item.estimated_minutes} min</span>
          {item.practice_count > 0 && (
            <span className="drill-target-pill">Practiced {item.practice_count}×</span>
          )}
        </div>
        <span
          className={`badge ${
            item.confidence === "nailed"
              ? "badge-done"
              : item.confidence === "ready"
              ? "badge-kind"
              : item.confidence === "shaky"
              ? "badge-warming"
              : "badge-unstarted"
          }`}
        >
          {confidenceLabel(item.confidence)}
        </span>
      </div>

      <div>
        <h4 className="drill-title">
          <RichText text={item.title || ""} />
        </h4>
        <p className="drill-prompt">
          <RichText text={item.prompt || ""} />
        </p>
      </div>

      {/* Spoken-Answer Countdown Timer */}
      <div className="drill-timer-box" data-testid={`drill-timer-${item.id}`}>
        <div className="drill-timer-row">
          <span className={`drill-timer-readout ${timerState}`} data-testid={`drill-timer-value-${item.id}`}>
            <Timer size={15} aria-hidden="true" />
            {formatSeconds(secondsLeft)}
          </span>
          <div className="drill-timer-controls">
            <button
              type="button"
              className="btn btn-sm"
              onClick={toggleTimer}
              data-testid={`drill-timer-toggle-${item.id}`}
            >
              {running ? (
                <>
                  <Pause size={13} aria-hidden="true" /> Pause
                </>
              ) : secondsLeft === 0 ? (
                <>
                  <Play size={13} aria-hidden="true" /> Restart {targetSec}s Timer
                </>
              ) : secondsLeft < targetSec ? (
                <>
                  <Play size={13} aria-hidden="true" /> Resume
                </>
              ) : (
                <>
                  <Play size={13} aria-hidden="true" /> Start {targetSec}s Timer
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={resetTimer}
              disabled={!running && secondsLeft === targetSec}
            >
              <RotateCcw size={13} aria-hidden="true" /> Reset
            </button>
          </div>
        </div>
        <div className="drill-timer-track" aria-hidden="true">
          <div
            className={`drill-timer-fill ${timerState}`}
            style={{ width: `${pctRemaining}%` }}
          />
        </div>
        {secondsLeft === 0 && (
          <p className="drill-timer-status" role="status">
            Time&apos;s up — wrap with one concise takeaway sentence.
          </p>
        )}
      </div>

      {/* Active-Recall Key Talking Points */}
      {keyPoints.length > 0 && (
        <div className="drill-reveal-wrap">
          <button
            type="button"
            className="btn btn-sm drill-reveal-btn"
            aria-expanded={revealed}
            onClick={() => setRevealed((prev) => !prev)}
            data-testid={`drill-reveal-${item.id}`}
          >
            {revealed ? (
              <>
                <EyeOff size={14} aria-hidden="true" /> Hide Key Talking Points
              </>
            ) : (
              <>
                <Eye size={14} aria-hidden="true" /> Reveal Key Talking Points ({keyPoints.length})
              </>
            )}
          </button>
          {revealed && (
            <ul className="drill-key-points" data-testid={`drill-points-${item.id}`}>
              {keyPoints.map((pt, idx) => (
                <li key={idx}>
                  <RichText text={pt || ""} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Personal Notes */}
      <div className="drill-notes-field">
        <div className="drill-notes-header">
          <label htmlFor={`drill-notes-${item.id}`}>Personal notes</label>
          {notesDirty && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={saving}
              onClick={() => void submitRating(item.confidence)}
            >
              Save notes
            </button>
          )}
        </div>
        <textarea
          id={`drill-notes-${item.id}`}
          className="drill-notes-input"
          rows={2}
          placeholder="Jot down your own phrasing, metric anchor, or edge-case reminder..."
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
        />
      </div>

      {rateError && (
        <div className="feedback-box err" style={{ marginTop: 0 }} role="alert">
          {rateError}
        </div>
      )}

      {/* Confidence Self-Rating */}
      <div className="drill-rating-footer">
        <div className="drill-rating-label">
          <span>Rate your spoken delivery</span>
          {xpFlash !== null && (
            <span className="drill-xp-pop" role="status">
              +{xpFlash} XP earned!
            </span>
          )}
        </div>
        <div className="drill-confidence-grid" role="group" aria-label={`Confidence rating for ${item.title}`}>
          {CONFIDENCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`drill-conf-btn lvl-${opt.value}`}
              aria-pressed={item.confidence === opt.value}
              disabled={saving}
              onClick={() => void submitRating(opt.value)}
              data-testid={`rate-${item.id}-${opt.value}`}
            >
              {opt.value === "nailed" && <CheckCircle2 size={13} aria-hidden="true" />}
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

export interface NewCampaignModalProps {
  open: boolean;
  repos: GitHubRepo[];
  models: OllamaModel[];
  defaultModel?: string;
  onClose: () => void;
  onCreated: (campaign: InterviewCampaignDetail) => void;
}

export function NewCampaignModal({
  open,
  repos,
  models,
  defaultModel,
  onClose,
  onCreated,
}: NewCampaignModalProps) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [interviewAt, setInterviewAt] = useState(() => defaultInterviewLocalInput());
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [dailyMinutes, setDailyMinutes] = useState(35);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [interviewerName, setInterviewerName] = useState("");
  const [interviewerNotes, setInterviewerNotes] = useState("");
  const [missionNotes, setMissionNotes] = useState("");
  const [resumeFilename, setResumeFilename] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [prepBriefText, setPrepBriefText] = useState("");
  const [linkedReposText, setLinkedReposText] = useState("");
  const [useOllama, setUseOllama] = useState(false);

  const [parsingResume, setParsingResume] = useState(false);
  const [resumeCharCount, setResumeCharCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsingResume(true);
    setError(null);
    try {
      const parsed = await api.parseResume(file);
      setResumeFilename(parsed.filename);
      setResumeText(parsed.text);
      setResumeCharCount(parsed.char_count);
    } catch (err: any) {
      setError(err?.message || "Could not extract text from resume file");
    } finally {
      setParsingResume(false);
    }
  };

  const toggleSuggestedRepo = (fullName: string) => {
    const existing = linkedReposText
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = existing.includes(fullName);
    const next = exists ? existing.filter((r) => r !== fullName) : [...existing, fullName];
    setLinkedReposText(next.join(", "));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCompany = company.trim();
    const cleanRole = role.trim();
    if (!cleanCompany || !cleanRole) {
      setError("Company and Role are required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const linkedRepos = linkedReposText
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: CreateCampaignReq = {
        company: cleanCompany,
        role: cleanRole,
        interview_at: localDateTimeToIso(interviewAt),
        duration_minutes: Math.max(10, Math.min(180, Number(durationMinutes) || 30)),
        daily_minutes: Math.max(15, Math.min(90, Number(dailyMinutes) || 35)),
        meeting_url: meetingUrl.trim(),
        interviewer_name: interviewerName.trim(),
        interviewer_notes: interviewerNotes.trim(),
        mission_notes: missionNotes.trim(),
        resume_filename: resumeFilename.trim(),
        resume_text: resumeText.trim(),
        prep_brief_text: prepBriefText.trim(),
        linked_repos: linkedRepos,
        use_ollama: useOllama,
        model: useOllama && defaultModel ? defaultModel : null,
      };
      const created = await api.createCampaign(payload);
      onCreated(created);
    } catch (err: any) {
      setError(err?.message || "Failed to create interview campaign");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedRepos = new Set(
    linkedReposText
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
  );

  return (
    <div
      className="campaign-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-campaign-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="campaign-modal">
        <div className="campaign-modal-header">
          <div>
            <h3 id="new-campaign-title">New interview campaign</h3>
            <p>
              Build a calm, time-boxed active-recall study schedule tailored to your upcoming interview date, resume, and prep brief.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            aria-label="Close new interview campaign form"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <form
          className="campaign-wizard-form"
          data-testid="new-campaign-form"
          onSubmit={handleSubmit}
        >
          <div className="campaign-wizard-grid">
            <div className="repo-field">
              <label htmlFor="camp-company">Company</label>
              <input
                id="camp-company"
                type="text"
                className="input-field"
                required
                placeholder="e.g. Acme AI"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className="repo-field">
              <label htmlFor="camp-role">Role</label>
              <input
                id="camp-role"
                type="text"
                className="input-field"
                required
                placeholder="e.g. Software Engineer, Applied AI"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>
          </div>

          <div className="campaign-wizard-grid">
            <div className="repo-field">
              <label htmlFor="camp-date">Interview date &amp; time</label>
              <input
                id="camp-date"
                type="datetime-local"
                className="input-field"
                required
                value={interviewAt}
                onChange={(e) => setInterviewAt(e.target.value)}
              />
            </div>
            <div className="repo-field">
              <label htmlFor="camp-duration">Call duration (min)</label>
              <input
                id="camp-duration"
                type="number"
                className="input-field"
                min={10}
                max={180}
                step={5}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
              />
            </div>
            <div className="repo-field">
              <label htmlFor="camp-daily-budget">Daily study budget (15–90 min/day)</label>
              <input
                id="camp-daily-budget"
                type="number"
                className="input-field"
                min={15}
                max={90}
                step={5}
                value={dailyMinutes}
                onChange={(e) => setDailyMinutes(Number(e.target.value))}
              />
              <div className="campaign-budget-presets">
                {[20, 35, 60].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    className={`campaign-preset-chip${dailyMinutes === mins ? " active" : ""}`}
                    onClick={() => setDailyMinutes(mins)}
                  >
                    {mins} min/day
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="campaign-wizard-grid">
            <div className="repo-field">
              <label htmlFor="camp-meeting">Meeting URL (optional)</label>
              <input
                id="camp-meeting"
                type="url"
                className="input-field"
                placeholder="https://meet.google.com/..."
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
              />
            </div>
            <div className="repo-field">
              <label htmlFor="camp-interviewer">Interviewer name (optional)</label>
              <input
                id="camp-interviewer"
                type="text"
                className="input-field"
                placeholder="e.g. Jordan Lee (CTO)"
                value={interviewerName}
                onChange={(e) => setInterviewerName(e.target.value)}
              />
            </div>
          </div>

          <div className="campaign-wizard-grid">
            <div className="repo-field">
              <label htmlFor="camp-interviewer-notes">Interviewer &amp; format notes</label>
              <textarea
                id="camp-interviewer-notes"
                className="campaign-wizard-textarea"
                rows={2}
                placeholder="e.g. 20-minute technical screen focused on architecture and past AI projects"
                value={interviewerNotes}
                onChange={(e) => setInterviewerNotes(e.target.value)}
              />
            </div>
            <div className="repo-field">
              <label htmlFor="camp-mission">Company mission &amp; context</label>
              <textarea
                id="camp-mission"
                className="campaign-wizard-textarea"
                rows={2}
                placeholder="What they build, core technical challenges, and why it resonates"
                value={missionNotes}
                onChange={(e) => setMissionNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Resume Upload + Extracted Text */}
          <div className="repo-field">
            <label htmlFor="camp-resume-file">Resume upload (PDF, TXT, or MD)</label>
            <div className="campaign-upload-box">
              <input
                id="camp-resume-file"
                type="file"
                accept=".pdf,.txt,.md"
                onChange={handleFileChange}
                disabled={parsingResume}
                data-testid="campaign-resume-upload"
              />
              {parsingResume && (
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  <Upload size={13} aria-hidden="true" /> Extracting resume text…
                </span>
              )}
              {!parsingResume && resumeFilename && (
                <span className="campaign-upload-status" data-testid="campaign-resume-status">
                  <FileText size={14} aria-hidden="true" />
                  Loaded {resumeFilename}
                  {resumeCharCount !== null ? ` (${resumeCharCount.toLocaleString()} chars)` : ""}
                </span>
              )}
            </div>
          </div>

          <div className="repo-field">
            <label htmlFor="camp-resume-text">Resume text (auto-filled from upload or paste directly)</label>
            <textarea
              id="camp-resume-text"
              className="campaign-wizard-textarea"
              rows={3}
              placeholder="Upload a resume above or paste key projects, metrics, and experience..."
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
            />
          </div>

          <div className="repo-field">
            <label htmlFor="camp-brief">Prep brief / Job description</label>
            <textarea
              id="camp-brief"
              className="campaign-wizard-textarea"
              rows={4}
              placeholder="Paste the job description, talking points, debugging stories, potential gaps, or questions to ask..."
              value={prepBriefText}
              onChange={(e) => setPrepBriefText(e.target.value)}
            />
          </div>

          <div className="repo-field">
            <label htmlFor="camp-repos">Linked GitHub repositories (comma-separated)</label>
            <input
              id="camp-repos"
              type="text"
              className="input-field"
              placeholder="owner/project-alpha, owner/project-beta"
              value={linkedReposText}
              onChange={(e) => setLinkedReposText(e.target.value)}
            />
            {repos.length > 0 && (
              <div className="campaign-linked-repos">
                {repos.slice(0, 6).map((repo) => (
                  <button
                    key={repo.full_name}
                    type="button"
                    className={`campaign-preset-chip${selectedRepos.has(repo.full_name) ? " active" : ""}`}
                    onClick={() => toggleSuggestedRepo(repo.full_name)}
                  >
                    {selectedRepos.has(repo.full_name) ? "✓ " : "+ "}
                    {repo.full_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {models.length > 0 && (
            <label className="repo-checkbox-row" htmlFor="camp-use-ollama">
              <input
                id="camp-use-ollama"
                type="checkbox"
                checked={useOllama}
                onChange={(e) => setUseOllama(e.target.checked)}
              />
              <span>Enrich study drills with local Ollama{defaultModel ? ` (${defaultModel})` : ""}</span>
            </label>
          )}

          {error && (
            <div className="feedback-box err" style={{ marginTop: 0 }} role="alert">
              {error}
            </div>
          )}

          <div className="campaign-modal-footer">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || parsingResume}
              data-testid="create-campaign-submit"
            >
              <Sparkles size={15} aria-hidden="true" />
              {submitting ? "Building Schedule…" : "Create Study Plan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export interface InterviewCampaignViewProps {
  campaign: InterviewCampaignDetail;
  selectedModel?: string;
  onBack: () => void;
  onUpdated: () => void;
  onCampaignChange: (updated: InterviewCampaignDetail) => void;
  onSelectRepo?: (repoFullName: string) => void;
  renderMockPanel: (props: {
    session: MockInterviewStartResp;
    selectedModel?: string;
    onClose: () => void;
    onSessionUpdated: () => void;
    onRestart: (repo: string) => void;
  }) => React.ReactNode;
}

interface DayGroup {
  dayNumber: number;
  label: string;
  items: CampaignItem[];
  totalMinutes: number;
  masteredCount: number;
}

export function InterviewCampaignView({
  campaign,
  selectedModel,
  onBack,
  onUpdated,
  onCampaignChange,
  onSelectRepo,
  renderMockPanel,
}: InterviewCampaignViewProps) {
  const [startingMock, setStartingMock] = useState(false);
  const [mockError, setMockError] = useState<string | null>(null);
  const [activeMock, setActiveMock] = useState<MockInterviewStartResp | null>(null);

  const dayGroups = useMemo<DayGroup[]>(() => {
    const map = new Map<number, DayGroup>();
    const sortedItems = [...(campaign.items || [])].sort(
      (a, b) => a.order_index - b.order_index
    );
    for (const item of sortedItems) {
      const existing = map.get(item.day_number);
      const isMastered = item.confidence === "ready" || item.confidence === "nailed";
      if (existing) {
        existing.items.push(item);
        existing.totalMinutes += item.estimated_minutes || 0;
        if (isMastered) existing.masteredCount += 1;
      } else {
        map.set(item.day_number, {
          dayNumber: item.day_number,
          label:
            item.day_label ||
            (item.day_number === 0 ? "Interview Morning Skim" : `Day ${item.day_number}`),
          items: [item],
          totalMinutes: item.estimated_minutes || 0,
          masteredCount: isMastered ? 1 : 0,
        });
      }
    }
    const entries = Array.from(map.values());
    // Sort positive days ascending (Day 1, Day 2, ...), placing Day 0 (Interview Morning Skim) right after
    entries.sort((a, b) => {
      if (a.dayNumber === 0 && b.dayNumber !== 0) return 1;
      if (b.dayNumber === 0 && a.dayNumber !== 0) return -1;
      return a.dayNumber - b.dayNumber;
    });
    return entries;
  }, [campaign.items]);

  const defaultTab = useMemo(() => {
    const firstPending = dayGroups.find(
      (g) => g.dayNumber > 0 && g.masteredCount < g.items.length
    );
    if (firstPending) return `day-${firstPending.dayNumber}`;
    if (dayGroups.length > 0) return `day-${dayGroups[0].dayNumber}`;
    return "skim";
  }, [campaign.id, dayGroups.length]);

  const [activeTab, setActiveTab] = useState<string>(defaultTab);

  useEffect(() => {
    setActiveTab(defaultTab);
    setActiveMock(null);
    setMockError(null);
  }, [campaign.id]);

  const handleItemRated = (
    updatedItem: CampaignItem,
    updatedSummary: InterviewCampaignSummary
  ) => {
    const nextItems = (campaign.items || []).map((it) =>
      it.id === updatedItem.id ? updatedItem : it
    );
    onCampaignChange({
      ...campaign,
      ...updatedSummary,
      items: nextItems,
    });
    onUpdated();
  };

  const handleStartMock = async () => {
    setStartingMock(true);
    setMockError(null);
    try {
      const session = await api.startCampaignMock(campaign.id, selectedModel);
      setActiveMock(session);
      onUpdated();
    } catch (err: any) {
      setMockError(err?.message || "Failed to start tailored mock interview");
    } finally {
      setStartingMock(false);
    }
  };

  const selectedDay = dayGroups.find((g) => `day-${g.dayNumber}` === activeTab) || null;
  const linkedRepos = Array.isArray(campaign.linked_repos) ? campaign.linked_repos : [];
  const readinessPct = Math.round(campaign.readiness_pct || 0);
  const readinessFillColor =
    readinessPct >= 80
      ? "var(--green-solid)"
      : readinessPct >= 45
      ? "var(--accent)"
      : "var(--amber)";

  // Skim sheet ordering: Morning Skim (day 0) first, then all remaining drills in order
  const skimItems = useMemo(() => {
    const items = [...(campaign.items || [])];
    return items.sort((a, b) => {
      if (a.day_number === 0 && b.day_number !== 0) return -1;
      if (b.day_number === 0 && a.day_number !== 0) return 1;
      if (a.day_number !== b.day_number) return a.day_number - b.day_number;
      return a.order_index - b.order_index;
    });
  }, [campaign.items]);

  return (
    <div className="campaign-workspace" data-testid="interview-campaign-view">
      {/* Top Navigation Row */}
      <div className="campaign-topbar">
        <button
          type="button"
          className="btn btn-sm"
          onClick={onBack}
          data-testid="campaign-back-btn"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Back to Repo Prep
        </button>
        <span className="campaign-countdown" data-testid="campaign-countdown">
          <Clock size={13} aria-hidden="true" /> {formatCountdown(campaign.hours_until)}
        </span>
      </div>

      {/* Live Tailored Campaign Mock Interview */}
      {activeMock &&
        renderMockPanel({
          session: activeMock,
          selectedModel,
          onClose: () => setActiveMock(null),
          onSessionUpdated: onUpdated,
          onRestart: () => void handleStartMock(),
        })}

      {/* Campaign Header & Readiness Overview */}
      <section className="card campaign-hero" data-testid="campaign-header">
        <div className="campaign-hero-top">
          <div className="campaign-hero-title">
            <span className="campaign-hero-eyebrow">
              <Briefcase size={14} aria-hidden="true" /> {campaign.company}
            </span>
            <h2>
              {campaign.company} — {campaign.role}
            </h2>
            <div className="campaign-meta-line">
              <span className="campaign-meta-item">
                <Calendar size={14} aria-hidden="true" />
                {formatInterviewDate(campaign.interview_at)}
              </span>
              <span className="badge badge-kind">{campaign.duration_minutes} min call</span>
              <span className="campaign-meta-item">
                <Clock size={14} aria-hidden="true" />
                ~{campaign.daily_minutes} min/day budget · ~{campaign.remaining_minutes} min left
              </span>
            </div>
          </div>

          <div className="campaign-hero-actions">
            {campaign.meeting_url && (
              <a
                href={campaign.meeting_url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm campaign-meeting-link"
              >
                <Video size={14} aria-hidden="true" /> Open Meeting{" "}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
            <button
              type="button"
              className="btn btn-konsole"
              onClick={() => void handleStartMock()}
              disabled={startingMock}
              data-testid="campaign-start-mock-btn"
            >
              <MessageSquareCode size={15} aria-hidden="true" />
              {startingMock ? "Starting Tailored Mock…" : "Start Tailored Mock Interview"}
            </button>
          </div>
        </div>

        {/* Readiness Progress Bar */}
        <div className="campaign-readiness-row" data-testid="campaign-readiness">
          <div className="campaign-readiness-label">
            <span>Campaign readiness</span>
            <strong>
              {readinessPct}% ({campaign.mastered_items}/{campaign.total_items} drills ready)
            </strong>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Campaign readiness"
            aria-valuenow={readinessPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${readinessPct}%`}
          >
            <div
              className="progress-fill"
              style={{ width: `${readinessPct}%`, background: readinessFillColor }}
            />
          </div>
        </div>

        {mockError && (
          <div className="feedback-box err" style={{ marginTop: 0 }} role="alert">
            {mockError}
          </div>
        )}

        {/* Interviewer, Mission & Linked Repos Context */}
        {(campaign.interviewer_name ||
          campaign.interviewer_notes ||
          campaign.mission_notes ||
          linkedRepos.length > 0 ||
          campaign.resume_filename) && (
          <div className="campaign-context-grid">
            {(campaign.interviewer_name || campaign.interviewer_notes) && (
              <div className="campaign-context-box">
                <h4>
                  <User size={13} aria-hidden="true" /> Interviewer &amp; Format
                </h4>
                {campaign.interviewer_name && (
                  <p>
                    <strong>{campaign.interviewer_name}</strong>
                  </p>
                )}
                {campaign.interviewer_notes && (
                  <p style={{ marginTop: campaign.interviewer_name ? 4 : 0 }}>
                    <RichText text={campaign.interviewer_notes} />
                  </p>
                )}
              </div>
            )}

            {campaign.mission_notes && (
              <div className="campaign-context-box">
                <h4>
                  <Sparkles size={13} aria-hidden="true" /> Mission &amp; Context
                </h4>
                <p>
                  <RichText text={campaign.mission_notes} />
                </p>
              </div>
            )}

            {(linkedRepos.length > 0 || campaign.resume_filename) && (
              <div className="campaign-context-box">
                <h4>
                  <FolderGit2 size={13} aria-hidden="true" /> Linked Repos &amp; Resume
                </h4>
                {campaign.resume_filename && (
                  <p style={{ marginBottom: linkedRepos.length ? 6 : 0 }}>
                    <FileText size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} aria-hidden="true" />
                    {campaign.resume_filename}
                  </p>
                )}
                {linkedRepos.length > 0 && (
                  <div className="campaign-linked-repos">
                    {linkedRepos.map((repo) => (
                      <button
                        key={repo}
                        type="button"
                        className="campaign-repo-chip"
                        title={`Prep ${repo} in Repo Interview Prep`}
                        onClick={() => onSelectRepo?.(repo)}
                      >
                        {repo}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Time-Boxed Day Tabs + 1-Page Skim Cheat Sheet */}
      <div
        className="campaign-tabs"
        role="tablist"
        aria-label="Study plan days"
        data-testid="campaign-day-tabs"
      >
        {dayGroups.map((group) => {
          const tabId = `day-${group.dayNumber}`;
          const isActive = activeTab === tabId;
          const shortTitle =
            group.dayNumber === 0
              ? "Morning Skim"
              : group.label.split("·")[0]?.trim() || `Day ${group.dayNumber}`;
          return (
            <button
              key={tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`campaign-tab${isActive ? " active" : ""}`}
              onClick={() => setActiveTab(tabId)}
              data-testid={`campaign-tab-day-${group.dayNumber}`}
            >
              <span>{shortTitle}</span>
              <span className="campaign-tab-meta">
                ~{group.totalMinutes} min · {group.masteredCount}/{group.items.length}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "skim"}
          className={`campaign-tab${activeTab === "skim" ? " active" : ""}`}
          onClick={() => setActiveTab("skim")}
          data-testid="campaign-tab-skim"
        >
          <FileText size={14} aria-hidden="true" />
          <span>1-Page Skim Sheet</span>
        </button>
      </div>

      {/* Active Day Drills View */}
      {activeTab !== "skim" && selectedDay && (
        <>
          <div className="campaign-day-banner">
            <strong>{selectedDay.label}</strong>
            <span>
              Realistic time budget: ~{selectedDay.totalMinutes} min · {selectedDay.masteredCount}/
              {selectedDay.items.length} ready
            </span>
          </div>
          <div className="drill-stack">
            {selectedDay.items.map((item) => (
              <CampaignDrillCard
                key={item.id}
                campaignId={campaign.id}
                item={item}
                onRated={handleItemRated}
              />
            ))}
          </div>
        </>
      )}

      {/* 1-Page Pre-Call Skim Cheat Sheet View */}
      {activeTab === "skim" && (
        <section className="card skim-sheet" data-testid="campaign-skim-sheet">
          <div className="skim-header">
            <div>
              <h3>1-Page Interview Skim Sheet</h3>
              <p>
                Everything expanded at a glance for a calm 5–10 minute pre-call refresh — no clicking required.
              </p>
            </div>
            {campaign.meeting_url && (
              <a
                href={campaign.meeting_url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary btn-sm campaign-meeting-link"
              >
                <Video size={14} aria-hidden="true" /> Open Meeting
              </a>
            )}
          </div>

          {skimItems.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No study drills in this campaign yet.
            </p>
          ) : (
            <div className="skim-grid">
              {skimItems.map((item) => {
                const pts = Array.isArray(item.key_points) ? item.key_points : [];
                return (
                  <article key={item.id} className="skim-item">
                    <div className="skim-item-top">
                      <span className={`drill-cat-badge ${categoryStyleClass(item.category)}`}>
                        {item.category}
                      </span>
                      <span className="drill-target-pill">
                        {item.target_seconds || 60}s · {confidenceLabel(item.confidence)}
                      </span>
                    </div>
                    <h4>
                      <RichText text={item.title || ""} />
                    </h4>
                    {pts.length > 0 ? (
                      <ul className="skim-points">
                        {pts.map((pt, i) => (
                          <li key={i}>
                            <RichText text={pt || ""} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ margin: 0, fontSize: "0.83rem" }}>
                        <RichText text={item.prompt || ""} />
                      </p>
                    )}
                    {item.notes && (
                      <p className="skim-note">
                        <strong>Note:</strong> {item.notes}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
