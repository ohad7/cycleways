# Route Video Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach a YouTube-hosted video summary to curated `/featured/<slug>` routes with bidirectional sync — a marker on the map tracks the video's current position, and clicking on the route seeks the video to that moment. Authored entirely in the existing editor with promote-pipeline publishing.

**Architecture:** A pure `videoSync` module owns all time↔location math (snap-to-route, interpolate along polyline, both directions). `VideoEmbed` upgrades from a dumb iframe to a YouTube IFrame API wrapper that polls `getCurrentTime()` and writes a `videoCursor` to `FeaturedRouteContext`. `MapView` consumes the cursor (renders a marker, soft auto-pans) and raises `onRouteClick` events that drive `player.seekTo()`. Video metadata lives in `public-data/route-videos/` and is updated via a new editor mode + promote endpoint — no JS file edits per video.

**Tech Stack:** React 19, Vite 7, Mapbox GL, plain Node `http` for the editor server, `node:assert/strict` for tests, Playwright for e2e. YouTube IFrame Player API for embedded playback.

---

## File Structure

**New files:**
- `src/components/featured/videoSync.js` — pure time↔location module
- `src/components/featured/youtubeIframeApi.js` — IFrame API loader helper
- `tests/test-video-sync.mjs` — unit tests for `videoSync.js`
- `tests/test-video-keyframes-promote.mjs` — unit tests for editor promote endpoint
- `tests/e2e/featured-video.spec.mjs` — Playwright e2e for the video panel
- `processing/process-video.sh` — ffmpeg recipe for source MP4 → YT upload
- `processing/README-video.md` — short doc for the recipe
- `public-data/route-videos/index.json` — initial empty manifest (`{ "version": 1, "routes": {} }`)
- `editor/.drafts/.gitkeep` — placeholder so the drafts dir exists (drafts themselves git-ignored)

**Modified files:**
- `src/components/featured/VideoEmbed.jsx` — full rewrite (IFrame API + sync)
- `src/components/featured/FeaturedRoute.jsx` — extend context, pass video props to `MapView`
- `src/components/featured/FeaturedRouteContext.js` — extend context shape
- `src/components/featured/FeaturedRouteMap.jsx` — pass video props to mobile `MapView`
- `src/featured/sovev-beit-hillel.jsx` — drop `src={undefined}` from `<FeaturedRoute.Video />`
- `src/map/MapView.jsx` — add `videoCursor` marker layer, `onRouteClick` handler
- `src/map/mapLayers.js` — small helper for the video cursor source/layer (if needed)
- `editor/server.mjs` — add `/api/video-keyframes/*` endpoints
- `editor/editor.js` — register the new Video Sync mode, ModeBar extraction
- `editor/index.html` — markup for Video Sync mode
- `editor/styles.css` — styles for new mode
- `.gitignore` — add `editor/.drafts/` (track only `.gitkeep`)
- `package.json` — append new test files to the `test` script

---

## Conventions Used Throughout

- **Coordinate shape:** Route geometry uses `{ lat, lng }` everywhere in the React code (see `src/map/mapLayers.js:1015`). The keyframes **JSON** uses `lon` (GeoJSON convention) but `videoSync.js` normalizes to `lng` internally and returns `{ lat, lng }` from `timeToPosition`. Tests should pass `lng` to the module directly.
- **Tests:** plain `.mjs` files using `import assert from "node:assert/strict"`. Pattern: imperative assertions in a try/finally, then a `console.log("X tests passed")` at the bottom. See `tests/test-map-assets.mjs` for the template.
- **Commits:** conventional-commit style, `feat(route-video):`, `test(route-video):`, `refactor(editor):` etc. Match the prefix used by the existing `featured-routes` commits.
- **No emojis in code or commit messages.**
- **Hebrew strings** for any new user-facing text in the public site or editor UI. Use existing strings as style reference.

---

## Task 1: `videoSync` — keyframe validation

**Files:**
- Create: `src/components/featured/videoSync.js`
- Test: `tests/test-video-sync.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/test-video-sync.mjs`:

```js
import assert from "node:assert/strict";
import { createVideoSync } from "../src/components/featured/videoSync.js";

const simpleRoute = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.01 },
];

// Valid keyframes — should succeed
const sync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 10, lat: 33.0, lng: 35.01 },
  ],
  videoDuration: 10,
  routeGeometry: simpleRoute,
});
assert.ok(sync, "createVideoSync returns a non-null object");

// Empty keyframes — must throw
assert.throws(
  () =>
    createVideoSync({
      keyframes: [],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /at least 2 keyframes/i,
);

// Not sorted by t — must throw
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 10, lat: 33.0, lng: 35.01 },
        { t: 0, lat: 33.0, lng: 35.0 },
      ],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /sorted by t/i,
);

// First t must be 0
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 1, lat: 33.0, lng: 35.0 },
        { t: 10, lat: 33.0, lng: 35.01 },
      ],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /first keyframe.*t === 0/i,
);

// Last t must equal videoDuration
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 0, lat: 33.0, lng: 35.0 },
        { t: 9, lat: 33.0, lng: 35.01 },
      ],
      videoDuration: 10,
      routeGeometry: simpleRoute,
    }),
  /last keyframe.*videoDuration/i,
);

// Route too short (< 2 points) — must throw
assert.throws(
  () =>
    createVideoSync({
      keyframes: [
        { t: 0, lat: 33.0, lng: 35.0 },
        { t: 10, lat: 33.0, lng: 35.0 },
      ],
      videoDuration: 10,
      routeGeometry: [{ lat: 33.0, lng: 35.0 }],
    }),
  /route.*at least 2/i,
);

console.log("videoSync validation tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

```sh
node tests/test-video-sync.mjs
```

Expected: error along the lines of `Cannot find module .../videoSync.js`.

- [ ] **Step 3: Implement minimal validation**

Create `src/components/featured/videoSync.js`:

```js
function assertValid({ keyframes, videoDuration, routeGeometry }) {
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    throw new Error("videoSync requires at least 2 keyframes");
  }
  for (let i = 1; i < keyframes.length; i++) {
    if (keyframes[i].t <= keyframes[i - 1].t) {
      throw new Error("videoSync keyframes must be sorted by t (strictly increasing)");
    }
  }
  if (keyframes[0].t !== 0) {
    throw new Error("videoSync first keyframe must have t === 0");
  }
  if (keyframes[keyframes.length - 1].t !== videoDuration) {
    throw new Error("videoSync last keyframe must have t === videoDuration");
  }
  if (!Array.isArray(routeGeometry) || routeGeometry.length < 2) {
    throw new Error("videoSync route geometry must have at least 2 points");
  }
}

export function createVideoSync(input) {
  assertValid(input);
  return {
    // implementation continues in later tasks
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
node tests/test-video-sync.mjs
```

Expected: `videoSync validation tests passed`.

- [ ] **Step 5: Commit**

```sh
git add tests/test-video-sync.mjs src/components/featured/videoSync.js
git commit -m "feat(route-video): videoSync keyframe validation"
```

---

## Task 2: `videoSync.timeToPosition` — interpolate along the route

**Files:**
- Modify: `src/components/featured/videoSync.js`
- Test: `tests/test-video-sync.mjs`

Background: `timeToPosition(t)` finds the bracketing keyframes for `t`, linearly interpolates their *fractional distance along the route polyline*, then resolves that fraction to a `{ lat, lng }` on the polyline. This keeps the marker visibly on the path even with sparse keyframes.

- [ ] **Step 1: Append failing tests**

Append to `tests/test-video-sync.mjs` before the final `console.log`:

```js
// timeToPosition along a straight east-west route
const straightRoute = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.001 },
  { lat: 33.0, lng: 35.002 },
];

const straightSync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 10, lat: 33.0, lng: 35.002 },
  ],
  videoDuration: 10,
  routeGeometry: straightRoute,
});

const start = straightSync.timeToPosition(0);
assert.ok(Math.abs(start.lat - 33.0) < 1e-9);
assert.ok(Math.abs(start.lng - 35.0) < 1e-9);
assert.ok(Math.abs(start.fraction - 0) < 1e-6);

const mid = straightSync.timeToPosition(5);
assert.ok(Math.abs(mid.lat - 33.0) < 1e-9);
assert.ok(Math.abs(mid.lng - 35.001) < 1e-6);
assert.ok(Math.abs(mid.fraction - 0.5) < 1e-3);

const end = straightSync.timeToPosition(10);
assert.ok(Math.abs(end.lat - 33.0) < 1e-9);
assert.ok(Math.abs(end.lng - 35.002) < 1e-9);
assert.ok(Math.abs(end.fraction - 1) < 1e-6);

