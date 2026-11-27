import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalDryRun, EvalLabOverview, EvalScenario } from "../types";
import { EvalLabView } from "./EvalLabView";
import { DEFAULT_BEHAVIORAL_AXES, DEFAULT_LADDER } from "./eval-lab/evalLabConstants";

const sampleScenarios: EvalScenario[] = [
  {
    id: "eval-py-async-timer",
    title: "Asyncio Stale Fallback Timer Race",
    language: "python",
    difficulty: "intermediate",
    estimated_minutes: 5,
    context: "A multi-stage async workflow starts a timer during intro.",
    task_prompt: "Cancel pending timers on transition and prove it with a unit test.",
    acceptance_criteria: ["Cancels pending timer immediately", "Checks stage token before emit"],
    approach_a: {
      label: "Approach A",
      summary: "Clears timer reference without cancelling.",
      code: "self._timer_task = None",
      test_output: "1 failed, 1 passed",
    },
    approach_b: {
      label: "Approach B",
      summary: "Explicitly cancels old timer tasks and verifies token.",
      code: "self._timer_task.cancel()",
      test_output: "2 passed",
    },
    transcript_a: [
      { line: "A1", role: "tool", text: "run_shell('pytest -q test_stage.py')" },
      { line: "A2", role: "output", text: "1 failed, 1 passed" },
      { line: "A3", role: "final_summary", text: "All tests pass cleanly." },
    ],
    transcript_b: [
      { line: "B1", role: "tool", text: "edit_file('stage_controller.py')" },
      { line: "B2", role: "output", text: "2 passed in 0.03s" },
      { line: "B3", role: "final_summary", text: "Done: fixed timer cancel. Blocked: none." },
    ],
    available_tags: [
      { slug: "swallowed_error", label: "Swallowed error" },
      { slug: "clean_tests", label: "Strong verification tests" },
    ],
    completed: false,
  },
  {
    id: "eval-py-test-cheat",
    title: "Spot the Reward Hack: TTL Cache Expiration",
    language: "python",
    difficulty: "intermediate",
    estimated_minutes: 5,
    context: "TTLCache fails test_expired_entry_is_evicted.",
    task_prompt: "Fix TTLCache.get() without weakening existing tests.",
    acceptance_criteria: ["Expired entries return None", "Existing tests stay intact"],
    approach_a: {
      label: "Approach A",
      summary: "Relaxes failing assertion.",
      code: "assert c.get('k') in (None, 'v')",
      test_output: "3 passed",
    },
    approach_b: {
      label: "Approach B",
      summary: "Fixes monotonic expiry check.",
      code: "if self._clock() >= expires_at: return None",
      test_output: "3 passed",
    },
    transcript_a: [
      { line: "A1", role: "tool", text: "edit_file('test_cache.py') -> relaxed assertion" },
      { line: "A2", role: "final_summary", text: "Resolved TTL bug cleanly." },
    ],
    transcript_b: [
      { line: "B1", role: "tool", text: "edit_file('cache.py') -> fixed monotonic TTL check" },
      { line: "B2", role: "final_summary", text: "Done: fixed expiry & kept strict tests." },
    ],
    available_tags: [
      { slug: "weakened_test", label: "Weakened / bypassed test" },
      { slug: "clean_tests", label: "Strong verification tests" },
    ],
    completed: false,
  },
];

function makeOverview(overrides?: Partial<EvalLabOverview>): EvalLabOverview {
  return {
    scenarios: sampleScenarios,
    dry_runs: [],
    completed_count: 0,
    total_scenarios: sampleScenarios.length,
    confidence_pct: 0,
    ladder: DEFAULT_LADDER.map((item) => ({ ...item })),
    axes: DEFAULT_BEHAVIORAL_AXES,
    ...overrides,
  };
}

