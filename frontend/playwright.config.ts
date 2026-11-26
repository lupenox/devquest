import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: process.env.DEVQUEST_E2E_URL || "http://127.0.0.1:8765",
    headless: true,
  },
});
