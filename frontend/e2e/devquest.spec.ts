import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

async function solveBrowserDrillInUi(page: Page, activity: any) {
  const card = page.getByTestId(`activity-${activity.id}`);
  await expect(card).toBeVisible({ timeout: 10000 });

  if (activity.activity_type === "read_check") {
    const options: string[] = activity.spec.options || [];
    const correctIdx: number = activity.spec.correct_index ?? 0;
    await card.locator(".option-btn").nth(correctIdx).click();
    await card.getByRole("button", { name: /check answer/i }).click();
  } else if (activity.activity_type === "fill_blank") {
    const blanks: any[] = activity.spec.blanks || [];
    for (let i = 0; i < blanks.length; i++) {
      const answer = blanks[i].accepted?.[0] ?? blanks[i].expected ?? "";
      await card.getByLabel(`Blank ${i + 1}`).fill(String(answer));
    }
    await card.getByRole("button", { name: /verify blanks/i }).click();
  } else if (activity.activity_type === "code_trace") {
    const checkpoints: any[] = activity.spec.checkpoints || [];
    const inputs = card.locator("input.input-field");
    for (let i = 0; i < checkpoints.length; i++) {
      const expected = checkpoints[i].expected ?? checkpoints[i].accepted?.[0] ?? "";
      await inputs.nth(i).fill(String(expected));
    }
    await card.getByRole("button", { name: /verify trace/i }).click();
  } else if (activity.activity_type === "pdb_sim") {
    const input = page.getByTestId(`pdb-input-${activity.id}`);
    const runBtn = page.getByTestId(`pdb-run-${activity.id}`);
    for (const cmd of ["n", "p total", "w"]) {
      await input.fill(cmd);
      await runBtn.click();
    }
  } else if (activity.activity_type === "parsons") {
    const targetOrder: number[] = activity.spec.correct_order || [];
    // Simulate moving rows until order matches targetOrder
    const current = targetOrder.map((_, i) => i);
    for (let pos = 0; pos < targetOrder.length; pos++) {
      const want = targetOrder[pos];
      let idx = current.indexOf(want);
      while (idx > pos) {
        await card.getByLabel(`Move line ${idx + 1} up`).click();
        [current[idx - 1], current[idx]] = [current[idx], current[idx - 1]];
        idx -= 1;
      }
    }
    await card.getByRole("button", { name: /check line order/i }).click();
  }

  await expect(page.getByTestId(`feedback-${activity.id}`)).toContainText("Passed!", { timeout: 10000 });
}