// Clamping: t outside [0, duration]
const clampLow = straightSync.timeToPosition(-1);
assert.equal(clampLow.fraction, 0);
const clampHigh = straightSync.timeToPosition(99);
assert.equal(clampHigh.fraction, 1);

// Sparse keyframes on an L-shape: marker stays on the path, not in lat/lng space
const lRoute = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.01 },   // 1 km east
  { lat: 33.01, lng: 35.01 },  // 1 km north
];
const lSync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 10, lat: 33.01, lng: 35.01 },
  ],
  videoDuration: 10,
  routeGeometry: lRoute,
});
// At t=5 (halfway through video, halfway along route by length),
// the marker should be at the corner of the L, not at the lat/lng midpoint.
const lMid = lSync.timeToPosition(5);
assert.ok(
  Math.abs(lMid.lng - 35.01) < 1e-3,
  `expected lng near corner (35.01), got ${lMid.lng}`,
);
assert.ok(
  Math.abs(lMid.lat - 33.0) < 1e-3,
  `expected lat near corner (33.0), got ${lMid.lat}`,
);
```

- [ ] **Step 2: Run test to verify it fails**

```sh
node tests/test-video-sync.mjs
```

Expected: `TypeError: straightSync.timeToPosition is not a function`.

- [ ] **Step 3: Implement `timeToPosition`**

Replace the body of `createVideoSync` in `src/components/featured/videoSync.js`:

```js
const EARTH_RADIUS_M = 6371000;
const DEG = Math.PI / 180;

function haversineMeters(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Returns { index, fraction (0..1 along the route), distanceMeters }
function nearestPointOnPolyline(point, polyline, cumulativeDistances) {
  let best = { index: 0, t: 0, dist: Infinity };
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    // Approximate local plane: scale lng by cos(lat) for projection.
    const cosLat = Math.cos(((a.lat + b.lat) / 2) * DEG);
    const ax = a.lng * cosLat;
    const ay = a.lat;
    const bx = b.lng * cosLat;
    const by = b.lat;
    const px = point.lng * cosLat;
    const py = point.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const projLat = a.lat + (b.lat - a.lat) * t;
    const projLng = a.lng + (b.lng - a.lng) * t;
    const d = haversineMeters(point, { lat: projLat, lng: projLng });
    if (d < best.dist) {
      best = { index: i, t, dist: d };
    }
  }
  const segLen = cumulativeDistances[best.index + 1] - cumulativeDistances[best.index];
  const along = cumulativeDistances[best.index] + best.t * segLen;
  const total = cumulativeDistances[cumulativeDistances.length - 1];
  return {
    index: best.index,
    fraction: total > 0 ? along / total : 0,
    distanceMeters: best.dist,
  };
}

function pointAtFraction(polyline, cumulativeDistances, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  const total = cumulativeDistances[cumulativeDistances.length - 1];
  const target = total * f;
  // Binary search for the segment containing `target`.
  let lo = 0;
  let hi = cumulativeDistances.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulativeDistances[mid] <= target) lo = mid;
    else hi = mid;
  }
  const segLen = cumulativeDistances[hi] - cumulativeDistances[lo];
  const segT = segLen > 0 ? (target - cumulativeDistances[lo]) / segLen : 0;
  const a = polyline[lo];
  const b = polyline[hi];
  return {
    lat: a.lat + (b.lat - a.lat) * segT,
    lng: a.lng + (b.lng - a.lng) * segT,
    fraction: f,
  };
}

function buildCumulativeDistances(polyline) {
  const result = [0];
  for (let i = 1; i < polyline.length; i++) {
    result.push(result[i - 1] + haversineMeters(polyline[i - 1], polyline[i]));
  }
  return result;
}

// Convert legacy `lon` to `lng` if present (keyframe JSON uses `lon`).
function normalizeKeyframe(k) {
  return { t: k.t, lat: k.lat, lng: k.lng ?? k.lon };
}

export function createVideoSync(input) {
  assertValid(input);
  const { videoDuration, routeGeometry } = input;
  const keyframes = input.keyframes.map(normalizeKeyframe);

  const cumulative = buildCumulativeDistances(routeGeometry);

  // Snap each keyframe to the route and build the byTime table.
  const byTime = keyframes.map((k) => {
    const snap = nearestPointOnPolyline(k, routeGeometry, cumulative);
    return { t: k.t, fraction: snap.fraction };
  });

  function timeToPosition(t) {
    const clamped = Math.max(0, Math.min(videoDuration, t));
    // Find bracketing keyframes in byTime.
    let lo = 0;
    let hi = byTime.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (byTime[mid].t <= clamped) lo = mid;
      else hi = mid;
    }
    const a = byTime[lo];
    const b = byTime[hi];
    const span = b.t - a.t;
    const localT = span > 0 ? (clamped - a.t) / span : 0;
    const fraction = a.fraction + (b.fraction - a.fraction) * localT;
    return pointAtFraction(routeGeometry, cumulative, fraction);
  }

  return {
    timeToPosition,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
node tests/test-video-sync.mjs
```

Expected: all previous assertions still pass and `videoSync validation tests passed` prints.

- [ ] **Step 5: Commit**

```sh
git add src/components/featured/videoSync.js tests/test-video-sync.mjs
git commit -m "feat(route-video): videoSync.timeToPosition with along-route interpolation"
```

---

## Task 3: `videoSync.positionToTime` — inverse mapping

**Files:**
- Modify: `src/components/featured/videoSync.js`
- Test: `tests/test-video-sync.mjs`

- [ ] **Step 1: Append failing tests**

Append before the final `console.log`:

```js
// positionToTime should be the inverse of timeToPosition (round-trip)
const roundtripSync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 4, lat: 33.0, lng: 35.001 },
    { t: 10, lat: 33.0, lng: 35.002 },
  ],
  videoDuration: 10,
  routeGeometry: straightRoute,
});

for (const t of [0, 1.5, 4, 7, 10]) {
  const pos = roundtripSync.timeToPosition(t);
  const tBack = roundtripSync.positionToTime(pos.fraction);
  assert.ok(
    Math.abs(tBack - t) < 0.01,
    `round-trip at t=${t} got ${tBack}`,
  );
}

// Clamping
assert.equal(roundtripSync.positionToTime(-0.5), 0);
assert.equal(roundtripSync.positionToTime(1.5), 10);
```

- [ ] **Step 2: Run test to verify it fails**

```sh
node tests/test-video-sync.mjs
```

Expected: `TypeError: roundtripSync.positionToTime is not a function`.

- [ ] **Step 3: Implement `positionToTime`**

In `src/components/featured/videoSync.js`, build a fraction-sorted view of `byTime` (it's already sorted by t and fractions are monotonically non-decreasing for a well-authored video, but assume nothing — sort defensively). Add to the body of `createVideoSync` after the `byTime` construction:

```js
  // For positionToTime we need byTime sorted by fraction. Defensive copy + sort.
  const byFraction = byTime
    .map(({ t, fraction }) => ({ t, fraction }))
    .sort((a, b) => a.fraction - b.fraction);

  function positionToTime(fraction) {
    const clamped = Math.max(0, Math.min(1, fraction));
    let lo = 0;
    let hi = byFraction.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (byFraction[mid].fraction <= clamped) lo = mid;
      else hi = mid;
    }
    const a = byFraction[lo];
    const b = byFraction[hi];
    const span = b.fraction - a.fraction;
    const localT = span > 0 ? (clamped - a.fraction) / span : 0;
    return a.t + (b.t - a.t) * localT;
  }
```

And extend the returned object:

```js
  return {
    timeToPosition,
    positionToTime,
  };
```

- [ ] **Step 4: Run test to verify it passes**

```sh
node tests/test-video-sync.mjs
```

- [ ] **Step 5: Commit**

```sh
git add src/components/featured/videoSync.js tests/test-video-sync.mjs
git commit -m "feat(route-video): videoSync.positionToTime inverse lookup"
```

---

## Task 4: `videoSync.snapClickToRoute` — click-near-route detection

**Files:**
- Modify: `src/components/featured/videoSync.js`
- Test: `tests/test-video-sync.mjs`

- [ ] **Step 1: Append failing tests**

```js
// snapClickToRoute
const clickSync = createVideoSync({
  keyframes: [
    { t: 0, lat: 33.0, lng: 35.0 },
    { t: 10, lat: 33.0, lng: 35.002 },
  ],
  videoDuration: 10,
  routeGeometry: [
    { lat: 33.0, lng: 35.0 },
    { lat: 33.0, lng: 35.002 },
  ],
});

// Click essentially on the route midpoint
const onRoute = clickSync.snapClickToRoute({ lat: 33.0, lng: 35.001 });
assert.ok(onRoute, "expected snap to succeed for on-route click");
assert.ok(onRoute.distanceMeters < 5, "snap distance should be near zero");
assert.ok(Math.abs(onRoute.fraction - 0.5) < 1e-3);

