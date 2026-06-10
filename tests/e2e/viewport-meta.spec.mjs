import { test, expect } from "@playwright/test";

test("viewport meta allows pinch zoom (no user-scalable=no)", async ({ page }) => {
  await page.goto("/");
  const content = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(content).toContain("width=device-width");
  expect(content).not.toContain("user-scalable=no");
});