test("DevQuest v2.0 full E2E: Command Palette, SPA routing, pdb_sim, Playgrounds, Sprint, Themes, SVG Skill Tree, Mock Interview & PWA", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const shotDir = process.env.CAPTURE_WALKTHROUGH_DIR || "";

  // 1. Verify PWA manifest & service worker endpoints return HTTP 200 valid responses
  const manifestResp = await request.get("/manifest.webmanifest");
  expect(manifestResp.status()).toBe(200);
  const manifestJson = await manifestResp.json();
  expect(manifestJson.name).toContain("DevQuest");
  expect(manifestJson.display).toBe("standalone");
  expect(manifestJson.theme_color).toBe("#0284c7");
  expect(manifestJson.background_color).toBe("#e0f7ff");
  expect(Array.isArray(manifestJson.icons) && manifestJson.icons.length > 0).toBeTruthy();

  const swResp = await request.get("/sw.js");
  expect(swResp.status()).toBe(200);

  // 2. Verify dashboard actions at tablet width, then open the full catalog with the keyboard.
  await page.setViewportSize({ width: 896, height: 929 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "DevQuest" })).toBeVisible();
  await expect(page.getByRole("button", { name: /start practice/i })).toBeVisible();
  await expect(page.getByTestId("tech-card-python")).toBeHidden();
  await expect(page.getByTestId("achievement-first_quest")).toBeHidden();
  const mainNav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(mainNav).toBeVisible();
  const navRects = await mainNav.getByRole("button").evaluateAll(buttons =>
    buttons.map(button => {
      const { top, bottom } = button.getBoundingClientRect();
      return { top, bottom };
    })
  );
  expect(navRects.length).toBeGreaterThan(0);
  expect(Math.max(...navRects.map(r => r.top))).toBeLessThan(Math.min(...navRects.map(r => r.bottom)));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(896);

  const tracksToggle = page.getByTestId("learning-tracks").locator("summary");
  await tracksToggle.focus();
  await tracksToggle.press("Enter");
  for (const slug of [
    "neovim", "python", "fastapi", "bash", "typescript", "javascript",
    "cpp", "json", "xml", "html", "css", "sql", "git", "react", "playwright", "regex", "debugging",
  ]) {
    await expect(page.getByTestId(`tech-card-${slug}`)).toBeVisible();
  }
  await tracksToggle.click();
  await expect(page.getByTestId("tech-card-python")).toBeHidden();
  await page.setViewportSize({ width: 1400, height: 950 });
  await expect(page.getByText("Neovim Live")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("player-rank-badge")).toBeVisible();
  await expect(page.getByTestId("achievements-shelf")).toBeVisible();

  // 3. Theme switching: default frutiger-aero -> emerald-3d -> catppuccin -> gruvbox -> frutiger-aero
  await expect(page.locator("html")).toHaveAttribute("data-theme", "frutiger-aero");
  const switcher = page.getByTestId("theme-switcher");
  await switcher.selectOption("emerald-3d");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "emerald-3d");
  await switcher.selectOption("catppuccin");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "catppuccin");
  await switcher.selectOption("gruvbox");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "gruvbox");
  await switcher.selectOption("frutiger-aero");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "frutiger-aero");

  // 4. Ctrl+K Command Palette search for "pdb" -> /modules/debugging-pdb-101 + reload via SPA fallback!
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByTestId("command-palette-input").fill("pdb");
  const pdbHit = page.getByTestId("palette-item-mod-debugging-pdb-101");
  await expect(pdbHit).toBeVisible({ timeout: 5000 });
  await pdbHit.click();

  await expect(page).toHaveURL(/\/modules\/debugging-pdb-101$/);
  await expect(page.getByText("Python Debugger (pdb & breakpoint()): Stepping, Frames & Bug Hunting")).toBeVisible();

  // Browser reload must work seamlessly via FastAPI SPA catch-all fallback
  await page.reload();
  await expect(page).toHaveURL(/\/modules\/debugging-pdb-101$/);
  await expect(page.getByTestId("pdb-sim-dbg-101-pdb-sim")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Neovim Live")).toBeVisible({ timeout: 10000 });

  // 5. Complete interactive pdb_sim commands (n, p total, w) -> earns XP + Achievement toast!
  const pdbCard = page.getByTestId("activity-dbg-101-pdb-sim");
  await pdbCard.scrollIntoViewIfNeeded();
  const pdbInput = page.getByTestId("pdb-input-dbg-101-pdb-sim");
  const pdbRun = page.getByTestId("pdb-run-dbg-101-pdb-sim");

  await pdbInput.fill("n");
  await pdbRun.click();
  await expect(page.getByTestId("pdb-obj-step")).toHaveClass(/done/);

  await pdbInput.fill("n");
  await pdbRun.click();

  await pdbInput.fill("p total");
  await pdbRun.click();
  await expect(page.getByTestId("pdb-obj-inspect_var:total")).toHaveClass(/done/);

  await pdbInput.fill("w");
  await pdbRun.click();
  await expect(page.getByTestId("pdb-obj-stack")).toHaveClass(/done/);

  await expect(page.getByTestId("feedback-dbg-101-pdb-sim")).toContainText("Passed! +30 XP", { timeout: 10000 });
  await expect(page.getByTestId("achievement-toast")).toContainText("Achievement Unlocked", { timeout: 10000 });
  // Ensure background silent module refresh preserves PdbSim widget state without unmounting
  await expect(page.getByTestId("pdb-obj-step")).toHaveClass(/done/);
  await expect(page.getByTestId("pdb-obj-inspect_var:total")).toHaveClass(/done/);
  await expect(page.getByTestId("pdb-obj-stack")).toHaveClass(/done/);
  await expect(pdbCard).toContainText("All debugging objectives completed!");

  if (shotDir) {
    await pdbCard.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(shotDir, "v2_pdb_sim_debugger.png"),
      fullPage: false,
    });
  }

  // 6. Verify Live Quick Playground inside SQL intermediate lab (direct URL via SPA fallback)
  await page.goto("/modules/sql-window-functions-201");
  await expect(page.getByText("SQL Window Functions: ROW_NUMBER, RANK & OVER (PARTITION BY)")).toBeVisible();
  const sqlToggle = page.getByTestId("playground-toggle-sql-201-nvim-lab");
  await sqlToggle.scrollIntoViewIfNeeded();
  await sqlToggle.click();
  const sqlPlayground = page.getByTestId("sql-playground-sql-201-nvim-lab");
  await expect(sqlPlayground).toBeVisible();
  await sqlPlayground.getByRole("button", { name: /run sql query/i }).click();
  await expect(sqlPlayground).toContainText("7 rows", { timeout: 10000 });

  // 7. Verify Python zyBooks + Live Neovim :w WebSocket grading + Vim Par Bonus regression check
  await page.goto("/modules/python-comprehensions-101");
  await expect(page.getByText("1.1 List Comprehensions vs Generator Expressions")).toBeVisible();

  const rcCard = page.getByTestId("activity-py-101-read-check");
  await rcCard.getByText("sum(e * e for e in stream)").click();
  await rcCard.getByRole("button", { name: /check answer/i }).click();
  await expect(page.getByTestId("feedback-py-101-read-check")).toContainText("Passed!");

  const labCard = page.getByTestId("activity-py-101-nvim-lab");
  await expect(page.getByTestId("open-terminal-py-101-nvim-lab")).toBeVisible();
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

  const gradeResp = await request.post("/api/grade", {
    data: {
      activity_id: "py-101-nvim-lab",
      workspace_dir: wsData.workspace_dir,
      keystrokes: 55,
    },
  });
  expect(gradeResp.ok()).toBeTruthy();
  await expect(page.getByTestId("xp-toast")).toContainText("Python Mastery", { timeout: 10000 });
  await expect(page.getByTestId("xp-toast")).toContainText("Vim Par Bonus");

  // 8. Start & complete a 2-min AI Break Sprint -> awards Combo XP!
  await page.getByRole("button", { name: /ai break sprint/i }).click();
  await expect(page).toHaveURL(/\/sprint$/);
  await page.getByTestId("sprint-dur-2").click();

  const sprintStartPromise = page.waitForResponse(
    (resp) => resp.url().includes("/api/sprint/start") && resp.status() === 200
  );
  await page.getByTestId("sprint-start-btn").click();
  const sprintStartJson = await (await sprintStartPromise).json();
  expect(sprintStartJson.activities.length).toBeGreaterThanOrEqual(2);

  for (let i = 0; i < sprintStartJson.activities.length; i++) {
    await solveBrowserDrillInUi(page, sprintStartJson.activities[i]);
    if (i === 0) {
      await expect(page.getByTestId("sprint-combo")).toContainText("1.5x Combo");
    } else if (i === 1) {
      await expect(page.getByTestId("sprint-combo")).toContainText("2x Combo");
    }
    await page.getByTestId("sprint-next-btn").click();
  }

  await expect(page.getByTestId("sprint-summary")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("sprint-bonus-xp")).toContainText(/\+[1-9]\d* XP/);

  // 9. Verify Interactive SVG Skill Tree renders <path> prerequisite connectors
  await page.getByRole("button", { name: /skill tree/i }).click();
  await expect(page).toHaveURL(/\/tree$/);
  await expect(page.getByText("Developer RPG Skill Tree")).toBeVisible();
  const svgPaths = page.locator('svg[data-testid="skill-tree-connectors"] path.st-edge');
  await expect(svgPaths.first()).toBeVisible({ timeout: 10000 });
  expect(await svgPaths.count()).toBeGreaterThanOrEqual(6);
  await expect(page.getByTestId("tree-node-fastapi-di-middleware-201")).toBeVisible();

  if (shotDir) {
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: path.join(shotDir, "v2_skill_tree.png"),
      fullPage: false,
      animations: "disabled",
    });
  }

  // 9b. Verify Tracks & zyBooks module cards render with light Frutiger Aero glass (no hardcoded dark #131928)
  await page.getByRole("button", { name: /tracks & zybooks/i }).click();
  await expect(page).toHaveURL(/\/tracks$/);
  const trackModCard = page.locator(".track-module-card").first();
  await expect(trackModCard).toBeVisible({ timeout: 10000 });
  const trackCardBg = await trackModCard.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(trackCardBg).not.toBe("rgb(19, 25, 40)");
  if (shotDir) {
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: path.join(shotDir, "v2_frutiger_aero_tracks.png"),
      fullPage: false,
      animations: "disabled",
    });
  }

  // 9c. Verify Python 16-Chapter Beginning-to-End zyBooks Textbook Syllabus Roadmap on /tracks/python
  await page.goto("/tracks/python");
  await expect(page).toHaveURL(/\/tracks\/python$/);
  await expect(page.getByTestId("syllabus-roadmap-python")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("track-progress-python")).toBeVisible();
  await expect(page.getByTestId("continue-track-python")).toContainText(/Continue Next Chapter \(Ch\. \d+\)/);
  await expect(page.getByTestId("syllabus-part-foundations")).toContainText("Part 1: Foundations (Beginner)");
  await expect(page.getByTestId("syllabus-part-intermediate")).toContainText("Part 2: Intermediate & Katas");
  await expect(page.getByTestId("syllabus-part-advanced")).toContainText("Part 3: Advanced & Async");
  await expect(page.getByTestId("syllabus-part-boss")).toContainText("Part 4: Boss Projects");

  const pySection = page.getByTestId("track-section-python");
  const pyCards = pySection.locator(".track-module-card");
  await expect(pyCards).toHaveCount(16);
  for (let ch = 1; ch <= 16; ch++) {
    await expect(pyCards.nth(ch - 1)).toContainText(`Ch. ${ch}`);
  }

  if (shotDir) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: path.join(shotDir, "v2_python_16ch_syllabus.png"),
      fullPage: false,
      animations: "disabled",
    });
  }

  // 10. Verify Repo Mock Interviewer grades an answer and displays Readiness %
  await page.getByRole("button", { name: /repo interview prep/i }).click();
  await expect(page).toHaveURL(/\/repos$/);
  await expect(page.getByText("Study Any GitHub Repo for Interviews")).toBeVisible();

  await page.getByPlaceholder("owner/repo or https://github.com/owner/repo").fill("lupenox/devquest");
  await page.getByTestId("custom-start-mock-interview").click();
  await expect(page.getByTestId("mock-interview-panel")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("mock-interview-question")).toBeVisible();

  await page.getByTestId("mock-interview-answer").fill(
    "First, DevQuest solves hands-on full-stack and Neovim practice with zero monthly cost. " +
    "We chose FastAPI and SQLite in `backend/app/main.py` and `backend/app/db.py` paired with a React TypeScript SPA " +
    "because local execution keeps latency low and avoids cloud infrastructure. " +
    "The key trade-off is SQLite single-writer concurrency versus PostgreSQL at high scale, mitigated via short transactions and clear module separation."
  );
  await page.getByTestId("mock-interview-submit").click();
  await expect(page.getByTestId("mock-interview-rubric")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("mock-interview-rubric")).toContainText("Clarity");
  await expect(page.getByTestId("mock-interview-rubric")).toContainText("Technical Accuracy");
  await expect(page.getByTestId("mock-interview-rubric")).toContainText("Code References");
  await expect(page.getByTestId("mock-interview-rubric")).toContainText("Trade-Offs");
  await expect(page.getByTestId("mock-interview-readiness")).toContainText(/Readiness \d+%/);

  // 11. Return to Mastery Dashboard, verify unlocked XP & Achievements, capture Dashboard screenshot
  await page.getByRole("button", { name: /mastery dashboard/i }).click();
  await expect(page).toHaveURL(/\/$/);
  const achievementsToggle = page.getByTestId("achievements-shelf").locator("summary");
  await achievementsToggle.click();
  await expect(page.getByTestId("achievement-first_quest")).toBeVisible();
  await expect(page.getByTestId("achievement-first_quest")).toHaveClass(/unlocked/);
  await expect(page.getByTestId("achievement-bug_hunter")).toHaveClass(/unlocked/);
  await expect(page.getByTestId("achievement-vim_par_sniper")).toHaveClass(/unlocked/);
  await achievementsToggle.click();
  await tracksToggle.click();
  await expect(page.getByTestId("tech-card-python")).toContainText(/\d+ XP/);
  await expect(page.getByTestId("tech-card-debugging")).toContainText(/\d+ XP/);
  await expect(page.getByTestId("tech-card-neovim")).toContainText(/\d+ XP/);
  await tracksToggle.click();
  const history = page.getByTestId("recent-xp");
  const historyToggle = history.locator("summary");
  await historyToggle.click();
  await expect(history.locator(".heat-cell")).toHaveCount(14);
  await expect(history.getByText(/\+\d+ XP/).first()).toBeVisible();
  await historyToggle.click();

  if (shotDir) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: path.join(shotDir, "v2_frutiger_aero_default.png"),
      fullPage: false,
      animations: "disabled",
    });
  }
});
