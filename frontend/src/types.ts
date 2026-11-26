export type ThemeId =
  | "emerald-3d"
  | "frutiger-aero"
  | "tokyo-night"
  | "catppuccin"
  | "gruvbox"
  | "kanagawa";

export interface Technology {
  slug: string;
  name: string;
  category: string;
  color: string;
  icon: string;
  xp: number;
  level: number;
  completed_activities: number;
  total_activities: number;
  mastery_pct: number;
  freshness: "fresh" | "warming" | "rusty" | "unstarted";
  last_practiced_at: string | null;
  modules?: ModuleSummary[];
}

export interface ModuleSection {
  title: string;
  body: string;
  code_example?: string;
}

export interface ModuleContent {
  sections: ModuleSection[];
  summary: string;
  tags: string[];
  external_resources?: { label: string; url: string }[];
}

export interface ModuleSummary {
  id: string;
  tech_slug: string;
  title: string;
  subtitle: string;
  difficulty: string;
  kind: "zybooks" | "kata" | "project" | "neovim_drill" | "repo_interview" | string;
  estimated_minutes: number;
  order_index: number;
  prereq_module_id: string | null;
  source: string;
  content: ModuleContent;
  activity_count: number;
  completed_count: number;
}

export interface Activity {
  id: string;
  module_id: string;
  tech_slug: string;
  title: string;
  activity_type:
    | "read_check"
    | "multi_select"
    | "fill_blank"
    | "parsons"
    | "code_trace"
    | "pdb_sim"
    | "nvim_lab"
    | "boss_checkpoint";
  grader_type: string;
  order_index: number;
  xp_reward: number;
  par_keystrokes: number | null;
  spec: Record<string, any>;
  completed?: boolean;
  completion?: {
    first_passed_at: string;
    last_passed_at: string;
    best_keystrokes: number | null;
    attempts_count: number;
  } | null;
}

export interface ModuleDetail extends ModuleSummary {
  technology: Technology;
  activities: Activity[];
}

export interface UnlockedAchievement {
  slug: string;
  name: string;
  icon: string;
  bonus_xp: number;
  description?: string;
}

export interface AchievementItem {
  slug: string;
  name: string;
  description: string;
  icon: string;
  bonus_xp?: number;
  unlocked: boolean;
  unlocked_at: string | null;
}

export interface DailyWarmupItem {
  activity_id: string;
  title: string;
  tech_slug: string;
  module_id: string;
  activity_type: string;
  xp_reward: number;
  reason: string;
}

export interface GradeOutcome {
  activity_id: string;
  tech_slug: string;
  tech_name: string;
  passed: boolean;
  score: number;
  output: string;
  first_time: boolean;
  xp_awarded: number;
  par_bonus: number;
  tech_xp: number;
  tech_mastery_pct: number;
  freshness: string;
  unlocked_achievements?: UnlockedAchievement[];
}

export interface LaunchWorkspaceResp {
  workspace_dir: string;
  primary_file: string;
  nvim_command: string;
  meta: Record<string, any>;
}

export interface OpenTerminalResp {
  launched: boolean;
  terminal: string | null;
  workspace_dir: string;
  primary_file: string;
  nvim_command: string;
  message: string;
}

export interface ExternalProfile {
  provider: string;
  handle: string;
  last_synced_at: string | null;
  last_count: number;
  metadata: Record<string, any>;
}

export interface DashboardData {
  total_xp: number;
  level: number;
  xp_in_level: number;
  xp_for_next: number;
  streak_days: number;
  today_xp: number;
  daily_xp_target: number;
  completed_activities: number;
  total_activities: number;
  rank_title?: string;
  achievements?: AchievementItem[];
  daily_warmup?: DailyWarmupItem[];
  technologies: Technology[];
  due_reviews: {
    activity_id: string;
    due_at: string;
    interval_days: number;
    title: string;
    tech_slug: string;
    module_id: string;
    activity_type: string;
  }[];
  recent_xp: {
    id: number;
    tech_slug: string;
    tech_name: string;
    color: string;
    source: string;
    amount: number;
    reason: string;
    created_at: string;
  }[];
  daily_totals: Record<string, number>;
  external_profiles: ExternalProfile[];
  recommended_next: {
    activity_id: string;
    title: string;
    activity_type: string;
    xp_reward: number;
    tech_slug: string;
    module_id: string;
    module_title: string;
    kind: string;
    estimated_minutes: number;
  }[];
}

