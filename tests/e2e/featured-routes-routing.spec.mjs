import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("/featured index renders", async ({ page }) => {
  await page.goto("/featured");
  await expect(page.locator(".routes-page")).toBeVisible();
});

test("/featured/:slug page renders 404 message for unknown slug", async ({ page }) => {
  await page.goto("/featured/test-route");
  await expect(page.locator(".featured-route-404")).toContainText("test-route");
});

test("/featured/:slug renders promoted catalog route without a source module", async ({ page }) => {
  await page.goto("/featured/sovev-dafna");
  await expect(page.locator(".featured-route-404")).toHaveCount(0);
  await expect(page.locator(".featured-route-video-first")).toBeVisible();
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב דפנה");
  await expect(page.locator(".fv-video .featured-video-frame")).toBeVisible();
});

test("existing planner at / still loads the map", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".map-container")).toBeVisible();
});