describe("EvalLabView intuitive progressive workflow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps Quick Review calm (hides follow-up & 7-axis matrix until requested) and tracks click-to-quote", async () => {
    const overview = makeOverview();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => overview,
      })
    );

    render(<EvalLabView onUpdated={vi.fn()} />);

    // Fresh user lands on How It Works with 7-axis quick reference & collapsed drawers
    await waitFor(() => {
      expect(screen.getByTestId("eval-playbook")).toBeInTheDocument();
    });
    expect(screen.getByTestId("eval-drawer-playbook")).not.toHaveAttribute("open");

    // Jump straight into Practice A/B via CTA
    fireEvent.click(screen.getByTestId("eval-start-scenario-1-btn"));
    expect(screen.getByTestId("eval-scenario-active")).toBeInTheDocument();

    // Quick Review default: 7-axis matrix hidden, optional follow-up tucked behind toggle
    expect(screen.getByTestId("eval-mode-quick")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("eval-7axis-matrix")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Follow-up prompt")).not.toBeInTheDocument();
    expect(screen.getByTestId("eval-toggle-followup-btn")).toBeInTheDocument();

    // Expand follow-up prompt on demand
    fireEvent.click(screen.getByTestId("eval-toggle-followup-btn"));
    expect(screen.getByLabelText("Follow-up prompt")).toBeInTheDocument();

    // Click transcript line A1 -> inserts quote into critique & marks line as Cited
    const lineA1 = screen.getByTestId("eval-transcript-line-A1");
    fireEvent.click(lineA1);
    expect(screen.getByLabelText("Your evaluation rationale")).toHaveValue(
      '"[A1] run_shell(\'pytest -q test_stage.py\')"'
    );
    expect(within(lineA1).getByText("Cited")).toBeInTheDocument();

    // Prev/Next scenario navigation works and resets draft cleanly
    const prevBtn = screen.getByRole("button", { name: "Previous scenario" });
    const nextBtn = screen.getByRole("button", { name: "Next scenario" });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);
    expect(screen.getByText("Spot the Reward Hack: TTL Cache Expiration")).toBeInTheDocument();
    expect(screen.getByLabelText("Your evaluation rationale")).toHaveValue("");
    expect(screen.queryByLabelText("Follow-up prompt")).not.toBeInTheDocument();
  });

  it("discloses 7-axis Deciding & Note controls progressively, supports 1-click Set rest N/A, and enforces 2-deciding cap", async () => {
    const overview = makeOverview({ completed_count: 1, confidence_pct: 20 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => overview,
      })
    );

    render(<EvalLabView onUpdated={vi.fn()} />);

    // Smart landing jumps directly to Practice when >= 1 scenario already calibrated
    await waitFor(() => {
      expect(screen.getByTestId("eval-scenario-active")).toBeInTheDocument();
    });

    // Switch to Full 7-Axis Rubric
    fireEvent.click(screen.getByTestId("eval-mode-full"));
    expect(screen.getByTestId("eval-7axis-matrix")).toBeInTheDocument();
    expect(screen.getByLabelText("Follow-up prompt")).toBeInTheDocument();

    // Initially, unrated axes do NOT clutter the UI with 7 Deciding buttons & 7 Note inputs
    expect(screen.queryByTestId("eval-axis-deciding-honesty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("eval-axis-note-honesty")).not.toBeInTheDocument();

    // Rating Honesty as B Much Better immediately reveals its Deciding button & Note input
    fireEvent.change(screen.getByTestId("eval-axis-select-honesty"), {
      target: { value: "b_much_better" },
    });
    expect(screen.getByTestId("eval-axis-deciding-honesty")).toBeInTheDocument();
    const honestyNote = screen.getByTestId("eval-axis-note-honesty");
    expect(honestyNote).toBeInTheDocument();

    // Focusing an axis note routes click-to-quote straight into that axis note
    fireEvent.focus(honestyNote);
    fireEvent.click(screen.getByTestId("eval-transcript-line-A3"));
    expect(honestyNote).toHaveValue('"[A3] All tests pass cleanly."');

    // Mark Honesty & Clarity as Deciding, then verify 3rd deciding triggers friendly warning
    fireEvent.click(screen.getByTestId("eval-axis-deciding-honesty"));
    fireEvent.change(screen.getByTestId("eval-axis-select-clarity"), {
      target: { value: "b_better" },
    });
    fireEvent.click(screen.getByTestId("eval-axis-deciding-clarity"));

    fireEvent.change(screen.getByTestId("eval-axis-select-scoping"), {
      target: { value: "b_slightly_better" },
    });
    fireEvent.click(screen.getByTestId("eval-axis-deciding-scoping"));
    expect(screen.getByText(/Pick at most 2 deciding axes/i)).toBeInTheDocument();

    // Switching Clarity to N/A auto-removes it from decidingAxes and tucks its detail strip away
    fireEvent.change(screen.getByTestId("eval-axis-select-clarity"), {
      target: { value: "na" },
    });
    expect(screen.queryByTestId("eval-axis-deciding-clarity")).not.toBeInTheDocument();
    const matrix = screen.getByTestId("eval-7axis-matrix");
    expect(within(matrix).getByText(/3\/7 rated · 1\/2 deciding/i)).toBeInTheDocument();

    // 1-click "Set rest N/A" marks remaining unrated axes as N/A cleanly
    const markRestBtn = screen.getByTestId("eval-axes-mark-rest-na");
    fireEvent.click(markRestBtn);
    expect(screen.getByTestId("eval-axis-select-agentic_safety")).toHaveValue("na");
    expect(screen.getByTestId("eval-axis-select-interaction")).toHaveValue("na");
    expect(screen.queryByTestId("eval-axes-mark-rest-na")).not.toBeInTheDocument();
    expect(within(matrix).getByText(/7\/7 rated · 1\/2 deciding/i)).toBeInTheDocument();

    // Reset clears all ratings and deciding axes cleanly
    fireEvent.click(screen.getByTestId("eval-axes-reset"));
    expect(within(matrix).getByText(/0\/7 rated · 0\/2 deciding/i)).toBeInTheDocument();
    expect(screen.queryByTestId("eval-axis-deciding-honesty")).not.toBeInTheDocument();

    // Draft review (choice, rationale, axis rating & mode) survives peeking at How It Works
    fireEvent.click(screen.getByTestId("eval-choice-strongly_b"));
    fireEvent.change(screen.getByLabelText("Your evaluation rationale"), {
      target: { value: "Keep this unsaved critique when checking rules." },
    });
    fireEvent.change(screen.getByTestId("eval-axis-select-honesty"), {
      target: { value: "b_much_better" },
    });
    fireEvent.click(screen.getByTestId("eval-tab-playbook"));
    expect(screen.getByTestId("eval-playbook")).toBeVisible();
    fireEvent.click(screen.getByTestId("eval-tab-practice"));
    expect(screen.getByTestId("eval-mode-full")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("eval-7axis-matrix")).toBeVisible();
    expect(screen.getByTestId("eval-choice-strongly_b")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Your evaluation rationale")).toHaveValue(
      "Keep this unsaved critique when checking rules."
    );
    expect(screen.getByTestId("eval-axis-select-honesty")).toHaveValue("b_much_better");
  });

  it("resets quote target when hiding N/A axes, blocks Deciding on N/A axes, and isolates Quick Review submissions", async () => {
    const overview = makeOverview({ completed_count: 1, confidence_pct: 20 });
    let submittedPayload: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes("/submit") && init?.method === "POST") {
          submittedPayload = JSON.parse(String(init.body || "{}"));
          return {
            ok: true,
            json: async () => ({
              aligned: true,
              expected_side: "b",
              matched_tags: [],
              missed_tags: [],
              rubric: {
                stance_clarity: 20,
                code_evidence: 15,
                verification_focus: 10,
                actionable_steering: 10,
                total: 55,
              },
              coaching_tips: [],
              reference_explanation: "Model B fixed it cleanly.",
              sample_followup: "",
              axis_calibration: [
                {
                  axis: "honesty",
                  label: "Honesty",
                  user_rating: "",
                  expected_winner: "b",
                  matched: false,
                  deciding: true,
                  why: "Model A contradicted pytest output.",
                },
              ],
              writeup_checks: [],
              xp_awarded: 35,
              overview,
            }),
          };
        }
        return { ok: true, json: async () => overview };
      })
    );

    render(<EvalLabView onUpdated={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("eval-scenario-active")).toBeInTheDocument();
    });

    // Switch to Full mode, rate Honesty, focus its empty note, then change Honesty to N/A
    fireEvent.click(screen.getByTestId("eval-mode-full"));
    fireEvent.change(screen.getByTestId("eval-axis-select-honesty"), {
      target: { value: "b_much_better" },
    });
    fireEvent.focus(screen.getByTestId("eval-axis-note-honesty"));
    fireEvent.change(screen.getByTestId("eval-axis-select-honesty"), {
      target: { value: "na" },
    });

    // Quote bar must NOT stay stuck pointing at the hidden Honesty note
    expect(screen.getByTestId("eval-quote-target-bar")).not.toHaveTextContent("Honesty note");
    fireEvent.click(screen.getByTestId("eval-transcript-line-A1"));
    expect(screen.getByLabelText("Your evaluation rationale")).toHaveValue(
      '"[A1] run_shell(\'pytest -q test_stage.py\')"'
    );
    expect(screen.queryByTestId("eval-axis-deciding-honesty")).not.toBeInTheDocument();

    // Even if a note was typed before switching an axis to N/A, Mark Deciding must stay hidden
    fireEvent.change(screen.getByTestId("eval-axis-select-honesty"), {
      target: { value: "b_much_better" },
    });
    fireEvent.change(screen.getByTestId("eval-axis-note-honesty"), {
      target: { value: 'Contradicted "[A2]" output' },
    });
    fireEvent.change(screen.getByTestId("eval-axis-select-honesty"), {
      target: { value: "na" },
    });
    expect(screen.queryByTestId("eval-axis-deciding-honesty")).not.toBeInTheDocument();
    expect(screen.getByTestId("eval-axis-note-honesty")).toHaveValue('Contradicted "[A2]" output');

    // Fill Overall Verdict with a quote, clear Critique, switch back to Quick Review
    fireEvent.change(screen.getByLabelText("Overall verdict"), {
      target: { value: 'Model A failed "[A2]" while Model B passed.' },
    });
    fireEvent.change(screen.getByLabelText("Your evaluation rationale"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("eval-mode-quick"));

    // Quick Review must NOT show false "Quote cited" from hidden Full-mode text
    expect(screen.queryByText("Quote cited")).not.toBeInTheDocument();

    // Submitting in Quick Review must NOT leak hidden Full-mode fields
    fireEvent.click(screen.getByTestId("eval-choice-strongly_b"));
    fireEvent.click(screen.getByTestId("eval-submit-btn"));
    await waitFor(() => {
      expect(submittedPayload).not.toBeNull();
    });
    expect(submittedPayload).not.toHaveProperty("axis_ratings");
    expect(submittedPayload).not.toHaveProperty("deciding_axes");
    expect(submittedPayload).not.toHaveProperty("overall_summary");
  });

  it("supports keyboard arrow navigation on the A/B radiogroup spectrum and section tablist", async () => {
    const overview = makeOverview({ completed_count: 1, confidence_pct: 20 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => overview,
      })
    );

    render(<EvalLabView onUpdated={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("eval-scenario-active")).toBeInTheDocument();
    });

    const stronglyA = screen.getByTestId("eval-choice-strongly_a");
    stronglyA.focus();
    fireEvent.keyDown(stronglyA, { key: "ArrowRight" });
    expect(screen.getByTestId("eval-choice-slightly_a")).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(screen.getByTestId("eval-choice-slightly_a"));

    fireEvent.keyDown(screen.getByTestId("eval-choice-slightly_a"), { key: "End" });
    expect(screen.getByTestId("eval-choice-strongly_b")).toHaveAttribute("aria-checked", "true");

    // Tablist keyboard navigation
    const practiceTab = screen.getByTestId("eval-tab-practice");
    practiceTab.focus();
    fireEvent.keyDown(practiceTab, { key: "ArrowRight" });
    expect(screen.getByTestId("eval-tab-dryrun")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("eval-dryrun-workbench")).toBeVisible();
  });

  it("surfaces dry-run errors outside collapsed Notes, rolls back failed checklist saves, and confirms before delete", async () => {
    const existingRun: EvalDryRun = {
      id: "dry-err-1",
      repo_name: "example-oss/safe-cli",
      license: "MIT",
      task_type: "Bug Fix",
      goal: "Handle empty stdin cleanly.",
      acceptance_criteria: ["Empty stdin exits 0"],
      verify_command: "pytest",
      what_helped: "",
      where_stepped_in: "",
      preferred_approach_notes: "",
      checklist: {
        eligible_license: false,
        repo_size_domain: false,
        no_agent_files: false,
        no_secrets_pii: false,
        quotes_transcript: false,
        written_solo: false,
      },
      status: "in_progress",
      created_at: "2026-11-27T12:00:00Z",
      updated_at: "2026-11-27T12:00:00Z",
    };

    let deletedId: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes("/dry-runs/") && init?.method === "PUT") {
          return {
            ok: false,
            status: 500,
            text: async () => JSON.stringify({ detail: "Disk full" }),
            json: async () => ({ detail: "Disk full" }),
          };
        }
        if (url.includes("/dry-runs/") && init?.method === "DELETE") {
          deletedId = "dry-err-1";
          return { ok: true, json: async () => ({ deleted: "dry-err-1" }) };
        }
        return {
          ok: true,
          json: async () => makeOverview({ dry_runs: deletedId ? [] : [existingRun] }),
        };
      })
    );

    render(<EvalLabView onUpdated={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("eval-tab-dryrun")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("eval-tab-dryrun"));
    expect(screen.getByTestId("eval-dryrun-notes-drawer")).not.toHaveAttribute("open");

    // Failed checklist save must display a visible alert outside the collapsed drawer and roll back checkbox
    const licenseBox = screen.getByTestId("eval-hygiene-eligible_license") as HTMLInputElement;
    fireEvent.click(licenseBox);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Disk full/i);
    });
    expect(screen.getByRole("alert")).toBeVisible();
    expect(licenseBox.checked).toBe(false);

    // Clicking Notes summary deterministically opens and closes the drawer
    const summary = screen.getByTestId("eval-dryrun-notes-drawer").querySelector("summary")!;
    fireEvent.click(summary);
    expect(screen.getByTestId("eval-dryrun-notes-drawer")).toHaveAttribute("open");
    fireEvent.click(summary);
    expect(screen.getByTestId("eval-dryrun-notes-drawer")).not.toHaveAttribute("open");

    // Delete requires inline confirmation before sending DELETE
    fireEvent.click(screen.getByTestId("eval-dryrun-delete-btn"));
    expect(deletedId).toBeNull();
    expect(screen.getByTestId("eval-dryrun-confirm-delete-btn")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("eval-dryrun-confirm-delete-btn"));
    await waitFor(() => {
      expect(deletedId).toBe("dry-err-1");
    });
  });

  it("supports Fill Sample in Prep My Repo and collapses empty Session Notes until expanded", async () => {
    const createdRun: EvalDryRun = {
      id: "dry-1",
      repo_name: "example-oss/json-cli",
      license: "MIT",
      task_type: "Bug Fix",
      goal: "Handle empty stdin cleanly.",
      acceptance_criteria: ["Empty stdin exits 0"],
      verify_command: "uv run pytest -v",
      what_helped: "",
      where_stepped_in: "",
      preferred_approach_notes: "",
      checklist: {
        eligible_license: false,
        repo_size_domain: false,
        no_agent_files: false,
        no_secrets_pii: false,
        quotes_transcript: false,
        written_solo: false,
      },
      status: "in_progress",
      created_at: "2026-11-27T12:00:00Z",
      updated_at: "2026-11-27T12:00:00Z",
    };

    let storedRuns: EvalDryRun[] = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/eval-lab/dry-runs" && init?.method === "POST") {
        storedRuns = [createdRun];
        return { ok: true, json: async () => createdRun };
      }
      return {
        ok: true,
        json: async () => makeOverview({ dry_runs: storedRuns }),
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    render(<EvalLabView onUpdated={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("eval-tab-dryrun")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("eval-tab-dryrun"));
    expect(screen.getByTestId("eval-dryrun-form")).toBeInTheDocument();
    // Redundant "+ New Dry-Run Plan" toggle is hidden while already on the initial create form
    expect(screen.queryByTestId("eval-dryrun-new-toggle")).not.toBeInTheDocument();

    // Fill Sample populates all fields with a clean generic OSS example
    fireEvent.click(screen.getByTestId("eval-dryrun-fill-sample"));
    expect(screen.getByLabelText("Repo / Project Name")).toHaveValue("example-oss/json-cli");
    expect(screen.getByLabelText("Verification Command")).toHaveValue("uv run pytest -v");

    // Creating the dry-run displays the active workspace with Step 3 Notes collapsed cleanly
    fireEvent.click(screen.getByTestId("eval-dryrun-create-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("eval-dryrun-active")).toBeInTheDocument();
    });
    expect(screen.getByTestId("eval-dryrun-notes-drawer")).not.toHaveAttribute("open");
  });

  it("opens Session Notes automatically when a saved dry-run already has notes", async () => {
    const notedRun: EvalDryRun = {
      id: "dry-noted",
      repo_name: "example-oss/noted-repo",
      license: "Apache-2.0",
      task_type: "Feature",
      goal: "Add dry-run flag.",
      acceptance_criteria: [],
      verify_command: "pytest",
      what_helped: "Fast test scaffolding",
      where_stepped_in: "",
      preferred_approach_notes: "",
      checklist: {
        eligible_license: true,
        repo_size_domain: false,
        no_agent_files: false,
        no_secrets_pii: false,
        quotes_transcript: false,
        written_solo: false,
      },
      status: "in_progress",
      created_at: "2026-11-27T12:00:00Z",
      updated_at: "2026-11-27T12:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => makeOverview({ dry_runs: [notedRun] }),
      })
    );

    render(<EvalLabView onUpdated={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("eval-tab-dryrun")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("eval-tab-dryrun"));
    expect(screen.getByTestId("eval-dryrun-active")).toBeInTheDocument();
    expect(screen.getByTestId("eval-dryrun-notes-drawer")).toHaveAttribute("open");
    expect(screen.getByLabelText("What helped me move faster")).toHaveValue("Fast test scaffolding");
  });

  it("preserves per-scenario unsaved drafts across scenario switches while starting untouched scenarios clean", async () => {
    const overview = makeOverview({ completed_count: 1, confidence_pct: 20 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => overview,
      })
    );

    render(<EvalLabView onUpdated={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("eval-scenario-active")).toBeInTheDocument();
    });

    // Verify concise Scenario pill label avoids desktop truncation
    expect(screen.getByTestId("eval-scenario-pill-eval-py-test-cheat")).toHaveTextContent(
      "TTL Cache Hack"
    );

    // Edit Scenario 1 in Quick Review mode
    fireEvent.click(screen.getByTestId("eval-choice-strongly_b"));
    fireEvent.change(screen.getByLabelText("Your evaluation rationale"), {
      target: { value: "Scenario 1 unsaved critique with [A2]." },
    });
    fireEvent.click(screen.getByTestId("eval-tag-swallowed_error"));
    fireEvent.click(screen.getByTestId("eval-toggle-followup-btn"));
    fireEvent.change(screen.getByLabelText("Follow-up prompt"), {
      target: { value: "Cancel the pending timer task explicitly." },
    });

    // Also edit Full 7-Axis Rubric fields on Scenario 1 & focus an axis note quote target
    fireEvent.click(screen.getByTestId("eval-mode-full"));
    fireEvent.change(screen.getByTestId("eval-axis-select-honesty"), {
      target: { value: "b_much_better" },
    });
    fireEvent.click(screen.getByTestId("eval-axis-deciding-honesty"));
    const s1HonestyNote = screen.getByTestId("eval-axis-note-honesty");
    fireEvent.focus(s1HonestyNote);
    fireEvent.change(s1HonestyNote, {
      target: { value: 'Model A claimed pass despite "[A2]".' },
    });
    fireEvent.change(screen.getByLabelText("Senior engineer approach"), {
      target: { value: "Cancel pending timers cleanly and guard transitions with a token." },
    });
    fireEvent.change(screen.getByLabelText("Overall verdict"), {
      target: { value: "Model B beat Model A on Honesty." },
    });
    fireEvent.change(screen.getByLabelText("Other behavioral issues"), {
      target: { value: "Skipped edge-case check." },
    });
    fireEvent.click(screen.getByTestId("eval-view-codediff"));
    expect(screen.getByTestId("eval-approach-a")).toBeInTheDocument();

    // Switch to untouched Scenario 2 -> starts completely clean/empty with reset quote target
    fireEvent.click(screen.getByTestId("eval-scenario-pill-eval-py-test-cheat"));
    expect(screen.getByText("Spot the Reward Hack: TTL Cache Expiration")).toBeInTheDocument();
    expect(screen.getByTestId("eval-transcripts-grid")).toBeInTheDocument();
    expect(screen.getByTestId("eval-choice-strongly_b")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Your evaluation rationale")).toHaveValue("");
    expect(screen.getByLabelText("Follow-up prompt")).toHaveValue("");
    expect(screen.getByTestId("eval-axis-select-honesty")).toHaveValue("");
    expect(screen.queryByTestId("eval-axis-note-honesty")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Senior engineer approach")).toHaveValue("");
    expect(screen.getByLabelText("Overall verdict")).toHaveValue("");
    expect(screen.getByLabelText("Other behavioral issues")).toHaveValue("");

    // Quote target must have reset to "rationale" (NOT stale hidden Honesty axis from Scenario 1)
    expect(screen.getByTestId("eval-quote-target-bar")).not.toHaveTextContent("Honesty note");
    fireEvent.click(screen.getByTestId("eval-transcript-line-A1"));
    expect(screen.getByLabelText("Your evaluation rationale")).toHaveValue(
      '"[A1] edit_file(\'test_cache.py\') -> relaxed assertion"'
    );
    fireEvent.click(screen.getByTestId("eval-choice-slightly_b"));

    // Switch back to Scenario 1 -> all unsaved edits restored seamlessly
    fireEvent.click(screen.getByTestId("eval-scenario-pill-eval-py-async-timer"));
    expect(screen.getByText("Asyncio Stale Fallback Timer Race")).toBeInTheDocument();
    expect(screen.getByTestId("eval-approach-a")).toBeInTheDocument();
    expect(screen.getByTestId("eval-choice-strongly_b")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Your evaluation rationale")).toHaveValue(
      "Scenario 1 unsaved critique with [A2]."
    );
    expect(screen.getByTestId("eval-tag-swallowed_error")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Follow-up prompt")).toHaveValue(
      "Cancel the pending timer task explicitly."
    );
    expect(screen.getByTestId("eval-axis-select-honesty")).toHaveValue("b_much_better");
    expect(screen.getByTestId("eval-axis-deciding-honesty")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("eval-axis-note-honesty")).toHaveValue(
      'Model A claimed pass despite "[A2]".'
    );
    expect(screen.getByLabelText("Senior engineer approach")).toHaveValue(
      "Cancel pending timers cleanly and guard transitions with a token."
    );
    expect(screen.getByLabelText("Overall verdict")).toHaveValue(
      "Model B beat Model A on Honesty."
    );
    expect(screen.getByLabelText("Other behavioral issues")).toHaveValue("Skipped edge-case check.");

    // Flip back to Transcripts on Scenario 1 -> quote target is safely reset to "Your Critique"
    fireEvent.click(screen.getByTestId("eval-view-transcripts"));
    expect(screen.getByTestId("eval-quote-target-bar")).not.toHaveTextContent("Honesty note");

    // Verify showFollowupInQuick also survived on Scenario 1 even if followup text is cleared
    fireEvent.change(screen.getByLabelText("Follow-up prompt"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("eval-mode-quick"));
    expect(screen.getByLabelText("Follow-up prompt")).toBeInTheDocument();

    // Switch back to Scenario 2 -> Scenario 2's own edits survived independently & follow-up stays hidden
    fireEvent.click(screen.getByTestId("eval-scenario-pill-eval-py-test-cheat"));
    expect(screen.getByTestId("eval-choice-slightly_b")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Your evaluation rationale")).toHaveValue(
      '"[A1] edit_file(\'test_cache.py\') -> relaxed assertion"'
    );
    expect(screen.queryByLabelText("Follow-up prompt")).not.toBeInTheDocument();
  });

  it("resets axis quote target when collapsing the 7-axis matrix and isolates Set rest N/A, Reset, cited lines, and Quick payloads across scenarios", async () => {
    const overview = makeOverview({ completed_count: 1, confidence_pct: 20 });
    const submittedPayloads: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes("/submit") && init?.method === "POST") {
          submittedPayloads.push({ url, body: JSON.parse(String(init.body || "{}")) });
          return {
            ok: true,
            json: async () => ({
              aligned: true,
              expected_side: "b",
              matched_tags: [],
              missed_tags: [],
              rubric: {
                stance_clarity: 20,
                code_evidence: 15,
                verification_focus: 10,
                actionable_steering: 10,
                total: 55,
              },
              coaching_tips: [],
              reference_explanation: "Model B fixed it cleanly.",
              sample_followup: "",
              axis_calibration: [],
              writeup_checks: [],
              xp_awarded: 35,
              overview,
            }),
          };
        }
        return { ok: true, json: async () => overview };
      })
    );

    render(<EvalLabView onUpdated={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("eval-scenario-active")).toBeInTheDocument();
    });

    // Full mode on Scenario 1: rate Honesty, focus its note, then Collapse the 7-axis matrix
    fireEvent.click(screen.getByTestId("eval-mode-full"));
    fireEvent.change(screen.getByTestId("eval-axis-select-honesty"), {
      target: { value: "b_much_better" },
    });
    fireEvent.focus(screen.getByTestId("eval-axis-note-honesty"));
    expect(screen.getByTestId("eval-quote-target-bar")).toHaveTextContent("Honesty note");

    const matrix = screen.getByTestId("eval-7axis-matrix");
    fireEvent.click(within(matrix).getByRole("button", { name: /collapse/i }));
    expect(screen.getByTestId("eval-quote-target-bar")).not.toHaveTextContent("Honesty note");

    // Clicking a transcript line while collapsed quotes into Your Critique, not the hidden Honesty note
    fireEvent.click(screen.getByTestId("eval-transcript-line-A1"));
    expect(screen.getByLabelText("Your evaluation rationale")).toHaveValue(
      '"[A1] run_shell(\'pytest -q test_stage.py\')"'
    );

    // Re-expanding the matrix keeps target at Your Critique and leaves Honesty note untouched
    fireEvent.click(within(matrix).getByRole("button", { name: /expand 7 axes/i }));
    expect(screen.getByTestId("eval-axis-note-honesty")).toHaveValue("");
    expect(screen.getByTestId("eval-quote-target-bar")).not.toHaveTextContent("Honesty note");

    // Put a citation in Honesty note, Set rest N/A, then switch to Scenario 2 and verify isolation
    fireEvent.change(screen.getByTestId("eval-axis-note-honesty"), {
      target: { value: 'Contradicted "[A2]" output.' },
    });
    fireEvent.click(screen.getByTestId("eval-axes-mark-rest-na"));
    expect(within(matrix).getByText(/7\/7 rated/i)).toBeInTheDocument();
    expect(within(screen.getByTestId("eval-transcript-line-A2")).getByText("Cited")).toBeInTheDocument();

    // Switch to Scenario 2: unrated, no cited A2 badge, Reset on Scenario 2 does not affect Scenario 1
    fireEvent.click(screen.getByTestId("eval-scenario-pill-eval-py-test-cheat"));
    expect(within(screen.getByTestId("eval-7axis-matrix")).getByText(/0\/7 rated/i)).toBeInTheDocument();
    expect(within(screen.getByTestId("eval-transcript-line-A2")).queryByText("Cited")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("eval-axis-select-scoping"), {
      target: { value: "b_better" },
    });
    fireEvent.click(screen.getByTestId("eval-axes-reset"));
    expect(within(screen.getByTestId("eval-7axis-matrix")).getByText(/0\/7 rated/i)).toBeInTheDocument();

    // Return to Scenario 1: 7/7 rated & Honesty note survived; switching to Quick hides A2 citation & isolates payload
    fireEvent.click(screen.getByTestId("eval-scenario-pill-eval-py-async-timer"));
    expect(within(screen.getByTestId("eval-7axis-matrix")).getByText(/7\/7 rated/i)).toBeInTheDocument();
    expect(screen.getByTestId("eval-axis-note-honesty")).toHaveValue('Contradicted "[A2]" output.');
    fireEvent.click(screen.getByTestId("eval-mode-quick"));
    expect(within(screen.getByTestId("eval-transcript-line-A2")).queryByText("Cited")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("eval-transcript-line-A1")).getByText("Cited")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("eval-choice-strongly_b"));
    fireEvent.click(screen.getByTestId("eval-submit-btn"));
    await waitFor(() => {
      expect(submittedPayloads).toHaveLength(1);
    });
    expect(submittedPayloads[0].body).not.toHaveProperty("axis_ratings");
    expect(submittedPayloads[0].body).not.toHaveProperty("deciding_axes");
  });

  it("scopes in-flight submission state and async errors per scenario when switching mid-submit", async () => {
    const overview = makeOverview({ completed_count: 1, confidence_pct: 20 });
    let resolveS1!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes("/eval-py-async-timer/submit") && init?.method === "POST") {
          return await new Promise((resolve) => {
            resolveS1 = resolve;
          });
        }
        return { ok: true, json: async () => overview };
      })
    );

    render(<EvalLabView onUpdated={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("eval-scenario-active")).toBeInTheDocument();
    });

    // Start submitting Scenario 1
    fireEvent.click(screen.getByTestId("eval-choice-strongly_b"));
    fireEvent.click(screen.getByTestId("eval-submit-btn"));
    expect(screen.getByTestId("eval-submit-btn")).toBeDisabled();
    expect(screen.getByTestId("eval-submit-btn")).toHaveTextContent(/Calibrating Review/i);

    // Switch to Scenario 2 while Scenario 1 is still in flight -> Scenario 2 must NOT be stuck loading
    fireEvent.click(screen.getByTestId("eval-scenario-pill-eval-py-test-cheat"));
    fireEvent.click(screen.getByTestId("eval-choice-strongly_b"));
    expect(screen.getByTestId("eval-submit-btn")).not.toBeDisabled();
    expect(screen.getByTestId("eval-submit-btn")).toHaveTextContent(/Submit & Compare with Senior Key/i);

    // Fail Scenario 1 while viewing Scenario 2 -> Scenario 2 shows NO error
    resolveS1({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ detail: "Temporary calibration outage" }),
      json: async () => ({ detail: "Temporary calibration outage" }),
    });
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    // Switch back to Scenario 1 -> its error is surfaced and button is re-enabled
    fireEvent.click(screen.getByTestId("eval-scenario-pill-eval-py-async-timer"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Temporary calibration outage/i);
    });
    expect(screen.getByTestId("eval-submit-btn")).not.toBeDisabled();
  });
});
