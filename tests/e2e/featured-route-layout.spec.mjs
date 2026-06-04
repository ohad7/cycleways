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
    await expect(page.locator(".elevation-profile")).toBeVisible();
    await expect(page.locator(".fv-video-progress-distance")).toContainText("מרחק מההתחלה");
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
    const elevationChartBox = await page.locator(".elevation-chart").boundingBox();
    const videoDistanceBox = await page.locator(".fv-video-progress-distance").boundingBox();
    const videoTimeBox = await page.locator(".fv-video-time").boundingBox();
    const pipBox = await page.locator(".fv-video-shell .fv-mobile-map").boundingBox();
    const storyBox = await columbiaStory.boundingBox();
    expect(videoBox.y + videoBox.height).toBeLessThanOrEqual(900);
    expect(panelBox.x).toBeGreaterThan(videoBox.x);
    expect(panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height)).toBeLessThanOrEqual(24);
    expect(elevationChartBox.y + elevationChartBox.height).toBeLessThanOrEqual(900);
    expect(elevationChartBox.y).toBeGreaterThan(elevationWrapBox.y);
    expect(videoDistanceBox.x).toBeGreaterThan(videoBox.x);
    expect(videoDistanceBox.x).toBeGreaterThan(videoTimeBox.x);
    expect(videoDistanceBox.y).toBeGreaterThan(videoBox.y + videoBox.height - 90);
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

  test("PiP map opens an expanded desktop map dialog", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await page.locator(".fv-video-shell .fv-mobile-map .featured-map-expand-btn").click();

    const dialog = page.getByRole("dialog", { name: "מפת המסלול" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".featured-map-expanded-distance")).toBeVisible();

    const panelBox = await dialog.locator(".featured-map-expanded-panel").boundingBox();
    expect(panelBox.width).toBeGreaterThan(800);
    expect(panelBox.height).toBeGreaterThan(600);

    await dialog.getByRole("button", { name: "סגור מפה" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".fv-video .featured-video-frame")).toBeVisible();
  });

  test("hovering the elevation graph moves the video cursor", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    const overlay = page.locator(".elevation-hover-overlay");
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    // The hover sets a video cursor; the elevation marker line becomes visible.
    await expect(page.locator(".elevation-profile svg line")).toHaveAttribute("opacity", "1");
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
    await expect(page.locator(".fv-video-progress-distance")).toBeVisible();

    const videoBox = await page.locator(".fv-video .featured-video-frame").boundingBox();
    const mapBox = await page.locator(".fv-mobile-map").boundingBox();
    const mobileDistanceBox = await page.locator(".fv-video-progress-distance").boundingBox();
    const mobileTimeBox = await page.locator(".fv-video-time").boundingBox();
    const mobileStatsBox = await page.locator(".fv-side-elevation-wrap .fv-route-stats").boundingBox();
    const mobileChartBox = await page.locator(".fv-side-elevation-wrap .elevation-chart").boundingBox();
    const mobileSvgBox = await page.locator(".fv-side-elevation-wrap .elevation-chart svg").boundingBox();
    expect(Math.abs((videoBox.width / videoBox.height) - 0.8)).toBeLessThan(0.02);
    expect(mapBox.width).toBeLessThanOrEqual(130);
    expect(mapBox.height).toBeLessThanOrEqual(130);
    expect(mapBox.x).toBeGreaterThan(videoBox.x + videoBox.width / 2);
    expect(mapBox.y).toBeGreaterThanOrEqual(videoBox.y);
    expect(mapBox.y + mapBox.height).toBeLessThan(videoBox.y + videoBox.height);
    expect(mobileDistanceBox.x).toBeGreaterThan(mobileTimeBox.x);
    expect(mobileDistanceBox.y).toBeGreaterThan(videoBox.y + videoBox.height - 80);
    expect(mobileStatsBox.height).toBeLessThanOrEqual(52);
    expect(mobileChartBox.height).toBeGreaterThanOrEqual(145);
    expect(Math.abs(mobileSvgBox.height - mobileChartBox.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(mobileSvgBox.width - mobileChartBox.width)).toBeLessThanOrEqual(1);
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

  test("mini map opens an expanded mobile map sheet", async ({ page }) => {
    await page.goto("/featured/sovev-beit-hillel");
    await page.locator(".fv-mobile-map .featured-map-expand-hit").click();

    const dialog = page.getByRole("dialog", { name: "מפת המסלול" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".featured-map-expanded-distance")).toBeVisible();

    const panelBox = await dialog.locator(".featured-map-expanded-panel").boundingBox();
    expect(panelBox.width).toBeGreaterThan(360);
    expect(panelBox.height).toBeGreaterThan(560);
    expect(panelBox.y).toBeGreaterThan(100);

    await dialog.getByRole("button", { name: "סגור מפה" }).click();
    await expect(dialog).toHaveCount(0);
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
