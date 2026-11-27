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

  // 3a. Verify Living 3D Aero Ambient Backdrop & Motion Mode Toggle (full -> subtle -> off -> full)
  const backdrop = page.getByTestId("ambient-backdrop");
  await expect(backdrop).toBeAttached();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  const motionToggle = page.getByTestId("motion-toggle");
  await motionToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "subtle");
  await expect(backdrop).toHaveAttribute("data-mode", "subtle");
  await motionToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await motionToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");

  // 3b. Verify Frutiger Aero color-scheme: light and high-contrast <select>/<option> colors
  const themeColors = await page.evaluate(() => {
    const htmlCs = getComputedStyle(document.documentElement).colorScheme;
    const sel = document.querySelector<HTMLSelectElement>('[data-testid="theme-switcher"]')!;
    const checkedOpt = sel.querySelectorAll("option")[0]!;
    const uncheckedOpt = sel.querySelectorAll("option")[1]!;
    return {
      htmlCs,
      selColor: getComputedStyle(sel).color,
      checkedColor: getComputedStyle(checkedOpt).color,
      checkedBg: getComputedStyle(checkedOpt).backgroundColor,
      uncheckedColor: getComputedStyle(uncheckedOpt).color,
      uncheckedBg: getComputedStyle(uncheckedOpt).backgroundColor,
    };
  });
  expect(themeColors.htmlCs).toBe("light");
  expect(themeColors.selColor).toBe("rgb(12, 36, 56)");
  expect(themeColors.checkedColor).toBe("rgb(8, 32, 50)");
  expect(themeColors.checkedBg).toBe("rgb(186, 230, 253)");
  expect(themeColors.uncheckedColor).toBe("rgb(12, 36, 56)");
  expect(themeColors.uncheckedBg).toBe("rgb(240, 250, 255)");

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

  // 10. Verify Repo Mock Interviewer grades an answer and displays Readiness %
  await page.getByRole("button", { name: /repo interview prep/i }).click();
  await expect(page).toHaveURL(/\/repos$/);
  await expect(page.getByRole("heading", { name: "Repo interview prep", exact: true })).toBeVisible();

  // Also verify .select-field option contrast inside Model settings under Frutiger Aero
  const modelSettings = page.locator("details").filter({ has: page.locator("summary", { hasText: /Model settings/i }) });
  await modelSettings.locator("summary").click();
  const modelSelectColors = await modelSettings.locator("select.select-field").evaluate((sel) => {
    const opt = sel.querySelector("option");
    return {
      colorScheme: getComputedStyle(sel).colorScheme,
      selColor: getComputedStyle(sel).color,
      selBg: getComputedStyle(sel).backgroundColor,
      optColor: opt ? getComputedStyle(opt).color : null,
      optBg: opt ? getComputedStyle(opt).backgroundColor : null,
    };
  });
  expect(modelSelectColors.colorScheme).toBe("light");
  expect(modelSelectColors.selColor).toBe("rgb(12, 36, 56)");
  if (modelSelectColors.optColor) {
    expect(["rgb(12, 36, 56)", "rgb(8, 32, 50)"]).toContain(modelSelectColors.optColor);
    expect(["rgb(240, 250, 255)", "rgb(186, 230, 253)"]).toContain(modelSelectColors.optBg);
  }
  await modelSettings.locator("summary").click();

  if (shotDir) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: path.join(shotDir, "v2_repo_prep_frutiger.png"),
      fullPage: false,
      animations: "disabled",
    });
  }

  await page.getByRole("textbox", { name: "Repository", exact: true }).fill("lupenox/devquest");
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

test("browse tracks, search, open a chapter and return to its syllabus", async ({ page }) => {
  await page.setViewportSize({ width: 896, height: 929 });
  await page.goto("/tracks");
  const query = page.getByRole("searchbox", { name: "Find a track" });
  const tracks = page.locator('main a[data-testid^="track-link-"]');
  await expect(tracks).toHaveCount(17);
  await expect(page.locator('[data-testid^="track-module-"]')).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button")).toHaveCount(8);

  const shotDir = process.env.CAPTURE_WALKTHROUGH_DIR;
  if (shotDir) {
    await page.screenshot({ path: path.join(shotDir, "v2_frutiger_aero_tracks.png"), animations: "disabled" });
  }

  await query.fill("no-such-track");
  await expect(tracks).toHaveCount(0);
  await query.fill("pYtHoN");
  await expect(tracks).toHaveCount(1);
  const python = page.getByTestId("track-link-python");
  await expect(python).toHaveAttribute("href", "/tracks/python");
  await python.click();
  await expect(page).toHaveURL(/\/tracks\/python$/);
  await page.reload();

  const roadmap = page.getByTestId("syllabus-roadmap-python");
  const chapterRows = roadmap.locator('[data-testid^="track-module-"]');
  await expect(page.getByTestId("track-progress-python")).toBeVisible();
  await expect(page.getByTestId("continue-track-python")).toBeVisible();
  await expect(chapterRows).toHaveCount(16);
  await expect(roadmap.locator("details[open]")).toHaveCount(1);
  for (const part of ["foundations", "intermediate", "advanced", "boss"]) {
    await expect(page.getByTestId(`syllabus-part-${part}`).locator("summary")).toBeVisible();
  }
  for (let i = 0; i < 16; i++) {
    await expect(chapterRows.nth(i).locator('[data-testid^="chapter-num-"]')).toHaveText(`Ch. ${i + 1}`);
  }
  if (shotDir) {
    await page.screenshot({ path: path.join(shotDir, "v2_python_16ch_syllabus.png"), animations: "disabled" });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const capstone = page.getByTestId("track-module-py-16-boss-async-pipeline");
  await expect(capstone).toBeHidden();
  await page.getByTestId("syllabus-part-boss").locator("summary").press("Enter");
  await capstone.click();
  await expect(page).toHaveURL(/\/modules\/py-16-boss-async-pipeline$/);
  await page.reload();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(roadmap).toBeVisible();
  await expect(page).toHaveURL(/\/tracks\/python$/);

  await page.getByRole("combobox", { name: "Switch track" }).selectOption("sql");
  await expect(page).toHaveURL(/\/tracks\/sql$/);
  await page.goBack();
  await expect(roadmap).toBeVisible();
  await page.getByRole("link", { name: "All tracks", exact: true }).click();
  await expect(page).toHaveURL(/\/tracks$/);
  await expect(tracks).toHaveCount(17);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
