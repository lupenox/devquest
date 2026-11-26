import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ModuleSummary, Technology } from "../types";
import { TrackSyllabus } from "./TrackSyllabus";

function chapter(order: number, difficulty: string, completed: number): ModuleSummary {
  return {
    id: `lesson-${order}`,
    tech_slug: "python",
    title: `Lesson ${order}`,
    subtitle: "",
    difficulty,
    kind: "zybooks",
    estimated_minutes: 10,
    order_index: order,
    prereq_module_id: null,
    source: "builtin",
    content: { sections: [], summary: "", tags: [] },
    activity_count: 2,
    completed_count: completed,
  };
}

it("resumes the first unfinished chapter and keeps mastered lessons available for review", () => {
  const modules = [
    chapter(4, "advanced", 0),
    chapter(2, "beginner", 2),
    chapter(5, "advanced", 0),
    chapter(3, "intermediate", 1),
    chapter(1, "beginner", 2),
  ];
  const tech: Technology = {
    slug: "python", name: "Python", category: "Core Languages", color: "#3976AA",
    icon: "code", xp: 60, level: 1, completed_activities: 5, total_activities: 10,
    mastery_pct: 50, freshness: "fresh", last_practiced_at: null, modules,
  };
  const openModule = vi.fn();
  const { rerender } = render(<TrackSyllabus tech={tech} onOpenModule={openModule} />);

  expect(screen.getByTestId("syllabus-part-foundations")).not.toHaveAttribute("open");
  expect(screen.getByTestId("syllabus-part-intermediate")).toHaveAttribute("open");
  expect(screen.getByTestId("track-module-lesson-3")).toBeVisible();
  fireEvent.click(screen.getByTestId("continue-track-python"));
  expect(openModule).toHaveBeenLastCalledWith("lesson-3");

  const completed = modules.map((m) => ({ ...m, completed_count: m.activity_count }));
  rerender(<TrackSyllabus tech={{ ...tech, modules: completed, mastery_pct: 100, completed_activities: 10 }} onOpenModule={openModule} />);
  expect(screen.queryByTestId("continue-track-python")).not.toBeInTheDocument();
  const foundations = screen.getByTestId("syllabus-part-foundations");
  if (!foundations.hasAttribute("open")) fireEvent.click(foundations.querySelector("summary")!);
  const firstLesson = screen.getByTestId("track-module-lesson-1");
  expect(firstLesson).toBeVisible();
  fireEvent.click(firstLesson);
  expect(openModule).toHaveBeenLastCalledWith("lesson-1");
});