// Click far away — default 80m threshold should reject
const farAway = clickSync.snapClickToRoute({ lat: 34.0, lng: 36.0 });
assert.equal(farAway, null, "expected null for click far from route");

// Custom larger threshold accepts a moderately-distant click
const loose = clickSync.snapClickToRoute(
  { lat: 33.0005, lng: 35.001 }, // ~55m north of the route at midpoint
  200,
);
assert.ok(loose, "expected loose threshold to accept the click");
```

- [ ] **Step 2: Run test to verify it fails**

```sh
node tests/test-video-sync.mjs
```

Expected: `TypeError: clickSync.snapClickToRoute is not a function`.

- [ ] **Step 3: Implement `snapClickToRoute`**

Add to the body of `createVideoSync`, sibling to `positionToTime`:

```js
  function snapClickToRoute(latLng, maxMeters = 80) {
    const snap = nearestPointOnPolyline(latLng, routeGeometry, cumulative);
    if (snap.distanceMeters > maxMeters) return null;
    return { fraction: snap.fraction, distanceMeters: snap.distanceMeters };
  }
```

And in the returned object:

```js
  return {
    timeToPosition,
    positionToTime,
    snapClickToRoute,
  };
```

- [ ] **Step 4: Run test to verify it passes**

```sh
node tests/test-video-sync.mjs
```

- [ ] **Step 5: Wire test into the project test command**

Modify `package.json`'s `test` script to add `node tests/test-video-sync.mjs &&` after `test-route-data.mjs`:

```jsonc
"test": "npm run test:osm && node tests/test-map-assets.mjs && node tests/test-route-manager-snap.js && node tests/test-route-manager-geometry.js && node tests/test-base-routing-network.mjs && node tests/test-base-routing-shards.mjs && node tests/test-compact-base-routing-shard.mjs && node tests/test-messagepack.mjs && node tests/test-route-encoding.mjs && node tests/test-route-data.mjs && node tests/test-video-sync.mjs && node tests/test-route-reducer.mjs && node tests/test-react-route-actions.mjs && node tests/test-poi-types.mjs && node tests/test-gpx-parity.mjs && node tests/test-analytics-parity.mjs && cd tests && node test-route-manager.js",
```

- [ ] **Step 6: Run the full test suite**

```sh
npm test
```

Expected: all tests pass, including the new `videoSync` line.

- [ ] **Step 7: Commit**

```sh
git add src/components/featured/videoSync.js tests/test-video-sync.mjs package.json
git commit -m "feat(route-video): videoSync.snapClickToRoute"
```

---

## Task 5: Extend `FeaturedRouteContext` with video state

**Files:**
- Modify: `src/components/featured/FeaturedRouteContext.js`
- Modify: `src/components/featured/FeaturedRoute.jsx`

This task adds the four new context fields the video pieces need: `videoCursor`, `setVideoCursor`, `videoSyncRef`, `playerSeekRef`. No new behavior yet — just plumbing.

- [ ] **Step 1: Read the existing context module**

Read `src/components/featured/FeaturedRouteContext.js`. It's small — just a `createContext` + `useContext` wrapper. The change is at the call site in `FeaturedRoute.jsx`.

- [ ] **Step 2: Extend the context value in `FeaturedRoute.jsx`**

In `src/components/featured/FeaturedRoute.jsx`, near the top of the component (alongside the other `useState` declarations):

```jsx
const [videoCursor, setVideoCursor] = useState(null);
const videoSyncRef = useRef(null);
const playerSeekRef = useRef(null);
```

Make sure `useRef` is included in the React imports at the top of the file (it may already be).

Extend the `contextValue` memo to include the four new fields:

```jsx
const contextValue = useMemo(
  () => ({
    meta,
    assets,
    routeState,
    status,
    error,
    focusedPoiId,
    setFocusedPoiId,
    focusedCoord,
    setFocusedCoord,
    routeFitRequest,
    videoCursor,
    setVideoCursor,
    videoSyncRef,
    playerSeekRef,
  }),
  [meta, assets, routeState, status, error, focusedPoiId, focusedCoord, routeFitRequest, videoCursor],
);
```

(Refs don't need to be in the deps array — they're stable references.)

- [ ] **Step 3: Run the full test suite to verify nothing broke**

```sh
npm test && npm run build
```

Expected: all tests pass; build succeeds.

- [ ] **Step 4: Commit**

```sh
git add src/components/featured/FeaturedRoute.jsx
git commit -m "feat(route-video): extend FeaturedRouteContext with videoCursor and refs"
```

---

## Task 6: Add `videoCursor` marker layer to `MapView`

**Files:**
- Modify: `src/map/MapView.jsx`
- Modify: `src/map/mapLayers.js`

- [ ] **Step 1: Read existing layer code**

Read `src/map/MapView.jsx` lines 60-100 (the props block) and `src/map/mapLayers.js` around `syncRouteGeometryLayer` (line ~1015) for the existing layer-management pattern.

- [ ] **Step 2: Add a layer-sync helper in `mapLayers.js`**

At the end of `src/map/mapLayers.js`, append:

```js
const VIDEO_CURSOR_SOURCE_ID = "video-cursor-source";
const VIDEO_CURSOR_LAYER_ID = "video-cursor-layer";

export function syncVideoCursorLayer(map, cursor) {
  if (!map || !map.isStyleLoaded()) return;
  const features = cursor && Number.isFinite(cursor.lat) && Number.isFinite(cursor.lng)
    ? [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [cursor.lng, cursor.lat] },
          properties: {},
        },
      ]
    : [];
  const data = { type: "FeatureCollection", features };
  if (!map.getSource(VIDEO_CURSOR_SOURCE_ID)) {
    map.addSource(VIDEO_CURSOR_SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: VIDEO_CURSOR_LAYER_ID,
      type: "circle",
      source: VIDEO_CURSOR_SOURCE_ID,
      paint: {
        "circle-radius": 9,
        "circle-color": "#ff3d3d",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });
  } else {
    map.getSource(VIDEO_CURSOR_SOURCE_ID).setData(data);
  }
}
```

- [ ] **Step 3: Wire the helper into `MapView.jsx`**

In `src/map/MapView.jsx`:

(a) Add `videoCursor = null` to the props destructure (next to `focusedMarker`).

(b) Import `syncVideoCursorLayer` from `./mapLayers.js`.

(c) Add a `useEffect` modeled on the existing `syncRouteGeometryLayer` effect (around line 586):

```jsx
useEffect(() => {
  if (status !== "ready") return;
  syncVideoCursorLayer(map, videoCursor);
}, [videoCursor, status]);
```

- [ ] **Step 4: Pass `videoCursor` through from `FeaturedRoute.jsx`**

In the desktop `<MapView ... />` call inside `src/components/featured/FeaturedRoute.jsx`, add the prop:

```jsx
videoCursor={videoCursor}
```

- [ ] **Step 5: Pass `videoCursor` through from `FeaturedRouteMap.jsx`**

In `src/components/featured/FeaturedRouteMap.jsx`, destructure `videoCursor` from `useFeaturedRoute()` and pass it on both `MapView` instances (inline and fullscreen).

- [ ] **Step 6: Manual smoke check**

```sh
npm run dev
```

Open `http://127.0.0.1:<port>/featured/sovev-beit-hillel`. Expected: page still loads correctly; no marker appears (because `videoCursor` is null); no console errors.

- [ ] **Step 7: Run tests + build**

```sh
npm test && npm run build
```

- [ ] **Step 8: Commit**

```sh
git add src/map/MapView.jsx src/map/mapLayers.js src/components/featured/FeaturedRoute.jsx src/components/featured/FeaturedRouteMap.jsx
git commit -m "feat(route-video): video cursor marker layer on MapView"
```

---

## Task 7: Add soft auto-pan and `onRouteClick` to `MapView`

**Files:**
- Modify: `src/map/MapView.jsx`

Soft auto-pan keeps the cursor in view as the video plays — animate-pan to recenter only when the cursor enters the outer 15% band of the viewport. `onRouteClick` raises the clicked `latLng` so the parent can decide what to do with it.

- [ ] **Step 1: Add the props**

In `src/map/MapView.jsx`, add to the props destructure:

```jsx
onRouteClick = null,
```

(Place near `onDataMarkerClick` for grouping.)

- [ ] **Step 2: Auto-pan effect**

After the `videoCursor` layer-sync effect from Task 6, add:

