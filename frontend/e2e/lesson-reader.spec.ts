import { test, expect } from "@playwright/test";
import path from "node:path";

test("Python Chapter 1 formats the lesson, copies runnable code, and remembers read concepts", async ({
  page, context, request,
}) => {
  const moduleId = "py-01-variables-types";
  const response = await request.get(`/api/modules/${moduleId}`);
  expect(response.ok()).toBeTruthy();
  const { content } = await response.json();
  const total = content.sections.length;

  await page.setViewportSize({ width: 1120, height: 1000 });
  await page.goto(`/modules/${moduleId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "frutiger-aero");
  const section = page.locator(".zy-section").first();
  await expect(section.getByRole("heading").locator("code.inline-code")).toHaveText("is None");
  await expect(section.locator(".zy-callout")).toContainText("value is None");
  await expect(section.locator(".tok-kw").filter({ hasText: /^if$/ })).toBeVisible();
  await expect(page.locator(".zy-section h3, .zy-section .zy-body").filter({ hasText: "`" })).toHaveCount(0);
  await expect(page.getByTestId("activity-py-01-read-check").locator("code").filter({ hasText: /^score$/ })).toBeVisible();

  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await section.getByRole("button", { name: /copy/i }).click();
  await expect(section.getByRole("button", { name: /copied/i })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(content.sections[0].code_example);

  const progress = page.locator(".concept-count");
  const toggle = section.getByRole("button", { name: "Mark read", pressed: false });
  await expect(progress).toHaveText(`Concepts read 0/${total}`);
  await toggle.click();
  await expect(progress).toHaveText(`Concepts read 1/${total}`);
  await page.reload();
  await expect(progress).toHaveText(`Concepts read 1/${total}`);
  const readButton = section.getByRole("button", { name: "Read", exact: true, pressed: true });
  await expect(readButton).toBeVisible();

  const screenshotDir = process.env.CAPTURE_WALKTHROUGH_DIR;
  if (screenshotDir) {
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshotDir, "v2_readable_zybooks_lesson.png"), animations: "disabled" });
  }

  await page.goto("/modules/py-02-control-flow");
  await expect(progress).toHaveText(/Concepts read 0\/\d+/);
  await page.goBack();
  await readButton.click();
  await expect(progress).toHaveText(`Concepts read 0/${total}`);
  await page.setViewportSize({ width: 390, height: 844 });
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewportWidth);
  for (const card of await page.locator(".zy-section").all()) {
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewportWidth);
    expect(await card.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
});
