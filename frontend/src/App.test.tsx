import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { DashboardView } from "./components/DashboardView";
import { ActivityCard } from "./components/ActivityWidgets";
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
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders technology mastery progress bars and triggers drill-down", () => {
    const onSelectTech = vi.fn();
    render(
      <DashboardView
        data={mockDashboard}
        onSelectTech={onSelectTech}
        onOpenModule={vi.fn()}
        onGoToForge={vi.fn()}
      />
    );
    expect(screen.getByText("2-Technology Mastery Matrix")).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("32%")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tech-card-python"));
    expect(onSelectTech).toHaveBeenCalledWith("python");
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
});
