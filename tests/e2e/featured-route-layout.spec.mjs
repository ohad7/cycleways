import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test.describe("desktop layout", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("video-first side map visible on desktop", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await expect(page.locator(".sbh-video .featured-video-frame")).toBeVisible();
    await expect(page.locator(".sbh-side-map")).toBeVisible();
    await expect(page.locator(".sbh-moments")).toBeVisible();
    await expect(page.locator(".sbh-moments .sbh-side-heading")).toHaveCount(0);
    await expect(page.locator(".sbh-carousel-dots")).toHaveCount(0);
    await expect(page.locator(".sbh-carousel-counter")).toContainText(/1 \/ \d+/);
    await expect(page.locator(".sbh-moment-image-button")).toBeVisible();
    await expect(page.locator(".sbh-carousel-arrow--left")).toBeVisible();
    await expect(page.locator(".sbh-carousel-arrow--left")).toHaveText("<");
    await expect(page.locator(".sbh-carousel-arrow--right")).toBeVisible();
    await expect(page.locator(".sbh-carousel-arrow--right")).toHaveText(">");
    await expect(page.locator(".sbh-moment-card")).toContainText("חוף קולומביה");
    await expect(page.locator(".featured-route-sticky-map")).toHaveCount(0);

    const videoBox = await page.locator(".sbh-video .featured-video-frame").boundingBox();
    expect(videoBox.y + videoBox.height).toBeLessThanOrEqual(900);

    const imageBox = await page.locator(".sbh-moment-figure").boundingBox();
    const leftArrowBox = await page.locator(".sbh-carousel-arrow--left").boundingBox();
    const rightArrowBox = await page.locator(".sbh-carousel-arrow--right").boundingBox();
    expect(leftArrowBox.x).toBeGreaterThanOrEqual(imageBox.x);
    expect(leftArrowBox.x + leftArrowBox.width).toBeLessThan(imageBox.x + imageBox.width / 2);
    expect(rightArrowBox.x).toBeGreaterThan(imageBox.x + imageBox.width / 2);
    expect(rightArrowBox.x + rightArrowBox.width).toBeLessThanOrEqual(imageBox.x + imageBox.width);
    expect(leftArrowBox.y).toBeGreaterThanOrEqual(imageBox.y);
    expect(rightArrowBox.y + rightArrowBox.height).toBeLessThanOrEqual(imageBox.y + imageBox.height);
    expect(leftArrowBox.width).toBeLessThan(leftArrowBox.height);
    expect(rightArrowBox.width).toBeLessThan(rightArrowBox.height);
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
