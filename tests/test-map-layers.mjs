import assert from "node:assert/strict";
import {
  featureFlagStringValue,
  getFeatureFlags,
} from "@cycleways/core/config/featureFlags.js";
import {
  ROUTE_NETWORK_BUCKETS,
  ROUTE_NETWORK_PRESENTATION_VARIANTS,
  normalizeRouteNetworkPresentationVariant,
  routeGeometryCasingStyleForPresentation,
  routeGeometryLineStyleForPresentation,
  routeNetworkLineStyleForPresentation,
  routeNetworkPresentation,
} from "@cycleways/core/map/networkPresentation.js";
import {
  addRouteNetworkLayers,
  buildRouteGeometryFeatureCollection,
  buildRoutePointDragPreviewFeatureCollection,
  buildRouteDirectionPulseFeatureCollection,
  buildVideoCursorLayerData,
  buildRecommendedRoutesFeatureCollection,
  getRouteFeatureColor,
  normalizeVideoCursorVariant,
  prepareRouteNetworkFeatures,
  ROUTE_GEOMETRY_CASING_LAYER_ID,
  ROUTE_GEOMETRY_LAYER_ID,
  ROUTE_NETWORK_CASING_LAYER_ID,
  ROUTE_NETWORK_LINE_LAYER_ID,
  ROUTE_NETWORK_SHADOW_LAYER_ID,
  syncRouteGeometryLayer,
  VIDEO_CURSOR_DEFAULT_VARIANT,
  VIDEO_CURSOR_VARIANTS,
} from "../src/map/mapLayers.js";

assert.equal(
  getRouteFeatureColor({ properties: { roadType: "paved", stroke: "#0288d1" } }),
  "rgb(101, 170, 162)",
);

assert.equal(
  getRouteFeatureColor({ properties: { roadType: "dirt", stroke: "#ae9067" } }),
  "rgb(174, 144, 103)",
);

assert.equal(
  getRouteFeatureColor({ properties: { roadType: "road", stroke: "#8f2424" } }),
  "rgb(138, 147, 158)",
);

{
  const typedBold = routeNetworkPresentation({ variant: "typed-bold" });
  assert.equal(typedBold.variant, ROUTE_NETWORK_PRESENTATION_VARIANTS.TYPED_BOLD);
  assert.equal(typedBold.cased, false, "typed-bold stays a single core line");
  assert.notEqual(
    typedBold.colors[ROUTE_NETWORK_BUCKETS.PRIMARY],
    "rgb(101, 170, 162)",
    "typed-bold uses a stronger adaptive palette",
  );
  assert.deepEqual(
    routeNetworkLineStyleForPresentation(typedBold).paint["line-width"],
    [
      "interpolate",
      ["linear"],
      ["zoom"],
      8,
      3.2,
      11,
      4.2,
      14,
      5.6,
    ],
    "typed-bold uses zoom-aware line width",
  );
}

{
  const idleBuildFocus = routeNetworkPresentation({ variant: "build-focus" });
  assert.equal(
    idleBuildFocus.variant,
    ROUTE_NETWORK_PRESENTATION_VARIANTS.CURRENT,
    "build-focus is current until route building starts",
  );
  const activeBuildFocus = routeNetworkPresentation({
    variant: "build-focus",
    routeBuilding: true,
  });
  assert.equal(activeBuildFocus.variant, "build-focus");
  assert.equal(activeBuildFocus.cased, true, "build-focus is cased while building");
}

{
  const singleBlue = routeNetworkPresentation({ variant: "single-blue" });
  assert.equal(
    new Set(Object.values(singleBlue.colors)).size,
    1,
    "single-blue intentionally collapses typed colors",
  );
  assert.equal(
    normalizeRouteNetworkPresentationVariant("missing"),
    "current",
    "unknown network variant falls back to current",
  );
}

