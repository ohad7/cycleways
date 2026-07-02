import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

const COMPACT_ROUTE = "Bjjy1nRHHDArrNAoctqGv4RHL3un";
const RECOMMENDED_ROUTES_SOURCE_ID = "react-recommended-routes";
const VIDEO_CURSOR_LAYER_IDS = [
  "video-cursor-progress-layer",
  "video-cursor-trail-layer",
  "video-cursor-pulse-layer",
  "video-cursor-halo-layer",
  "video-cursor-nav-circle-layer",
  "video-cursor-layer",
  "video-cursor-symbol-layer",
];

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("mobile: Discover homepage is standalone, build opens the map sheet", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const home = page.getByTestId("mobile-discover-home");
  await expect(home).toBeVisible();
  await expect(home.getByText("לאן רוכבים היום?")).toBeVisible();
  await expect(home.locator(".panel-route-hero")).toBeVisible();
  await expect(home.locator(".panel-route-card").first()).toBeVisible();
  await expect(page.locator(".front-sheet")).toHaveCount(0);
  await expect(page.locator(".map-container")).toHaveCount(0);

  await home.getByRole("button", { name: "+ תכנן מסלול" }).click();
  const sheet = page.locator(".front-sheet");
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await expect(sheet.locator(".front-sheet__build-peek")).toContainText("מסלול חדש");
  await expect(sheet.locator(".front-sheet__mode-switch")).toHaveCount(0);
  await expect(page.getByTestId("front-panel").getByRole("tab")).toHaveCount(0);
  await expect(page.locator(".mobile-build-topbar")).toHaveCount(0);
  await expect(page.locator(".header")).toBeVisible();
  await expect(page.getByRole("link", { name: /מפת שבילי אופניים/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "פתיחת תפריט" })).toBeVisible();
  const viewportFit = await page.locator(".front-shell").evaluate((shell) => {
    const rect = shell.getBoundingClientRect();
    const headerRect = document.querySelector(".header")?.getBoundingClientRect();
    const styles = window.getComputedStyle(document.body);
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      headerBottom: Math.round(headerRect?.bottom ?? 0),
      viewportHeight: window.innerHeight,
      bodyBackground: styles.backgroundImage,
      bodyBackgroundColor: styles.backgroundColor,
      documentOverflow: document.documentElement.scrollHeight - window.innerHeight,
    };
  });
  expect(Math.abs(viewportFit.top - viewportFit.headerBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(viewportFit.bottom - viewportFit.viewportHeight)).toBeLessThanOrEqual(1);
  expect(viewportFit.bodyBackground).toBe("none");
  expect(viewportFit.documentOverflow).toBeLessThanOrEqual(1);
  const horizontalFit = await page.locator(".front-shell").evaluate((shell) => {
    const sheet = shell.querySelector(".front-sheet");
    const canvas = shell.querySelector(".mapboxgl-canvas");
    if (!sheet || !canvas) return null;
    const sheetRect = sheet.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      sheetLeft: Math.round(sheetRect.left),
      sheetRight: Math.round(sheetRect.right),
      canvasLeft: Math.round(canvasRect.left),
      canvasRight: Math.round(canvasRect.right),
    };
  });
  expect(horizontalFit).toBeTruthy();
  expect(Math.abs(horizontalFit.sheetLeft - horizontalFit.canvasLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(horizontalFit.sheetRight - horizontalFit.canvasRight)).toBeLessThanOrEqual(1);
});

test("mobile: Discover homepage does not mount the map route overlay", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  await expect(page.getByTestId("mobile-discover-home")).toBeVisible();
  await expect(page.locator(".front-sheet")).toHaveCount(0);
  await expect(page.locator(".map-container")).toHaveCount(0);
  expect(await recommendedRouteFeatureCount(page)).toBe(0);
});

test("mobile: selecting a route opens the dedicated route page", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const home = page.getByTestId("mobile-discover-home");
  await expect(home).toBeVisible();
  const card = home.locator(".panel-route-card-wrap").first();
  await expect(card).toHaveAttribute("href", /\/routes\/[a-z0-9-]+/);
  await card.click();
  await expect(page).toHaveURL(/\/routes\/[a-z0-9-]+$/, { timeout: 20_000 });
  await expect(page.locator(".front-sheet")).toHaveCount(0);
});

