import { test, expect } from "@playwright/test";

test("featured route shell renders header for known slug", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
});

test("featured route page returns 404-style message for unknown slug", async ({ page }) => {
  await page.goto("/featured/zzz-not-real");
  await expect(page.locator(".featured-route-404")).toBeVisible();
});
