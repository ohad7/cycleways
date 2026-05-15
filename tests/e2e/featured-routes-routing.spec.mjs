import { test, expect } from "@playwright/test";

test("placeholder /featured index renders", async ({ page }) => {
  await page.goto("/featured");
  await expect(page.locator(".featured-index-placeholder")).toBeVisible();
});

test("placeholder /featured/:slug page renders with slug", async ({ page }) => {
  await page.goto("/featured/test-route");
  await expect(page.locator(".featured-route-placeholder")).toContainText("test-route");
});

test("existing planner at / still loads the map", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".map-container")).toBeVisible();
});