{
  const casedRoute = routeGeometryCasingStyleForPresentation("cased");
  assert.ok(casedRoute, "cased built route has a casing style");
  assert.equal(
    routeGeometryCasingStyleForPresentation("current"),
    null,
    "current built route has no casing style",
  );
}

{
  assert.equal(
    featureFlagStringValue(
      "routeNetworkPresentation",
      ["current", "typed-bold"],
      "typed-bold",
    ),
    "typed-bold",
    "string flags return their default when no window is present",
  );
  const previousWindow = globalThis.window;
  globalThis.window = {
    location: {
      search: "",
    },
    CYCLEWAYS_FEATURE_FLAGS: {
      routeNetworkPresentation: "typed-cased",
    },
  };
  assert.equal(
    getFeatureFlags().routeNetworkPresentation,
    "typed-cased",
    "global string flag is used when no query param is present",
  );
  globalThis.window = {
    location: {
      search: "",
    },
    CYCLEWAYS_FEATURE_FLAGS: {
      routeNetworkPresentation: "not-valid",
    },
  };
  assert.equal(
    getFeatureFlags().routeNetworkPresentation,
    "typed-cased",
    "invalid global string flag falls back to the default",
  );
  globalThis.window = {
    location: {
      search: "?networkStyle=single-blue&routeStyle=bright-blue&networkScheme=gray-map-saturated",
    },
    CYCLEWAYS_FEATURE_FLAGS: {
      routeNetworkPresentation: "typed-cased",
      routeGeometryPresentation: "current",
      routeNetworkColorScheme: "outdoors-balanced",
    },
  };
  const queryFlags = getFeatureFlags();
  assert.equal(
    queryFlags.routeNetworkPresentation,
    "single-blue",
    "networkStyle query param wins over global values",
  );
  assert.equal(
    queryFlags.routeGeometryPresentation,
    "bright-blue",
    "routeStyle query param maps to routeGeometryPresentation",
  );
  assert.equal(
    queryFlags.routeNetworkColorScheme,
    "gray-map-saturated",
    "networkScheme query param maps to routeNetworkColorScheme",
  );
  globalThis.window = {
    location: {
      search: "?networkStyle=bad-value&routeNetworkPresentation=typed-cased",
    },
    CYCLEWAYS_FEATURE_FLAGS: {
      routeNetworkPresentation: "single-blue",
    },
  };
  assert.equal(
    getFeatureFlags().routeNetworkPresentation,
    "typed-cased",
    "long query param is used when the short alias is invalid",
  );
  if (previousWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previousWindow;
  }
}

class FakeMap {
  constructor() {
    this.layers = new Map();
    this.sources = new Map();
  }

  addSource(id, source) {
    this.sources.set(id, {
      ...source,
      setData: (data) => {
        this.sources.set(id, { ...this.sources.get(id), data });
      },
    });
  }

  getSource(id) {
    return this.sources.get(id);
  }

  removeSource(id) {
    this.sources.delete(id);
  }

  addLayer(layer, before) {
    this.layers.set(layer.id, { ...layer, before });
  }

  getLayer(id) {
    return this.layers.get(id);
  }

  removeLayer(id) {
    this.layers.delete(id);
  }
}

