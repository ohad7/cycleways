import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test.describe("desktop layout", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("video-first PiP map on video + elevation rail on desktop", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await expect(page.locator(".fv-video .featured-video-frame")).toBeVisible();
    await expect(page.locator(".fv-video-shell")).toBeVisible();
    await expect(page.locator(".fv-video-controls")).toBeVisible();
    await expect(page.locator(".fv-video-scrubber")).toBeVisible();
    await expect(page.locator(".fv-route-panel")).toBeVisible();
    await expect(page.getByRole("button", { name: "נגן מסלול" })).toBeVisible();
    const editLink = page.getByRole("link", { name: "פתח לעריכה" });
    await expect(editLink).toBeVisible();
    await expect(editLink).toHaveAttribute("href", /\/\?route=DvsVvkJ2SiQeaAkhgGPtCZde8S8Q8xGxbG4BSY7c32agaEz219fTkrW2ZA/);
    await expect(editLink).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("button", { name: /הורד קובץ ניווט/ })).toBeVisible();
    // The map is a PiP inside the video shell; there is no rail side-map.
    await expect(page.locator(".fv-video-shell .fv-mobile-map")).toBeVisible();
    await expect(page.locator(".fv-side-map")).toHaveCount(0);
    // The rail shows the stats block and the elevation graph.
    await expect(page.locator(".fv-route-stats")).toBeVisible();
    await expect(page.locator(".fv-side-elevation-wrap .elevation-profile")).toBeVisible();
    await expect(page.locator(".fv-mobile-elevation-strip")).toBeHidden();
    // The control readout is the route distance (progress / total), like the planner.
    await expect(page.locator(".fv-video-time")).toContainText("/");
    await expect(page.locator(".fv-video-time")).toContainText("km");
    await expect(page.locator(".fv-side-heading")).toHaveCount(0);
    await expect(page.locator(".fv-moments")).toHaveCount(0);
    await expect(page.locator(".fv-carousel-arrow")).toHaveCount(0);
    await expect(page.locator(".fv-poi-stories")).toBeVisible();
    await expect(page.locator(".fv-poi-story").first()).toContainText("התחלה");
    const columbiaStory = page.locator(".fv-poi-story").filter({ hasText: "חוף קולומביה" });
    await expect(columbiaStory).toHaveCount(1);
    await expect(page.locator(".featured-route-sticky-map")).toHaveCount(0);

    const videoBox = await page.locator(".fv-video .featured-video-frame").boundingBox();
    const panelBox = await page.locator(".fv-route-panel").boundingBox();
    const actionsBox = await page.locator(".fv-route-actions").boundingBox();
    const elevationWrapBox = await page.locator(".fv-side-elevation-wrap").boundingBox();
    const elevationChartBox = await page.locator(".fv-side-elevation-wrap .elevation-chart").boundingBox();
    const videoTimeBox = await page.locator(".fv-video-time").boundingBox();
    const pipBox = await page.locator(".fv-video-shell .fv-mobile-map").boundingBox();
    const storyBox = await columbiaStory.boundingBox();
    expect(videoBox.y + videoBox.height).toBeLessThanOrEqual(900);
    expect(panelBox.x).toBeGreaterThan(videoBox.x);
    expect(panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height)).toBeLessThanOrEqual(24);
    expect(elevationChartBox.y + elevationChartBox.height).toBeLessThanOrEqual(900);
    expect(elevationChartBox.y).toBeGreaterThan(elevationWrapBox.y);
    expect(videoTimeBox.x).toBeGreaterThan(videoBox.x);
    expect(videoTimeBox.y).toBeGreaterThan(videoBox.y + videoBox.height - 90);
    const elevationScroll = await page.locator(".fv-side-elevation-wrap").evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(elevationScroll.scrollHeight).toBeLessThanOrEqual(elevationScroll.clientHeight + 1);
    const scrollBeforePlay = await page.evaluate(() => window.scrollY);
    await page.getByRole("button", { name: "נגן מסלול" }).click();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforePlay);
    // PiP sits in the top-right region of the video.
    expect(pipBox.x).toBeGreaterThan(videoBox.x + videoBox.width / 2);
    expect(pipBox.y).toBeGreaterThanOrEqual(videoBox.y - 2);
    expect(storyBox.y).toBeGreaterThan(videoBox.y + videoBox.height);

    // The preview starts on the route-start endpoint, then follows selected POIs.
    await expect(page.locator(".fv-video-poi-preview")).toContainText("חניון כניסה בית הלל");
    await columbiaStory.click();
    await expect(page.locator(".fv-video-poi-preview")).toBeVisible();
    await expect(page.locator(".fv-video-poi-preview")).not.toHaveClass(/fv-video-poi-preview--mini/);
    await expect(page.locator(".fv-video-poi-preview")).toContainText("חוף קולומביה");
  });

  test("route action downloads the featured route GPX", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /הורד קובץ ניווט/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("sovev-beit-hillel.gpx");
  });

  test("expand swaps the map to fill the stage and the video to a PiP", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    const shell = page.locator(".fv-video-shell");
    const map = page.locator(".fv-video-shell .fv-mobile-map");

    await map.locator(".featured-map-expand-btn").click();

    // The map now fills the stage; the video shrinks to a corner PiP.
    await expect(map).toHaveClass(/featured-map-inline--map-primary/);
    const shellBox = await shell.boundingBox();
    const mapBox = await map.boundingBox();
    expect(mapBox.width).toBeGreaterThan(shellBox.width - 4);
    expect(mapBox.height).toBeGreaterThan(500);

    const pip = page
      .locator(
        ".fv-video.featured-video--pip .featured-video-frame > iframe, .fv-video.featured-video--pip .featured-video-iframe-host",
      )
      .first();
    const pipBox = await pip.boundingBox();
    expect(pipBox.width).toBeLessThan(360);
    expect(pipBox.x).toBeGreaterThan(shellBox.x + shellBox.width / 2);

    // The shared playback control bar stays pinned to the bottom of the stage.
    const controlsBox = await page.locator(".fv-video-controls").boundingBox();
    expect(controlsBox.y).toBeGreaterThan(shellBox.y + shellBox.height / 2);

    // The live video is replaced by a static poster; the synthetic engine drives
    // the route animation, so hitting play advances the distance readout.
    await expect(page.locator(".fv-video-poster")).toBeVisible();
    const distanceBefore = await page.locator(".fv-video-time").textContent();
    await page.locator(".fv-video-play-toggle").click();
    await page.waitForTimeout(700);
    const distanceAfter = await page.locator(".fv-video-time").textContent();
    expect(distanceAfter).not.toBe(distanceBefore);

    // Swap back to video-primary.
    await page.locator(".fv-video-swap-back").click();
    await expect(map).not.toHaveClass(/featured-map-inline--map-primary/);
    await expect(page.locator(".fv-video .featured-video-frame")).toBeVisible();
  });

  test("hovering the elevation graph moves the video cursor", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    const overlay = page.locator(".fv-side-elevation-wrap .elevation-hover-overlay");
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    // The hover sets a video cursor; the elevation progress-head marker appears.
    await expect(page.locator(".fv-side-elevation-wrap .elevation-progress-head-pulse")).toBeVisible();
    await expect(page.locator(".fv-side-elevation-wrap .elevation-progress-line")).toBeVisible();
    await expect(page.locator('.fv-side-elevation-wrap .elevation-chart svg path[fill="#b7d3ba"]')).toHaveCount(1);
    const markerShape = await page.locator(".fv-side-elevation-wrap .elevation-progress-head-pulse__symbol").evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const coreRect = el.closest(".elevation-progress-head-pulse__core").getBoundingClientRect();
      return {
        borderLeftWidth: Number.parseFloat(style.borderLeftWidth),
        borderTopWidth: Number.parseFloat(style.borderTopWidth),
        borderBottomWidth: Number.parseFloat(style.borderBottomWidth),
        borderLeftColor: style.borderLeftColor,
        centerDeltaX: Math.abs((rect.x + rect.width / 2) - (coreRect.x + coreRect.width / 2)),
        centerDeltaY: Math.abs((rect.y + rect.height / 2) - (coreRect.y + coreRect.height / 2)),
      };
    });
    expect(markerShape.borderLeftColor).toBe("rgb(255, 255, 255)");
    expect(markerShape.borderLeftWidth).toBeGreaterThanOrEqual(5);
    expect(markerShape.borderLeftWidth).toBeLessThanOrEqual(7);
    expect(markerShape.borderTopWidth + markerShape.borderBottomWidth).toBeGreaterThanOrEqual(7);
    expect(markerShape.borderTopWidth + markerShape.borderBottomWidth).toBeLessThanOrEqual(9);
    expect(markerShape.centerDeltaX).toBeLessThanOrEqual(1.2);
    expect(markerShape.centerDeltaY).toBeLessThanOrEqual(0.5);
  });
});

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("inline map visible on mobile, sticky map hidden, no fullscreen button", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await expect(page.locator(".featured-map-inline")).toBeVisible();
    await expect(page.locator(".featured-route-sticky-map")).toHaveCount(0);
    await expect(page.locator(".featured-map-fullscreen-btn")).toHaveCount(0);
    await expect(page.locator(".fv-mobile-map .featured-map-expand-hit")).toBeVisible();
    await expect(page.getByRole("button", { name: "נגן מסלול" })).toBeVisible();
    await expect(page.getByRole("link", { name: "פתח לעריכה" })).toBeVisible();
    await expect(page.getByRole("button", { name: /הורד קובץ ניווט/ })).toBeVisible();
    await expect(page.locator(".fv-side-elevation-wrap")).toBeVisible();
    await expect(page.locator(".fv-mobile-elevation-strip")).toBeVisible();
    await expect(page.locator(".fv-mobile-elevation-strip .fv-video-play-toggle")).toHaveCount(0);
    await expect(page.locator(".fv-side-elevation-wrap .elevation-profile")).toBeHidden();
    await expect(page.locator(".fv-video-time")).toContainText("km");

    const videoBox = await page.locator(".fv-video .featured-video-frame").boundingBox();
    const mapBox = await page.locator(".fv-mobile-map").boundingBox();
    const stageBox = await page.locator(".fv-video-stage").boundingBox();
    const stripBox = await page.locator(".fv-mobile-elevation-strip").boundingBox();
    const mobileStatsBox = await page.locator(".fv-side-elevation-wrap .fv-route-stats").boundingBox();
    const mobileChartBox = await page.locator(".fv-mobile-elevation-strip .elevation-chart").boundingBox();
    const mobileSvgBox = await page.locator(".fv-mobile-elevation-strip .elevation-chart svg").boundingBox();
    const actionBox = await page.locator(".fv-route-actions").boundingBox();
    expect(Math.abs((videoBox.width / videoBox.height) - 0.8)).toBeLessThan(0.02);
    expect(mapBox.width).toBeLessThanOrEqual(130);
    expect(mapBox.height).toBeLessThanOrEqual(130);
    expect(mapBox.x).toBeGreaterThan(videoBox.x + videoBox.width / 2);
    expect(mapBox.y).toBeGreaterThanOrEqual(videoBox.y);
    expect(mapBox.y + mapBox.height).toBeLessThan(videoBox.y + videoBox.height);
    expect(stripBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height - 2);
    expect(stripBox.y).toBeLessThanOrEqual(stageBox.y + stageBox.height + 2);
    expect(mobileChartBox.width).toBeGreaterThan(videoBox.width - 40);
    const mobileTimeBox = await page.locator(".fv-video-time").boundingBox();
    expect(mobileTimeBox.y).toBeGreaterThan(videoBox.y + videoBox.height - 80);
    expect(mobileStatsBox.height).toBeLessThanOrEqual(52);
    expect(mobileChartBox.height).toBeGreaterThanOrEqual(80);
    expect(Math.abs(mobileSvgBox.height - mobileChartBox.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(mobileSvgBox.width - mobileChartBox.width)).toBeLessThanOrEqual(2);
    expect(actionBox.y).toBeGreaterThan(740);
    const mobileElevationScroll = await page.locator(".fv-side-elevation-wrap").evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(mobileElevationScroll.scrollHeight).toBeLessThanOrEqual(mobileElevationScroll.clientHeight + 1);

    await page.getByRole("button", { name: "נגן מסלול" }).click();
    await page.waitForFunction(() => {
      const frame = document.querySelector(".fv-video .featured-video-frame");
      if (!frame) return false;
      const rect = frame.getBoundingClientRect();
      return rect.top >= 40 && rect.top <= 110 && rect.bottom > 300;
    });
  });

  test("tapping the mini map swaps it to full-screen with the video as a PiP", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    const map = page.locator(".fv-mobile-map");
    await map.locator(".featured-map-expand-hit").click();

    // The map fills the stage; the video becomes a small corner thumbnail.
    await expect(map).toHaveClass(/featured-map-inline--map-primary/);
    const mapBox = await map.boundingBox();
    expect(mapBox.width).toBeGreaterThan(360);
    expect(mapBox.height).toBeGreaterThan(400);

    const pip = page
      .locator(
        ".fv-video.featured-video--pip .featured-video-frame > iframe, .fv-video.featured-video--pip .featured-video-iframe-host",
      )
      .first();
    const pipBox = await pip.boundingBox();
    expect(pipBox.width).toBeLessThanOrEqual(160);

    // Swap back to video-primary.
    await page.locator(".fv-video-swap-back").click();
    await expect(map).not.toHaveClass(/featured-map-inline--map-primary/);
    await expect(page.locator(".fv-video .featured-video-frame")).toBeVisible();
  });

  test("poi story cards act as tappable video chapters", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    const columbiaStory = page.locator(".fv-poi-story").filter({ hasText: "חוף קולומביה" });
    await expect(columbiaStory).toHaveCount(1);
    await expect(columbiaStory.locator(".fv-poi-story-images img")).toHaveCount(2);
    await expect(columbiaStory.locator(".fv-poi-story-image-count")).toContainText("2 תמונות");

    await columbiaStory.scrollIntoViewIfNeeded();
    await columbiaStory.click();

    await expect(page.locator(".fv-video-poi-preview")).toContainText("חוף קולומביה");
    await page.waitForFunction(() => {
      const frame = document.querySelector(".fv-video .featured-video-frame");
      if (!frame) return false;
      const rect = frame.getBoundingClientRect();
      return rect.top >= 40 && rect.top <= 100 && rect.bottom > 300;
    });
  });
});
