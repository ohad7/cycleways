import { expect, test } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

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

test("current public app loads with route controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#route-description")).toContainText(
    "לחץ על נקודות במפה",
  );
  // Route controls now live in the right-side panel (no on-map control buttons).
  await expect(page.getByTestId("front-panel")).toBeVisible();
});

test("production root restores compact route URL", async ({ page }) => {
  await page.goto(`/?route=${COMPACT_ROUTE}`);

  await expect(page.locator("#route-description")).toBeVisible();
  await expect(page.getByText("4.5 ק\"מ").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "סיכום" })).toBeEnabled();
  await expect(page.locator(".react-route-point-chip")).toHaveCount(0);
  expect(await getRoutePointFeatureCount(page)).toBeGreaterThan(0);

  const fitEvents = await page.evaluate(() =>
    window.__mockMapboxEvents.filter((event) => event.type === "fitBounds"),
  );
  expect(fitEvents.length).toBeGreaterThan(0);
});

test("production core flow works on desktop and mobile", async ({ page }, testInfo) => {
  await page.goto(`/?route=${COMPACT_ROUTE}`);

  await expect(page.getByText("4.5 ק\"מ").first()).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`react-route-${testInfo.project.name}.png`),
  });

  await page.getByRole("button", { name: "סיכום" }).click();
  await expect(page.getByRole("dialog", { name: "הורדת מסלול GPX" })).toBeVisible();
  await expect(page.locator(".download-modal-content")).toBeVisible();
  await expect(page.locator(".react-route-point-chip")).toHaveCount(0);
  await page.getByRole("button", { name: "🔗 שיתוף מסלול" }).click();
  await expect(page.getByRole("dialog", { name: "שיתוף המסלול" })).toBeVisible();
  await expect(page.getByLabel("קישור שיתוף")).toHaveValue(/route=/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("production shows outside-network warning in the route panel", async ({ page }) => {
  await page.goto(`/?route=${COMPACT_ROUTE}`);
  // Route loaded into the bottom route panel.
  await expect(page.locator("#route-description")).toContainText("4.5 ק\"מ");

  await page.evaluate(() => {
    window.__mockMapboxRenderedFeatures = [];
    window.__mockMapboxCurrentMap._emit("click", {
      lngLat: { lng: 34.9, lat: 32.5 },
      point: { x: 12, y: 12 },
    });
  });

  await expect(page.locator("#route-description .route-inline-warning")).toContainText(
    "הנקודה רחוקה מדי מרשת הדרכים",
  );
});

test("production supports segment hover, segment clicks, and sharing", async ({ page }) => {
  await page.goto("/");
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

  await expect(page.locator("#route-description")).toContainText("3.9 ק\"מ");
  await expect(page.getByRole("button", { name: "סיכום" })).toBeEnabled();
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
    "line-color": "#006699",
    "line-width": 5,
  });
  expect(routeGeometryPaint["line-opacity"]).toEqual(
    expect.arrayContaining([0.3, 0.9]),
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

  await page.getByRole("button", { name: "סיכום" }).click();
  await page.getByRole("button", { name: "🔗 שיתוף מסלול" }).click();
  const shareUrl = await page.getByLabel("קישור שיתוף").getAttribute("value");
  expect(shareUrl).toContain("route=");
  expect(shareUrl).not.toContain("w=");
});

async function getRoutePointFeatureCount(page) {
  return page.evaluate(
    ({ sourceId }) =>
      window.__mockMapboxCurrentMap?.sources?.get(sourceId)?.data?.features
        ?.length || 0,
    { sourceId: "react-route-points" },
  );
}
