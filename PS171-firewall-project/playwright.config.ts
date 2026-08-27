import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const installedBrowser =
  process.env.PS171_BROWSER_EXECUTABLE ??
  (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : undefined);
const fixtureBase = `${pathToFileURL(path.join(process.cwd(), "test-sites")).href}/`;
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  use: {
    baseURL: fixtureBase,
    headless: true,
    launchOptions: installedBrowser
      ? { executablePath: installedBrowser }
      : undefined
  }
});
