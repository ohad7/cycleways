import { expect, test } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen, revealMapOnMobile } from "./sheet-helpers.mjs";

const COMPACT_ROUTE = "Bjjy1nRHHDArrNAoctqGv4RHL3un";
const ROUTE_NETWORK_HIT_LAYER_ID = "cycleways-network-hit";
const ROUTE_NETWORK_FOCUS_LAYER_ID = "cycleways-network-focus";
const ROUTE_NETWORK_HOVER_LAYER_ID = "cycleways-network-hover";
const ROUTE_GEOMETRY_LAYER_ID = "react-route-geometry-line";
const DATA_MARKERS_LAYER_ID = "react-data-markers-layer";
const ROUTE_POINTS_LAYER_ID = "react-route-points-circle";
const SEGMENT_CLICK_POINTS = [
  { lat: 33.128051854432194, lng: 35.583601947688756 },
  { lat: 33.11076673723811, lng: 35.57875100376203 },
  { lat: 33.110140144352336, lng: 35.59054934237174 },
];

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("current public app loads with route controls", async ({ page, isMobile }) => {
  await page.goto("/");

  // On mobile the landing is the discover-home screen; the map mounts once the
  // user engages Build. On desktop the map is always mounted.
  await revealMapOnMobile(page, isMobile);
  await expect(page.locator("#map")).toBeVisible();
  // Route controls now live in the right-side panel (no on-map control buttons).
  await ensurePanelOpen(page);
  await expect(page.getByTestId("front-panel")).toBeVisible();
});

test("production root restores compact route URL", async ({ page }) => {
  await page.goto(`/?route=${COMPACT_ROUTE}`);

  // Wait for the restored route (its first-point transition drops the
  // sheet to peek) before opening the panel.
  await page.waitForSelector(".map-container--route-ready", { timeout: 30000 });

  await ensurePanelOpen(page);
  await expect(page.getByTestId("front-panel")).toBeVisible();
  await expect(page.getByTestId("front-panel").getByText("4.5 ק\"מ").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "GPX" })).toBeEnabled();
  await expect(page.locator(".react-route-point-chip")).toHaveCount(0);
  expect(await getRoutePointFeatureCount(page)).toBeGreaterThan(0);

  const fitEvents = await page.evaluate(() =>
    window.__mockMapboxEvents.filter((event) => event.type === "fitBounds"),
  );
  expect(fitEvents.length).toBeGreaterThan(0);
});

test("production core flow works on desktop and mobile", async ({ page }, testInfo) => {
  await page.goto(`/?route=${COMPACT_ROUTE}`);

  // Wait for the restored route (its first-point transition drops the
  // sheet to peek) before opening the panel.
  await page.waitForSelector(".map-container--route-ready", { timeout: 30000 });

  await ensurePanelOpen(page);
  await expect(page.getByTestId("front-panel").getByText("4.5 ק\"מ").first()).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`react-route-${testInfo.project.name}.png`),
  });

  // GPX download button is directly in the build panel (no modal).
  await expect(page.locator(".build-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "GPX" })).toBeEnabled();
  await expect(page.locator(".react-route-point-chip")).toHaveCount(0);
  // Share button copies link to clipboard.
  await expect(page.getByRole("button", { name: "שיתוף" })).toBeEnabled();
});

test("production shows outside-network warning in the route panel", async ({ page }) => {
  await page.goto(`/?route=${COMPACT_ROUTE}`);
  // Wait for the build panel to be visible (route loaded, panel auto-switched to build).
  await ensurePanelOpen(page);
  await expect(page.locator(".build-panel")).toBeVisible();
  // Ensure the route stats are showing before triggering the outside-network click.
  await expect(page.getByTestId("front-panel").getByText("4.5 ק\"מ").first()).toBeVisible();

  await page.evaluate(() => {
    window.__mockMapboxRenderedFeatures = [];
    window.__mockMapboxCurrentMap._emit("click", {
      lngLat: { lng: 34.9, lat: 32.5 },
      point: { x: 12, y: 12 },
    });
  });

  await expect(page.locator(".build-panel__error")).toContainText(
    "הנקודה רחוקה מדי מרשת הדרכים",
  );
});

