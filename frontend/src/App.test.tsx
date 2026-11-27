import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { App } from "./App";
import { DashboardView } from "./components/DashboardView";
import { ActivityCard } from "./components/ActivityWidgets";
import { CommandPalette } from "./components/CommandPalette";
import { SprintView } from "./components/SprintView";
import type { Activity, DashboardData } from "./types";

const mockDashboard: DashboardData = {
  total_xp: 240,
  level: 2,
  xp_in_level: 140,
  xp_for_next: 183,
  streak_days: 3,
  today_xp: 60,
  daily_xp_target: 100,
  completed_activities: 4,
  total_activities: 30,
  rank_title: "Buffer Apprentice",
  achievements: [
    {
      slug: "first_quest",
      name: "First Quest",
      description: "Complete your first DevQuest activity.",
      icon: "sparkles",
      bonus_xp: 25,
      unlocked: true,
      unlocked_at: "2026-11-26T12:00:00Z",
    },
    {
      slug: "bug_hunter",
      name: "Bug Hunter",
      description: "Complete a Debugging (pdb/Bash) lab.",
      icon: "bug",
      bonus_xp: 35,
      unlocked: false,
      unlocked_at: null,
    },
  ],
  daily_warmup: [
    {
      activity_id: "dbg-101-pdb-sim",
      title: "Interactive Debugger Simulation: Step Through buggy_total()",
      tech_slug: "debugging",
      module_id: "debugging-pdb-101",
      activity_type: "pdb_sim",
      xp_reward: 30,
      reason: "Fresh Tech",
    },
  ],
  technologies: [
    {
      slug: "python",
      name: "Python",
      category: "Core Languages",
      color: "#3776AB",
      icon: "code",
      xp: 120,
      level: 2,
      completed_activities: 2,
      total_activities: 5,
      mastery_pct: 31.6,
      freshness: "fresh",
      last_practiced_at: new Date().toISOString(),
    },
    {
      slug: "neovim",
      name: "Neovim",
      category: "Dev Tools & Workflow",
      color: "#57A143",
      icon: "terminal",
      xp: 75,
      level: 2,
      completed_activities: 1,
      total_activities: 4,
      mastery_pct: 19.8,
      freshness: "fresh",
      last_practiced_at: new Date().toISOString(),
    },
  ],
  due_reviews: [],
  recent_xp: [],
  daily_totals: {},
  external_profiles: [],
  recommended_next: [
    {
      activity_id: "py-101-read-check",
      title: "Participation Activity: Eager vs Lazy Memory",
      activity_type: "read_check",
      xp_reward: 20,
      tech_slug: "python",
      module_id: "python-comprehensions-101",
      module_title: "Pythonic Iteration",
      kind: "zybooks",
      estimated_minutes: 6,
    },
  ],
};

