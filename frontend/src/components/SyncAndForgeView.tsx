import React, { useEffect, useState } from "react";
import { Cpu, RefreshCw, Sparkles, Terminal } from "lucide-react";
import { api } from "../api";
import type { DashboardData, OllamaModel } from "../types";

interface Props {
  dashboard: DashboardData;
  onSynced: () => void;
  onOpenModule: (moduleId: string) => void;
}

export function SyncAndForgeView({ dashboard, onSynced, onOpenModule }: Props) {
  const existing = Object.fromEntries(dashboard.external_profiles.map((p) => [p.provider, p.handle]));
  const [lcUser, setLcUser] = useState(existing.leetcode || "");
  const [cwUser, setCwUser] = useState(existing.codewars || "");
  const [exPath, setExPath] = useState(existing.exercism || "~/exercism");
  const [syncLog, setSyncLog] = useState<string>("");
  const [syncing, setSyncing] = useState(false);

  // Local Ollama zyBooks Forge
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [techSlug, setTechSlug] = useState("fastapi");
  const [topic, setTopic] = useState("Dependency Injection & BackgroundTasks");
  const [difficulty, setDifficulty] = useState("intermediate");
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");

  useEffect(() => {
    api.ollamaModels().then((res) => {
      setModels(res.models);
      if (res.models.length > 0) setSelectedModel(res.models[0].name);
    });
  }, []);

  const saveAndSync = async (provider: string, handle: string) => {
    setSyncing(true);
    setSyncLog("");
    try {
      if (handle.trim()) {
        await api.saveProfile(provider, handle.trim());
      }
      const res = await api.runSync(provider);
      setSyncLog(JSON.stringify(res.results, null, 2));
      onSynced();
    } catch (e: any) {
      setSyncLog(`Sync error: ${e?.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const generateModule = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setGenStatus("Generating zyBooks micro-lesson via local Ollama (100% free/offline)...");
    try {
      const res = await api.ollamaGenerate(techSlug, topic, difficulty, selectedModel || undefined);
      setGenStatus(`Created module: ${res.module.title}`);
      onSynced();
      onOpenModule(res.module.id);
    } catch (err: any) {
      setGenStatus(`Generation error: ${err?.message}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="grid-2">
        {/* External Platform Sync */}
        <div className="card">
          <h3 className="card-title">
            <RefreshCw size={17} color="#73daca" /> External Platform Sync ($0 Free APIs)
          </h3>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
            Pull completions from <code>leetcode.nvim</code> (LeetCode GraphQL), Codewars v1 API, and your local <code>exercism</code> CLI workspace straight into your RPG mastery bars!
          </p>

          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>LeetCode Username (GraphQL)</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <input
                  className="input-field"
                  placeholder="your-leetcode-username"
                  value={lcUser}
                  onChange={(e) => setLcUser(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={syncing || !lcUser.trim()}
                  onClick={() => saveAndSync("leetcode", lcUser)}
                >
                  Sync
                </button>
              </div>
            </div>

            <div>
              <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>Codewars Username (Public API v1)</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <input
                  className="input-field"
                  placeholder="your-codewars-username"
                  value={cwUser}
                  onChange={(e) => setCwUser(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={syncing || !cwUser.trim()}
                  onClick={() => saveAndSync("codewars", cwUser)}
                >
                  Sync
                </button>
              </div>
            </div>

            <div>
              <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>Local Exercism Workspace Directory</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <input
                  className="input-field"
                  value={exPath}
                  onChange={(e) => setExPath(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={syncing}
                  onClick={() => saveAndSync("exercism", exPath)}
                >
                  Scan
                </button>
              </div>
            </div>
          </div>

          {syncLog && <pre className="code-block" style={{ marginTop: 12 }}>{syncLog}</pre>}
        </div>

        {/* Local Ollama zyBooks Forge */}
        <div className="card">
          <h3 className="card-title">
            <Sparkles size={17} color="#bb9af7" /> Local Ollama zyBooks Module Forge ($0/mo)
          </h3>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
            Want a fresh interactive zyBooks lesson (reading cards + concept check + fill-in-the-blank + Parsons puzzle) on any topic? Generate one locally using your installed Ollama model!
          </p>

          <form onSubmit={generateModule} style={{ display: "grid", gap: 10 }}>
            <div>
              <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>Technology</label>
              <select className="select-field" value={techSlug} onChange={(e) => setTechSlug(e.target.value)}>
                {dashboard.technologies.map((t) => (
                  <option key={t.slug} value={t.slug}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>Topic</label>
              <input
                className="input-field"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. SQL Window Functions, C++ Smart Pointers, Regex Lookaheads..."
                required
              />
            </div>
            <div className="grid-2">
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>Difficulty</label>
                <select className="select-field" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>Local Ollama Model</label>
                <select
                  className="select-field"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {models.length === 0 ? (
                    <option value="">Ollama offline / no models</option>
                  ) : (
                    models.map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))
                  )}
                </select>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={generating || models.length === 0}>
              <Cpu size={15} /> {generating ? "Forging Lesson..." : "Forge New zyBooks Module"}
            </button>
          </form>

          {genStatus && <div className="feedback-box ok">{genStatus}</div>}
        </div>
      </div>

      {/* Neovim & Arch/AUR Quick-Reference */}
      <div className="card">
        <h3 className="card-title">
          <Terminal size={17} color="#7aa2f7" /> Neovim &amp; EndeavourOS / AUR Companion Cheat Sheet
        </h3>
        <div className="grid-2">
          <div>
            <strong>Configured Neovim Keybindings (<code>&lt;Space&gt;</code> = Leader)</strong>
            <pre className="code-block">{`:w             Auto-grade current DevQuest lab + earn XP!
<leader>qt     Run DevQuest grader manually
<leader>qo     Open full pytest / g++ / SQL / Playwright test output
<leader>qh     Show progressive challenge hints
<leader>qs     Pop up all 16 RPG Mastery Bars inside Neovim
<leader>pb     Launch :VimBeGood motion game
<leader>ph     Toggle hardtime.nvim motion coach
<leader>pp     Toggle precognition.nvim motion hints
<leader>pl     Open :Leet (leetcode.nvim inside Neovim!)`}</pre>
          </div>
          <div>
            <strong>Optional Arch / AUR Practice Games &amp; CLI</strong>
            <p className="muted" style={{ fontSize: "0.84rem", marginTop: 4 }}>
              Run this once in your terminal if you also want PacVim (Pac-Man for Vim motions), Oh My Git! (visual Godot Git game), and the official Exercism CLI:
            </p>
            <pre className="code-block">yay -S --needed exercism-bin pacvim-git oh-my-git-git</pre>
            <p className="muted" style={{ fontSize: "0.84rem" }}>
              Terminal DevQuest shortcuts already installed in <code>~/.local/bin/devquest</code>:
            </p>
            <pre className="code-block">{`devquest up            # Start DevQuest dashboard on http://127.0.0.1:8765
devquest next [tech]   # Open your next challenge directly in Neovim
devquest check         # Grade current challenge folder in terminal
devquest stats         # Print 16 ASCII mastery progress bars`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