test("production supports segment hover, segment clicks, and sharing", async ({ page, isMobile }) => {
  await page.goto("/");
  // On mobile, reveal the map (discover-home has none) before exercising the
  // network/segment interactions.
  await revealMapOnMobile(page, isMobile);
  await page.waitForFunction(
    (layerId) => window.__mockMapboxCurrentMap?.layers?.has(layerId),
    ROUTE_NETWORK_HIT_LAYER_ID,
  );
  expect(
    await page.evaluate(() =>
      window.__mockMapboxEvents.filter((event) => event.type === "fitBounds")
        .length,
    ),
  ).toBe(0);
  await page.waitForFunction(() =>
    window.__mockMapboxCurrentMap?.layers?.has("react-data-markers-layer"),
  );
  expect(
    await page.evaluate(() =>
      window.__mockMapboxCurrentMap?.layers?.get("react-data-markers-layer")
        ?.type,
    ),
  ).toBe("symbol");

  await page.evaluate(
    () => {
      const lngLat = { lng: 35.586584, lat: 33.11124 };
      window.__mockMapboxCurrentMap._emit("mousemove", {
        lngLat,
        point: window.__mockMapboxCurrentMap.project(lngLat),
      });
    },
  );

  await expect(page.locator("#segment-name-display")).toBeVisible();
  await expect(page.locator("#segment-name-display")).toContainText("דרך המנפטה");
  await expect(page.locator("#segment-name-display")).toContainText("ק\"מ");
  await expect(page.locator("#segment-name-display")).toContainText("בתשלום");

  await page.evaluate(
    () => {
      const lngLat = { lng: 35.618511, lat: 33.182466 };
      window.__mockMapboxCurrentMap._emit("mousemove", {
        lngLat,
        point: window.__mockMapboxCurrentMap.project(lngLat),
      });
    },
  );

  const hoverMarkers = await page.evaluate(() =>
    window.__mockMapboxEvents.filter(
      (event) =>
        event.type === "marker" &&
        String(event.className || "").includes("hover-preview-marker"),
    ).length,
  );
  expect(hoverMarkers).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      window.__mockMapboxEvents.filter((event) => event.type === "fitBounds")
        .length,
    ),
  ).toBe(0);

  for (const [index, point] of SEGMENT_CLICK_POINTS.entries()) {
    await page.evaluate(
      ({ geometryLayerId, index, layerId, point }) => {
        window.__mockMapboxRenderedFeatures = [
          {
            layer: { id: layerId },
            properties: { name: index === 2 ? "דרך נוף הרי נפתלי" : "דרך המנפטה" },
          },
          ...(index === 2
            ? [
                {
                  layer: { id: geometryLayerId },
                  properties: {},
                },
              ]
            : []),
        ];
        const event = {
          lngLat: point,
          point: { x: 360, y: 260 },
        };
        if (index === 0) {
          window.__mockMapboxCurrentMap._emitLayer("click", layerId, {
            ...event,
            features: [{ properties: { name: "דרך המנפטה" } }],
          });
        }
        window.__mockMapboxCurrentMap._emit("click", event);
      },
      {
        geometryLayerId: ROUTE_GEOMETRY_LAYER_ID,
        index,
        layerId: ROUTE_NETWORK_HIT_LAYER_ID,
        point,
      },
    );
    expect(await getRoutePointFeatureCount(page)).toBe(index + 1);
  }

  await ensurePanelOpen(page);
  await expect(page.locator(".build-panel")).toContainText("3.9 ק\"מ");
  await expect(page.getByRole("button", { name: "GPX" })).toBeEnabled();
  const routePointLayer = await page.evaluate(
    ({ layerId }) => window.__mockMapboxCurrentMap?.layers?.get(layerId),
    { layerId: ROUTE_POINTS_LAYER_ID },
  );
  expect(routePointLayer).toMatchObject({
    type: "circle",
    source: "react-route-points",
  });
  expect(routePointLayer.paint["circle-radius"]).toEqual(
    expect.arrayContaining([4.2, 4.1, 3.8, 3.2]),
  );
  expect(routePointLayer.paint["circle-color"]).toEqual(
    expect.arrayContaining(["#18a957", "#c84c45"]),
  );
  const routeGeometryPaint = await page.evaluate(
    ({ layerId }) => window.__mockMapboxCurrentMap?.layers?.get(layerId)?.paint,
    { layerId: ROUTE_GEOMETRY_LAYER_ID },
  );
  expect(routeGeometryPaint).toMatchObject({
    "line-color": "#102a43",
  });
  expect(routeGeometryPaint["line-width"]).toEqual(
    expect.arrayContaining([5.2, 6.8, 8.4]),
  );
  expect(routeGeometryPaint["line-opacity"]).toEqual(
    expect.arrayContaining([0.42, 1]),
  );
  expect(
    await page.evaluate(
      ({ focusLayerId, hoverLayerId }) => ({
        focus: window.__mockMapboxCurrentMap?.layers?.get(focusLayerId)?.filter,
        hover: window.__mockMapboxCurrentMap?.layers?.get(hoverLayerId)?.filter,
      }),
      {
        focusLayerId: ROUTE_NETWORK_FOCUS_LAYER_ID,
        hoverLayerId: ROUTE_NETWORK_HOVER_LAYER_ID,
      },
    ),
  ).toEqual({
    focus: ["==", ["get", "name"], ""],
    hover: ["==", ["get", "name"], ""],
  });

  await page.evaluate(
    ({ dataLayerId, point }) => {
      window.__mockMapboxRenderedFeatures = [
        {
          layer: { id: dataLayerId },
          properties: { dataPointId: "payment-marker" },
        },
      ];
      window.__mockMapboxCurrentMap._emit("click", {
        lngLat: point,
        point: { x: 360, y: 260 },
      });
      window.__mockMapboxRenderedFeatures = [];
    },
    {
      dataLayerId: DATA_MARKERS_LAYER_ID,
      point: { lat: 33.111, lng: 35.586 },
    },
  );
  expect(await getRoutePointFeatureCount(page)).toBe(3);

  // Share button is directly in the build panel.
  await expect(page.getByRole("button", { name: "שיתוף" })).toBeEnabled();
});

async function getRoutePointFeatureCount(page) {
  return page.evaluate(
    ({ sourceId }) =>
      window.__mockMapboxCurrentMap?.sources?.get(sourceId)?.data?.features
        ?.length || 0,
    { sourceId: "react-route-points" },
  );
}
