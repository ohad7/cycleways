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
    await expect(page.locator(".sbh-video-shell")).toBeVisible();
    await expect(page.locator(".sbh-video-controls")).toBeVisible();
    await expect(page.locator(".sbh-video-scrubber")).toBeVisible();
    await expect(page.locator(".sbh-route-panel")).toBeVisible();
    await expect(page.locator(".sbh-side-map")).toBeVisible();
    await expect(page.locator(".sbh-side-heading")).toContainText("מרחק מההתחלה");
    await expect(page.locator(".sbh-side-heading")).toContainText(/0 מ׳|\d+(\.\d)? ק״מ/);
    await expect(page.locator(".sbh-side-heading")).not.toContainText("מפה חיה");
    await expect(page.locator(".sbh-moments")).toHaveCount(0);
    await expect(page.locator(".sbh-carousel-arrow")).toHaveCount(0);
    await expect(page.locator(".sbh-carousel-dots")).toHaveCount(0);
    await expect(page.locator(".sbh-carousel-counter")).toHaveCount(0);
    await expect(page.locator(".sbh-poi-stories")).toBeVisible();
    await expect(page.locator(".sbh-poi-story").first()).toContainText("חוף קולומביה");
    await expect(page.locator(".featured-route-sticky-map")).toHaveCount(0);

    const videoBox = await page.locator(".sbh-video .featured-video-frame").boundingBox();
    const panelBox = await page.locator(".sbh-route-panel").boundingBox();
    const mapBox = await page.locator(".sbh-side-map").boundingBox();
    const storyBox = await page.locator(".sbh-poi-story").first().boundingBox();
    expect(videoBox.y + videoBox.height).toBeLessThanOrEqual(900);
    expect(panelBox.x).toBeGreaterThan(videoBox.x);
    expect(mapBox.y).toBeGreaterThan(panelBox.y);
    expect(Math.abs((mapBox.y + mapBox.height) - (videoBox.y + videoBox.height))).toBeLessThanOrEqual(2);
    expect(storyBox.y).toBeGreaterThan(videoBox.y + videoBox.height);

    // The preview starts collapsed (a small clickable thumbnail of the nearest stop).
    await expect(page.locator(".sbh-video-poi-preview")).toHaveClass(/sbh-video-poi-preview--mini/);
    await page.locator(".sbh-poi-story").first().click();
    await expect(page.locator(".sbh-video-poi-preview")).toBeVisible();
    await expect(page.locator(".sbh-video-poi-preview")).not.toHaveClass(/sbh-video-poi-preview--mini/);
    await expect(page.locator(".sbh-video-poi-preview")).toContainText("חוף קולומביה");
  });
});

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("inline map visible on mobile, sticky map hidden, no fullscreen button", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await expect(page.locator(".featured-map-inline")).toBeVisible();
    await expect(page.locator(".featured-route-sticky-map")).toHaveCount(0);
    await expect(page.locator(".featured-map-fullscreen-btn")).toHaveCount(0);
  });
});
