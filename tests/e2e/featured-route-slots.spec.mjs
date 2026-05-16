import { test, expect } from "@playwright/test";

test("featured route page renders header and content card", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".featured-route-content-card")).toBeVisible();
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
});

test("empty gallery slot does not render a Photos section", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".featured-gallery")).toHaveCount(0);
});
