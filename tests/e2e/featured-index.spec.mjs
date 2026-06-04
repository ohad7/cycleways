import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("/featured alias lists recommended routes", async ({ page }) => {
  await page.goto("/featured/");
  await expect(page.locator(".route-card", { hasText: "סובב בית הלל" })).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "בניאס" })).toBeVisible();
  await expect(page.locator(".route-card__media img")).toHaveCount(2);
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".route-card__media img")).every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  const images = await page.locator(".route-card__media img").evaluateAll((imgs) =>
    imgs.map((img) => ({
      currentSrc: img.currentSrc,
      naturalWidth: img.naturalWidth,
    })),
  );
  expect(images.every((image) => image.currentSrc.includes("/public-data/poi-images/"))).toBe(true);
  expect(images.every((image) => !image.currentSrc.includes("/featured/public-data/"))).toBe(true);
});

test("route card details open canonical /routes detail page", async ({ page }) => {
  await page.goto("/featured");
  await page
    .locator(".route-card", { hasText: "סובב בית הלל" })
    .getByRole("link", { name: "פרטים" })
    .click();
  await expect(page).toHaveURL(/\/routes\/sovev-beit-hillel$/);
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
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
