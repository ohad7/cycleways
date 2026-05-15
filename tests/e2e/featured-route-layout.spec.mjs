import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test.describe("desktop layout", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("sticky map column visible on desktop", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await expect(page.locator(".featured-route-sticky-map")).toBeVisible();
    await expect(page.locator(".featured-map-inline")).toHaveCount(0);
  });
});

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("inline map visible on mobile, sticky map hidden", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await expect(page.locator(".featured-map-inline")).toBeVisible();
    await expect(page.locator(".featured-route-sticky-map")).toHaveCount(0);
  });

  test("fullscreen map opens and closes", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await page.locator(".featured-map-fullscreen-btn").click();
    await expect(page.locator(".featured-map-fullscreen-overlay")).toBeVisible();
    await page.locator(".featured-map-fullscreen-close").click();
    await expect(page.locator(".featured-map-fullscreen-overlay")).toHaveCount(0);
  });

  test("Escape key closes fullscreen map", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await page.locator(".featured-map-fullscreen-btn").click();
    await expect(page.locator(".featured-map-fullscreen-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".featured-map-fullscreen-overlay")).toHaveCount(0);
  });
});
