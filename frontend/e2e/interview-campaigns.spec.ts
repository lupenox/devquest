import { test, expect } from "@playwright/test";

test("create reusable interview campaign with resume upload, timed drills, skim sheet, and tailored mock interview", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/repos");

  // 1. Open "+ New Interview Campaign" wizard from Repo Interview Prep
  await expect(page.getByTestId("interview-campaigns-section")).toBeVisible();
  await page.getByTestId("new-campaign-btn").click();
  await expect(page.getByTestId("new-campaign-form")).toBeVisible();

  // 2. Upload a synthetic .txt resume through real POST /api/campaigns/parse-resume
  await page.getByTestId("campaign-resume-upload").setInputFiles({
    name: "acme_candidate_resume.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "SUMMARY\nPython and TypeScript engineer shipping async LLM pipelines and automated tests.\n\n" +
        "PROJECTS\n- Realtime Voice Evaluator: Python, asyncio, FastAPI, offline fake-SDK pytest suite.\n" +
        "- Hybrid Retrieval Service: Dense + BM25 search with CI faithfulness evals.\n",
      "utf-8"
    ),
  });
  await expect(page.getByTestId("campaign-resume-status")).toContainText("acme_candidate_resume.txt", {
    timeout: 10000,
  });
  await expect(page.locator("#camp-resume-text")).toHaveValue(/Realtime Voice Evaluator/);

  // 3. Fill generic fictional Acme AI campaign fields and create study plan
  await page.locator("#camp-company").fill("Acme AI");
  await page.locator("#camp-role").fill("SWE, Applied AI");
  await page.locator("#camp-duration").fill("20");
  await page.locator("#camp-daily-budget").fill("30");
  await page.locator("#camp-meeting").fill("https://meet.example.com/acme-r1");
  await page.locator("#camp-interviewer").fill("Alex Rivera (CTO)");
  await page.locator("#camp-interviewer-notes").fill("20-minute technical screen focused on architecture and debugging.");
  await page.locator("#camp-mission").fill("Building reliable, safety-tested AI developer tooling.");
  await page.locator("#camp-brief").fill(
    "PROJECTS\n- Realtime Voice Evaluator: Python async state machine with offline CI fakes.\n" +
      "QUESTIONS\n- How do you test async LLM pipelines offline?\n" +
      "GAPS\n- Lighter production Rust experience; strong C++ and systems coursework.\n" +
      "QUESTIONS TO ASK\n- What is the highest-leverage engineering bottleneck for the next 90 days?\n"
  );
  await page.locator("#camp-repos").fill("acme/voice-evaluator, acme/hybrid-rag");

  await page.getByTestId("create-campaign-submit").click();

  // 4. Verify Campaign Workspace opens with realistic day-by-day schedule tabs
  await expect(page.getByTestId("interview-campaign-view")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("campaign-header")).toContainText("Acme AI — SWE, Applied AI");
  await expect(page.getByTestId("campaign-readiness")).toContainText("0%");
  await expect(page.getByTestId("campaign-tab-day-1")).toBeVisible();
  await expect(page.getByTestId("campaign-tab-day-0")).toBeVisible();
  await expect(page.getByTestId("campaign-tab-skim")).toBeVisible();

  // 5. Interact with first active-recall drill: start timer, verify tick, reveal talking points, save note, rate Nailed It
  const firstDrill = page.locator('[data-testid^="campaign-item-"]').first();
  await expect(firstDrill).toBeVisible();
  const fullTestId = (await firstDrill.getAttribute("data-testid")) || "";
  const itemId = fullTestId.replace(/^campaign-item-/, "");

  const timerVal = page.getByTestId(`drill-timer-value-${itemId}`);
  const initialClock = (await timerVal.textContent())?.trim() || "";
  await page.getByTestId(`drill-timer-toggle-${itemId}`).click();
  await expect(timerVal).not.toHaveText(initialClock, { timeout: 3500 });
  await page.getByTestId(`drill-timer-toggle-${itemId}`).click(); // Pause

  await page.getByTestId(`drill-reveal-${itemId}`).click();
  await expect(page.getByTestId(`drill-points-${itemId}`)).toBeVisible();

  await page.locator(`#drill-notes-${itemId}`).fill("Lead with architecture, then cite offline pytest metrics.");
  await page.getByTestId(`rate-${itemId}-nailed`).click();

  // Readiness % must rise cleanly above 0%
  await expect(page.getByTestId("campaign-readiness")).toContainText(/[1-9]\d*% \(1\/\d+ drills ready\)/, {
    timeout: 10000,
  });

  // 6. Switch to Interview Morning Skim tab and 1-Page Skim Sheet
  await page.getByTestId("campaign-tab-day-0").click();
  await expect(page.locator('[data-testid^="campaign-item-"]').first()).toBeVisible();

  await page.getByTestId("campaign-tab-skim").click();
  await expect(page.getByTestId("campaign-skim-sheet")).toBeVisible();
  await expect(page.getByTestId("campaign-skim-sheet")).toContainText(
    "Lead with architecture, then cite offline pytest metrics."
  );

  // 7. Launch tailored Campaign Mock Interview and grade Q1
  await page.getByTestId("campaign-start-mock-btn").click();
  await expect(page.getByTestId("mock-interview-panel")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("mock-interview-question")).toContainText("Acme AI");

  await page.getByTestId("mock-interview-answer").fill(
    "First, I build Python and TypeScript AI systems with automated offline testing. " +
      "In acme/voice-evaluator, we isolated async state transitions and provider SDKs behind fakes so pytest runs deterministically in CI. " +
      "The main trade-off is maintaining fake parity with live APIs versus burning tokens on flaky integration runs, which we balance with contract schemas."
  );
  await page.getByTestId("mock-interview-submit").click();
  await expect(page.getByTestId("mock-interview-rubric")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("mock-interview-readiness")).toContainText(/Readiness \d+%/);

  // 8. Verify Dashboard Upcoming Interview Banner appears and jumps back cleanly
  await page.goto("/");
  await expect(page.getByTestId("upcoming-interview-banner")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("upcoming-interview-banner")).toContainText("Acme AI");
  await expect(page.getByTestId("upcoming-interview-banner")).toContainText("SWE, Applied AI");

  // 9. Clean up campaign via API so subsequent tests in shared runs stay clean, or verify 320px responsive layout first
  await page.getByRole("button", { name: /study interview plan/i }).click();
  await expect(page).toHaveURL(/\/repos$/);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByTestId("interview-campaigns-section")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
