import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("DevQuest full RPG + zyBooks + Live Neovim WebSocket grading flow", async ({ page, request }) => {
  await page.goto("/");

  // 1. Verify HUD & all 16 technologies render on Mastery Dashboard
  await expect(page.getByRole("heading", { name: "DevQuest" })).toBeVisible();
  for (const slug of [
    "neovim", "python", "fastapi", "bash", "typescript", "javascript",
    "cpp", "json", "xml", "html", "css", "sql", "git", "react", "playwright", "regex",
  ]) {
    await expect(page.getByTestId(`tech-card-${slug}`)).toBeVisible();
  }

  // Wait for WebSocket live indicator
  await expect(page.getByText("Neovim Live")).toBeVisible({ timeout: 10000 });

  if (process.env.CAPTURE_WALKTHROUGH_DIR) {
    await page.setViewportSize({ width: 1400, height: 950 });
    await page.screenshot({
      path: path.join(process.env.CAPTURE_WALKTHROUGH_DIR, "dashboard_initial.png"),
      fullPage: true,
    });
  }

  // 2. Open Python track -> zyBooks module
  await page.getByTestId("tech-card-python").click();
  await page.getByRole("button", { name: /open/i }).first().click();
  await expect(page.getByText("1.1 List Comprehensions vs Generator Expressions")).toBeVisible();

  // 3. Complete zyBooks Read Check participation activity in browser
  const rcCard = page.getByTestId("activity-py-101-read-check");
  await rcCard.getByText("sum(e * e for e in stream)").click();
  await rcCard.getByRole("button", { name: /check answer/i }).click();
  await expect(page.getByTestId("feedback-py-101-read-check")).toContainText("Passed!");

  // 4. Simulate Neovim `:w` auto-grade on the Python Neovim Lab and verify live WebSocket toast!
  const labCard = page.getByTestId("activity-py-101-nvim-lab");
  await labCard.getByRole("button", { name: /prepare neovim workspace/i }).click();
  await expect(labCard).toContainText("nvim solution.py");

  const launchResp = await request.post("/api/activities/py-101-nvim-lab/launch-nvim", {
    data: { reset: false },
  });
  const wsData = await launchResp.json();
  fs.writeFileSync(
    path.join(wsData.workspace_dir, "solution.py"),
    `def dedupe_preserve_order(items):
    return list(dict.fromkeys(items))

def moving_average(values, window):
    if window <= 0 or window > len(values):
        raise ValueError("invalid")
    return [sum(values[i:i+window]) / window for i in range(len(values) - window + 1)]
`
  );

  // Trigger /api/grade exactly like devquest.nvim does on :w (with keystrokes under par!)
  const gradeResp = await request.post("/api/grade", {
    data: {
      activity_id: "py-101-nvim-lab",
      workspace_dir: wsData.workspace_dir,
      keystrokes: 55,
    },
  });
  expect(gradeResp.ok()).toBeTruthy();

  // Assert live WebSocket XP toast & live HUD XP update without page reload!
  await expect(page.getByTestId("xp-toast")).toContainText("Python Mastery");
  await expect(page.getByTestId("xp-toast")).toContainText("Vim Par Bonus");
  await expect(page.getByTestId("hud-level")).toContainText("XP");

  if (process.env.CAPTURE_WALKTHROUGH_DIR) {
    await page.screenshot({
      path: path.join(process.env.CAPTURE_WALKTHROUGH_DIR, "zybooks_live_graded.png"),
      fullPage: true,
    });
  }

  // 5. Verify Skill Tree, Boss Projects, and Sync & AI Forge tabs render cleanly
  await page.getByRole("button", { name: /skill tree/i }).click();
  await expect(page.getByText("Developer RPG Skill Tree")).toBeVisible();

  await page.getByRole("button", { name: /boss projects/i }).click();
  await expect(page.getByText("URL Shortener & Click Analytics API")).toBeVisible();

  await page.getByRole("button", { name: /sync & ai forge/i }).click();
  await expect(page.getByText("Local Ollama zyBooks Module Forge")).toBeVisible();

  // 6. Return to Mastery Dashboard and verify updated Python + Neovim mastery progress bars
  await page.getByRole("button", { name: /mastery dashboard/i }).click();
  await expect(page.getByTestId("tech-card-python")).toContainText("80 XP");
  await expect(page.getByTestId("tech-card-neovim")).toContainText("20 XP");
  if (process.env.CAPTURE_WALKTHROUGH_DIR) {
    await page.screenshot({
      path: path.join(process.env.CAPTURE_WALKTHROUGH_DIR, "dashboard_with_xp.png"),
      fullPage: true,
    });
  }
});