describe("DevQuest UI Components", () => {
  let memStorage: Record<string, string>;

  beforeEach(() => {
    vi.restoreAllMocks();
    memStorage = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k in memStorage ? memStorage[k] : null),
      setItem: (k: string, v: string) => {
        memStorage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete memStorage[k];
      },
      clear: () => {
        memStorage = {};
      },
    });
    document.documentElement.removeAttribute("data-theme");
    window.history.replaceState({}, "", "/");
  });

  it("keeps practice and sprint actions visible and reveals progress details on demand", () => {
    const onSelectTech = vi.fn();
    const onOpenModule = vi.fn();
    const onGoToForge = vi.fn();
    const onStartSprint = vi.fn();
    render(
      <DashboardView
        data={mockDashboard}
        onSelectTech={onSelectTech}
        onOpenModule={onOpenModule}
        onGoToForge={onGoToForge}
        onStartSprint={onStartSprint}
      />
    );
    expect(screen.getByTestId("player-rank-badge")).toHaveTextContent("Buffer Apprentice");
    fireEvent.click(screen.getByRole("button", { name: /start practice/i }));
    expect(onOpenModule).toHaveBeenCalledWith("debugging-pdb-101");

    for (const duration of [2, 5, 10]) {
      fireEvent.click(screen.getByTestId(`quick-sprint-${duration}`));
      expect(onStartSprint).toHaveBeenLastCalledWith(duration);
    }

    const achievements = screen.getByTestId("achievements-shelf");
    expect(achievements).not.toHaveAttribute("open");
    expect(achievements.querySelector("summary")).toHaveTextContent(/1\s*\/\s*2 unlocked/i);
    fireEvent.click(achievements.querySelector("summary")!);
    expect(screen.getByTestId("achievement-first_quest")).toBeVisible();
    expect(screen.getByTestId("achievement-first_quest")).toHaveClass("unlocked");
    expect(screen.getByTestId("achievement-bug_hunter")).toHaveClass("locked");

    const tracks = screen.getByTestId("learning-tracks");
    expect(tracks).not.toHaveAttribute("open");
    fireEvent.click(tracks.querySelector("summary")!);
    const python = screen.getByTestId("tech-card-python");
    expect(python).toBeVisible();
    expect(python).toHaveTextContent("32%");
    fireEvent.click(python);
    expect(onSelectTech).toHaveBeenCalledWith("python");
    fireEvent.click(screen.getByRole("button", { name: /generate.*module/i }));
    expect(onGoToForge).toHaveBeenCalledOnce();
  });

  it("offers a fallback drill when warmups are empty and opens an outstanding review", () => {
    const onOpenModule = vi.fn();
    const review = {
      activity_id: "review-1", due_at: "2026-11-26", interval_days: 1, title: "Window functions",
      tech_slug: "sql", module_id: "sql-window-functions-201", activity_type: "read_check",
    };
    const alternative = {
      ...mockDashboard.recommended_next[0],
      activity_id: "py-02-read-check",
      module_id: "py-02-control-flow",
      title: "Participation Activity: A branch with `elif`",
    };
    render(
      <DashboardView
        data={{
          ...mockDashboard,
          daily_warmup: [],
          recommended_next: [...mockDashboard.recommended_next, alternative],
          due_reviews: [review],
        }}
        onSelectTech={vi.fn()}
        onOpenModule={onOpenModule}
        onGoToForge={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /start practice/i }));
    expect(onOpenModule).toHaveBeenLastCalledWith("python-comprehensions-101");
    expect(screen.getByTestId("daily-warmup-list")).not.toHaveTextContent("`elif`");
    fireEvent.click(screen.getByText(/More practice/));
    fireEvent.click(screen.getByRole("button", { name: /a branch with elif/i }));
    expect(onOpenModule).toHaveBeenLastCalledWith("py-02-control-flow");
    fireEvent.click(screen.getByRole("button", { name: /window functions/i }));
    expect(onOpenModule).toHaveBeenLastCalledWith("sql-window-functions-201");
  });

  it("grades a zyBooks read_check activity and displays XP feedback", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        activity_id: "py-101-read-check",
        tech_slug: "python",
        tech_name: "Python",
        passed: true,
        score: 1,
        output: "Correct! Generator expressions use O(1) memory.",
        first_time: true,
        xp_awarded: 20,
        par_bonus: 0,
        tech_xp: 20,
        tech_mastery_pct: 15,
        freshness: "fresh",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const activity: Activity = {
      id: "py-101-read-check",
      module_id: "python-comprehensions-101",
      tech_slug: "python",
      title: "Participation Activity: Eager vs Lazy Memory",
      activity_type: "read_check",
      grader_type: "browser",
      order_index: 0,
      xp_reward: 20,
      par_keystrokes: null,
      spec: {
        question: "Which uses O(1) memory?",
        options: ["list comp", "generator expr"],
        correct_index: 1,
      },
    };

    const onGraded = vi.fn();
    render(<ActivityCard activity={activity} onGraded={onGraded} />);
    fireEvent.click(screen.getByText("generator expr"));
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));

    await waitFor(() => {
      expect(screen.getByTestId("feedback-py-101-read-check")).toHaveTextContent("+20 XP");
    });
    expect(onGraded).toHaveBeenCalledTimes(1);
  });

  it("CommandPalette searches /api/search, supports keyboard navigation, and runs selected module", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: "pdb",
        technologies: [
          { slug: "debugging", name: "Debugging", category: "Dev Tools & Workflow", color: "#f7768e", mastery_pct: 10 },
        ],
        modules: [
          {
            id: "debugging-pdb-101",
            tech_slug: "debugging",
            title: "Python Debugger (pdb & breakpoint())",
            subtitle: "Step live through frames",
            kind: "zybooks",
          },
        ],
        activities: [],
        packs: [],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const onClose = vi.fn();
    const onOpenModule = vi.fn();
    const onChangeTheme = vi.fn();

    render(
      <CommandPalette
        open={true}
        onClose={onClose}
        currentTheme="frutiger-aero"
        technologies={mockDashboard.technologies}
        onNavigateTab={vi.fn()}
        onSelectTech={vi.fn()}
        onOpenModule={onOpenModule}
        onChangeTheme={onChangeTheme}
        onSyncGithub={vi.fn()}
      />
    );

    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "pdb" } });

    await waitFor(() => {
      expect(screen.getByTestId("palette-item-mod-debugging-pdb-101")).toBeInTheDocument();
    });

    // Press Enter on the first selected module hit
    fireEvent.keyDown(screen.getByTestId("command-palette"), { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenModule).toHaveBeenCalledWith("debugging-pdb-101");
  });

  it("PdbSim executes n, p total, w commands, tracks objectives, and submits for XP", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        activity_id: "dbg-101-pdb-sim",
        tech_slug: "debugging",
        tech_name: "Debugging",
        passed: true,
        score: 1,
        output: "Stepping with n and inspecting p total exposed total = n.",
        first_time: true,
        xp_awarded: 30,
        par_bonus: 0,
        tech_xp: 65,
        tech_mastery_pct: 25,
        freshness: "fresh",
        unlocked_achievements: [{ slug: "bug_hunter", name: "Bug Hunter", icon: "bug", bonus_xp: 35 }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const pdbActivity: Activity = {
      id: "dbg-101-pdb-sim",
      module_id: "debugging-pdb-101",
      tech_slug: "debugging",
      title: "Interactive Debugger Simulation: Step Through buggy_total()",
      activity_type: "pdb_sim",
      grader_type: "browser",
      order_index: 3,
      xp_reward: 30,
      par_keystrokes: null,
      spec: {
        prompt: "Step with n, inspect total with p total, and print stack with w.",
        code: ["def buggy_total(nums):", "    total = 0", "    for n in nums:", "        total = n", "    return total"],
        trace: [
          {
            line: 3,
            func: "buggy_total",
            locals: { nums: "[10, 20]", total: "0" },
            stack: ["<module>()", "buggy_total() at eval.py:3"],
          },
          {
            line: 4,
            func: "buggy_total",
            locals: { nums: "[10, 20]", total: "10", n: "10" },
            stack: ["<module>()", "buggy_total() at eval.py:4"],
          },
        ],
        required_actions: ["step", "inspect_var:total", "stack"],
      },
    };

    const onGraded = vi.fn();
    render(<ActivityCard activity={pdbActivity} onGraded={onGraded} />);

    const input = screen.getByTestId("pdb-input-dbg-101-pdb-sim");
    const runBtn = screen.getByTestId("pdb-run-dbg-101-pdb-sim");

    fireEvent.change(input, { target: { value: "n" } });
    fireEvent.click(runBtn);
    expect(screen.getByTestId("pdb-obj-step")).toHaveClass("done");

    fireEvent.change(input, { target: { value: "p total" } });
    fireEvent.click(runBtn);
    expect(screen.getByTestId("pdb-obj-inspect_var:total")).toHaveClass("done");

    fireEvent.change(input, { target: { value: "w" } });
    fireEvent.click(runBtn);
    expect(screen.getByTestId("pdb-obj-stack")).toHaveClass("done");

    await waitFor(() => {
      expect(screen.getByTestId("feedback-dbg-101-pdb-sim")).toHaveTextContent("+30 XP");
    });
    expect(onGraded).toHaveBeenCalledTimes(1);
  });

  it("SprintView starts a 2-min sprint, builds combo multiplier across drills, and awards bonus XP", async () => {
    const sprintActivities: Activity[] = [
      {
        id: "sprint-q1",
        module_id: "python-comprehensions-101",
        tech_slug: "python",
        title: "Drill 1",
        activity_type: "read_check",
        grader_type: "browser",
        order_index: 0,
        xp_reward: 20,
        par_keystrokes: null,
        spec: { question: "Pick A", options: ["Alpha", "Beta"], correct_index: 0 },
      },
      {
        id: "sprint-q2",
        module_id: "sql-joins-aggregates-101",
        tech_slug: "sql",
        title: "Drill 2",
        activity_type: "read_check",
        grader_type: "browser",
        order_index: 0,
        xp_reward: 20,
        par_keystrokes: null,
        spec: { question: "Pick B", options: ["One", "Two"], correct_index: 1 },
      },
    ];

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/sprint/start") {
        return { ok: true, json: async () => ({ duration_minutes: 2, activities: sprintActivities }) };
      }
      if (url.includes("/submit")) {
        const actId = url.includes("sprint-q1") ? "sprint-q1" : "sprint-q2";
        return {
          ok: true,
          json: async () => ({
            activity_id: actId,
            tech_slug: "python",
            tech_name: "Python",
            passed: true,
            score: 1,
            output: "Correct!",
            first_time: true,
            xp_awarded: 20,
            par_bonus: 0,
            tech_xp: 40,
            tech_mastery_pct: 20,
            freshness: "fresh",
          }),
        };
      }
      if (url === "/api/sprint/complete") {
        return {
          ok: true,
          json: async () => ({ bonus_xp: 30, unlocked_achievements: [], completed_count: 2, max_combo: 2 }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", mockFetch);

    const onSprintCompleted = vi.fn();
    render(
      <SprintView
        technologies={mockDashboard.technologies}
        liveOutcome={null}
        onSprintCompleted={onSprintCompleted}
        onBackToDashboard={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("sprint-dur-2"));
    fireEvent.click(screen.getByTestId("sprint-start-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("sprint-combo")).toHaveTextContent("1x Combo");
    });

    // Clear Drill 1
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    await waitFor(() => {
      expect(screen.getByTestId("sprint-combo")).toHaveTextContent("1.5x Combo");
    });
    fireEvent.click(screen.getByTestId("sprint-next-btn"));

    // Clear Drill 2
    await waitFor(() => {
      expect(screen.getByText("Two")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Two"));
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    await waitFor(() => {
      expect(screen.getByTestId("sprint-combo")).toHaveTextContent("2x Combo");
    });

    // Finish Sprint & Claim Combo Bonus
    fireEvent.click(screen.getByTestId("sprint-next-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("sprint-summary")).toBeInTheDocument();
      expect(screen.getByTestId("sprint-bonus-xp")).toHaveTextContent("+30 XP");
    });
    expect(onSprintCompleted).toHaveBeenCalledTimes(1);
  });

  it("App initializes default frutiger-aero theme and switches themes cleanly via HUD switcher", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockDashboard,
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal(
      "WebSocket",
      class {
        close() {}
      }
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("theme-switcher")).toBeInTheDocument();
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("frutiger-aero");

    const switcher = screen.getByTestId("theme-switcher") as HTMLSelectElement;
    expect(switcher.options[0].value).toBe("frutiger-aero");
    expect(switcher.options[1].value).toBe("emerald-3d");

    fireEvent.change(switcher, { target: { value: "emerald-3d" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("emerald-3d");
    expect(window.localStorage.getItem("devquest_theme")).toBe("emerald-3d");

    fireEvent.change(switcher, { target: { value: "catppuccin" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("catppuccin");

    fireEvent.change(switcher, { target: { value: "gruvbox" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("gruvbox");

    // Verify Living 3D Aero / Calm / Static motion mode cycling & persistence
    const backdrop = screen.getByTestId("ambient-backdrop");
    expect(document.documentElement.getAttribute("data-motion")).toBe("full");
    expect(backdrop).toHaveAttribute("data-mode", "full");

    const motionBtn = screen.getByTestId("motion-toggle");
    fireEvent.click(motionBtn);
    expect(document.documentElement.getAttribute("data-motion")).toBe("subtle");
    expect(window.localStorage.getItem("devquest_motion")).toBe("subtle");
    expect(backdrop).toHaveAttribute("data-mode", "subtle");

    fireEvent.click(motionBtn);
    expect(document.documentElement.getAttribute("data-motion")).toBe("off");
    expect(window.localStorage.getItem("devquest_motion")).toBe("off");

    fireEvent.click(motionBtn);
    expect(document.documentElement.getAttribute("data-motion")).toBe("full");
    expect(window.localStorage.getItem("devquest_motion")).toBe("full");
  });
});