export interface SkillTreeNode {
  id: string;
  tech_slug: string;
  tech_name: string;
  color: string;
  category: string;
  title: string;
  difficulty: string;
  kind: string;
  total_acts: number;
  done_acts: number;
  completed: boolean;
  unlocked: boolean;
  prereq_module_id: string | null;
}

export interface OllamaModel {
  name: string;
  size: number;
}

export interface GitHubStatus {
  connected: boolean;
  auth_source: string;
  username?: string;
  name?: string;
  avatar_url?: string;
  public_repos?: number;
  private_repos?: number;
  error?: string;
}

export interface GitHubRepo {
  full_name: string;
  name: string;
  owner: string;
  description: string;
  language: string;
  private: boolean;
  stargazers_count: number;
  updated_at: string;
  default_branch: string;
  html_url: string;
  topics: string[];
}

export interface SearchTechnologyHit {
  slug: string;
  name: string;
  category: string;
  color: string;
  mastery_pct?: number;
}

export interface SearchModuleHit {
  id: string;
  tech_slug: string;
  title: string;
  subtitle?: string;
  kind: string;
  difficulty?: string;
}

export interface SearchActivityHit {
  id: string;
  module_id: string;
  tech_slug: string;
  title: string;
  activity_type: string;
  xp_reward?: number;
}

export interface SearchResults {
  query?: string;
  technologies: SearchTechnologyHit[];
  modules: SearchModuleHit[];
  activities: SearchActivityHit[];
  packs: SearchModuleHit[];
}

export interface SprintStartResp {
  duration_minutes: number;
  activities: Activity[];
}

export interface SprintCompleteResp {
  bonus_xp: number;
  unlocked_achievements: UnlockedAchievement[];
  session_id?: number;
  duration_minutes?: number;
  completed_count?: number;
  max_combo?: number;
}

export interface RegexMatch {
  start: number;
  end: number;
  match: string;
  groups: Record<string, string>;
}

export interface RegexPlaygroundResp {
  ok: boolean;
  error: string | null;
  matches: RegexMatch[];
}

export interface SqlPlaygroundResp {
  ok: boolean;
  error: string | null;
  columns: string[];
  rows: any[][];
  row_count?: number;
}

export interface MockInterviewQuestion {
  index: number;
  category?: string;
  question: string;
  context_hint?: string;
  focus?: string;
}

export interface MockInterviewRubric {
  clarity: number;
  accuracy: number;
  code_refs: number;
  tradeoffs: number;
  total: number;
  feedback: string;
  ideal_points: string[];
  graded_by?: string;
}

export interface MockInterviewSummary {
  id: number;
  repo_full_name: string;
  module_id: string | null;
  status: "active" | "completed" | string;
  readiness_score: number;
  created_at: string;
  updated_at: string;
  answered_count?: number;
  total_questions?: number;
}

export interface MockInterviewStartResp {
  session_id: number;
  repo_full_name: string;
  module_id?: string | null;
  status?: string;
  current_index: number;
  total_questions: number;
  question: MockInterviewQuestion;
  questions?: MockInterviewQuestion[];
  readiness_score?: number;
}

export interface MockInterviewAnswerResp {
  session_id: number;
  repo_full_name?: string;
  status: "active" | "completed" | string;
  answered_index: number;
  current_index: number;
  total_questions: number;
  rubric: MockInterviewRubric;
  next_question: MockInterviewQuestion | null;
  completed: boolean;
  readiness_score: number;
  xp_awarded?: number;
  unlocked_achievements?: UnlockedAchievement[];
}