test("mobile: build drawer scroll area reaches route controls", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto(`/?route=${COMPACT_ROUTE}`);
  await expect(page.locator(".front-sheet")).toHaveAttribute("data-snap", "half");
  await ensurePanelOpen(page);
  await expect(page.locator(".build-panel")).toContainText("4.5");
  const metrics = await page.locator(".front-shell").evaluate((shell) => {
    const body = shell.querySelector(".front-panel__body");
    const actions = shell.querySelector(".build-panel__actions");
    if (!body || !actions) return null;
    body.scrollTop = body.scrollHeight;
    const shellRect = shell.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      actionsBottom: Math.round(actionsRect.bottom),
      bodyBottom: Math.round(bodyRect.bottom),
      bodyCanScroll: body.scrollHeight > body.clientHeight,
      bodyHeight: Math.round(bodyRect.height),
      shellBottom: Math.round(shellRect.bottom),
    };
  });
  expect(metrics).toBeTruthy();
  expect(metrics.bodyCanScroll).toBe(true);
  expect(metrics.bodyBottom).toBeLessThanOrEqual(metrics.shellBottom + 1);
  expect(metrics.actionsBottom).toBeLessThanOrEqual(metrics.bodyBottom + 2);
});

test("mobile: clearing route removes playback shadow", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto(`/?route=${COMPACT_ROUTE}`);
  await expect(page.locator(".front-sheet")).toHaveAttribute("data-snap", "half");
  const sheet = page.locator(".front-sheet");
  const playback = page.locator(".planner-route-playback--map");
  await expect(playback).toBeVisible();
  await expect.poll(async () => {
    const sheetBox = await sheet.boundingBox();
    const playbackBox = await playback.boundingBox();
    if (!sheetBox || !playbackBox) return false;
    const gap = sheetBox.y - (playbackBox.y + playbackBox.height);
    return gap >= 2 && gap <= 10;
  }).toBe(true);
  await page.getByRole("button", { name: "נגן מסלול על המפה" }).click();
  await expect(page.locator(".front-sheet")).toHaveAttribute("data-snap", "half");
  await expect.poll(() => hasVideoCursorLayer(page)).toBe(true);
  await ensurePanelOpen(page);
  await page.getByRole("button", { name: "נקה" }).click();
  await expect.poll(() => hasVideoCursorLayer(page)).toBe(false);
});

test("mobile: בניית מסלול opens a build-only sheet", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const home = page.getByTestId("mobile-discover-home");
  await expect(home).toBeVisible();
  await home.getByRole("button", { name: "+ תכנן מסלול" }).click();
  const sheet = page.locator(".front-sheet");
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await expect(sheet.locator(".front-sheet__build-peek")).toContainText("מסלול חדש");
  await expect(page.getByTestId("front-panel").getByRole("tab")).toHaveCount(0);
  await expect(page.locator(".mobile-build-topbar")).toHaveCount(0);
});

test("mobile: full drawer hides the map playback control", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto(`/?route=${COMPACT_ROUTE}`);
  const sheet = page.locator(".front-sheet");
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await expect(page.locator(".planner-route-playback--map")).toBeVisible();
  await sheet.getByRole("button", { name: "שנה גודל פאנל" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(page.locator(".planner-route-playback--map")).toHaveCount(0);
});

test("desktop: no sheet affordances, side panel as before", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop-only");
  await page.goto("/");
  await expect(page.getByTestId("front-panel")).toBeVisible();
  await expect(page.locator(".front-sheet__grip")).toBeHidden();
  await expect(page.locator(".front-sheet__peek")).toBeHidden();
});

test("Discover filters survive a toggle to Build and back", async ({ page, isMobile }) => {
  test.skip(isMobile, "mobile Discover is standalone and has no Search/Build tabs");
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await ensurePanelOpen(page);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "סינון" }).click();
  const chip = panel.getByRole("button", { name: "קל", exact: true }).first();
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  await panel.getByRole("tab", { name: "חפש מסלול" }).click();
  await panel.getByRole("button", { name: "סינון" }).click();
  await expect(
    panel.getByRole("button", { name: "קל", exact: true }).first(),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Discover cards link to the route page", async ({ page, isMobile }) => {
  await page.goto("/");
  const scope = isMobile ? page.getByTestId("mobile-discover-home") : page.getByTestId("front-panel");
  if (!isMobile) await ensurePanelOpen(page);
  await expect(scope).toBeVisible();
  const link = scope
    .locator(".panel-route-card-wrap")
    .first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /\/routes\/[a-z0-9-]+/);
});

async function recommendedRouteFeatureCount(page) {
  const features = await recommendedRouteFeatures(page);
  return features.length;
}

async function recommendedRouteFeatures(page) {
  return page.evaluate((sourceId) => {
    const source = window.__mockMapboxCurrentMap?.sources?.get(sourceId);
    return (source?.data?.features ?? []).map((feature) => ({
      hovered: feature.properties?.hovered,
      tier: feature.properties?.tier,
    }));
  }, RECOMMENDED_ROUTES_SOURCE_ID);
}

async function hasVideoCursorLayer(page) {
  return page.evaluate((layerIds) => {
    const layers = window.__mockMapboxCurrentMap?.layers;
    return layerIds.some((id) => layers?.has(id));
  }, VIDEO_CURSOR_LAYER_IDS);
}
