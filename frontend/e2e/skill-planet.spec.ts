import { expect, test } from "@playwright/test";

test("orbit hides top nav & pre-zoom details, visiting zooms into first-person details, and back returns cleanly", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /skill tree/i }).click();
  await expect(page).toHaveURL(/\/tree$/);

  // Top header and 8-tab nav are replaced with a simple Back button
  await expect(page.locator("header.hud-header")).toHaveCount(0);
  await expect(page.locator("nav.nav-tabs")).toHaveCount(0);
  await expect(page.getByTestId("skill-tree-back")).toBeVisible();

  // Orbit view stays clean — landmark details do NOT appear until zoomed into a landmark
  const planet = page.locator("section.skill-planet");
  await expect(planet).toHaveAttribute("data-view-mode", "orbit");
  await expect(page.locator(".skill-orbit canvas")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("landmark-details")).toHaveCount(0);

  // Typing in Find a skill focuses the closest aligned skill without opening full details yet
  const search = page.getByRole("searchbox", { name: "Find a skill" });
  await search.fill("dependency injection");
  await expect(page.getByTestId("landmark-visit-pill")).toContainText(/dependency injection/i);
  await expect(page.getByTestId("landmark-details")).toHaveCount(0);

  // Clicking the visit pill zooms into First-Person View and reveals landmark details
  await page.getByTestId("landmark-visit-pill").click();
  await expect(planet).toHaveAttribute("data-view-mode", "first-person");
  const details = page.getByTestId("landmark-details");
  await expect(details).toBeVisible();
  await expect(details).toContainText(/dependency injection/i);

  // Clicking prerequisite navigates directly to that landmark in first-person view
  const prereqBtn = details.locator(".landmark-fp-prereq .planet-prereq");
  const prereqTitle = await prereqBtn.innerText();
  await prereqBtn.click();
  await expect(details.locator(".landmark-fp-title")).toContainText(prereqTitle);

  // Clicking connected landmark jumps back to FastAPI DI in first-person view
  await details.getByText(/Connected landmarks \(/).click();
  await details.locator(".skill-routes-list button").filter({ hasText: /dependency injection/i }).first().click();
  await expect(details.locator(".landmark-fp-title")).toContainText(/dependency injection/i);

  // Back to planet returns cleanly to orbit view & hides details again
  await page.getByTestId("landmark-back-btn").click();
  await expect(planet).toHaveAttribute("data-view-mode", "orbit");
  await expect(page.getByTestId("landmark-details")).toHaveCount(0);

  // Category filter and Prerequisite map still work seamlessly
  await page.getByLabel("Filter skill tree by category").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Prerequisite map" }).click();
  await expect(page.getByTestId("skill-tree-svg-stage")).toBeVisible();
  await page.getByRole("button", { name: "Planet", exact: true }).click();
  await expect(planet).toHaveAttribute("data-view-mode", "orbit");

  // Simple Back button leaves Skill Tree back to the main dashboard shell
  await page.getByTestId("skill-tree-back").click();
  await expect(page.locator("header.hud-header")).toBeVisible();
  await expect(page.locator("nav.nav-tabs")).toBeVisible();
});

test("first-person open module navigates into the selected lesson", async ({ page }) => {
  await page.goto("/tree");
  await expect(page.locator(".skill-orbit canvas")).toHaveAttribute("data-ready", "true");
  const search = page.getByRole("searchbox", { name: "Find a skill" });
  await search.fill("dependency injection");
  await expect(page.getByTestId("landmark-visit-pill")).toContainText(/dependency injection/i);
  await search.press("Enter");
  await expect(page.getByTestId("landmark-details")).toBeVisible();
  await page.getByRole("button", { name: "Open module" }).click();
  await expect(page).toHaveURL(/fastapi-di-middleware-201/);
});

test("a phone without WebGL can visit a landmark cleanly with zero overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => Object.defineProperty(window, "WebGL2RenderingContext", { value: undefined }));
  await page.goto("/tree");
  await expect(page.locator(".skill-fallback-globe")).toBeVisible();
  await expect(page.getByTestId("landmark-details")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause rotation" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // Choose a landmark from the fallback selector to view its details
  const picker = page.getByLabel("Visit a landmark");
  await picker.selectOption({ index: 1 });
  await expect(page.getByTestId("landmark-details")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("dragging rotates the world in orbit and looks around in first-person without shader errors", async ({
  page,
}) => {
  const shaderErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /shader|webgl/i.test(msg.text())) shaderErrors.push(msg.text());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tree");
  const canvas = page.locator(".skill-orbit canvas");
  await expect(canvas).toHaveAttribute("data-ready", "true");

  // Orbit drag rotates globe without opening landmark details
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  const beforeOrbit = await canvas.screenshot();
  await page.mouse.down();
  await page.mouse.move(x + 83, y + 34, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas.screenshot()).equals(beforeOrbit)).toBe(false);
  await expect(page.getByTestId("landmark-details")).toHaveCount(0);

  // Enter first-person view and drag to look around
  const search = page.getByRole("searchbox", { name: "Find a skill" });
  await search.fill("dependency injection");
  await expect(page.getByTestId("landmark-visit-pill")).toContainText(/dependency injection/i);
  await page.getByTestId("landmark-visit-pill").click();
  await expect(page.getByTestId("landmark-details")).toBeVisible();

  const beforeFp = await canvas.screenshot();
  await page.mouse.move(x, y - 40);
  await page.mouse.down();
  await page.mouse.move(x + 110, y - 105, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas.screenshot()).equals(beforeFp)).toBe(false);

  expect(shaderErrors).toEqual([]);
  if (process.env.SKILL_PLANET_PREVIEW) {
    await page.screenshot({ path: process.env.SKILL_PLANET_PREVIEW, fullPage: true });
  }
});

test("search miss preserves last focus and Escape exits first-person view", async ({ page }) => {
  await page.goto("/tree");
  const search = page.getByRole("searchbox", { name: "Find a skill" });
  await search.fill("dependency injection");
  await expect(page.getByTestId("landmark-visit-pill")).toContainText(/dependency injection/i);
  await search.fill("zzzz-no-such-skill");
  await expect(page.getByRole("status")).toContainText("No matching skill");
  await expect(page.getByTestId("landmark-visit-pill")).toContainText(/dependency injection/i);
  await search.press("Escape");
  await expect(search).toHaveValue("");

  await page.getByTestId("landmark-visit-pill").click();
  await expect(page.getByTestId("landmark-details")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("landmark-details")).toHaveCount(0);
});
