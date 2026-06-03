import { test, expect } from "@playwright/test";

test("featured route page renders header and video-first shell", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".featured-route-video-first")).toBeVisible();
  await expect(page.locator(".fv-playback")).toBeVisible();
  await expect(page.locator(".fv-route-panel")).toBeVisible();
  await expect(page.locator(".fv-poi-stories")).toBeVisible();
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
});

test("empty gallery slot does not render a Photos section", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".featured-gallery")).toHaveCount(0);
});

test("document title is the featured route name, not the front-page title", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".featured-route-header h1")).toBeVisible();
  await expect(page).toHaveTitle(/^סובב בית הלל \|/);
});
