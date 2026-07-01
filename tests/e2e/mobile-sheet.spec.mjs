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
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(sheet.locator(".front-sheet__build-peek")).toContainText("מסלול חדש");
  await sheet.getByRole("button", { name: "שנה גודל פאנל" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await expect(page.getByTestId("front-panel").getByRole("tab", { name: "בניית מסלול" })).toHaveAttribute("aria-selected", "true");
});

test("mobile: Discover homepage does not mount the map route overlay", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  await expect(page.getByTestId("mobile-discover-home")).toBeVisible();
  await expect(page.locator(".front-sheet")).toHaveCount(0);
  await expect(page.locator(".map-container")).toHaveCount(0);
  expect(await recommendedRouteFeatureCount(page)).toBe(0);
});

test("mobile: selecting a route drops the sheet back to peek", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const home = page.getByTestId("mobile-discover-home");
  await expect(home).toBeVisible();
  await home.locator(".panel-route-card").first().click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  const sheet = page.locator(".front-sheet");
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect.poll(async () => page.locator(".front-shell").evaluate((shell) => {
    const sheetEl = shell.querySelector(".front-sheet");
    const shellRect = shell.getBoundingClientRect();
    const sheetRect = sheetEl.getBoundingClientRect();
    return Math.round(shellRect.bottom - sheetRect.top);
  })).toBeLessThanOrEqual(210);
  const peekLayout = await page.locator(".front-shell").evaluate((shell) => {
    const peekEl = shell.querySelector(".front-sheet__peek");
    const playbackEl = shell.querySelector(".planner-route-playback");
    const shellRect = shell.getBoundingClientRect();
    const sheetRect = shell.querySelector(".front-sheet").getBoundingClientRect();
    const peekRect = peekEl.getBoundingClientRect();
    const playbackRect = playbackEl?.getBoundingClientRect();
    return {
      shellScrollTop: shell.scrollTop,
      visibleSheetPx: Math.round(shellRect.bottom - sheetRect.top),
      playbackBottom: playbackRect ? Math.round(playbackRect.bottom) : null,
      peekTop: Math.round(peekRect.top),
    };
  });
  expect(peekLayout.shellScrollTop).toBe(0);
  expect(peekLayout.visibleSheetPx).toBeGreaterThanOrEqual(148);
  expect(peekLayout.visibleSheetPx).toBeLessThanOrEqual(210);
  expect(peekLayout.playbackBottom).toBeLessThan(peekLayout.peekTop);

  const mapPlayback = page.locator(".planner-route-playback--map");
  const panelPlayback = page.locator(".planner-route-playback--panel");
  await expect(mapPlayback).toBeVisible();
  await expect(panelPlayback).toBeHidden();
  await sheet.getByRole("button", { name: "שנה גודל פאנל" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await expect(mapPlayback).toBeHidden();
  await expect(panelPlayback).toBeVisible();
});

test("mobile: build drawer scroll area reaches route controls", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto(`/?route=${COMPACT_ROUTE}`);
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
  await expect(page.locator(".planner-route-playback--map")).toBeVisible();
  await page.getByRole("button", { name: "נגן מסלול על המפה" }).click();
  await expect.poll(() => hasVideoCursorLayer(page)).toBe(true);
  await ensurePanelOpen(page);
  await page.getByRole("button", { name: "נקה" }).click();
  await expect.poll(() => hasVideoCursorLayer(page)).toBe(false);
});

test("mobile: בניית מסלול switches to Build and keeps the map front", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const home = page.getByTestId("mobile-discover-home");
  await expect(home).toBeVisible();
  await home.getByRole("button", { name: "+ תכנן מסלול" }).click();
  const sheet = page.locator(".front-sheet");
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(sheet.locator(".front-sheet__build-peek")).toContainText("מסלול חדש");
  await sheet.getByRole("button", { name: "שנה גודל פאנל" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await expect(
    page.getByTestId("front-panel").getByRole("tab", { name: "בניית מסלול" }),
  ).toHaveAttribute("aria-selected", "true");
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

test("Discover cards link to the route page without hijacking card selection", async ({ page, isMobile }) => {
  await page.goto("/");
  const scope = isMobile ? page.getByTestId("mobile-discover-home") : page.getByTestId("front-panel");
  if (!isMobile) await ensurePanelOpen(page);
  await expect(scope).toBeVisible();
  const link = scope
    .locator(".panel-route-card-wrap")
    .first()
    .getByRole("link", { name: "לעמוד המסלול" });
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