```jsx
useEffect(() => {
  if (status !== "ready" || !videoCursor || !map) return;
  const bounds = map.getBounds();
  const w = bounds.getEast() - bounds.getWest();
  const h = bounds.getNorth() - bounds.getSouth();
  const margin = 0.15;
  const inset = {
    west: bounds.getWest() + w * margin,
    east: bounds.getEast() - w * margin,
    south: bounds.getSouth() + h * margin,
    north: bounds.getNorth() - h * margin,
  };
  if (
    videoCursor.lng < inset.west ||
    videoCursor.lng > inset.east ||
    videoCursor.lat < inset.south ||
    videoCursor.lat > inset.north
  ) {
    map.easeTo({
      center: [videoCursor.lng, videoCursor.lat],
      duration: 600,
    });
  }
}, [videoCursor, status]);
```

- [ ] **Step 3: Click handler**

Locate the existing click handler in `MapView.jsx` (around line 703 — `map.on("click", DATA_MARKERS_LAYER_ID, handleDataMarkerClick)`). Add a generic-click handler that fires `onRouteClick` for clicks that did NOT hit a data marker. `DATA_MARKERS_LAYER_ID` is already imported at the top of the file (line 10):

```jsx
useEffect(() => {
  if (status !== "ready" || !map || !onRouteClick) return undefined;
  const handler = (e) => {
    // Skip if the click hit a data marker — those have their own handler.
    if (map.getLayer?.(DATA_MARKERS_LAYER_ID)) {
      const hits = map.queryRenderedFeatures(e.point, {
        layers: [DATA_MARKERS_LAYER_ID],
      });
      if (hits && hits.length > 0) return;
    }
    onRouteClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  };
  map.on("click", handler);
  return () => map.off("click", handler);
}, [status, onRouteClick]);
```

- [ ] **Step 4: Pass `onRouteClick` through `FeaturedRoute.jsx`**

In `src/components/featured/FeaturedRoute.jsx`, define the handler in the component body:

```jsx
const handleRouteClick = useCallback(
  (latLng) => {
    const sync = videoSyncRef.current;
    const seek = playerSeekRef.current;
    if (!sync || !seek) return;
    const snap = sync.snapClickToRoute(latLng);
    if (!snap) return;
    const t = sync.positionToTime(snap.fraction);
    seek(t);
  },
  [],
);
```

Pass `onRouteClick={handleRouteClick}` to both `MapView` instances (desktop aside in `FeaturedRoute.jsx`, mobile slots in `FeaturedRouteMap.jsx`). Import `useCallback` if not already imported.

- [ ] **Step 5: Smoke check + tests + build**

```sh
npm test && npm run build && npm run dev
```

Click around `/featured/sovev-beit-hillel` to confirm no console errors. (Click-to-seek won't do anything yet because there's no `videoSync` or `playerSeek` registered.)

- [ ] **Step 6: Commit**

```sh
git add src/map/MapView.jsx src/components/featured/FeaturedRoute.jsx src/components/featured/FeaturedRouteMap.jsx
git commit -m "feat(route-video): MapView soft auto-pan and onRouteClick wiring"
```

---

## Task 8: YouTube IFrame API loader helper

**Files:**
- Create: `src/components/featured/youtubeIframeApi.js`

A small module-level promise so multiple `VideoEmbed` mounts share one API load.

- [ ] **Step 1: Create the loader**

Create `src/components/featured/youtubeIframeApi.js`:

```js
let loadPromise = null;

export function loadYouTubeIframeApi() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("YouTube IFrame API requires a browser"));
  }
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") {
        try {
          previous();
        } catch (err) {
          console.warn("previous onYouTubeIframeAPIReady threw", err);
        }
      }
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load YouTube IFrame API"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
```

- [ ] **Step 2: No test (browser-only API). Build + commit**

```sh
npm run build
git add src/components/featured/youtubeIframeApi.js
git commit -m "feat(route-video): YouTube IFrame API loader helper"
```

---

## Task 9: `VideoEmbed` — fetch index + per-slug keyframes

**Files:**
- Modify: `src/components/featured/VideoEmbed.jsx`
- Create: `public-data/route-videos/index.json`

This step removes the old dumb-iframe behavior and replaces it with data fetching only. The IFrame API integration follows in Task 10.

- [ ] **Step 1: Create the initial empty index**

Create `public-data/route-videos/index.json`:

```json
{ "version": 1, "routes": {} }
```

- [ ] **Step 2: Rewrite `VideoEmbed.jsx` with fetch-only behavior**

Replace the entire contents of `src/components/featured/VideoEmbed.jsx`:

