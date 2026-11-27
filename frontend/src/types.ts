export type ThemeId =
  | "frutiger-aero"
  | "emerald-3d"
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
  upcoming_campaign?: InterviewCampaignSummary | null;
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

export type CampaignConfidence = "unreviewed" | "shaky" | "ready" | "nailed";

export interface CampaignItem {
  id: string;
  campaign_id: string;
  day_number: number;
  day_label: string;
  category: string;
  title: string;
  prompt: string;
  key_points: string[];
  target_seconds: number;
  estimated_minutes: number;
  confidence: CampaignConfidence;
  practice_count: number;
  order_index: number;
  notes: string;
}

export interface CampaignDayGroup {
  day_number: number;
  day_label: string;
  estimated_minutes: number;
  remaining_minutes?: number;
  completed_count?: number;
  total_count?: number;
  items: CampaignItem[];
}

export interface InterviewCampaignSummary {
  id: string;
  company: string;
  role: string;
  interview_at: string;
  duration_minutes: number;
  daily_minutes: number;
  meeting_url: string;
  interviewer_name: string;
  status: string;
  readiness_pct: number;
  total_items: number;
  mastered_items: number;
  total_minutes: number;
  remaining_minutes: number;
  hours_until: number;
  next_item_title?: string | null;
}

export interface InterviewCampaignDetail extends InterviewCampaignSummary {
  interviewer_notes: string;
  mission_notes: string;
  resume_filename: string;
  resume_text: string;
  prep_brief_text: string;
  linked_repos: string[];
  items: CampaignItem[];
  days?: CampaignDayGroup[];
  created_at: string;
  updated_at: string;
}

export interface CreateCampaignReq {
  company: string;
  role: string;
  interview_at: string;
  duration_minutes?: number;
  daily_minutes?: number;
  meeting_url?: string;
  interviewer_name?: string;
  interviewer_notes?: string;
  mission_notes?: string;
  resume_filename?: string;
  resume_text?: string;
  prep_brief_text?: string;
  linked_repos?: string[];
  use_ollama?: boolean;
  model?: string | null;
}

export interface ParseResumeResp {
  filename: string;
  text: string;
  char_count: number;
  preview: string;
}

export type EvalChoice = "strongly_a" | "slightly_a" | "tie" | "slightly_b" | "strongly_b";

export type BehavioralAxisSlug =
  | "honesty"
  | "agentic_safety"
  | "scoping"
  | "deference"
  | "interaction"
  | "confidence"
  | "clarity";

export type ForcedChoiceRating =
  | "a_much_better"
  | "a_better"
  | "a_slightly_better"
  | "a_negligibly_better"
  | "b_negligibly_better"
  | "b_slightly_better"
  | "b_better"
  | "b_much_better"
  | "na";

export interface BehavioralAxisDef {
  slug: BehavioralAxisSlug;
  label: string;
  description: string;
}

export interface TranscriptLine {
  line: string;
  role: "tool" | "output" | "assistant" | "final_summary";
  text: string;
}

export interface AxisRatingInput {
  rating: ForcedChoiceRating | "";
  note: string;
}

export interface AxisCalibrationItem {
  axis: string;
  label: string;
  user_rating: string;
  expected_winner: "a" | "b" | "na";
  matched: boolean;
  deciding: boolean;
  why: string;
}

export interface WriteupCheck {
  id: string;
  label: string;
  passed: boolean;
  message: string;
}

export interface EvalApproach {
  label: string;
  summary: string;
  code: string;
  test_output: string;
}

export interface EvalScenario {
  id: string;
  title: string;
  language: string;
  difficulty: string;
  estimated_minutes: number;
  context: string;
  task_prompt: string;
  acceptance_criteria: string[];
  approach_a: EvalApproach;
  approach_b: EvalApproach;
  available_tags: { slug: string; label: string }[];
  transcript_a?: TranscriptLine[];
  transcript_b?: TranscriptLine[];
  senior_engineer_example?: string;
  overall_example?: string;
  completed?: boolean;
  best_score?: number;
  last_submission?: Record<string, any> | null;
}

export interface EvalRubric {
  stance_clarity: number;
  code_evidence: number;
  verification_focus: number;
  actionable_steering: number;
  total: number;
}

export interface EvalSubmitReq {
  choice: EvalChoice;
  spotted_tags: string[];
  rationale: string;
  followup_prompt: string;
  axis_ratings?: Record<string, AxisRatingInput>;
  deciding_axes?: string[];
  senior_engineer_note?: string;
  overall_summary?: string;
  other_issues?: string;
}

export interface EvalDryRun {
  id: string;
  repo_name: string;
  license: string;
  task_type: string;
  goal: string;
  acceptance_criteria: string[];
  verify_command: string;
  what_helped: string;
  where_stepped_in: string;
  preferred_approach_notes: string;
  checklist: Record<string, boolean>;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface EvalLabOverview {
  scenarios: EvalScenario[];
  dry_runs: EvalDryRun[];
  completed_count: number;
  total_scenarios: number;
  confidence_pct: number;
  ladder: { id: string; title: string; done: boolean }[];
  axes?: BehavioralAxisDef[];
}

export interface EvalSubmitResp {
  aligned: boolean;
  expected_side: "a" | "b";
  matched_tags: string[];
  missed_tags: string[];
  rubric: EvalRubric;
  coaching_tips: string[];
  reference_explanation: string;
  sample_followup: string;
  xp_awarded: number;
  unlocked_achievements?: UnlockedAchievement[];
  axis_calibration?: AxisCalibrationItem[];
  writeup_checks?: WriteupCheck[];
  senior_engineer_example?: string;
  overall_example?: string;
  overview: EvalLabOverview;
}
