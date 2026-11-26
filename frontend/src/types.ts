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
  kind: "zybooks" | "kata" | "project" | "neovim_drill" | string;
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
}

export interface LaunchWorkspaceResp {
  workspace_dir: string;
  primary_file: string;
  nvim_command: string;
  meta: Record<string, any>;
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
