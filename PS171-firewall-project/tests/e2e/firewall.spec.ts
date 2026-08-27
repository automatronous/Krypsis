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
