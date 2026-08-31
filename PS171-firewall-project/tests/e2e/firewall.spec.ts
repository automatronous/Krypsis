import { test, expect } from "@playwright/test";
test("synthetic sensitive page is available for extension integration", async ({
  page
}) => {
  await page.goto("basic/index.html");
  await expect(
    page.getByRole("heading", { name: "Order #39482" })
  ).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(1);
});
test("malicious page preserves untrusted attack fixture", async ({ page }) => {
  await page.goto("malicious/index.html");
  await expect(page.getByText(/Normal product content/)).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(1);
});

test("visual page fixture supports OCR testing for visible text extraction", async ({ page }) => {
  await page.goto("visual/index.html");
  // Verify that visible text elements are present on the page
  // OCR should be able to extract these during pipeline execution
  const heading = await page.locator("h1").first();
  await expect(heading).toBeVisible();
  // Ensure the page has renderable content for OCR extraction
  const contentArea = await page.locator("body").boundingBox();
  expect(contentArea).not.toBeNull();
  expect(contentArea?.width).toBeGreaterThan(0);
  expect(contentArea?.height).toBeGreaterThan(0);
});

