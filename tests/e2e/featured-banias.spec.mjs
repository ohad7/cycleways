import { test, expect } from "@playwright/test";

test("banias gan hatsafon featured page renders the video-first shell", async ({ page }) => {
  await page.goto("/featured/banias-gan-hatsafon");
  await expect(page.locator(".featured-route-video-first")).toBeVisible();
  await expect(page.locator(".fv-playback")).toBeVisible();
  await expect(page.locator(".fv-route-panel")).toBeVisible();
  await expect(page.locator(".fv-poi-stories")).toBeVisible();
  await expect(page.locator(".featured-route-header h1")).toContainText("בניאס");
});
