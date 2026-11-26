import React, { useEffect, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  FolderGit2,
  Lock,
  Play,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { api } from "../api";
import type { GitHubRepo, GitHubStatus, ModuleSummary, OllamaModel } from "../types";

interface Props {
  onOpenModule: (moduleId: string) => void;
  onUpdated: () => void;
}

export function RepoInterviewView({ onOpenModule, onUpdated }: Props) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [packs, setPacks] = useState<ModuleSummary[]>([]);
  const [models, setModels] = useState<OllamaModel[]>([]);

  const [usernameInput, setUsernameInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [customRepo, setCustomRepo] = useState("");
  const [filter, setFilter] = useState("");
  const [useOllama, setUseOllama] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");

  const [busyRepo, setBusyRepo] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      const [st, pk, ol] = await Promise.all([
        api.githubStatus(),
        api.githubStudyPacks(),
        api.ollamaModels(),
      ]);
      setStatus(st);
      setPacks(pk.packs);
      setModels(ol.models);
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

  const filteredRepos = repos.filter(
    (r) =>
      r.full_name.toLowerCase().includes(filter.toLowerCase()) ||
      r.description.toLowerCase().includes(filter.toLowerCase()) ||
      r.language.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* GitHub Connector + Manual Repo Analyzer */}
      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">
            <FolderGit2 size={18} color="#7aa2f7" /> GitHub Connector
          </h3>
          {status?.connected ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input-field"
                placeholder="GitHub username (e.g. lupenox)"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
              />
              <input
                className="input-field"
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
            Paste any <code>owner/repo</code> or GitHub URL to inspect its real code, entrypoints, stack, and generate an interactive zyBooks interview-defense pack.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              className="input-field"
              placeholder="owner/repo or https://github.com/owner/repo"
              value={customRepo}
              onChange={(e) => setCustomRepo(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!customRepo.trim() || Boolean(busyRepo)}
              onClick={() => analyzeRepo(customRepo)}
            >
              {busyRepo === customRepo ? "Analyzing..." : "Build Study Pack"}
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.84rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={useOllama}
              onChange={(e) => setUseOllama(e.target.checked)}
              disabled={models.length === 0}
            />
            <span>Enrich with Local Ollama Staff-Engineer Grill Questions</span>
            {models.length > 0 && useOllama && (
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

      {/* Generated Repo Interview Study Packs */}
      <div className="card">
        <h3 className="card-title">
          <BookOpen size={17} color="#73daca" /> Your Repo Interview Study Packs ({packs.length})
        </h3>
        {packs.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: "0.86rem" }}>
            No repo study packs yet—click <strong>Study for Interview</strong> on any repository below to build one!
          </p>
        ) : (
          <div className="grid-2">
            {packs.map((p) => (
              <div
                key={p.id}
                style={{
                  background: "#131928",
                  border: "1px solid #26314c",
                  borderRadius: 10,
                  padding: 14,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div>
                  <strong>{p.title}</strong>
                  <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                    {p.completed_count}/{p.activity_count} defense drills mastered • {p.tech_slug.toUpperCase()}
                  </div>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenModule(p.id)}>
                  <Play size={13} /> Defend
                </button>
              </div>
            ))}
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
            {filteredRepos.map((r) => (
              <div
                key={r.full_name}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                    <strong>{r.full_name}</strong>
                    <span className="badge badge-kind">{r.language}</span>
                    {r.private && (
                      <span className="badge badge-warming">
                        <Lock size={10} /> Private
                      </span>
                    )}
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: "0.83rem" }}>
                    {r.description || "No description"}
                  </p>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <a
                    href={r.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="muted"
                    style={{ fontSize: "0.78rem" }}
                  >
                    View on GitHub
                  </a>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={Boolean(busyRepo)}
                    onClick={() => analyzeRepo(r.full_name)}
                  >
                    <BookOpen size={13} />
                    {busyRepo === r.full_name ? "Building..." : "Study for Interview"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
