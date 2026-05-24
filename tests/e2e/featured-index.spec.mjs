import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("/featured gallery lists known featured routes", async ({ page }) => {
  await page.goto("/featured");
  await expect(page.locator(".featured-gallery-card", { hasText: "סובב בית הלל" })).toBeVisible();
  await expect(page.locator(".featured-gallery-card", { hasText: "שדה נחמיה" })).toBeVisible();
});

test("clicking a gallery card opens its featured-route page", async ({ page }) => {
  await page.goto("/featured");
  await page.locator(".featured-gallery-card", { hasText: "סובב בית הלל" }).click();
  await expect(page).toHaveURL(/\/featured\/sovev-beit-hillel$/);
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
});

test("home page recommendations link to /featured", async ({ page }) => {
  await page.goto("/");
  await page.locator("a", { hasText: "דף המסלולים המומלצים" }).click();
  await expect(page).toHaveURL(/\/featured$/);
});

test("TopBar appears on /featured page", async ({ page }) => {
  await page.goto("/featured");
  await expect(page.locator("header.header")).toBeVisible();
  await expect(page.locator(".site-title")).toContainText("מפת שבילי אופניים");
});

test("TopBar site title links back to /", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await page.locator(".site-title-link").click();
  await expect(page).toHaveURL(/\/$/);
});
