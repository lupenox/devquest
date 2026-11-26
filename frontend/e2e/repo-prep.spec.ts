import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("select a connected repository and use the shared interview prep actions", async ({ page }) => {
  const repos = Array.from({ length: 40 }, (_, index) => ({
    full_name: `example/project-${index + 1}`,
    name: `project-${index + 1}`,
    description: `Practice project ${index + 1}`,
    language: index === 39 ? "TypeScript" : "Python",
    private: index === 39,
    html_url: `https://github.com/example/project-${index + 1}`,
  }));
  const pack = {
    id: "repo-interview-example-project-40", kind: "repo_interview",
    title: "Interview Prep: example/project-40", subtitle: "", tech_slug: "typescript",
    content: { sections: [], external_resources: [] },
    activity_count: 3, completed_count: 1,
  };
  await page.route("**/api/github/status", route => route.fulfill({ json: {
    connected: true, auth_source: "gh_cli", username: "example", public_repos: 39, private_repos: 1,
  } }));
  await page.route("**/api/github/repos*", route => route.fulfill({ json: { repos } }));
  await page.route("**/api/github/study-packs", route => route.fulfill({ json: { packs: [pack] } }));
  await page.route("**/api/ollama/models", route => route.fulfill({ json: {
    available: true, models: [{ name: "local-coder", size: 1 }, { name: "local-reviewer", size: 2 }],
  } }));
  await page.route("**/api/interviews", route => route.fulfill({ json: { interviews: [{
    id: 8, repo_full_name: "example/project-40", module_id: pack.id, status: "completed", readiness_score: 81,
  }] } }));
  await page.route("**/api/github/analyze", route => route.fulfill({ json: { module: pack } }));
  await page.route(`**/api/modules/${pack.id}`, route => route.fulfill({ json: {
    ...pack, technology: { name: "TypeScript", color: "#3178c6" }, activities: [], difficulty: "intermediate",
  } }));

  await page.setViewportSize({ width: 896, height: 929 });
  await page.goto("/repos");
  const details = (name: RegExp) => page.locator("details").filter({ has: page.locator("summary").filter({ hasText: name }) });
  const browser = page.getByTestId("repo-browser");
  await expect(browser.locator("summary")).toContainText("40");
  await expect(browser).not.toHaveAttribute("open", "");
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button")).toHaveCount(7);

  const saved = page.getByRole("region", { name: "Saved study packs" }).getByRole("button", { name: "Open pack" });
  await saved.click();
  await expect(page).toHaveURL(new RegExp(`/modules/${pack.id}$`));
  await page.goBack();
  await expect(browser.locator("summary")).toContainText("40");

  await page.setViewportSize({ width: 320, height: 844 });
  const connection = details(/GitHub connection/i);
  await connection.locator("summary").click();
  await expect(connection.getByRole("button", { name: /sync xp/i })).toBeVisible();
  await expect(connection.getByRole("textbox", { name: "GitHub username" })).toBeVisible();
  await expect(connection.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  await connection.locator("summary").click();

  const history = details(/Interview history/i);
  await history.locator("summary").click();
  await expect(history).toContainText("81%");
  await history.locator("summary").click();

  const modelSettings = details(/Model settings/i);
  await modelSettings.locator("summary").click();
  await modelSettings.getByRole("checkbox", { name: "Use Ollama to build study packs" }).check();
  await modelSettings.getByRole("combobox", { name: "Local model" }).selectOption("local-reviewer");

  await browser.locator("summary").focus();
  await browser.locator("summary").press("Enter");
  const filter = browser.getByRole("searchbox");
  await expect(browser.getByRole("button", { name: /use repository/i })).toHaveCount(6);
  await browser.getByRole("button", { name: "Next" }).click();
  await expect(browser.getByRole("link", { name: "example/project-7 on GitHub" })).toBeVisible();
  await filter.fill("no such repository");
  await expect(browser.getByText("No matching repositories.")).toBeVisible();
  await filter.fill("tYpEsCrIpT");
  await expect(browser.getByRole("link", { name: "example/project-40 on GitHub" })).toHaveAttribute("href", repos[39].html_url);
  await expect(browser.getByText("Private", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await browser.getByRole("button", { name: /use repository/i }).click();
  await expect(page.getByRole("textbox", { name: "Repository", exact: true })).toHaveValue("example/project-40");

  const request = page.waitForRequest("**/api/github/analyze");
  await page.getByRole("button", { name: /build study pack/i }).click();
  expect((await request).postDataJSON()).toEqual({
    repo: "example/project-40", use_ollama: true, model: "local-reviewer",
  });
  await expect(page).toHaveURL(new RegExp(`/modules/${pack.id}$`));
});