{
  const geoJson = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [35, 33],
            [35.1, 33.1],
          ],
        },
        properties: { name: "typed", stroke: "#0288d1" },
      },
    ],
  };
  const currentMap = new FakeMap();
  addRouteNetworkLayers(currentMap, prepareRouteNetworkFeatures(geoJson));
  assert.ok(currentMap.getLayer(ROUTE_NETWORK_LINE_LAYER_ID));
  assert.equal(
    currentMap.getLayer(ROUTE_NETWORK_CASING_LAYER_ID),
    undefined,
    "current network presentation does not add casing",
  );

  const casedMap = new FakeMap();
  const options = { variant: "typed-cased" };
  casedMap.addLayer({ id: ROUTE_GEOMETRY_LAYER_ID, type: "line" });
  addRouteNetworkLayers(
    casedMap,
    prepareRouteNetworkFeatures(geoJson, options),
    options,
  );
  assert.ok(
    casedMap.getLayer(ROUTE_NETWORK_SHADOW_LAYER_ID),
    "typed-cased adds network shadow",
  );
  assert.ok(
    casedMap.getLayer(ROUTE_NETWORK_CASING_LAYER_ID),
    "typed-cased adds network casing",
  );
  assert.deepEqual(
    casedMap.getLayer(ROUTE_NETWORK_LINE_LAYER_ID).paint["line-width"],
    routeNetworkPresentation(options).coreWidth,
    "typed-cased network core uses variant width expression",
  );
  assert.equal(
    casedMap.getLayer(ROUTE_NETWORK_LINE_LAYER_ID).before,
    ROUTE_GEOMETRY_LAYER_ID,
    "route network is inserted below built route geometry when both exist",
  );
}

{
  const fakeMap = new FakeMap();
  const route = [
    { lng: 35, lat: 33 },
    { lng: 35.1, lat: 33.1 },
  ];
  syncRouteGeometryLayer(fakeMap, route, null, { variant: "cased" });
  assert.ok(fakeMap.getLayer(ROUTE_GEOMETRY_CASING_LAYER_ID));
  assert.deepEqual(
    fakeMap.getLayer(ROUTE_GEOMETRY_LAYER_ID).paint["line-width"],
    routeGeometryLineStyleForPresentation("cased").paint["line-width"],
    "cased route geometry uses zoom-aware core width",
  );
  syncRouteGeometryLayer(fakeMap, route, null, { variant: "orange" });
  assert.equal(
    fakeMap.getLayer(ROUTE_GEOMETRY_LAYER_ID).paint["line-color"],
    "#f97316",
    "emphasized route geometry variants update the built-route color",
  );
  assert.equal(
    fakeMap.getLayer(ROUTE_GEOMETRY_CASING_LAYER_ID).paint["line-color"],
    routeGeometryCasingStyleForPresentation("orange").paint["line-color"],
    "switching between cased route variants refreshes casing paint",
  );
  syncRouteGeometryLayer(fakeMap, route, null, { variant: "current" });
  assert.equal(
    fakeMap.getLayer(ROUTE_GEOMETRY_CASING_LAYER_ID),
    undefined,
    "switching route geometry back to current removes casing",
  );
}

{
  const geometry = [
    { lng: 0, lat: 0 },
    { lng: 1, lat: 0 },
    { lng: 2, lat: 0 },
    { lng: 3, lat: 0 },
    { lng: 4, lat: 0 },
    { lng: 5, lat: 0 },
    { lng: 6, lat: 0 },
  ];
  const data = buildRouteGeometryFeatureCollection(geometry);
  assert.equal(data.features.length, 1, "route geometry renders as one feature");
  assert.equal(data.features[0].properties.affected, false);
}

{
  const geometry = [
    { lng: 0, lat: 0 },
    { lng: 1, lat: 0 },
    { lng: 2, lat: 0 },
    { lng: 3, lat: 0 },
    { lng: 4, lat: 0 },
    { lng: 5, lat: 0 },
    { lng: 6, lat: 0 },
  ];
  const data = buildRouteGeometryFeatureCollection(geometry, {
    mode: "insert",
    insertIndex: 2,
    points: [
      { lng: 0, lat: 0 },
      { lng: 2, lat: 0 },
      { lng: 4, lat: 0 },
      { lng: 6, lat: 0 },
    ],
  });
  const affected = data.features.filter(
    (feature) => feature.properties.affected,
  );
  assert.equal(affected.length, 1, "insert drag marks one stale route span");
  assert.deepEqual(
    affected[0].geometry.coordinates,
    [
      [2, 0],
      [3, 0],
      [4, 0],
    ],
  );
}

