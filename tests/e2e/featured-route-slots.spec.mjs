import { test, expect } from "@playwright/test";

test("POI section renders extra POIs on featured route", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".poi-list")).toBeVisible();
  await expect(page.locator(".poi-card-title", { hasText: "בית קפה לדוגמה" })).toBeVisible();
});

test("empty gallery slot does not render a Photos section", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await expect(page.locator(".featured-gallery")).toHaveCount(0);
});
