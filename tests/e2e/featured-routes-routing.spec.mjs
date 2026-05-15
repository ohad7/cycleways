import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("/featured index renders", async ({ page }) => {
  await page.goto("/featured");
  await expect(page.locator(".featured-index")).toBeVisible();
});

test("/featured/:slug page renders 404 message for unknown slug", async ({ page }) => {
  await page.goto("/featured/test-route");
  await expect(page.locator(".featured-route-404")).toContainText("test-route");
});

test("existing planner at / still loads the map", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".map-container")).toBeVisible();
});
