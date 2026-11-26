import type {
  DashboardData,
  GradeOutcome,
  LaunchWorkspaceResp,
  ModuleDetail,
  OllamaModel,
  SkillTreeNode,
  Technology,
} from "./types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  dashboard: () => req<DashboardData>("/api/dashboard"),
  tracks: () => req<{ technologies: Technology[] }>("/api/tracks"),
  module: (id: string) => req<ModuleDetail>(`/api/modules/${encodeURIComponent(id)}`),
  projects: () => req<{ projects: ModuleDetail[] }>("/api/projects"),
  skillTree: () => req<{ nodes: SkillTreeNode[]; edges: { from: string; to: string }[] }>("/api/skill-tree"),
  submitBrowser: (activityId: string, submission: Record<string, any>) =>
    req<GradeOutcome>(`/api/activities/${encodeURIComponent(activityId)}/submit`, {
      method: "POST",
      body: JSON.stringify({ submission }),
    }),
  launchNvim: (activityId: string, reset = false) =>
    req<LaunchWorkspaceResp>(`/api/activities/${encodeURIComponent(activityId)}/launch-nvim`, {
      method: "POST",
      body: JSON.stringify({ reset }),
    }),
  gradeWorkspace: (activityId: string, workspaceDir: string, keystrokes?: number) =>
    req<GradeOutcome>("/api/grade", {
      method: "POST",
      body: JSON.stringify({ activity_id: activityId, workspace_dir: workspaceDir, keystrokes }),
    }),
  saveProfile: (provider: string, handle: string) =>
    req<{ provider: string; handle: string }>("/api/sync/profile", {
      method: "POST",
      body: JSON.stringify({ provider, handle }),
    }),
  runSync: (provider?: string) =>
    req<{ results: Record<string, any>[] }>("/api/sync/run", {
      method: "POST",
      body: JSON.stringify({ provider: provider || null }),
    }),
  ollamaModels: () =>
    req<{ available: boolean; url: string; models: OllamaModel[] }>("/api/ollama/models"),
  ollamaGenerate: (techSlug: string, topic: string, difficulty: string, model?: string) =>
    req<{ module: ModuleDetail }>("/api/ollama/generate", {
      method: "POST",
      body: JSON.stringify({
        tech_slug: techSlug,
        topic,
        difficulty,
        model: model || null,
      }),
    }),
  setDailyGoal: (dailyXpTarget: number) =>
    req<{ daily_xp_target: number }>("/api/daily-goal", {
      method: "POST",
      body: JSON.stringify({ daily_xp_target: dailyXpTarget }),
    }),
};

export function connectEvents(
  onEvent: (evt: { type: string; payload: any }) => void,
  onStatus: (connected: boolean) => void
): () => void {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${window.location.host}/ws/events`;
  let closed = false;
  let ws: WebSocket | null = null;
  let timer: number | null = null;

  const open = () => {
    if (closed) return;
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => onStatus(true);
      ws.onclose = () => {
        onStatus(false);
        if (!closed) {
          timer = window.setTimeout(open, 2500);
        }
      };
      ws.onerror = () => onStatus(false);
      ws.onmessage = (msg) => {
        try {
          onEvent(JSON.parse(msg.data));
        } catch {
          // ignore malformed messages
        }
      };
    } catch {
      onStatus(false);
    }
  };

  open();
  return () => {
    closed = true;
    if (timer) window.clearTimeout(timer);
    ws?.close();
  };
}
