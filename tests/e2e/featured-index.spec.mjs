import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("/featured alias lists recommended routes", async ({ page }) => {
  await page.goto("/featured/");
  await expect(page).toHaveTitle(/מסלולים מומלצים/);
  await expect(page.locator(".route-card", { hasText: "סובב בית הלל" })).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "בניאס" })).toBeVisible();
  await expect(
    page.locator(".route-card", { hasText: "סובב בית הלל" }).locator(".route-card__badges"),
  ).toContainText("מעגלי");
  await expect(
    page.locator(".route-card", { hasText: "מסע בעקבות כובשי הגולן" }).locator(".route-card__badges"),
  ).toContainText("חד כיווני");
  const imageLocator = page.locator(".route-card__media img");
  await expect(imageLocator).not.toHaveCount(0);
  const imageCount = await imageLocator.count();
  for (let i = 0; i < imageCount; i++) {
    const image = imageLocator.nth(i);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() =>
      image.evaluate((img) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
  }
  const images = await page.locator(".route-card__media img").evaluateAll((imgs) =>
    imgs.map((img) => ({
      currentSrc: img.currentSrc,
      naturalWidth: img.naturalWidth,
    })),
  );
  expect(images.every((image) => image.currentSrc.includes("/public-data/poi-images/"))).toBe(true);
  expect(images.every((image) => !image.currentSrc.includes("/featured/public-data/"))).toBe(true);
});

test("front page routes nav opens /featured without blank client transition", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "מסלולים", exact: true }).click();
  await expect(page).toHaveURL(/\/featured\/$/);
  await expect(page.locator(".routes-page")).toBeVisible();
  await expect(page.locator(".route-card", { hasText: "סובב בית הלל" })).toBeVisible();
});

test("route card details open canonical /routes detail page", async ({ page }) => {
  await page.goto("/featured");
  const card = page.locator(".route-card", { hasText: "סובב בית הלל" });
  await expect(card.getByRole("link", { name: "פתח במפה" })).toHaveAttribute("href", /route=/);
  await page
    .locator(".route-card", { hasText: "סובב בית הלל" })
    .getByRole("link", { name: "פתח פרטי מסלול: סובב בית הלל" })
    .click();
  await expect(page).toHaveURL(/\/routes\/sovev-beit-hillel$/);
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
});

test("TopBar appears on /featured page", async ({ page }) => {
  await page.goto("/featured");
  await expect(page.locator("header.header")).toBeVisible();
  await expect(page.locator(".site-title")).toContainText("מפת שבילי אופניים");
  await expect(page.getByRole("link", { name: "מסלולים" })).toHaveAttribute("href", /\/featured\/$/);
});

test("TopBar site title links back to /", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await page.locator(".site-title-link").click();
  await expect(page).toHaveURL(/\/$/);
});