{
  const geometry = [
    { lng: 0, lat: 0 },
    { lng: 1, lat: 0 },
    { lng: 2, lat: 0 },
    { lng: 3, lat: 0 },
    { lng: 4, lat: 0 },
    { lng: 5, lat: 0 },
    { lng: 6, lat: 0 },
  ];
  const data = buildRouteGeometryFeatureCollection(geometry, {
    mode: "move",
    index: 2,
    points: [
      { lng: 0, lat: 0 },
      { lng: 2, lat: 0 },
      { lng: 4, lat: 0 },
      { lng: 6, lat: 0 },
    ],
  });
  const affected = data.features.filter(
    (feature) => feature.properties.affected,
  );
  assert.equal(affected.length, 1, "point drag marks the neighboring route span");
  assert.deepEqual(
    affected[0].geometry.coordinates,
    [
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
    ],
  );
}

{
  const route = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
    { lat: 0.01, lng: 0.01 },
  ];
  const pulse = buildRouteDirectionPulseFeatureCollection(route, 0.75);
  assert.equal(pulse.features.length, 1, "pulse renders a visible route slice");
  assert.equal(
    pulse.features[0].geometry.type,
    "LineString",
    "pulse is route-attached line geometry",
  );
  assert.ok(
    pulse.features[0].geometry.coordinates.length >= 2,
    "pulse has at least two coordinates",
  );
}

{
  const emptyPulse = buildRouteDirectionPulseFeatureCollection(
    [{ lat: 0, lng: 0 }],
    0.5,
  );
  assert.equal(emptyPulse.features.length, 0, "invalid pulse input stays hidden");
}

assert.equal(
  normalizeVideoCursorVariant(1),
  VIDEO_CURSOR_VARIANTS.CHEVRON_HALO,
  "cursor option 1 maps to chevron halo",
);
assert.equal(
  VIDEO_CURSOR_DEFAULT_VARIANT,
  VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE,
  "implicit cursor default is progress head pulse",
);
assert.equal(
  normalizeVideoCursorVariant(undefined),
  VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE,
  "omitted cursor variant uses progress head pulse",
);
assert.equal(
  normalizeVideoCursorVariant("5"),
  VIDEO_CURSOR_VARIANTS.PULSE_RING,
  "cursor option 5 maps to pulse ring",
);
assert.equal(
  normalizeVideoCursorVariant("6"),
  VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE,
  "cursor option 6 maps to progress head pulse",
);
assert.equal(
  normalizeVideoCursorVariant("progress-head"),
  VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD,
  "named cursor variants are accepted",
);

{
  const route = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
    { lat: 0.01, lng: 0.01 },
  ];
  const data = buildVideoCursorLayerData(
    { lat: 0, lng: 0.005, fraction: 0.5 },
    route,
    "chevron-trail",
  );
  assert.equal(data.variant, VIDEO_CURSOR_VARIANTS.CHEVRON_TRAIL);
  assert.equal(data.cursor.features.length, 1, "cursor point is visible");
  assert.equal(data.trail.features.length, 1, "trail variant emits a route line");
  assert.equal(data.progress.features.length, 0, "trail variant does not emit progress");
  assert.equal(
    data.cursor.features[0].properties.showSymbol,
    true,
    "directional variants render a symbol",
  );
  assert.ok(
    Number.isFinite(data.cursor.features[0].properties.bearing),
    "directional variants get a computed bearing",
  );
}

{
  const route = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
    { lat: 0.01, lng: 0.01 },
  ];
  const data = buildVideoCursorLayerData(
    { lat: 0, lng: 0.005, fraction: 0.5 },
    route,
    "progress-head",
  );
  assert.equal(data.progress.features.length, 1, "progress variant emits a route line");
  assert.equal(data.trail.features.length, 0, "progress variant has no trail line");
  assert.equal(
    data.cursor.features[0].properties.showCore,
    true,
    "progress variant keeps a compact head marker",
  );
}

