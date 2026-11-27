import { test, expect } from "@playwright/test";
import path from "node:path";

test("AI Code Eval Lab: Playbook, A/B Reward-Hacking Calibration, Dry-Run Hygiene Workbench & 320px responsiveness", async ({
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

  // 2. Verify Frutiger Aero theme, Zero-Overwhelm Playbook & Confidence Ladder
  await expect(page.locator("html")).toHaveAttribute("data-theme", "frutiger-aero");
  await expect(page.getByTestId("eval-lab-hero")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("eval-lab-hero")).toContainText("AI Code Eval Lab");
  await expect(page.getByTestId("eval-confidence-pct")).toContainText("0%");
  await expect(page.getByTestId("eval-confidence-ladder")).toBeVisible();
  await expect(page.getByTestId("eval-playbook")).toBeVisible();
  await expect(page.getByTestId("eval-confidence-tip")).toBeVisible();

  // 3. Open A/B Practice tab & select the Reward-Hacking test-cheat scenario
  await page.getByTestId("eval-tab-practice").click();
  const scenariosList = page.getByTestId("eval-scenarios-list");
  await expect(scenariosList).toBeVisible();
  await expect(scenariosList.locator('[data-testid^="eval-scenario-pill-"]')).toHaveCount(6);

  await page.getByTestId("eval-scenario-pill-eval-py-test-cheat").click();
  const activeScenario = page.getByTestId("eval-scenario-active");
  await expect(activeScenario).toBeVisible();

  // Pick Approach B, tag the reward-hacking issue, write grounded rationale + follow-up steering prompt
  await page.getByTestId("eval-choice-strongly_b").click();
  const tagChips = activeScenario.locator('[data-testid^="eval-tag-"]');
  const tagCount = await tagChips.count();
  expect(tagCount).toBeGreaterThanOrEqual(2);
  const weakenedTag = page.getByTestId("eval-tag-weakened_test");
  if (await weakenedTag.isVisible()) {
    await weakenedTag.click();
  } else {
    await tagChips.first().click();
  }
  const cleanTestsTag = page.getByTestId("eval-tag-clean_tests");
  if (await cleanTestsTag.isVisible()) {
    await cleanTestsTag.click();
  }

  await page.locator("#eval-rationale").fill(
    "Strongly prefer Approach B because Approach A reward-hacks the test suite by weakening the failing TTL assertion instead of fixing the actual cache expiration comparison. " +
      "Approach B fixes the time.monotonic() boundary check in get() and keeps the strict pytest regression assertions intact."
  );
  await page.locator("#eval-followup").fill(
    "Restore the original strict TTL expiration assertion in tests/test_cache.py, fix the >= expiry check in cache.py using time.monotonic(), and re-run pytest -v."
  );
  await page.getByTestId("eval-submit-btn").click();

  // Verify Calibration Result + 4-axis rubric + Confidence % rise
  const calResult = page.getByTestId("eval-calibration-result");
  await expect(calResult).toBeVisible({ timeout: 10000 });
  await expect(calResult).toContainText("Stance Clarity");
  await expect(calResult).toContainText("Code Evidence");
  await expect(calResult).toContainText("Verification Focus");
  await expect(calResult).toContainText("Actionable Steering");
  await expect(page.getByTestId("eval-confidence-pct")).toContainText(/[1-9]\d*%/);

  if (process.env.CAPTURE_WALKTHROUGH_DIR) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(10, 10);
    await page.screenshot({
      path: path.join(process.env.CAPTURE_WALKTHROUGH_DIR, "v2_eval_lab.png"),
      fullPage: false,
      animations: "disabled",
    });
  }

  // 4. Dry-Run Task Workbench: create plan + check off all 5 Pre-Submit Hygiene Checklist items
  await page.getByTestId("eval-tab-dryrun").click();
  await expect(page.getByTestId("eval-dryrun-workbench")).toBeVisible();
  await page.locator("#dryrun-repo").fill("example-oss/ttl-cache");
  await page.locator("#dryrun-license").selectOption("MIT");
  await page.locator("#dryrun-task-type").selectOption("Bug Fix");
  await page.locator("#dryrun-goal").fill("Fix monotonic clock TTL expiration boundary without relaxing tests.");
  await page.locator("#dryrun-ac-1").fill("Expired entries return None strictly at >= ttl_seconds.");
  await page.locator("#dryrun-ac-2").fill("Existing unit tests pass unchanged with zero skipped assertions.");
  await page.locator("#dryrun-ac-3").fill("Add regression test covering clock boundary behavior.");
  await page.locator("#dryrun-verify-cmd").fill("uv run pytest -v");
  await page.getByTestId("eval-dryrun-create-btn").click();

  await expect(page.getByTestId("eval-dryrun-active")).toBeVisible({ timeout: 10000 });
  for (const key of ["eligible_license", "no_secrets", "no_pii", "verified_locally", "own_words"]) {
    const box = page.getByTestId(`eval-hygiene-${key}`);
    await expect(box).toBeVisible();
    await box.check();
  }
  await expect(page.getByTestId("eval-hygiene-checklist")).toContainText("5/5");

  // 5. Verify zero horizontal overflow at 320px viewport width
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