```jsx
import React, { useEffect, useState } from "react";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

let indexPromise = null;

function loadVideoIndex() {
  if (!indexPromise) {
    const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
    indexPromise = fetch(`${base}public-data/route-videos/index.json`)
      .then((r) => (r.ok ? r.json() : { routes: {} }))
      .catch(() => ({ routes: {} }));
  }
  return indexPromise;
}

async function loadKeyframes(filename) {
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  const response = await fetch(`${base}public-data/route-videos/${filename}`);
  if (!response.ok) throw new Error(`keyframes ${filename}: HTTP ${response.status}`);
  return response.json();
}

export default function VideoEmbed() {
  const { meta } = useFeaturedRoute();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | absent | ready | error

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const index = await loadVideoIndex();
        const filename = index?.routes?.[meta.slug];
        if (!filename) {
          if (!cancelled) setStatus("absent");
          return;
        }
        const payload = await loadKeyframes(filename);
        if (cancelled) return;
        setData(payload);
        setStatus("ready");
      } catch (err) {
        console.warn("VideoEmbed failed to load", err);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta.slug]);

  if (status !== "ready" || !data) return null;
  return (
    <section className="featured-video">
      <h2>סרטון</h2>
      <div className="featured-video-frame">
        {/* Player wired up in the next task */}
        <div data-testid="video-placeholder">{data.youtubeId}</div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Update `sovev-beit-hillel.jsx` to drop the `src` prop**

In `src/featured/sovev-beit-hillel.jsx`, change:

```jsx
<FeaturedRoute.Video src={undefined} />
```

to:

```jsx
<FeaturedRoute.Video />
```

- [ ] **Step 4: Smoke check + build**

```sh
npm test && npm run build && npm run dev
```

Open `/featured/sovev-beit-hillel`. Expected: no video section visible (the slug isn't in the empty index).

- [ ] **Step 5: Commit**

```sh
git add public-data/route-videos/index.json src/components/featured/VideoEmbed.jsx src/featured/sovev-beit-hillel.jsx
git commit -m "feat(route-video): VideoEmbed fetches index and per-slug keyframes"
```

---

## Task 10: `VideoEmbed` — instantiate YouTube player + ticker loop

**Files:**
- Modify: `src/components/featured/VideoEmbed.jsx`
- Modify: `src/components/featured/featured.css` (small additions)

- [ ] **Step 1: Replace the placeholder render with the player**

In `src/components/featured/VideoEmbed.jsx`, add imports:

```jsx
import React, { useEffect, useRef, useState } from "react";
import { loadYouTubeIframeApi } from "./youtubeIframeApi.js";
import { createVideoSync } from "./videoSync.js";
```

Inside the component, replace the `if (status !== "ready" || !data) return null;` block onward with:

```jsx
  const {
    meta,
    routeState,
    setVideoCursor,
    videoSyncRef,
    playerSeekRef,
  } = useFeaturedRoute();
  const iframeContainerRef = useRef(null);
  const playerRef = useRef(null);
  const tickerRef = useRef(null);

  // Build the videoSync instance once we have both data and route geometry.
  useEffect(() => {
    if (!data || !routeState?.geometry?.length) return;
    try {
      videoSyncRef.current = createVideoSync({
        keyframes: data.keyframes,
        videoDuration: data.videoDuration,
        routeGeometry: routeState.geometry,
      });
    } catch (err) {
      console.warn("videoSync construction failed", err);
      videoSyncRef.current = null;
    }
    return () => {
      videoSyncRef.current = null;
    };
  }, [data, routeState?.geometry, videoSyncRef]);

  // Construct YouTube player when data + container are ready.
  useEffect(() => {
    if (!data || !iframeContainerRef.current) return undefined;
    let cancelled = false;
    let timeoutId = null;
    let player = null;

    const fallback = () => {
      if (cancelled) return;
      console.warn("YouTube IFrame API did not become ready; falling back to plain iframe");
      // Render a plain iframe directly in the container.
      const el = iframeContainerRef.current;
      if (!el) return;
      el.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube.com/embed/${data.youtubeId}`;
      iframe.title = "סרטון המסלול";
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.loading = "lazy";
      el.appendChild(iframe);
    };

    timeoutId = window.setTimeout(fallback, 5000);

    (async () => {
      let YT;
      try {
        YT = await loadYouTubeIframeApi();
      } catch {
        if (timeoutId) clearTimeout(timeoutId);
        fallback();
        return;
      }
      if (cancelled) return;

      player = new YT.Player(iframeContainerRef.current, {
        videoId: data.youtubeId,
        playerVars: { enablejsapi: 1, rel: 0 },
        events: {
          onReady: () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = null;
            playerRef.current = player;
            playerSeekRef.current = (t) => player.seekTo(t, true);
          },
          onStateChange: (e) => {
            // YT.PlayerState.PLAYING === 1
            if (e.data === 1) startTicker();
            else stopTicker();
          },
        },
      });
    })();

    function startTicker() {
      if (tickerRef.current) return;
      let lastEmit = 0;
      const loop = (now) => {
        tickerRef.current = window.requestAnimationFrame(loop);
        if (now - lastEmit < 250) return;
        lastEmit = now;
        const p = playerRef.current;
        const sync = videoSyncRef.current;
        if (!p || !sync || typeof p.getCurrentTime !== "function") return;
        const t = p.getCurrentTime();
        const pos = sync.timeToPosition(t);
        setVideoCursor({ t, lat: pos.lat, lng: pos.lng, fraction: pos.fraction });
      };
      tickerRef.current = window.requestAnimationFrame(loop);
    }

    function stopTicker() {
      if (tickerRef.current) {
        window.cancelAnimationFrame(tickerRef.current);
        tickerRef.current = null;
      }
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      stopTicker();
      if (player && typeof player.destroy === "function") {
        try { player.destroy(); } catch {}
      }
      playerRef.current = null;
      playerSeekRef.current = null;
      setVideoCursor(null);
    };
  }, [data, playerSeekRef, setVideoCursor, videoSyncRef]);

  if (status !== "ready" || !data) return null;
  return (
    <section className="featured-video">
      <h2>סרטון</h2>
      <div className="featured-video-frame">
        <div ref={iframeContainerRef} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify CSS leaves the iframe sized correctly**

Look at `src/components/featured/featured.css` for `.featured-video-frame` rules. The YT-created iframe replaces the inner `<div>` and should inherit those rules. If the existing styles assume a direct `<iframe>` child, add a rule:

```css
.featured-video-frame > iframe {
  width: 100%;
  height: 100%;
  border: 0;
}
```

(Only add if missing.)

- [ ] **Step 3: Smoke check**

```sh
npm run dev
```

Manual: temporarily add an entry to `public-data/route-videos/index.json`:

```json
{ "version": 1, "routes": { "sovev-beit-hillel": "sovev-beit-hillel.json" } }
```

and create a stub `public-data/route-videos/sovev-beit-hillel.json` with any real YT video ID and route-shaped keyframes (you can use the test fixture coords; coordinate validity isn't enforced client-side). Load the page, hit play, watch the marker move on the map. Revert the index/stub when done so the commit reflects only the code changes.

- [ ] **Step 4: Tests + build**

```sh
npm test && npm run build
```

- [ ] **Step 5: Commit**

```sh
git add src/components/featured/VideoEmbed.jsx src/components/featured/featured.css
git commit -m "feat(route-video): VideoEmbed with YouTube IFrame API and cursor ticker"
```

---

## Task 11: Add the editor mode toolbar extraction (ModeBar)

**Files:**
- Modify: `editor/editor.js`
- Modify: `editor/index.html`
- Modify: `editor/styles.css`

Narrow refactor only — extract whatever existing mode-switching UI lives in the editor into a discrete "ModeBar" so the new Video Sync mode has a natural place to slot in. Do NOT touch the cycleways-network editing surfaces.

- [ ] **Step 1: Read the current mode UI**

Read `editor/editor.js` (start with the section that hooks up mode buttons; search for `mode` or `setMode`). Read `editor/index.html` for the toolbar markup.

- [ ] **Step 2: Identify the mode-switching DOM and JS**

The goal: a single contiguous block of markup with the mode buttons, plus a single function in `editor.js` that registers a mode and renders its action area. Either move existing code into that shape, or add the shape and rewire one existing mode through it to prove the contract.

Concrete contract (small):

```js
// in editor.js
const modes = new Map();

export function registerEditorMode({ id, label, onActivate, renderActions }) {
  modes.set(id, { label, onActivate, renderActions });
}

function activateMode(id) {
  document.querySelectorAll("[data-mode-action]").forEach((el) => el.remove());
  const mode = modes.get(id);
  if (!mode) return;
  mode.onActivate?.();
  const actionsRoot = document.getElementById("mode-actions");
  if (actionsRoot) mode.renderActions?.(actionsRoot);
}
```

In `editor/index.html`, ensure a `<div id="mode-actions"></div>` exists near the existing toolbar.

- [ ] **Step 3: Re-route one existing mode through `registerEditorMode`**

Pick one of the existing modes (whichever is smallest), and convert it to:

```js
registerEditorMode({
  id: "<existing-id>",
  label: "<existing label>",
  onActivate: () => { /* existing activation code */ },
  renderActions: (root) => {
    // Move the existing per-mode promote/save buttons here.
  },
});
```

This proves the contract; the new Video Sync mode in Task 14 will use the same API.

- [ ] **Step 4: Smoke check the editor manually**

```sh
cd editor && node dev-server.mjs
```

Open the editor in a browser, switch modes, exercise the migrated mode's action button. Expected: behavior unchanged.

- [ ] **Step 5: Commit**

```sh
cd ..
git add editor/editor.js editor/index.html editor/styles.css
git commit -m "refactor(editor): extract ModeBar contract for per-mode action areas"
```

---

## Task 12: Editor server — video keyframes draft endpoint

**Files:**
- Modify: `editor/server.mjs`
- Create: `tests/test-video-keyframes-promote.mjs`

Add `PUT /api/video-keyframes/:slug/draft` that writes a JSON body to `editor/.drafts/route-videos/<slug>.json` after schema validation.

- [ ] **Step 1: Add `.gitignore` entry + drafts dir**

Append to `.gitignore`:

```
editor/.drafts/
!editor/.drafts/.gitkeep
```

Create the directory + placeholder:

```sh
mkdir -p editor/.drafts && touch editor/.drafts/.gitkeep
```

- [ ] **Step 2: Write the failing test**

Create `tests/test-video-keyframes-promote.mjs`:

```js
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateKeyframesDraft,
} from "../editor/server.mjs";

const validDraft = {
  version: 1,
  youtubeId: "dQw4w9WgXcQ",
  videoDuration: 10,
  keyframes: [
    { t: 0, lat: 33.0, lon: 35.0 },
    { t: 10, lat: 33.0, lon: 35.002 },
  ],
};

const routePolyline = [
  { lat: 33.0, lng: 35.0 },
  { lat: 33.0, lng: 35.002 },
];

// Happy path
assert.doesNotThrow(() =>
  validateKeyframesDraft(validDraft, routePolyline),
);

// Wrong videoDuration
assert.throws(
  () =>
    validateKeyframesDraft(
      { ...validDraft, videoDuration: 9 },
      routePolyline,
    ),
  /videoDuration/,
);

// Unsorted keyframes
assert.throws(
  () =>
    validateKeyframesDraft(
      {
        ...validDraft,
        keyframes: [
          { t: 10, lat: 33.0, lon: 35.002 },
          { t: 0, lat: 33.0, lon: 35.0 },
        ],
      },
      routePolyline,
    ),
  /sorted/i,
);

// Keyframe coordinate too far from route
assert.throws(
  () =>
    validateKeyframesDraft(
      {
        ...validDraft,
        keyframes: [
          { t: 0, lat: 34.0, lon: 36.0 },  // very far
          { t: 10, lat: 33.0, lon: 35.002 },
        ],
      },
      routePolyline,
    ),
  /too far from route/i,
);

console.log("video keyframes promote tests passed");
```

- [ ] **Step 3: Run the test to verify it fails**

```sh
node tests/test-video-keyframes-promote.mjs
```

Expected: `SyntaxError` or `does not provide an export named 'validateKeyframesDraft'`.

- [ ] **Step 4: Implement and export `validateKeyframesDraft` in `editor/server.mjs`**

Near the top of `editor/server.mjs` (with the other imports/utility functions), add:

```js
import { createVideoSync } from "../src/components/featured/videoSync.js";

export function validateKeyframesDraft(draft, routePolyline, maxMeters = 80) {
  if (!draft || typeof draft !== "object") {
    throw new Error("draft must be an object");
  }
  const { youtubeId, videoDuration, keyframes } = draft;
  if (typeof youtubeId !== "string" || !youtubeId) {
    throw new Error("draft.youtubeId required");
  }
  if (typeof videoDuration !== "number" || videoDuration <= 0) {
    throw new Error("draft.videoDuration must be a positive number");
  }
  if (!Array.isArray(keyframes) || keyframes.length < 2) {
    throw new Error("draft.keyframes must have at least 2 entries");
  }
  // createVideoSync enforces schema + sort + boundary t-values + route validity.
  // We reuse it as the canonical validator.
  let sync;
  try {
    sync = createVideoSync({
      keyframes,
      videoDuration,
      routeGeometry: routePolyline,
    });
  } catch (err) {
    throw new Error(`videoSync rejected draft: ${err.message}`);
  }
  // Additional check: distance from route for each keyframe.
  for (const kf of keyframes) {
    const snap = sync.snapClickToRoute(
      { lat: kf.lat, lng: kf.lng ?? kf.lon },
      maxMeters,
    );
    if (!snap) {
      throw new Error(
        `keyframe at t=${kf.t} is too far from route (>${maxMeters}m)`,
      );
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```sh
node tests/test-video-keyframes-promote.mjs
```

- [ ] **Step 6: Add the draft endpoint in `editor/server.mjs`**

Find the existing endpoint block (search for `/api/source`). Add (alongside the other `if (request.method === ...)` blocks):

```js
if (request.method === "PUT" && url.pathname.startsWith("/api/video-keyframes/")) {
  const parts = url.pathname.split("/").filter(Boolean);
  // /api/video-keyframes/<slug>/draft
  if (parts.length === 4 && parts[3] === "draft") {
    const slug = parts[2];
    const payload = await readJsonBody(request);
    // Skip server-side route validation for drafts — the editor authors
    // iteratively; only promote needs to enforce route distance.
    const draftPath = path.resolve(repoRoot, "editor/.drafts/route-videos", `${slug}.json`);
    await fs.promises.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.promises.writeFile(draftPath, JSON.stringify(payload, null, 2));
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, path: draftPath }));
    return;
  }
}
```

> Use whatever JSON-body helper the existing endpoints use (search the file for `readJsonBody` or equivalent). If none exists, the existing endpoints will show the pattern — copy that.

- [ ] **Step 7: Manual check with curl**

```sh
cd editor && node dev-server.mjs &
sleep 1
curl -X PUT http://127.0.0.1:<editor-port>/api/video-keyframes/test-slug/draft \
  -H "Content-Type: application/json" \
  -d '{"version":1,"youtubeId":"x","videoDuration":1,"keyframes":[{"t":0,"lat":1,"lon":1},{"t":1,"lat":1,"lon":2}]}'
ls editor/.drafts/route-videos/
```

Expected: `test-slug.json` exists. Clean it up: `rm editor/.drafts/route-videos/test-slug.json`. Stop the dev server.

- [ ] **Step 8: Commit**

```sh
git add .gitignore editor/.drafts/.gitkeep editor/server.mjs tests/test-video-keyframes-promote.mjs
git commit -m "feat(editor): video keyframes draft endpoint + validator"
```

---

## Task 13: Editor server — promote endpoint

**Files:**
- Modify: `editor/server.mjs`
- Modify: `tests/test-video-keyframes-promote.mjs`

`POST /api/video-keyframes/:slug/promote` loads the draft, validates against the route polyline (decoded from the slug's `meta.route`), writes the canonical files atomically, removes the draft.

- [ ] **Step 1: Add failing test for promote (end-to-end)**

Append to `tests/test-video-keyframes-promote.mjs` before the final `console.log`:

```js
// promoteKeyframesDraft writes the canonical files and removes the draft
import { promoteKeyframesDraft } from "../editor/server.mjs";

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rv-promote-"));
const draftsDir = path.join(tmpRoot, "drafts");
const publicDir = path.join(tmpRoot, "public");
await fs.mkdir(draftsDir, { recursive: true });
await fs.mkdir(publicDir, { recursive: true });

await fs.writeFile(
  path.join(draftsDir, "test-slug.json"),
  JSON.stringify(validDraft),
);

const result = await promoteKeyframesDraft({
  slug: "test-slug",
  draftsDir,
  publicDir,
  routePolyline,
});

assert.ok(result.ok);
assert.ok(await fs.stat(path.join(publicDir, "test-slug.json")));
const index = JSON.parse(
  await fs.readFile(path.join(publicDir, "index.json"), "utf8"),
);
assert.equal(index.routes["test-slug"], "test-slug.json");
// Draft removed
await assert.rejects(fs.stat(path.join(draftsDir, "test-slug.json")));
```

- [ ] **Step 2: Run test (expect failure)**

```sh
node tests/test-video-keyframes-promote.mjs
```

- [ ] **Step 3: Implement `promoteKeyframesDraft` in `editor/server.mjs`**

Add (alongside `validateKeyframesDraft`):

```js
export async function promoteKeyframesDraft({ slug, draftsDir, publicDir, routePolyline }) {
  const draftPath = path.resolve(draftsDir, `${slug}.json`);
  const raw = await fs.promises.readFile(draftPath, "utf8");
  const draft = JSON.parse(raw);

  validateKeyframesDraft(draft, routePolyline);

  const targetPath = path.resolve(publicDir, `${slug}.json`);
  const tmpTarget = `${targetPath}.tmp`;
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(tmpTarget, JSON.stringify(draft, null, 2));
  await fs.promises.rename(tmpTarget, targetPath);

  const indexPath = path.resolve(publicDir, "index.json");
  let index;
  try {
    index = JSON.parse(await fs.promises.readFile(indexPath, "utf8"));
  } catch {
    index = { version: 1, routes: {} };
  }
  index.routes = index.routes || {};
  index.routes[slug] = `${slug}.json`;
  const tmpIndex = `${indexPath}.tmp`;
  await fs.promises.writeFile(tmpIndex, JSON.stringify(index, null, 2));
  await fs.promises.rename(tmpIndex, indexPath);

  await fs.promises.unlink(draftPath);
  return { ok: true, targetPath, indexPath };
}
```

- [ ] **Step 4: Wire the HTTP endpoint**

Below the draft endpoint added in Task 12, add:

```js
if (request.method === "POST" && url.pathname.startsWith("/api/video-keyframes/")) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 4 && parts[3] === "promote") {
    const slug = parts[2];
    try {
      const routePolyline = await loadRoutePolylineForSlug(slug);
      const result = await promoteKeyframesDraft({
        slug,
        draftsDir: path.resolve(repoRoot, "editor/.drafts/route-videos"),
        publicDir: path.resolve(repoRoot, "public-data/route-videos"),
        routePolyline,
      });
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result));
    } catch (err) {
      response.statusCode = 400;
      response.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
}
```

`loadRoutePolylineForSlug(slug)` is a helper you'll write directly above. The runtime `loadMapAssets` uses `fetch()` and won't work in Node, so we read the JSON files from disk and feed them to the same routing primitives.

```js
import { pathToFileURL } from "node:url";
import { restoreRouteFromParam, createRouteManager } from "../src/routing/routeActions.js";

let cachedAssets = null;
async function loadAssetsFromDisk() {
  if (cachedAssets) return cachedAssets;
  const publicData = path.resolve(repoRoot, "public-data");
  const manifest = JSON.parse(
    await fs.promises.readFile(path.join(publicData, "map-manifest.json"), "utf8"),
  );
  const bikeRoadsPath = path.join(publicData, manifest.bikeRoads);
  const segmentsPath = path.join(publicData, manifest.segments);
  const geoJsonData = JSON.parse(await fs.promises.readFile(bikeRoadsPath, "utf8"));
  const segmentsData = JSON.parse(await fs.promises.readFile(segmentsPath, "utf8"));
  cachedAssets = { geoJsonData, segmentsData };
  return cachedAssets;
}

async function loadRoutePolylineForSlug(slug) {
  const metaModulePath = path.resolve(repoRoot, `src/featured/${slug}.meta.js`);
  const { meta } = await import(pathToFileURL(metaModulePath).href);
  const { geoJsonData, segmentsData } = await loadAssetsFromDisk();
  // The editor server already loads window.RouteManager for its own use —
  // find that bootstrapping (search for `RouteManager`) and reuse it.
  const manager = await createRouteManager(
    globalThis.RouteManager,
    geoJsonData,
    segmentsData,
  );
  const snapshot = restoreRouteFromParam(manager, meta.route, segmentsData);
  if (!snapshot) throw new Error(`route "${slug}" failed to decode`);
  return snapshot.geometry;
}
```

> If `globalThis.RouteManager` isn't yet wired in the editor server, copy the bootstrap from wherever the existing editor's routing endpoints (search `editor/server.mjs` for `RouteManager`) get it.

- [ ] **Step 5: Run the new test**

```sh
node tests/test-video-keyframes-promote.mjs
```

- [ ] **Step 6: Manual end-to-end check**

```sh
cd editor && node dev-server.mjs &
sleep 1
# Write a draft
curl -X PUT http://127.0.0.1:<port>/api/video-keyframes/sovev-beit-hillel/draft \
  -H "Content-Type: application/json" \
  -d '{"version":1,"youtubeId":"<real-id>","videoDuration":<n>,"keyframes":[...]}'
# Promote
curl -X POST http://127.0.0.1:<port>/api/video-keyframes/sovev-beit-hillel/promote
ls public-data/route-videos/
cat public-data/route-videos/index.json
```

Expected: `sovev-beit-hillel.json` present in `public-data/route-videos/`, `index.json` updated. Clean up after the smoke test if you don't want the change committed.

- [ ] **Step 7: Commit**

```sh
git add editor/server.mjs tests/test-video-keyframes-promote.mjs
git commit -m "feat(editor): video keyframes promote endpoint + tests"
```

---

## Task 14: Editor — Video Sync mode UI (slug picker + YT URL input)

**Files:**
- Modify: `editor/editor.js`
- Modify: `editor/index.html`
- Modify: `editor/styles.css`

This task adds only the *scaffolding* of the new mode: slug picker, YT URL field, empty keyframes list. The Add / Save / Promote logic comes in the next two tasks.

- [ ] **Step 1: Add Video Sync to the HTML**

In `editor/index.html`, add a panel/container that's hidden by default and shown only when the mode is active:

```html
<div id="video-sync-panel" hidden>
  <div class="vs-row">
    <label for="vs-slug">מסלול:</label>
    <select id="vs-slug"></select>
  </div>
  <div class="vs-row">
    <label for="vs-yt-url">YouTube URL:</label>
    <input id="vs-yt-url" type="text" placeholder="https://youtube.com/watch?v=..." />
  </div>
  <div id="vs-player" class="vs-player"></div>
  <ul id="vs-keyframes" class="vs-keyframes"></ul>
</div>
```

- [ ] **Step 2: Add minimal styles in `editor/styles.css`**

```css
#video-sync-panel { padding: 0.5rem; border-top: 1px solid #ddd; }
.vs-row { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; }
.vs-row > label { min-width: 7em; }
.vs-row > input, .vs-row > select { flex: 1; }
.vs-player { width: 100%; aspect-ratio: 16 / 9; margin: 0.5rem 0; background: #000; }
.vs-keyframes { list-style: none; padding: 0; margin: 0; max-height: 16rem; overflow: auto; }
.vs-keyframes li { display: flex; gap: 0.5rem; padding: 0.25rem; border-bottom: 1px solid #eee; align-items: center; }
.vs-keyframes li.selected { background: #fffbe6; }
```

- [ ] **Step 3: Register the mode in `editor.js`**

Using the `registerEditorMode` API from Task 11:

```js
async function listFeaturedSlugs() {
  // Vite-like discovery isn't available in the editor's own vanilla code.
  // Hit a small editor API to enumerate slugs.
  const response = await fetch("/api/featured-slugs");
  return response.ok ? response.json() : [];
}

registerEditorMode({
  id: "video-sync",
  label: "סנכרון וידאו",
  onActivate: async () => {
    const panel = document.getElementById("video-sync-panel");
    panel.hidden = false;
    const slugSelect = document.getElementById("vs-slug");
    slugSelect.innerHTML = "";
    const slugs = await listFeaturedSlugs();
    for (const slug of slugs) {
      const opt = document.createElement("option");
      opt.value = slug;
      opt.textContent = slug;
      slugSelect.appendChild(opt);
    }
  },
  renderActions: (root) => {
    // populated in next tasks
  },
});

// Hide the panel when leaving the mode.
// (Add this in the mode-deactivate path; existing modes likely have a similar hook.)
```

- [ ] **Step 4: Add the `/api/featured-slugs` endpoint to `editor/server.mjs`**

```js
if (request.method === "GET" && url.pathname === "/api/featured-slugs") {
  const dir = path.resolve(repoRoot, "src/featured");
  const entries = await fs.promises.readdir(dir);
  const slugs = entries
    .filter((f) => f.endsWith(".meta.js"))
    .map((f) => f.replace(/\.meta\.js$/, ""));
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(slugs));
  return;
}
```

- [ ] **Step 5: Manual check**

Open the editor, switch to Video Sync mode, verify the dropdown lists slugs (`sovev-beit-hillel`, `shdeh-nehemia-baniyas`). Empty player area, empty keyframes list — expected.

- [ ] **Step 6: Commit**

```sh
git add editor/editor.js editor/index.html editor/styles.css editor/server.mjs
git commit -m "feat(editor): Video Sync mode scaffolding (slug picker, YT URL field)"
```

---

## Task 15: Editor Video Sync — load route + YT player, add keyframes

**Files:**
- Modify: `editor/editor.js`
- Modify: `editor/server.mjs` (small additions)

- [ ] **Step 1: Load the route polyline for the chosen slug into the editor map**

Add a server endpoint `GET /api/video-keyframes/:slug/route-polyline` that returns the polyline computed via `loadRoutePolylineForSlug` (Task 13). Use the existing endpoint dispatch in `editor/server.mjs`:

```js
if (request.method === "GET" && url.pathname.startsWith("/api/video-keyframes/")) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 4 && parts[3] === "route-polyline") {
    const slug = parts[2];
    const polyline = await loadRoutePolylineForSlug(slug);
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(polyline));
    return;
  }
}
```

In `editor.js`, on slug change, fetch this and render the polyline on the editor's map using its existing map-rendering primitives.

- [ ] **Step 2: Load YT player when URL pasted**

In `editor.js`:

```js
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
  } catch {}
  return null;
}

let ytPlayer = null;

async function loadYouTubeIframeApi() {
  // Same pattern as src/components/featured/youtubeIframeApi.js, inline here
  // since the editor is vanilla JS without ES module imports for browser code.
  if (window.YT && window.YT.Player) return window.YT;
  return new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
}

async function loadVideo(youtubeId) {
  const YT = await loadYouTubeIframeApi();
  const container = document.getElementById("vs-player");
  container.innerHTML = "";
  if (ytPlayer) try { ytPlayer.destroy(); } catch {}
  ytPlayer = new YT.Player(container, {
    videoId: youtubeId,
    playerVars: { enablejsapi: 1, rel: 0 },
  });
}

document.getElementById("vs-yt-url").addEventListener("change", (e) => {
  const id = extractYouTubeId(e.target.value);
  if (id) loadVideo(id);
});
```

- [ ] **Step 3: Capture keyframes on map click**

Hook into the editor's existing map click handler — when in Video Sync mode, treat the click as a keyframe candidate instead of the usual editor behavior. Pseudocode:

```js
let keyframes = [];

function addKeyframeAtCurrentTime(latLng) {
  if (!ytPlayer || typeof ytPlayer.getCurrentTime !== "function") return;
  const t = ytPlayer.getCurrentTime();
  keyframes.push({ t, lat: latLng.lat, lon: latLng.lng });
  keyframes.sort((a, b) => a.t - b.t);
  renderKeyframesList();
}

function renderKeyframesList() {
  const ul = document.getElementById("vs-keyframes");
  ul.innerHTML = "";
  for (const [i, kf] of keyframes.entries()) {
    const li = document.createElement("li");
    li.textContent = `${formatTime(kf.t)} — ${kf.lat.toFixed(5)}, ${kf.lon.toFixed(5)}`;
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "מחק";
    del.addEventListener("click", () => {
      keyframes.splice(i, 1);
      renderKeyframesList();
    });
    li.appendChild(del);
    ul.appendChild(li);
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds - m * 60).toFixed(2);
  return `${m}:${String(s).padStart(5, "0")}`;
}
```

Wire the editor's existing map click pipeline to call `addKeyframeAtCurrentTime(latLng)` only when `currentMode === "video-sync"`.

- [ ] **Step 4: Manual check**

Open the editor, switch to Video Sync, pick a slug, paste a YT URL, scrub the video, click on the map a few times. Expected: keyframes list grows in time order; delete buttons work.

- [ ] **Step 5: Commit**

```sh
git add editor/editor.js editor/server.mjs
git commit -m "feat(editor): Video Sync mode keyframe capture on map click"
```

---

## Task 16: Editor Video Sync — Save Draft and Promote actions

**Files:**
- Modify: `editor/editor.js`

- [ ] **Step 1: Implement the action buttons**

In `editor.js`, in the `renderActions` callback for the Video Sync mode:

```js
renderActions: (root) => {
  root.innerHTML = "";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.dataset.modeAction = "video-sync";
  saveBtn.textContent = "שמור טיוטה";
  saveBtn.addEventListener("click", async () => {
    const slug = document.getElementById("vs-slug").value;
    const youtubeId = extractYouTubeId(document.getElementById("vs-yt-url").value);
    const videoDuration = ytPlayer?.getDuration?.();
    if (!youtubeId || !videoDuration) {
      alert("נדרשת כתובת YouTube ושהוידאו ייטען לפני שמירה");
      return;
    }
    const payload = { version: 1, youtubeId, videoDuration, keyframes };
    const r = await fetch(`/api/video-keyframes/${slug}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await r.json();
    alert(r.ok ? "נשמר" : `שגיאה: ${result?.error || r.statusText}`);
  });

  const promoteBtn = document.createElement("button");
  promoteBtn.type = "button";
  promoteBtn.dataset.modeAction = "video-sync";
  promoteBtn.textContent = "פרסם";
  promoteBtn.addEventListener("click", async () => {
    const slug = document.getElementById("vs-slug").value;
    const r = await fetch(`/api/video-keyframes/${slug}/promote`, {
      method: "POST",
    });
    const result = await r.json();
    alert(r.ok ? "פורסם בהצלחה" : `שגיאה: ${result?.error || r.statusText}`);
  });

  root.append(saveBtn, promoteBtn);
},
```

- [ ] **Step 2: Manual end-to-end check**

Open editor, pick slug, paste YT URL, add 3-5 keyframes, click "שמור טיוטה" — verify `editor/.drafts/route-videos/<slug>.json` exists. Click "פרסם" — verify `public-data/route-videos/<slug>.json` and `index.json` updated.

Open `http://127.0.0.1:<vite-port>/featured/<slug>` and verify the video panel now appears and the marker moves with playback.

- [ ] **Step 3: Run tests + build**

```sh
npm test && npm run build
```

- [ ] **Step 4: Commit**

```sh
git add editor/editor.js
git commit -m "feat(editor): Video Sync Save Draft and Promote actions"
```

---

## Task 17: Editor Video Sync — Load existing draft on slug select

**Files:**
- Modify: `editor/editor.js`
- Modify: `editor/server.mjs`

- [ ] **Step 1: Add GET draft endpoint**

In `editor/server.mjs`:

```js
if (request.method === "GET" && url.pathname.startsWith("/api/video-keyframes/")) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 4 && parts[3] === "draft") {
    const slug = parts[2];
    const draftPath = path.resolve(repoRoot, "editor/.drafts/route-videos", `${slug}.json`);
    try {
      const raw = await fs.promises.readFile(draftPath, "utf8");
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(raw);
    } catch {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false }));
    }
    return;
  }
}
```

- [ ] **Step 2: Load draft on slug change**

Extend the slug-select change handler:

```js
async function loadDraft(slug) {
  const r = await fetch(`/api/video-keyframes/${slug}/draft`);
  if (!r.ok) {
    keyframes = [];
    document.getElementById("vs-yt-url").value = "";
    renderKeyframesList();
    return;
  }
  const draft = await r.json();
  keyframes = draft.keyframes || [];
  document.getElementById("vs-yt-url").value = `https://youtube.com/watch?v=${draft.youtubeId}`;
  loadVideo(draft.youtubeId);
  renderKeyframesList();
}

document.getElementById("vs-slug").addEventListener("change", (e) => {
  loadDraft(e.target.value);
});
```

Also trigger `loadDraft` when the mode is first activated (after populating the dropdown).

- [ ] **Step 3: Manual check**

Save a draft. Switch away from the slug, switch back. Expected: keyframes + YT URL repopulate.

- [ ] **Step 4: Commit**

```sh
git add editor/editor.js editor/server.mjs
git commit -m "feat(editor): Video Sync loads existing draft on slug select"
```

---

## Task 18: Video processing script

**Files:**
- Create: `processing/process-video.sh`
- Create: `processing/README-video.md`

- [ ] **Step 1: Write the script**

Create `processing/process-video.sh`:

```sh
#!/bin/zsh
# Usage: process-video.sh <input.mp4> <output.mp4> [speedup-factor]
#
# Defaults: 15x speedup, 1440p upscale (for YT quality tier), Apple HW HEVC encode.
# Strips audio, caps fps at 30.
set -euo pipefail
IN="${1:?missing input}"
OUT="${2:?missing output}"
SPEEDUP="${3:-15}"
ffmpeg -i "$IN" \
  -vf "setpts=PTS/${SPEEDUP},scale=2560:1440:flags=lanczos" \
  -r 30 \
  -an \
  -c:v hevc_videotoolbox -q:v 60 -tag:v hvc1 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  "$OUT"
```

```sh
chmod +x processing/process-video.sh
```

- [ ] **Step 2: Write the README**

Create `processing/README-video.md`:

```markdown
# Route Video Processing

Compress a 1080p source ride video into a 1–3 minute timelapse for YouTube
upload, optimized for YouTube's re-encoder.

## Usage

    ./process-video.sh source.mp4 processed.mp4 [speedup]

- `speedup` (default 15) — divides duration by this factor.
- Output is 1440p / 30fps / HEVC / no audio.

## Why these settings

- **1440p upscale:** YouTube assigns higher-tier encoders (VP9/AV1) with
  more generous bitrate to ≥ 1440p uploads, even when viewers watch at 1080p.
  This is the single biggest knob for perceived playback quality.
- **Apple HW HEVC (`hevc_videotoolbox`):** ~10× faster than `libx264` on
  Apple Silicon. Local encode quality doesn't matter — YT re-encodes
  everything.
- **30 fps:** Source is typically 24 fps; the speedup already produces a
  hyperlapse. 60 fps doubles the bitrate for no perceptual gain.
- **Audio stripped:** timelapse audio is unusable.

## After upload

Wait for YT to finish encoding 1440p/2160p renditions before judging
quality — the first few minutes show only the cheap fast-path encode.
Upload as **unlisted**.
```

- [ ] **Step 3: Commit**

```sh
git add processing/process-video.sh processing/README-video.md
git commit -m "feat(route-video): ffmpeg processing recipe for YT-bound timelapse"
```

---

## Task 19: E2E test — featured-route video panel

**Files:**
- Create: `tests/e2e/featured-video.spec.mjs`

This requires a real promoted video for one route. The test assumes you've completed Task 16 manually for `sovev-beit-hillel` (so the keyframes file exists). If not, you'd skip this test in CI.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/featured-video.spec.mjs`:

```js
import { test, expect } from "@playwright/test";

test("video panel renders for a route with keyframes", async ({ page }) => {
  await page.goto("/featured/sovev-beit-hillel");
  await page.waitForSelector(".featured-video", { timeout: 10000 });
  await expect(page.locator(".featured-video iframe")).toBeVisible();
});

test("no video panel for a route without keyframes", async ({ page }) => {
  // shdeh-nehemia-baniyas is expected to NOT have a video promoted
  await page.goto("/featured/shdeh-nehemia-baniyas");
  // Give the page a moment to settle
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".featured-video")).toHaveCount(0);
});
```

- [ ] **Step 2: Run the e2e suite**

```sh
npm run test:smoke
```

Expected: both specs pass (assuming sovev-beit-hillel has a promoted video).

- [ ] **Step 3: Commit**

```sh
git add tests/e2e/featured-video.spec.mjs
git commit -m "test(route-video): playwright e2e for video panel render"
```

---

## Task 20: Final test wire-up + branch cleanup

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm all new tests are in the `test` script**

```sh
grep -o "test-video-sync\|test-video-keyframes-promote" package.json
```

Expected: both names appear. If `test-video-keyframes-promote.mjs` is missing, add it to the `test` script (place after `test-video-sync.mjs`).

- [ ] **Step 2: Run the full test suite**

```sh
npm test
```

Expected: all pass.

- [ ] **Step 3: Build**

```sh
npm run build
```

Expected: clean build.

- [ ] **Step 4: Final commit if anything changed**

```sh
git add package.json
git diff --cached --quiet || git commit -m "test(route-video): wire promote test into npm test"
```

- [ ] **Step 5: Push branch**

```sh
git push -u origin claude/video-summary
```

---

## Self-Review Checklist (for the agent executing this plan)

After all tasks are complete, before opening a PR:

1. **Manual visual check** on `/featured/sovev-beit-hillel`:
   - Marker appears and tracks playback.
   - Soft auto-pan kicks in when the marker exits the inner viewport.
   - Clicking on/near the route seeks the video.
   - Clicking far from the route does not seek and doesn't break map pan.
   - Pausing the video freezes the marker.
   - Refresh while paused: marker repositions to t=0 when playback resumes.

2. **Failure modes:**
   - In a browser dev-tools network panel, block requests to
     `https://www.youtube.com/iframe_api`. Reload the route page. After 5 s
     the fallback plain iframe should appear; no JS errors.
   - Delete the slug's `route-videos/<slug>.json` (keep the index entry).
     Page should silently render no video panel after a `Could not load`
     warning in the console.

3. **Test coverage** — every spec requirement has at least one test or a
   manual-check note in this list. Skim the spec one last time to confirm.