{
  const data = buildVideoCursorLayerData(
    { lat: 0, lng: 0, fraction: 0.1 },
    [],
    "pulse-ring",
  );
  assert.equal(data.trail.features.length, 0, "missing geometry hides route-attached lines");
  assert.equal(
    data.cursor.features[0].properties.showPulse,
    true,
    "pulse variant sets the pulse layer flag",
  );
}

{
  const route = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
    { lat: 0.01, lng: 0.01 },
  ];
  const data = buildVideoCursorLayerData(
    { lat: 0, lng: 0.005, fraction: 0.5 },
    route,
    "progress-head-pulse",
  );
  assert.equal(
    data.variant,
    VIDEO_CURSOR_VARIANTS.PROGRESS_HEAD_PULSE,
    "combined variant is normalized",
  );
  assert.equal(
    data.progress.features.length,
    1,
    "combined variant emits the progress route line",
  );
  assert.equal(
    data.cursor.features[0].properties.showPulse,
    true,
    "combined variant enables the pulse layer",
  );
  assert.ok(
    data.cursor.features[0].properties.pulseRadius < 23,
    "combined variant uses a smaller static pulse than pulse-ring",
  );
  assert.equal(
    data.cursor.features[0].properties.symbolColor,
    "#ffffff",
    "combined variant keeps the directional progress head",
  );
}

{
  const preview = buildRoutePointDragPreviewFeatureCollection({
    mode: "move",
    index: 1,
    lng: 35.2,
    lat: 33.2,
    points: [
      { lng: 35.0, lat: 33.0 },
      { lng: 35.1, lat: 33.1 },
      { lng: 35.3, lat: 33.3 },
    ],
  });
  assert.equal(
    preview.features.filter((feature) => feature.geometry.type === "LineString")
      .length,
    2,
    "middle-point drag preview has previous and next guide lines",
  );
  assert.equal(
    preview.features.filter((feature) => feature.geometry.type === "Point")
      .length,
    1,
    "drag preview has one cursor halo point",
  );
}

{
  const preview = buildRoutePointDragPreviewFeatureCollection({
    mode: "insert",
    insertIndex: 1,
    lng: 35.2,
    lat: 33.2,
    points: [
      { lng: 35.0, lat: 33.0 },
      { lng: 35.3, lat: 33.3 },
    ],
  });
  assert.equal(
    preview.features.filter((feature) => feature.geometry.type === "LineString")
      .length,
    2,
    "insert drag preview connects surrounding route points",
  );
}

{
  const routes = [
    {
      slug: "bright-one",
      geometry: [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }],
      color: "#e8590c",
      tier: "bright",
      hovered: false,
    },
    {
      slug: "ghost-one",
      geometry: [{ lng: 2, lat: 2 }, { lng: 3, lat: 3 }],
      color: "#ae3ec9",
      tier: "ghost",
      hovered: false,
    },
    {
      slug: "hovered-one",
      geometry: [{ lng: 4, lat: 4 }, { lng: 5, lat: 5 }],
      color: "#7048e8",
      tier: "bright",
      hovered: true,
    },
  ];
  const fc = buildRecommendedRoutesFeatureCollection(routes);
  assert.equal(fc.features.length, 3, "one feature per valid route");
  assert.equal(fc.features[0].properties.tier, "bright");
  assert.equal(fc.features[0].properties.hovered, false);
  assert.equal(fc.features[1].properties.tier, "ghost");
  assert.equal(fc.features[2].properties.hovered, true);

  // Missing tier defaults to "bright"; too-short geometry is dropped.
  const fallback = buildRecommendedRoutesFeatureCollection([
    { geometry: [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }], color: "#000" },
    { geometry: [{ lng: 0, lat: 0 }], color: "#000", tier: "ghost" },
  ]);
  assert.equal(fallback.features.length, 1, "drops <2-point geometry");
  assert.equal(fallback.features[0].properties.tier, "bright", "tier defaults to bright");
}

console.log("test-map-layers.mjs passed");
