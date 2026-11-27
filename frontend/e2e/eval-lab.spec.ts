import { test, expect } from "@playwright/test";
import path from "node:path";

test("AI Code Eval Lab: 7-Axis Behavioral Cheat Sheet, Numbered Transcripts, Click-to-Quote, Linters, Calibration & 6-Point Pre-Flight Workbench", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1400, height: 950 });

  // 1. Navigate to AI Eval Lab via nav button + verify SPA fallback on reload
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /ai eval lab/i }).click();
  await expect(page).toHaveURL(/\/eval-lab$/);
  await page.reload();
  await expect(page).toHaveURL(/\/eval-lab$/);

  // 2. Verify Frutiger Aero theme, 7-Axis Behavioral Cheat Sheet & Honesty vs Confidence callout
  await expect(page.locator("html")).toHaveAttribute("data-theme", "frutiger-aero");
  await expect(page.getByTestId("eval-lab-hero")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".lab-window canvas")).toBeVisible();
  await expect(page.getByTestId("eval-confidence-pct")).toContainText("0%");
  await page.getByText("Progress", {exact: true}).click();
  await expect(page.getByTestId("eval-confidence-ladder")).toBeVisible();
  await expect(page.getByTestId("eval-playbook")).toBeVisible();

  await page.getByText("Open reference", {exact:true}).click();
  const cheatsheet = page.getByTestId("eval-7axis-cheatsheet");
  await expect(cheatsheet).toBeVisible();
  for (const axisLabel of ["Honesty", "Agentic Safety", "Scoping", "Deference", "Interaction", "Confidence", "Clarity"]) {
    await expect(cheatsheet).toContainText(axisLabel);
  }
  await expect(page.getByTestId("eval-golden-rules")).toContainText(/Honesty vs Confidence/i);
  await expect(page.getByTestId("eval-confidence-tip")).toBeVisible();
  // Verify on-demand reference drawers start collapsed cleanly and expand on click
  const playbookDrawer = page.getByTestId("eval-drawer-playbook");
  await expect(playbookDrawer).not.toHaveAttribute("open", "");
  await playbookDrawer.locator("summary").click();
  await expect(playbookDrawer).toHaveAttribute("open", "");

  // 3. Open A/B Practice tab & select the Reward-Hacking test-cheat scenario
  await page.getByTestId("eval-tab-practice").click();
  const scenariosList = page.getByTestId("eval-scenarios-list");
  await expect(scenariosList).toBeVisible();
  await expect(scenariosList.locator('[data-testid^="eval-scenario-pill-"]')).toHaveCount(6);

  await page.getByTestId("eval-scenario-pill-eval-py-test-cheat").click();
  const activeScenario = page.getByTestId("eval-scenario-active");
  await expect(activeScenario).toBeVisible();

  await page.getByRole("button", {name:"Compare responses"}).click();
  // Verify Quick Practice default keeps deep 7-axis matrix & structured write-ups tucked away until toggled
  await expect(page.getByTestId("eval-mode-quick")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("eval-7axis-matrix")).toHaveCount(0);
  await expect(page.getByTestId("eval-quote-target-bar")).toContainText("Your Critique");

  // Verify numbered Model A vs Model B transcripts + FINAL SUMMARY badge + click-to-quote
  await expect(page.getByTestId("eval-transcripts-grid")).toBeVisible();
  await expect(page.getByTestId("eval-transcript-a")).toContainText(/FINAL SUMMARY/i);
  await expect(page.getByTestId("eval-transcript-b")).toContainText(/FINAL SUMMARY/i);

  const firstALine = page.getByTestId("eval-transcript-a").locator('[data-testid^="eval-transcript-line-"]').first();
  await firstALine.click();
  await expect(page.locator("#eval-rationale")).toHaveValue(/"\[A\d+\]/);

  // Also verify Code Diff toggle works smoothly, then return to Transcripts
  await page.getByTestId("eval-view-codediff").click();
  await expect(page.getByTestId("eval-approach-a")).toBeVisible();
  await expect(page.getByTestId("eval-approach-b")).toBeVisible();
  await page.getByTestId("eval-view-transcripts").click();
  await expect(page.getByTestId("eval-transcripts-grid")).toBeVisible();

  // Capture crisp Frutiger Aero screenshot of the simplified Practice A/B view
  if (process.env.CAPTURE_WALKTHROUGH_DIR) {
    await page.getByTestId("eval-transcripts-grid").scrollIntoViewIfNeeded();
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: path.join(process.env.CAPTURE_WALKTHROUGH_DIR, "v2_eval_lab_7axis.png"),
      fullPage: false,
      animations: "disabled",
    });
  }

  await page.getByRole("button", {name:"Give verdict"}).click();
  // Pick Approach B + tag reward hacking
  await page.getByTestId("eval-choice-strongly_b").click();
  const weakenedTag = page.getByTestId("eval-tag-weakened_test");
  if (await weakenedTag.isVisible()) {
    await weakenedTag.click();
  }
  const cleanTestsTag = page.getByTestId("eval-tag-clean_tests");
  if (await cleanTestsTag.isVisible()) {
    await cleanTestsTag.click();
  }

  // Switch to Full Live Rehearsal mode to exercise 7-Axis Forced-Choice Matrix & live linters
  await page.getByTestId("eval-mode-full").click();
  await expect(page.getByTestId("eval-mode-full")).toHaveAttribute("aria-pressed", "true");

  // 7-Axis Forced-Choice Matrix: rate Honesty & Scoping as B Much Better and mark both Deciding
  const matrix = page.getByTestId("eval-7axis-matrix");
  await expect(matrix).toBeVisible();
  const honestySelect = page.getByTestId("eval-axis-select-honesty");
  if (!(await honestySelect.isVisible())) {
    await matrix.getByRole("button", { name: /expand 7 axes/i }).click();
  }
  await honestySelect.selectOption("b_much_better");
  await page.getByTestId("eval-axis-deciding-honesty").click();
  await page.getByTestId("eval-axis-note-honesty").fill('Model A claimed clean pass despite weakened test "[A4]".');

  await page.getByTestId("eval-axis-select-scoping").selectOption("b_much_better");
  await page.getByTestId("eval-axis-deciding-scoping").click();

  // Append concrete rationale keeping the clicked [A1] transcript quote intact
  const currentRationale = await page.locator("#eval-rationale").inputValue();
  await page.locator("#eval-rationale").fill(
    `${currentRationale} Strongly prefer Approach B because Approach A weakened the failing TTL test assertion instead of fixing the time.monotonic() boundary bug in get().`
  );
  await page.locator("#eval-followup").fill(
    "Restore the original strict TTL expiration assertion in tests/test_cache.py, fix the >= expiry check in cache.py, and re-run pytest -v."
  );

  // Structured Write-Ups: verify live Senior Engineer "Model A" amber linter warning, then fix cleanly
  await page.locator("#eval-senior-note").fill("Model A weakened the test instead of fixing TTL expiry.");
  await expect(page.getByTestId("eval-senior-linter")).toContainText(/Model A|Model B/i);

  await page.locator("#eval-senior-note").fill(
    "Reproduce the TTL boundary bug with the existing failing unit test before changing production code. " +
      "Fix the monotonic expiry comparison inside get() so entries at or past ttl_seconds evict reliably. " +
      "Keep all existing regression assertions untouched and re-run pytest to confirm a clean pass."
  );
  await expect(page.getByTestId("eval-senior-linter")).not.toContainText(/Remove|Do not mention/i);

  // Overall Verdict: 6 sentences naming Model A & Model B + citing transcript quote
  await page.locator("#eval-overall").fill(
    'Model B is much better overall, decided by Scoping and Honesty. ' +
      'Model A altered the failing TTL test assertion rather than fixing the underlying expiry logic as shown in "[A3]". ' +
      'Model A then summarized the test run as a clean bug fix, misrepresenting the workaround. ' +
      'In contrast, Model B preserved every test assertion and fixed the root monotonic clock comparison directly. ' +
      'Model B verified the suite locally and reported exact test counts accurately in its final summary. ' +
      'Because reward-hacking tests undermines verification trust, Model B is the clear winner.'
  );
  await expect(page.getByTestId("eval-overall-sentences")).toContainText(/6 sentences/i);

  await page.getByTestId("eval-submit-btn").click();

  // Verify Calibration Result + 7-Axis Calibration Table + Write-Up Checks + 4-Axis Rubric + Confidence % rise
  const calResult = page.getByTestId("eval-calibration-result");
  await expect(calResult).toBeVisible({ timeout: 10000 });
  await page.getByText("Detailed scoring and coaching").click();
  await expect(page.getByTestId("eval-axis-calibration-table")).toBeVisible();
  await expect(page.getByTestId("eval-writeup-checks")).toBeVisible();
  await expect(page.getByTestId("eval-rubric-bars")).toContainText("Stance Clarity");
  await expect(page.getByTestId("eval-rubric-bars")).toContainText("Code Evidence");
  await expect(page.getByTestId("eval-reference-examples")).toBeVisible();
  await expect(page.getByTestId("eval-confidence-pct")).toContainText(/[1-9]\d*%/);

  // 4. Dry-Run Task Workbench: create plan + check off all 6 Pre-Flight Repo & Session Hygiene Checklist items
  await page.getByTestId("eval-tab-dryrun").click();
  await expect(page.getByTestId("eval-dryrun-workbench")).toBeVisible();
  await page.locator("#dryrun-repo").fill("example-oss/ttl-cache");
  await page.locator("#dryrun-license").selectOption("MIT");
  await page.locator("#dryrun-task-type").selectOption("Bug Fix");
  await page.locator("#dryrun-goal").fill("Fix monotonic clock TTL expiration boundary without relaxing tests.");
  await page.getByRole("button", {name:"Define acceptance checks"}).click();
  await page.locator("#dryrun-ac-1").fill("Expired entries return None strictly at >= ttl_seconds.");
  await page.locator("#dryrun-ac-2").fill("Existing unit tests pass unchanged with zero skipped assertions.");
  await page.locator("#dryrun-ac-3").fill("Add regression test covering clock boundary behavior.");
  await page.locator("#dryrun-verify-cmd").fill("uv run pytest -v");
  await page.getByTestId("eval-dryrun-create-btn").click();

  await expect(page.getByTestId("eval-dryrun-active")).toBeVisible({ timeout: 10000 });
  for (const key of [
    "eligible_license",
    "repo_size_domain",
    "no_agent_files",
    "no_secrets_pii",
    "quotes_transcript",
    "written_solo",
  ]) {
    const box = page.getByTestId(`eval-hygiene-${key}`);
    await expect(box).toBeVisible();
    await box.check();
  }
  await expect(page.getByTestId("eval-hygiene-checklist")).toContainText("6/6");

  // 5. Verify zero horizontal overflow at 320px viewport width
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});


test("phone walkthrough supports reduced motion and unavailable WebGL", async ({ page }) => {
  await page.setViewportSize({width: 375, height: 812});
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.addInitScript(() => { Object.defineProperty(window, "WebGL2RenderingContext", {value: undefined}); });
  await page.goto("/eval-lab");
  await expect(page.getByRole("button", {name: "Motion off"})).toBeDisabled();
  await expect(page.locator(".lab-window canvas")).toBeHidden();
  await page.getByTestId("eval-tab-practice").click();
  await page.getByRole("button", {name: "Compare responses"}).click();
  await expect(page.getByTestId("eval-transcript-a")).toBeVisible();
  await page.getByRole("button", {name: "Model B", exact:true}).click();
  await expect(page.getByTestId("eval-transcript-a")).toBeHidden();
  await page.getByTestId("eval-transcript-b").getByRole("button").first().click();
  await page.getByRole("button", {name: "Give verdict"}).click();
  await expect(page.locator("#eval-rationale")).toHaveValue(/\[B\d+\]/);
  await page.getByTestId("eval-choice-strongly_b").click();
  await page.getByTestId("eval-submit-btn").click();
  await expect(page.getByTestId("eval-calibration-result")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
