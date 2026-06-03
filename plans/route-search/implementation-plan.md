# Route Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a button-driven welcome wizard that helps newcomers find a cycling route by answering 4–5 quick questions, matched against an editor-managed catalog that also serves as the registry for featured routes.

**Architecture:** A pure `wizardReducer` drives the conversational state. A pure `catalogFilter` ranks pre-computed catalog entries against the user's answers. A new "Route Catalog" workspace tab in the editor lets the maintainer manage the unified list (catalog + featured candidates); the editor server's `classifyRoute()` enriches each entry with computed metadata on promote. A `<WelcomeWizard>` overlay mounted from `App.jsx` is the front door on first visit; dismissible to localStorage and re-openable from the TopBar.

**Tech Stack:** React 19, Vite 7, vanilla JS for the editor, `node:assert/strict` tests in `.mjs` files, Playwright for e2e. No new dependencies.

---

## File Structure

**New runtime files**

- `src/components/wizardReducer.js` — pure state machine for the 5-step wizard
- `src/components/catalogFilter.js` — pure filter + scoring + ranking
- `src/data/catalog.js` — fetch helper for `public-data/route-catalog.json`
- `src/components/WelcomeWizard.jsx` — overlay shell, visibility, URL nav
- `src/components/WelcomeWizardChat.jsx` — chat-style presentation
- `src/components/RouteCard.jsx` — single result card
- `src/components/welcome-wizard.css` — overlay styles

**Modified runtime files**

- `src/App.jsx` — mount `<WelcomeWizard>`; visibility from URL + localStorage
- `src/components/TopBar.jsx` — add "מצא מסלול" button
- `src/components/featured/FeaturedRoute.jsx` — read meta from loaded catalog
- `src/featured/index.js` — enumerate featured entries from catalog
- `src/featured/sovev-beit-hillel.jsx`, `shdeh-nehemia-baniyas.jsx` — drop `meta` prop, drop `export { meta }`
- `package.json` — wire new test files into `npm test`

**Deleted runtime files**

- `src/featured/sovev-beit-hillel.meta.js`
- `src/featured/shdeh-nehemia-baniyas.meta.js`

**New editor files** (additions inside existing modules)

- `editor/index.html` — `#route-catalog-panel` markup + workspace tab button
- `editor/editor.js` — register `"route-catalog"` workspace mode; list/detail UI + actions
- `editor/server.mjs` — `classifyRoute`, `validateCatalogDraft`, `promoteCatalogDraft`, endpoints
- `editor/styles.css` — small styles for the new panel

**New data files**

- `data/places.json` — named places list (`[{ id, name, lat, lng }]`)
- `data/region-zones.json` — region polygons (`[{ id, name, polygon: [[lng,lat],...] }]`)

**New public-data file (seeded by migration, then maintained by editor promotes)**

- `public-data/route-catalog.json`

**New tests**

- `tests/test-wizard-reducer.mjs`
- `tests/test-catalog-filter.mjs`
- `tests/test-classify-route.mjs`
- `tests/test-route-catalog-promote.mjs`
- `tests/e2e/welcome-wizard.spec.mjs`

---

## Conventions Used Throughout

- **Coordinate shape:** geometry uses `{ lat, lng }`; the catalog's `passesNear` is computed against `places.json` entries which use `lat, lng`.
- **Tests:** `.mjs` files using `import assert from "node:assert/strict"`, imperative assertions, `console.log("X tests passed")` at the bottom. Template: `tests/test-video-sync.mjs`.
- **Commits:** conventional-commit style — `feat(route-search):`, `test(route-search):`, `refactor(featured-routes):` etc. Match the existing `featured-routes` and `route-video` prefixes.
- **No emojis in code or commit messages.**
- **Hebrew strings** for all user-facing text in the public site. Editor UI is English (matches existing editor convention).

---

## Task 1: Seed `data/places.json` and `data/region-zones.json`

**Files:**
- Create: `data/places.json`
- Create: `data/region-zones.json`

Seed with the small set of places/zones already implied by the existing featured routes plus the recommended segments. The maintainer extends these later through the editor or by editing the JSON directly.

- [ ] **Step 1: Write `data/places.json`**

```json
{
  "version": 1,
  "places": [
    { "id": "beit-hillel",       "name": "בית הלל",       "lat": 33.2177, "lng": 35.6097 },
    { "id": "dafna",             "name": "דפנה",          "lat": 33.2330, "lng": 35.6240 },
    { "id": "banias",            "name": "בניאס",         "lat": 33.2487, "lng": 35.6928 },
    { "id": "kfar-szold",        "name": "כפר סאלד",      "lat": 33.1971, "lng": 35.6552 },
    { "id": "hagoshrim",         "name": "הגושרים",       "lat": 33.2294, "lng": 35.6188 },
    { "id": "shdeh-nehemia",     "name": "שדה נחמיה",     "lat": 33.2056, "lng": 35.6101 },
    { "id": "kfar-blum",         "name": "כפר בלום",      "lat": 33.1762, "lng": 35.6082 },
    { "id": "ayelet-hashachar",  "name": "איילת השחר",    "lat": 33.0250, "lng": 35.5689 },
    { "id": "kiryat-shmona",     "name": "קרית שמונה",    "lat": 33.2086, "lng": 35.5704 },
    { "id": "metula",            "name": "מטולה",         "lat": 33.2786, "lng": 35.5760 },
    { "id": "amir",              "name": "עמיר",          "lat": 33.1797, "lng": 35.5856 },
    { "id": "gan-hatzafon",      "name": "גן הצפון",      "lat": 33.2174, "lng": 35.6311 }
  ]
}
```

Coordinates are approximate; adjust against the actual map as the catalog grows.

- [ ] **Step 2: Write `data/region-zones.json`**

```json
{
  "version": 1,
  "zones": [
    {
      "id": "hula-valley",
      "name": "עמק החולה",
      "polygon": [[35.55, 33.15], [35.65, 33.15], [35.65, 33.22], [35.55, 33.22], [35.55, 33.15]]
    },
    {
      "id": "galilee-panhandle",
      "name": "אצבע הגליל",
      "polygon": [[35.55, 33.22], [35.65, 33.22], [35.65, 33.30], [35.55, 33.30], [35.55, 33.22]]
    },
    {
      "id": "dafna-cluster",
      "name": "דפנה והגושרים",
      "polygon": [[35.60, 33.20], [35.70, 33.20], [35.70, 33.26], [35.60, 33.26], [35.60, 33.20]]
    },
    {
      "id": "north-golan",
      "name": "צפון הגולן",
      "polygon": [[35.65, 33.18], [35.80, 33.18], [35.80, 33.30], [35.65, 33.30], [35.65, 33.18]]
    },
    {
      "id": "south-golan",
      "name": "דרום הגולן",
      "polygon": [[35.65, 33.05], [35.85, 33.05], [35.85, 33.18], [35.65, 33.18], [35.65, 33.05]]
    }
  ]
}
```

These polygons overlap at boundaries; point-in-polygon picks the first match in array order.

- [ ] **Step 3: Commit**

```sh
git add data/places.json data/region-zones.json
git commit -m "feat(route-search): seed places and region zones data"
```

---

## Task 2: `wizardReducer` — pure state machine

**Files:**
- Create: `src/components/wizardReducer.js`
- Test: `tests/test-wizard-reducer.mjs`

Five-step flow with one conditional skip (region question is skipped when a specific place is picked).

- [ ] **Step 1: Write the failing tests**

```js
// tests/test-wizard-reducer.mjs
import assert from "node:assert/strict";
import { initialWizardState, wizardReducer } from "../src/components/wizardReducer.js";

const s0 = initialWizardState();
assert.equal(s0.step, 0);
assert.equal(s0.answers.place, null);

// Answering place jumps past region (step 1 -> 2)
const s1 = wizardReducer(s0, { type: "ANSWER", key: "place", value: "dafna" });
assert.equal(s1.answers.place, "dafna");
assert.equal(s1.step, 2);

// Answering place="any" keeps the region question (step 1)
const sAny = wizardReducer(s0, { type: "ANSWER", key: "place", value: "any" });
assert.equal(sAny.answers.place, "any");
assert.equal(sAny.step, 1);

// Continue forward
const s2 = wizardReducer(s1, { type: "ANSWER", key: "distance", value: "medium" });
assert.equal(s2.step, 3);
const s3 = wizardReducer(s2, { type: "ANSWER", key: "difficulty", value: "easy" });
assert.equal(s3.step, 4);
const s4 = wizardReducer(s3, { type: "ANSWER", key: "style", value: "family" });
assert.equal(s4.step, 5); // results step

// BACK from results goes to step 4
const back1 = wizardReducer(s4, { type: "BACK" });
assert.equal(back1.step, 4);

// BACK across the skipped region step (step 2 -> 0, not 2 -> 1)
const back2 = wizardReducer(s1, { type: "BACK" }); // from step 2 with place set
assert.equal(back2.step, 0);

// RESET
const reset = wizardReducer(s4, { type: "RESET" });
assert.deepEqual(reset, initialWizardState());

// BACK from step 0 is a no-op
assert.deepEqual(wizardReducer(s0, { type: "BACK" }), s0);

console.log("wizardReducer tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

```sh
node tests/test-wizard-reducer.mjs
```
Expected: `Cannot find module '.../wizardReducer.js'`.

- [ ] **Step 3: Implement the reducer**

```js
// src/components/wizardReducer.js
const STEP_KEYS = ["place", "region", "distance", "difficulty", "style"];

export function initialWizardState() {
  return {
    step: 0,
    answers: {
      place: null,
      region: null,
      distance: null,
      difficulty: null,
      style: null,
    },
  };
}

function nextStepAfter(stepIndex, answers) {
  // If the place question was just answered with a real place (not "any"),
  // skip the region step.
  if (stepIndex === 0 && answers.place && answers.place !== "any") {
    return 2;
  }
  return stepIndex + 1;
}

function prevStepFrom(stepIndex, answers) {
  if (stepIndex === 0) return 0;
  // If we're at step 2 and the place isn't "any", region was skipped — jump back to 0.
  if (stepIndex === 2 && answers.place && answers.place !== "any") {
    return 0;
  }
  return stepIndex - 1;
}

export function wizardReducer(state, action) {
  switch (action.type) {
    case "ANSWER": {
      const answers = { ...state.answers, [action.key]: action.value };
      // Find which step this answer corresponds to and advance.
      const answeredAt = STEP_KEYS.indexOf(action.key);
      const step = nextStepAfter(answeredAt, answers);
      return { step, answers };
    }
    case "BACK":
      return { ...state, step: prevStepFrom(state.step, state.answers) };
    case "RESET":
      return initialWizardState();
    default:
      return state;
  }
}

export const WIZARD_STEP_COUNT = STEP_KEYS.length; // 5
export const WIZARD_STEP_KEYS = STEP_KEYS;
```

- [ ] **Step 4: Run test to verify it passes**

```sh
node tests/test-wizard-reducer.mjs
```
Expected: `wizardReducer tests passed`.

- [ ] **Step 5: Commit**

```sh
git add src/components/wizardReducer.js tests/test-wizard-reducer.mjs
git commit -m "feat(route-search): wizardReducer pure state machine"
```

---

## Task 3: `catalogFilter` — pure filter + scoring

**Files:**
- Create: `src/components/catalogFilter.js`
- Test: `tests/test-catalog-filter.mjs`

Hard filter on `place` and `region`. Soft score on `distance`, `difficulty`, `style`. Top 5.

- [ ] **Step 1: Write the failing tests**

```js
// tests/test-catalog-filter.mjs
import assert from "node:assert/strict";
import { catalogFilter } from "../src/components/catalogFilter.js";

const catalog = [
  { slug: "a", distanceKm: 5,  elevationGainM: 50,  regionId: "hula-valley", passesNear: ["beit-hillel"], difficulty: "easy",     style: "family",      qualityScore: 4.5 },
  { slug: "b", distanceKm: 15, elevationGainM: 200, regionId: "hula-valley", passesNear: ["dafna"],       difficulty: "moderate", style: "scenic",      qualityScore: 4.2 },
  { slug: "c", distanceKm: 30, elevationGainM: 700, regionId: "north-golan", passesNear: ["banias"],      difficulty: "hard",     style: "sporty",      qualityScore: 3.8 },
  { slug: "d", distanceKm: 8,  elevationGainM: 30,  regionId: "hula-valley", passesNear: ["beit-hillel"], difficulty: "easy",     style: "scenic",      qualityScore: 3.5 },
];

// All "any" returns full catalog sorted by qualityScore.
const all = catalogFilter(catalog, { place: "any", region: "any", distance: "any", difficulty: "any", style: "any" });
assert.equal(all.length, 4);
assert.equal(all[0].slug, "a"); // highest qualityScore

// Hard filter on place
const onlyBeitHillel = catalogFilter(catalog, { place: "beit-hillel", region: "any", distance: "any", difficulty: "any", style: "any" });
assert.deepEqual(onlyBeitHillel.map(r => r.slug), ["a", "d"]); // by qualityScore

// Hard filter on region (place=any)
const golan = catalogFilter(catalog, { place: "any", region: "north-golan", distance: "any", difficulty: "any", style: "any" });
assert.deepEqual(golan.map(r => r.slug), ["c"]);

// Soft scoring: distance="medium" prefers b (15 km, exact match) over a (5 km, adjacent)
const medium = catalogFilter(catalog, { place: "any", region: "any", distance: "medium", difficulty: "any", style: "any" });
assert.equal(medium[0].slug, "b");

// Soft scoring: style="family" prefers a (exact) over b (no match)
const family = catalogFilter(catalog, { place: "any", region: "any", distance: "any", difficulty: "any", style: "family" });
assert.equal(family[0].slug, "a");

// No match returns empty
const empty = catalogFilter(catalog, { place: "nonexistent", region: "any", distance: "any", difficulty: "any", style: "any" });
assert.deepEqual(empty, []);

// Returns at most 5
const fiveCat = Array.from({ length: 10 }, (_, i) => ({
  slug: `r${i}`, distanceKm: 10, elevationGainM: 100, regionId: "x", passesNear: [],
  difficulty: "easy", style: "scenic", qualityScore: 5 - i * 0.1,
}));
const five = catalogFilter(fiveCat, { place: "any", region: "any", distance: "any", difficulty: "any", style: "any" });
assert.equal(five.length, 5);
assert.equal(five[0].slug, "r0");

console.log("catalogFilter tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

```sh
node tests/test-catalog-filter.mjs
```

- [ ] **Step 3: Implement the filter**

```js
// src/components/catalogFilter.js
const DISTANCE_BUCKETS = ["short", "medium", "long"]; // < 10, 10-25, > 25 km
const DIFFICULTY_BUCKETS = ["easy", "moderate", "hard"];

function distanceBucketOf(km) {
  if (km < 10) return "short";
  if (km <= 25) return "medium";
  return "long";
}

function bucketScore(actualBucket, requestedBucket, buckets) {
  if (requestedBucket === "any" || requestedBucket == null) return 0;
  if (actualBucket === requestedBucket) return 3;
  const ai = buckets.indexOf(actualBucket);
  const ri = buckets.indexOf(requestedBucket);
  if (ai >= 0 && ri >= 0 && Math.abs(ai - ri) === 1) return 1;
  return 0;
}

function styleScore(actual, requested) {
  if (requested === "any" || requested == null) return 0;
  return actual === requested ? 3 : 0;
}

export function catalogFilter(catalog, answers) {
  const want = answers || {};

  const hardFiltered = catalog.filter((entry) => {
    if (want.place && want.place !== "any") {
      if (!Array.isArray(entry.passesNear) || !entry.passesNear.includes(want.place)) {
        return false;
      }
    }
    if (want.region && want.region !== "any") {
      if (entry.regionId !== want.region) return false;
    }
    return true;
  });

  const scored = hardFiltered.map((entry) => {
    const distBucket = distanceBucketOf(entry.distanceKm);
    const score =
      bucketScore(distBucket, want.distance, DISTANCE_BUCKETS) +
      bucketScore(entry.difficulty, want.difficulty, DIFFICULTY_BUCKETS) +
      styleScore(entry.style, want.style);
    return { entry, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.entry.qualityScore || 0) - (a.entry.qualityScore || 0);
  });

  return scored.slice(0, 5).map((s) => s.entry);
}

export { distanceBucketOf, DISTANCE_BUCKETS, DIFFICULTY_BUCKETS };
```

- [ ] **Step 4: Run test to verify it passes**

```sh
node tests/test-catalog-filter.mjs
```

- [ ] **Step 5: Commit**

```sh
git add src/components/catalogFilter.js tests/test-catalog-filter.mjs
git commit -m "feat(route-search): catalogFilter pure ranking"
```

---

## Task 4: `classifyRoute` in the editor server

**Files:**
- Modify: `editor/server.mjs`
- Test: `tests/test-classify-route.mjs`

Pure function that takes a route token (already decoded to geometry), the network data, places list, and region zones — and returns the computed metadata block.

- [ ] **Step 1: Write the failing test**

```js
// tests/test-classify-route.mjs
import assert from "node:assert/strict";
import { classifyRoute } from "../editor/server.mjs";

// Synthetic short, flat geometry near a known place.
const places = [
  { id: "beit-hillel", name: "בית הלל", lat: 33.2177, lng: 35.6097 },
  { id: "kfar-szold",  name: "כפר סאלד", lat: 33.1971, lng: 35.6552 },
];
const zones = [
  { id: "hula-valley", name: "עמק החולה",
    polygon: [[35.55, 33.15], [35.65, 33.15], [35.65, 33.22], [35.55, 33.22], [35.55, 33.15]] },
];

const easyFlatLoop = {
  geometry: [
    { lat: 33.2170, lng: 35.6090, elevation: 100 },
    { lat: 33.2180, lng: 35.6100, elevation: 102 },
    { lat: 33.2185, lng: 35.6110, elevation: 105 },
    { lat: 33.2175, lng: 35.6098, elevation: 100 },
  ],
  roadTypeFractions: { paved: 0.8, dirt: 0.2, road: 0.0 },
  qualityScore: 4.2,
};

const meta = classifyRoute(easyFlatLoop, { places, zones });
assert.equal(meta.regionId, "hula-valley");
assert.ok(meta.passesNear.includes("beit-hillel"));
assert.equal(meta.difficulty, "easy");
assert.ok(meta.distanceKm > 0 && meta.distanceKm < 1); // very short
assert.equal(meta.elevationGainM > 0 && meta.elevationGainM < 20, true);
assert.equal(meta.style, "scenic"); // qualityScore >= 4 -> scenic priority over family (roadMix.road = 0)
// Wait — by priority order family > scenic. Let's check.
// family: easy && roadMix.road < 0.1 && qualityScore >= 3 -> true here. So style="family".
assert.equal(meta.style, "family");

// Hard climby long route -> hard sporty
const hardClimb = {
  geometry: [
    { lat: 33.20, lng: 35.65, elevation: 100 },
    { lat: 33.25, lng: 35.70, elevation: 800 }, // huge climb
    { lat: 33.30, lng: 35.75, elevation: 1200 },
  ],
  roadTypeFractions: { paved: 0.6, dirt: 0.4, road: 0.0 },
  qualityScore: 3.0,
};
const hardMeta = classifyRoute(hardClimb, { places, zones });
assert.equal(hardMeta.difficulty, "hard");
assert.equal(hardMeta.style, "sporty");

// Adventurous: dirt-heavy, not easy enough for family, not scenic enough for scenic
const dirty = {
  geometry: [
    { lat: 33.20, lng: 35.60, elevation: 100 },
    { lat: 33.22, lng: 35.62, elevation: 250 },
  ],
  roadTypeFractions: { paved: 0.2, dirt: 0.7, road: 0.1 },
  qualityScore: 3.2,
};
const dirtyMeta = classifyRoute(dirty, { places, zones });
assert.equal(dirtyMeta.difficulty, "moderate");
assert.equal(dirtyMeta.style, "adventurous");

console.log("classifyRoute tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

```sh
node tests/test-classify-route.mjs
```

- [ ] **Step 3: Implement `classifyRoute`**

Add to `editor/server.mjs` (place near the other exported validators):

```js
const PASSES_NEAR_METERS = 500;

function haversineMeters(a, b) {
  const R = 6371000;
  const DEG = Math.PI / 180;
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestDistanceToPolyline(point, polyline) {
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const DEG = Math.PI / 180;
    const cosLat = Math.cos(((a.lat + b.lat) / 2) * DEG);
    const ax = a.lng * cosLat, ay = a.lat;
    const bx = b.lng * cosLat, by = b.lat;
    const px = point.lng * cosLat, py = point.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const projLat = a.lat + (b.lat - a.lat) * t;
    const projLng = a.lng + (b.lng - a.lng) * t;
    const d = haversineMeters(point, { lat: projLat, lng: projLng });
    if (d < best) best = d;
  }
  return best;
}

function pointInPolygon(point, polygon) {
  // Ray-cast algorithm. polygon: [[lng,lat], ...]
  const x = point.lng, y = point.lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function centroidOf(polyline) {
  let sumLat = 0, sumLng = 0;
  for (const p of polyline) { sumLat += p.lat; sumLng += p.lng; }
  return { lat: sumLat / polyline.length, lng: sumLng / polyline.length };
}

function distanceKmOf(polyline) {
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    total += haversineMeters(polyline[i - 1], polyline[i]);
  }
  return total / 1000;
}

function elevationDeltas(polyline) {
  let gain = 0, loss = 0;
  for (let i = 1; i < polyline.length; i++) {
    const dz = (polyline[i].elevation ?? 0) - (polyline[i - 1].elevation ?? 0);
    if (dz > 0) gain += dz;
    else loss -= dz;
  }
  return { elevationGainM: Math.round(gain), elevationLossM: Math.round(loss) };
}

function difficultyOf(distanceKm, elevationGainM) {
  if (elevationGainM > 500 || distanceKm > 40) return "hard";
  if (elevationGainM >= 150 || distanceKm >= 25) return "moderate";
  return "easy";
}

function styleOf({ difficulty, roadMix, qualityScore, distanceKm }) {
  // Priority: family > scenic > sporty > adventurous.
  const roadFrac = roadMix?.road ?? 0;
  const dirtFrac = roadMix?.dirt ?? 0;
  if (difficulty === "easy" && roadFrac < 0.1 && qualityScore >= 3) return "family";
  if (qualityScore >= 4) return "scenic";
  if (difficulty === "hard" || distanceKm > 30) return "sporty";
  if (dirtFrac >= 0.5) return "adventurous";
  return "scenic"; // fallback
}

export function classifyRoute(input, refs) {
  const { geometry, roadTypeFractions, qualityScore } = input;
  if (!Array.isArray(geometry) || geometry.length < 2) {
    throw new Error("classifyRoute: geometry must have at least 2 points");
  }
  const distanceKm = distanceKmOf(geometry);
  const { elevationGainM, elevationLossM } = elevationDeltas(geometry);
  const difficulty = difficultyOf(distanceKm, elevationGainM);
  const roadMix = {
    paved: roadTypeFractions?.paved ?? 0,
    dirt: roadTypeFractions?.dirt ?? 0,
    road: roadTypeFractions?.road ?? 0,
  };
  const style = styleOf({ difficulty, roadMix, qualityScore: qualityScore ?? 0, distanceKm });

  const centroid = centroidOf(geometry);
  const regionId = (refs.zones.find((z) => pointInPolygon(centroid, z.polygon))?.id) ?? "unknown";

  const passesNear = refs.places
    .filter((p) => nearestDistanceToPolyline(p, geometry) <= PASSES_NEAR_METERS)
    .map((p) => p.id);

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    elevationGainM,
    elevationLossM,
    regionId,
    passesNear,
    difficulty,
    style,
    roadMix,
    qualityScore: qualityScore ?? 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
node tests/test-classify-route.mjs
```

- [ ] **Step 5: Commit**

```sh
git add editor/server.mjs tests/test-classify-route.mjs
git commit -m "feat(route-search): classifyRoute computes catalog metadata"
```

---

## Task 5: Catalog draft endpoints (save / load / recompute / places)

**Files:**
- Modify: `editor/server.mjs`

Add the four endpoints (without promote yet — that comes in Task 6). Follows the same pattern as the existing video-keyframes endpoints.

- [ ] **Step 1: Add constants and helper near the top of `editor/server.mjs`**

```js
const routeCatalogDraftPath = resolve(editorRoot, ".drafts/route-catalog.json");
const routeCatalogPublicPath = resolve(publicDataDir, "route-catalog.json");
const placesPath = resolve(repoRoot, "data/places.json");
const regionZonesPath = resolve(repoRoot, "data/region-zones.json");

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add `validateCatalogDraft`**

```js
const SLUG_RE = /^[a-z][a-z0-9-]*$/;

export function validateCatalogDraft(catalog) {
  if (!catalog || !Array.isArray(catalog.entries)) {
    throw new Error("catalog.entries must be an array");
  }
  const seen = new Set();
  for (const entry of catalog.entries) {
    if (!entry || typeof entry !== "object") throw new Error("entry must be an object");
    if (!SLUG_RE.test(String(entry.slug))) {
      throw new Error(`invalid slug: ${entry.slug}`);
    }
    if (seen.has(entry.slug)) throw new Error(`duplicate slug: ${entry.slug}`);
    seen.add(entry.slug);
    if (!entry.name || !entry.summary) {
      throw new Error(`entry ${entry.slug} missing name or summary`);
    }
    if (typeof entry.route !== "string" || entry.route.length === 0) {
      throw new Error(`entry ${entry.slug} missing route token`);
    }
  }
}
```

- [ ] **Step 3: Wire the endpoints**

In the request dispatch (search for the existing `/api/video-keyframes/` block; add after it):

```js
if (url.pathname.startsWith("/api/route-catalog/")) {
  const parts = url.pathname.split("/").filter(Boolean);

  // /api/route-catalog/draft  (GET load, PUT save)
  if (parts.length === 3 && parts[2] === "draft") {
    if (request.method === "GET") {
      const draft = await readJsonOrNull(routeCatalogDraftPath);
      if (draft) {
        sendJson(response, 200, draft);
        return;
      }
      const promoted = await readJsonOrNull(routeCatalogPublicPath);
      if (promoted) {
        sendJson(response, 200, promoted);
        return;
      }
      // Seed from existing src/featured/*.meta.js files.
      const seed = await seedCatalogFromFeaturedMeta();
      sendJson(response, 200, seed);
      return;
    }
    if (request.method === "PUT") {
      const body = await readRequestJson(request);
      validateCatalogDraft(body);
      await mkdir(dirname(routeCatalogDraftPath), { recursive: true });
      await writeFile(routeCatalogDraftPath, JSON.stringify(body, null, 2));
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  // /api/route-catalog/places  (GET)
  if (parts.length === 3 && parts[2] === "places" && request.method === "GET") {
    const places = await readJsonOrNull(placesPath);
    sendJson(response, 200, places || { version: 1, places: [] });
    return;
  }
}
```

- [ ] **Step 4: Implement `seedCatalogFromFeaturedMeta`**

```js
async function seedCatalogFromFeaturedMeta() {
  const featuredDir = resolve(repoRoot, "src/featured");
  const entries = [];
  let files = [];
  try {
    files = await readdir(featuredDir);
  } catch {
    return { version: 1, entries };
  }
  for (const file of files) {
    if (!file.endsWith(".meta.js")) continue;
    const slug = file.replace(/\.meta\.js$/, "");
    try {
      const mod = await import(pathToFileURL(resolve(featuredDir, file)).href);
      const meta = mod.meta;
      if (!meta || !meta.route) continue;
      entries.push({
        slug: meta.slug || slug,
        name: meta.name || slug,
        summary: meta.summary || "",
        route: meta.route,
        notes: "",
        featured: true,
      });
    } catch (err) {
      log("warn", `seed: failed to import ${file}`, err.message);
    }
  }
  return { version: 1, entries };
}
```

- [ ] **Step 5: Manual smoke test**

```sh
cd editor && node dev-server.mjs &
sleep 1
curl -s http://127.0.0.1:8899/api/route-catalog/draft | python3 -m json.tool
curl -s http://127.0.0.1:8899/api/route-catalog/places | python3 -m json.tool | head -20
pkill -f "dev-server.mjs"
```
Expected: catalog draft shows 2 seed entries (`sovev-beit-hillel`, `shdeh-nehemia-baniyas`); places lists ~12 entries.

- [ ] **Step 6: Commit**

```sh
cd ..
git add editor/server.mjs
git commit -m "feat(editor): route-catalog draft + places endpoints with meta.js seeding"
```

---

## Task 6: Catalog promote endpoint + recompute

**Files:**
- Modify: `editor/server.mjs`
- Test: `tests/test-route-catalog-promote.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test-route-catalog-promote.mjs
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promoteCatalogDraft, recomputeCatalogMetadata } from "../editor/server.mjs";

const places = [
  { id: "beit-hillel", name: "בית הלל", lat: 33.2177, lng: 35.6097 },
];
const zones = [
  { id: "hula-valley", name: "עמק החולה",
    polygon: [[35.55, 33.15], [35.65, 33.15], [35.65, 33.22], [35.55, 33.22], [35.55, 33.15]] },
];

const fakeDecode = (token) => {
  if (token === "ok") {
    return {
      geometry: [
        { lat: 33.2170, lng: 35.6090, elevation: 100 },
        { lat: 33.2180, lng: 35.6100, elevation: 102 },
        { lat: 33.2175, lng: 35.6098, elevation: 100 },
      ],
      roadTypeFractions: { paved: 0.8, dirt: 0.2, road: 0.0 },
      qualityScore: 4.0,
    };
  }
  return null;
};

const draft = {
  version: 1,
  entries: [
    { slug: "test-a", name: "A", summary: "x", route: "ok", featured: false },
  ],
};

// recompute fills in computed fields
const recomputed = recomputeCatalogMetadata(draft, { places, zones, decodeRoute: fakeDecode });
assert.equal(recomputed.entries[0].slug, "test-a");
assert.equal(recomputed.entries[0].difficulty, "easy");
assert.ok(recomputed.entries[0].passesNear.includes("beit-hillel"));
assert.equal(recomputed.entries[0].regionId, "hula-valley");

// promote: writes public file atomically, removes draft
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rc-promote-"));
const draftPath = path.join(tmpRoot, "draft.json");
const publicPath = path.join(tmpRoot, "public.json");
await fs.writeFile(draftPath, JSON.stringify(draft));

await promoteCatalogDraft({
  draftPath,
  publicPath,
  places,
  zones,
  decodeRoute: fakeDecode,
});

const written = JSON.parse(await fs.readFile(publicPath, "utf-8"));
assert.equal(written.entries.length, 1);
assert.equal(written.entries[0].difficulty, "easy");
await assert.rejects(fs.stat(draftPath));

console.log("route catalog promote tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

```sh
node tests/test-route-catalog-promote.mjs
```

- [ ] **Step 3: Implement `recomputeCatalogMetadata` and `promoteCatalogDraft` in `editor/server.mjs`**

Inject the route decoder as a dependency so it's testable without the full RouteManager bootstrap.

```js
export function recomputeCatalogMetadata(draft, refs) {
  const { places, zones, decodeRoute } = refs;
  validateCatalogDraft(draft);
  const entries = draft.entries.map((entry) => {
    const decoded = decodeRoute(entry.route);
    if (!decoded) {
      throw new Error(`entry ${entry.slug}: route token failed to decode`);
    }
    const computed = classifyRoute(decoded, { places, zones });
    return { ...entry, ...computed };
  });
  return { version: 1, entries };
}

export async function promoteCatalogDraft({ draftPath, publicPath, places, zones, decodeRoute }) {
  const draft = JSON.parse(await readFile(draftPath, "utf-8"));
  const enriched = recomputeCatalogMetadata(draft, { places, zones, decodeRoute });
  await mkdir(dirname(publicPath), { recursive: true });
  const tmp = `${publicPath}.tmp`;
  await writeFile(tmp, JSON.stringify(enriched, null, 2));
  await rename(tmp, publicPath);
  await unlink(draftPath);
  return { ok: true, publicPath, entryCount: enriched.entries.length };
}
```

- [ ] **Step 4: Build the live decoder that wires through `RouteManager`**

```js
async function buildLiveDecodeRoute() {
  const RouteManagerClass = nodeRequire(resolve(repoRoot, "route-manager.js"));
  const { geoJsonData, segmentsData } = await loadFeaturedAssetsFromDisk();
  const manager = await createRouteManager(RouteManagerClass, geoJsonData, segmentsData, null);
  return function decodeRoute(token) {
    try {
      const snapshot = restoreRouteFromParam(manager, token, segmentsData);
      if (!snapshot) return null;
      // Approximate roadTypeFractions and qualityScore from snapshot.selectedSegments + segmentsData.
      const counts = { paved: 0, dirt: 0, road: 0 };
      let qualitySum = 0, qualityN = 0;
      for (const seg of snapshot.selectedSegments || []) {
        const segData = segmentsData[seg];
        const meta = segData?.roadType || "paved";
        if (counts[meta] !== undefined) counts[meta] += 1;
        const q = segData?.quality?.overall;
        if (Number.isFinite(q)) { qualitySum += q; qualityN += 1; }
      }
      const total = counts.paved + counts.dirt + counts.road;
      const roadTypeFractions = total > 0
        ? { paved: counts.paved / total, dirt: counts.dirt / total, road: counts.road / total }
        : { paved: 1, dirt: 0, road: 0 };
      const qualityScore = qualityN > 0 ? qualitySum / qualityN : 0;
      return {
        geometry: snapshot.geometry,
        roadTypeFractions,
        qualityScore,
      };
    } catch {
      return null;
    }
  };
}
```

- [ ] **Step 5: Wire the recompute + promote HTTP endpoints**

Inside the existing `/api/route-catalog/` block:

```js
// /api/route-catalog/recompute  (POST)
if (parts.length === 3 && parts[2] === "recompute" && request.method === "POST") {
  const body = await readRequestJson(request);
  validateCatalogDraft(body);
  const places = (await readJsonOrNull(placesPath))?.places || [];
  const zones = (await readJsonOrNull(regionZonesPath))?.zones || [];
  const decodeRoute = await buildLiveDecodeRoute();
  try {
    const enriched = recomputeCatalogMetadata(body, { places, zones, decodeRoute });
    sendJson(response, 200, enriched);
  } catch (err) {
    sendJson(response, 400, { ok: false, error: err.message });
  }
  return;
}

// /api/route-catalog/promote  (POST)
if (parts.length === 3 && parts[2] === "promote" && request.method === "POST") {
  const places = (await readJsonOrNull(placesPath))?.places || [];
  const zones = (await readJsonOrNull(regionZonesPath))?.zones || [];
  const decodeRoute = await buildLiveDecodeRoute();
  try {
    const result = await promoteCatalogDraft({
      draftPath: routeCatalogDraftPath,
      publicPath: routeCatalogPublicPath,
      places,
      zones,
      decodeRoute,
    });
    sendJson(response, 200, result);
  } catch (err) {
    sendJson(response, 400, { ok: false, error: err.message });
  }
  return;
}
```

- [ ] **Step 6: Wire test into `npm test`**

In `package.json`'s `test` script, add `node tests/test-classify-route.mjs && node tests/test-route-catalog-promote.mjs &&` after `test-catalog-filter.mjs` (which we'll also add now if missing). Final test script section should include:

```
node tests/test-wizard-reducer.mjs && node tests/test-catalog-filter.mjs && node tests/test-classify-route.mjs && node tests/test-route-catalog-promote.mjs &&
```

(Insert after `node tests/test-video-keyframes-promote.mjs &&`.)

- [ ] **Step 7: Run the full suite**

```sh
npm test
```

- [ ] **Step 8: Commit**

```sh
git add editor/server.mjs tests/test-route-catalog-promote.mjs package.json
git commit -m "feat(editor): route-catalog recompute + promote endpoints"
```

---

## Task 7: Editor "Route Catalog" workspace tab scaffolding

**Files:**
- Modify: `editor/index.html`
- Modify: `editor/editor.js`
- Modify: `editor/styles.css`

This task adds only the workspace-mode scaffolding (button, panel show/hide). The list/detail UI and actions follow in Task 8.

- [ ] **Step 1: Add workspace tab button and panel in `editor/index.html`**

Find the workspace-tabs block (`<div class="workspace-tabs">`) and add the catalog button:

```html
<button id="workspace-route-catalog" class="tool-button" type="button">Route Catalog</button>
```

After the existing `#video-sync-panel` section, add:

```html
<section id="route-catalog-panel" class="panel workspace-panel" hidden>
  <header class="panel-header">
    <h2>Route Catalog</h2>
    <span id="rc-status"></span>
  </header>
  <div class="rc-toolbar">
    <button id="rc-new" class="secondary-button" type="button">+ New entry</button>
    <button id="rc-save-draft" class="secondary-button" type="button">Save Draft</button>
    <button id="rc-recompute" class="secondary-button" type="button">Recompute</button>
    <button id="rc-promote" class="primary-button" type="button">Promote</button>
  </div>
  <ul id="rc-list" class="rc-list"></ul>
  <div id="rc-detail" class="rc-detail" hidden></div>
</section>
```

- [ ] **Step 2: Add basic styles in `editor/styles.css`**

Append:

```css
#route-catalog-panel .rc-toolbar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}
.rc-list {
  list-style: none;
  padding: 0;
  margin: 0 0 0.5rem 0;
  max-height: 12rem;
  overflow: auto;
  border: 1px solid #ddd;
  border-radius: 4px;
}
.rc-list li {
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  font-size: 0.9em;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}
.rc-list li:last-child { border-bottom: 0; }
.rc-list li.selected { background: #fffbe6; }
.rc-list li.invalid { color: #b00020; }
.rc-list .rc-tags { color: #666; font-size: 0.85em; }
.rc-detail {
  border-top: 1px solid #ddd;
  padding-top: 0.5rem;
}
.rc-row { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.4rem; }
.rc-row > label { min-width: 6em; }
.rc-row > input, .rc-row > textarea { flex: 1; }
.rc-computed {
  background: #f8f8f8;
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  margin: 0.5rem 0;
  font-size: 0.85em;
  color: #444;
}
```

- [ ] **Step 3: Register the workspace mode in `editor/editor.js`**

Add to the `els` block (alongside other workspace refs):

```js
workspaceRouteCatalog: document.getElementById("workspace-route-catalog"),
routeCatalogPanel: document.getElementById("route-catalog-panel"),
```

Update `setWorkspaceMode`'s allow-list:

```js
if (!["segments", "base", "overlay", "video-sync", "route-catalog"].includes(mode)) return;
```

Add the activation branch alongside the existing video-sync branch:

```js
} else if (mode === "route-catalog") {
  state.baseOverlay.enabled = false;
  setStatus("Route Catalog mode: manage findable + featured routes.");
  if (typeof activateRouteCatalogMode === "function") {
    try { await activateRouteCatalogMode(); } catch (err) { showError(err); }
  }
}
```

Extend `renderWorkspaceChrome`:

```js
els.workspaceRouteCatalog.classList.toggle("active", state.workspaceMode === "route-catalog");
els.routeCatalogPanel.hidden = state.workspaceMode !== "route-catalog";
```

Wire the button click in `wireEvents()`:

```js
els.workspaceRouteCatalog.addEventListener("click", () => setWorkspaceMode("route-catalog").catch(showError));
```

- [ ] **Step 4: Define a stub `activateRouteCatalogMode`** at the end of `editor.js` (the real implementation comes in Task 8):

```js
async function activateRouteCatalogMode() {
  // populated in next task
  document.getElementById("rc-status").textContent = "Loading…";
}
```

- [ ] **Step 5: Smoke check**

```sh
cd editor && node dev-server.mjs &
sleep 1
curl -s http://127.0.0.1:8899/editor/ | grep -c "workspace-route-catalog\|route-catalog-panel"
pkill -f "dev-server.mjs"
```
Expected: count ≥ 2.

- [ ] **Step 6: Commit**

```sh
cd ..
git add editor/index.html editor/editor.js editor/styles.css
git commit -m "feat(editor): route-catalog workspace tab scaffolding"
```

---

## Task 8: Editor route-catalog list + detail UI + actions

**Files:**
- Modify: `editor/editor.js`

Implements the full controller. Single coherent addition to `editor.js`.

- [ ] **Step 1: Replace the stub `activateRouteCatalogMode` with the full controller**

At the bottom of `editor.js`, replace the previous stub:

```js
const routeCatalogState = {
  loaded: null,         // { version, entries: [...] } as loaded
  draft: null,          // mutated locally
  selectedSlug: null,
  places: [],
};

const rcEls = {
  status: document.getElementById("rc-status"),
  list: document.getElementById("rc-list"),
  detail: document.getElementById("rc-detail"),
  newBtn: document.getElementById("rc-new"),
  saveBtn: document.getElementById("rc-save-draft"),
  recomputeBtn: document.getElementById("rc-recompute"),
  promoteBtn: document.getElementById("rc-promote"),
};

function rcSetStatus(msg) {
  rcEls.status.textContent = msg || "";
}

function rcSelectedEntry() {
  if (!routeCatalogState.draft) return null;
  return routeCatalogState.draft.entries.find((e) => e.slug === routeCatalogState.selectedSlug) || null;
}

function rcRenderList() {
  const draft = routeCatalogState.draft;
  rcEls.list.innerHTML = "";
  if (!draft || draft.entries.length === 0) {
    const li = document.createElement("li");
    li.textContent = "(no entries — click + New entry)";
    li.style.opacity = "0.6";
    rcEls.list.appendChild(li);
    return;
  }
  for (const entry of draft.entries) {
    const li = document.createElement("li");
    if (entry.slug === routeCatalogState.selectedSlug) li.classList.add("selected");
    const main = document.createElement("span");
    main.textContent = `${entry.name || entry.slug}${entry.featured ? " ⭐" : ""}`;
    const tags = document.createElement("span");
    tags.className = "rc-tags";
    const dist = entry.distanceKm != null ? `${entry.distanceKm} km` : "?";
    const diff = entry.difficulty || "?";
    const style = entry.style || "?";
    tags.textContent = `${dist} · ${diff} · ${style}`;
    li.append(main, tags);
    li.addEventListener("click", () => {
      routeCatalogState.selectedSlug = entry.slug;
      rcRenderList();
      rcRenderDetail();
    });
    rcEls.list.appendChild(li);
  }
}

function rcRenderDetail() {
  const entry = rcSelectedEntry();
  if (!entry) {
    rcEls.detail.hidden = true;
    return;
  }
  rcEls.detail.hidden = false;
  rcEls.detail.innerHTML = "";
  const fields = [
    { key: "slug",    label: "Slug" },
    { key: "name",    label: "Name" },
    { key: "summary", label: "Summary" },
    { key: "route",   label: "Route token" },
    { key: "notes",   label: "Notes", textarea: true },
  ];
  for (const f of fields) {
    const row = document.createElement("div");
    row.className = "rc-row";
    const label = document.createElement("label");
    label.textContent = `${f.label}:`;
    const input = document.createElement(f.textarea ? "textarea" : "input");
    input.value = entry[f.key] ?? "";
    if (!f.textarea) input.type = "text";
    input.addEventListener("input", (e) => {
      entry[f.key] = e.target.value;
    });
    row.append(label, input);
    rcEls.detail.appendChild(row);
  }
  const featuredRow = document.createElement("div");
  featuredRow.className = "rc-row";
  const fLabel = document.createElement("label");
  fLabel.textContent = "Featured:";
  const fInput = document.createElement("input");
  fInput.type = "checkbox";
  fInput.checked = !!entry.featured;
  fInput.addEventListener("change", (e) => { entry.featured = e.target.checked; });
  featuredRow.append(fLabel, fInput);
  rcEls.detail.appendChild(featuredRow);

  const computed = document.createElement("div");
  computed.className = "rc-computed";
  const lines = [
    `Distance: ${entry.distanceKm ?? "?"} km · Elevation gain: ${entry.elevationGainM ?? "?"} m`,
    `Region: ${entry.regionId ?? "?"} · Difficulty: ${entry.difficulty ?? "?"} · Style: ${entry.style ?? "?"}`,
    `Passes near: ${(entry.passesNear || []).join(", ") || "(none)"}`,
  ];
  computed.textContent = lines.join("\n");
  computed.style.whiteSpace = "pre-line";
  rcEls.detail.appendChild(computed);

  const actionRow = document.createElement("div");
  actionRow.className = "rc-row";
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "secondary-button danger";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", () => {
    if (!confirm(`Delete ${entry.slug}?`)) return;
    routeCatalogState.draft.entries = routeCatalogState.draft.entries.filter((e) => e.slug !== entry.slug);
    routeCatalogState.selectedSlug = null;
    rcRenderList();
    rcRenderDetail();
  });
  actionRow.appendChild(delBtn);
  rcEls.detail.appendChild(actionRow);
}

async function rcLoad() {
  rcSetStatus("Loading…");
  const r = await fetch("/api/route-catalog/draft");
  if (!r.ok) { rcSetStatus("Load failed"); return; }
  routeCatalogState.loaded = await r.json();
  routeCatalogState.draft = JSON.parse(JSON.stringify(routeCatalogState.loaded));
  const pr = await fetch("/api/route-catalog/places");
  routeCatalogState.places = pr.ok ? ((await pr.json())?.places || []) : [];
  rcSetStatus(`${routeCatalogState.draft.entries.length} entries loaded.`);
  rcRenderList();
  rcRenderDetail();
}

async function rcSaveDraft() {
  rcSetStatus("Saving…");
  const r = await fetch("/api/route-catalog/draft", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(routeCatalogState.draft),
  });
  const result = await r.json().catch(() => ({}));
  rcSetStatus(r.ok ? "Draft saved." : `Save failed: ${result.error || r.statusText}`);
}

async function rcRecompute() {
  rcSetStatus("Computing…");
  const r = await fetch("/api/route-catalog/recompute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(routeCatalogState.draft),
  });
  const result = await r.json().catch(() => ({}));
  if (!r.ok) {
    rcSetStatus(`Recompute failed: ${result.error || r.statusText}`);
    return;
  }
  routeCatalogState.draft = result;
  rcSetStatus("Metadata refreshed.");
  rcRenderList();
  rcRenderDetail();
}

async function rcPromote() {
  // Save first so promote reads the latest draft.
  await rcSaveDraft();
  rcSetStatus("Promoting…");
  const r = await fetch("/api/route-catalog/promote", { method: "POST" });
  const result = await r.json().catch(() => ({}));
  rcSetStatus(r.ok ? `Promoted (${result.entryCount} entries).` : `Promote failed: ${result.error || r.statusText}`);
  if (r.ok) await rcLoad();
}

function rcNewEntry() {
  const slug = prompt("New entry slug (lowercase, kebab-case):");
  if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) {
    alert("Invalid slug.");
    return;
  }
  if (routeCatalogState.draft.entries.some((e) => e.slug === slug)) {
    alert("Slug already exists.");
    return;
  }
  routeCatalogState.draft.entries.push({
    slug,
    name: slug,
    summary: "",
    route: "",
    notes: "",
    featured: false,
  });
  routeCatalogState.selectedSlug = slug;
  rcRenderList();
  rcRenderDetail();
}

rcEls.newBtn.addEventListener("click", rcNewEntry);
rcEls.saveBtn.addEventListener("click", () => rcSaveDraft().catch(showError));
rcEls.recomputeBtn.addEventListener("click", () => rcRecompute().catch(showError));
rcEls.promoteBtn.addEventListener("click", () => rcPromote().catch(showError));

async function activateRouteCatalogMode() {
  if (!routeCatalogState.draft) await rcLoad();
}
```

- [ ] **Step 2: Manual end-to-end smoke**

```sh
cd editor && node dev-server.mjs
```
Open the editor in a browser, switch to Route Catalog. Expected: 2 seeded entries (`sovev-beit-hillel`, `shdeh-nehemia-baniyas`). Click one — detail panel shows its fields. Click Recompute — distance/difficulty/style update. Click Save Draft — status shows "Draft saved." Click Promote — `public-data/route-catalog.json` is written.

```sh
cat /Users/ohad/projects/cycleways/public-data/route-catalog.json | python3 -m json.tool | head -30
```

- [ ] **Step 3: Commit**

```sh
cd ..
git add editor/editor.js
git commit -m "feat(editor): route-catalog list + detail UI + save/recompute/promote actions"
```

---

## Task 9: Runtime catalog loader

**Files:**
- Create: `src/data/catalog.js`

- [ ] **Step 1: Implement**

```js
// src/data/catalog.js
let catalogPromise = null;

export function loadCatalog() {
  if (catalogPromise) return catalogPromise;
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  catalogPromise = fetch(`${base}public-data/route-catalog.json`)
    .then((r) => (r.ok ? r.json() : { version: 1, entries: [] }))
    .catch((err) => {
      console.warn("loadCatalog failed", err);
      return { version: 1, entries: [] };
    });
  return catalogPromise;
}

export function findCatalogEntryBySlug(catalog, slug) {
  return catalog?.entries?.find((e) => e.slug === slug) || null;
}
```

- [ ] **Step 2: Commit**

```sh
git add src/data/catalog.js
git commit -m "feat(route-search): runtime catalog loader"
```

---

## Task 10: `RouteCard` component

**Files:**
- Create: `src/components/RouteCard.jsx`

- [ ] **Step 1: Implement**

```jsx
// src/components/RouteCard.jsx
import React from "react";
import { Link } from "react-router-dom";

export default function RouteCard({ entry, places, onSelect }) {
  const placeNames = (entry.passesNear || [])
    .map((id) => places.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .slice(0, 4);
  return (
    <article className="rc-result-card">
      <header className="rc-result-card__header">
        <h3>{entry.name}</h3>
        {entry.featured && <span className="rc-result-card__badge">מומלץ במיוחד</span>}
      </header>
      <p>{entry.summary}</p>
      <p className="rc-result-card__stats">
        {entry.distanceKm} ק״מ · {entry.difficulty} · {entry.style}
      </p>
      {placeNames.length > 0 && (
        <p className="rc-result-card__places">עובר ב: {placeNames.join(", ")}</p>
      )}
      <div className="rc-result-card__actions">
        <button type="button" onClick={() => onSelect(entry)}>
          ראו את המסלול במפה
        </button>
        {entry.featured && (
          <Link to={`/featured/${entry.slug}`}>פרטים מלאים →</Link>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Add styles to `src/components/welcome-wizard.css`** (create if missing — covered later in Task 11)

Skip for now; Task 11 creates the CSS file with rules including `.rc-result-card`.

- [ ] **Step 3: Commit**

```sh
git add src/components/RouteCard.jsx
git commit -m "feat(route-search): RouteCard component"
```

---

## Task 11: `WelcomeWizardChat` component

**Files:**
- Create: `src/components/WelcomeWizardChat.jsx`
- Create: `src/components/welcome-wizard.css`

Presentation only — receives state + dispatch + catalog + places + filter result and renders the conversation flow.

- [ ] **Step 1: Implement `WelcomeWizardChat`**

```jsx
// src/components/WelcomeWizardChat.jsx
import React from "react";
import RouteCard from "./RouteCard.jsx";
import { catalogFilter } from "./catalogFilter.js";

const QUESTIONS = [
  {
    key: "place",
    prompt: "מאיפה תרצו להתחיל?",
    optionsFromPlaces: true,
  },
  {
    key: "region",
    prompt: "באיזה אזור?",
    optionsFromZones: true,
  },
  {
    key: "distance",
    prompt: 'כמה ק"מ?',
    options: [
      { value: "short",  label: 'קצר (< 10 ק"מ)' },
      { value: "medium", label: 'בינוני (10–25 ק"מ)' },
      { value: "long",   label: 'ארוך (> 25 ק"מ)' },
      { value: "any",    label: "לא משנה" },
    ],
  },
  {
    key: "difficulty",
    prompt: "רמת קושי?",
    options: [
      { value: "easy",     label: "קל" },
      { value: "moderate", label: "בינוני" },
      { value: "hard",     label: "מאתגר" },
      { value: "any",      label: "לא משנה" },
    ],
  },
  {
    key: "style",
    prompt: "איזה סגנון?",
    options: [
      { value: "family",       label: "משפחתי" },
      { value: "scenic",       label: "נוף" },
      { value: "sporty",       label: "ספורטיבי" },
      { value: "adventurous",  label: "הרפתקני" },
      { value: "any",          label: "לא משנה" },
    ],
  },
];

const STEP_KEYS = QUESTIONS.map((q) => q.key);

function renderOptions(question, places, zones) {
  if (question.optionsFromPlaces) {
    const opts = (places || []).map((p) => ({ value: p.id, label: p.name }));
    opts.push({ value: "any", label: "לא משנה" });
    return opts;
  }
  if (question.optionsFromZones) {
    const opts = (zones || []).map((z) => ({ value: z.id, label: z.name }));
    opts.push({ value: "any", label: "לא משנה" });
    return opts;
  }
  return question.options;
}

export default function WelcomeWizardChat({
  state,
  dispatch,
  catalog,
  places,
  zones,
  onSelectRoute,
}) {
  const { step, answers } = state;
  const conversation = [];

  // Replay answered steps as past bubbles.
  STEP_KEYS.forEach((key, idx) => {
    if (idx >= step) return;
    if (answers[key] == null) return;
    const q = QUESTIONS[idx];
    const opts = renderOptions(q, places, zones);
    const chosenLabel = opts.find((o) => o.value === answers[key])?.label || answers[key];
    conversation.push({ kind: "bot",  text: q.prompt, key: `${key}-q` });
    conversation.push({ kind: "user", text: chosenLabel, key: `${key}-a` });
  });

  const atResults = step >= STEP_KEYS.length;
  let activeQuestion = null;
  if (!atResults) {
    activeQuestion = QUESTIONS[step];
    conversation.push({ kind: "bot", text: activeQuestion.prompt, key: `${activeQuestion.key}-q-active` });
  }

  let results = null;
  if (atResults) {
    results = catalogFilter(catalog?.entries || [], answers);
  }

  return (
    <div className="ww-chat">
      <div className="ww-chat__scroll">
        {conversation.map((msg) =>
          msg.kind === "bot" ? (
            <div key={msg.key} className="ww-bubble ww-bubble--bot">{msg.text}</div>
          ) : (
            <div key={msg.key} className="ww-bubble ww-bubble--user">{msg.text}</div>
          ),
        )}

        {activeQuestion && (
          <div className="ww-options">
            {renderOptions(activeQuestion, places, zones).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="ww-option-btn"
                onClick={() => dispatch({ type: "ANSWER", key: activeQuestion.key, value: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {atResults && (
          <>
            <h2 className="ww-results-title">
              {results.length > 0
                ? `${results.length} מסלולים מתאימים`
                : "לא נמצאו מסלולים מתאימים. נסו לשנות תנאי."}
            </h2>
            {results.map((entry) => (
              <RouteCard
                key={entry.slug}
                entry={entry}
                places={places}
                onSelect={onSelectRoute}
              />
            ))}
            <div className="ww-results-actions">
              <button type="button" onClick={() => dispatch({ type: "RESET" })}>
                התחל מחדש
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/welcome-wizard.css`**

```css
.ww-overlay {
  position: fixed;
  inset: 0;
  background: #ffffff;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  direction: rtl;
}
.ww-overlay__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}
.ww-overlay__header h1 { font-size: 1.1rem; margin: 0; }
.ww-overlay__dismiss {
  background: transparent;
  border: 0;
  cursor: pointer;
  color: #666;
  font-size: 0.95rem;
}
.ww-chat__scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.ww-bubble {
  padding: 0.6rem 0.9rem;
  border-radius: 16px;
  max-width: 80%;
  line-height: 1.4;
}
.ww-bubble--bot {
  background: #f4f4f4;
  align-self: flex-start;
}
.ww-bubble--user {
  background: #1976d2;
  color: white;
  align-self: flex-end;
}
.ww-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
.ww-option-btn {
  background: white;
  border: 1px solid #1976d2;
  color: #1976d2;
  padding: 0.5rem 1rem;
  border-radius: 18px;
  cursor: pointer;
  font: inherit;
}
.ww-option-btn:hover { background: #e3f2fd; }
.ww-results-title { margin-top: 1rem; }
.ww-results-actions { margin-top: 1rem; }
.rc-result-card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 0.5rem;
  background: #fafafa;
}
.rc-result-card__header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
.rc-result-card__header h3 { margin: 0; font-size: 1.05rem; }
.rc-result-card__badge {
  background: #ffd54f;
  color: #5d4037;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.75rem;
}
.rc-result-card__stats { color: #444; font-size: 0.9rem; margin: 0.3rem 0; }
.rc-result-card__places { color: #666; font-size: 0.85rem; margin: 0.2rem 0; }
.rc-result-card__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
  align-items: center;
}
.rc-result-card__actions button {
  background: #1976d2;
  color: white;
  border: 0;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
}
.rc-result-card__actions a {
  color: #1976d2;
  text-decoration: none;
}
```

- [ ] **Step 3: Commit**

```sh
git add src/components/WelcomeWizardChat.jsx src/components/welcome-wizard.css
git commit -m "feat(route-search): WelcomeWizardChat + styles"
```

---

## Task 12: `WelcomeWizard` shell

**Files:**
- Create: `src/components/WelcomeWizard.jsx`

Owns visibility, the localStorage flag, the route-selection navigation, and the reducer state.

- [ ] **Step 1: Implement**

```jsx
// src/components/WelcomeWizard.jsx
import React, { useEffect, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./welcome-wizard.css";
import { initialWizardState, wizardReducer } from "./wizardReducer.js";
import { loadCatalog } from "../data/catalog.js";
import WelcomeWizardChat from "./WelcomeWizardChat.jsx";

const SKIP_FLAG_KEY = "cycleways:skipWelcome";

export default function WelcomeWizard({ visible, onDismiss }) {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);
  const [catalog, setCatalog] = useState(null);
  const [places, setPlaces] = useState([]);
  const [zones, setZones] = useState([]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const c = await loadCatalog();
      if (cancelled) return;
      setCatalog(c);
      try {
        const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
        const [pRes, zRes] = await Promise.all([
          fetch(`${base}data/places.json`),
          fetch(`${base}data/region-zones.json`),
        ]);
        if (pRes.ok) setPlaces((await pRes.json())?.places || []);
        if (zRes.ok) setZones((await zRes.json())?.zones || []);
      } catch (err) {
        console.warn("places/zones load failed", err);
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(SKIP_FLAG_KEY, "1"); } catch {}
    onDismiss?.();
  };

  const selectRoute = (entry) => {
    try { localStorage.setItem(SKIP_FLAG_KEY, "1"); } catch {}
    onDismiss?.();
    navigate(`/?route=${encodeURIComponent(entry.route)}`);
  };

  return (
    <div className="ww-overlay" role="dialog" aria-modal="true">
      <header className="ww-overlay__header">
        <h1>מצא מסלול</h1>
        <button type="button" className="ww-overlay__dismiss" onClick={dismiss}>
          דלג למפה ✕
        </button>
      </header>
      <WelcomeWizardChat
        state={state}
        dispatch={dispatch}
        catalog={catalog}
        places={places}
        zones={zones}
        onSelectRoute={selectRoute}
      />
    </div>
  );
}

export const WELCOME_WIZARD_SKIP_FLAG = SKIP_FLAG_KEY;
```

- [ ] **Step 2: Copy `data/places.json` + `data/region-zones.json` to `public-data/` so the runtime can fetch them**

The current `scripts/copy-static-assets.mjs` copies `public-data/` on build. We need the runtime to read `data/*.json` at `/data/...`. Vite serves files from `data/` automatically (since they're in the repo root) but production builds don't copy them. Update `scripts/copy-static-assets.mjs`:

```js
// add to the list of assets the build copies
{ src: "data/places.json",        dest: "dist/data/places.json" },
{ src: "data/region-zones.json",  dest: "dist/data/region-zones.json" },
```

Verify the structure of the existing copy script before editing — the field names above are placeholders for whatever the existing API uses. Match the existing entries' shape.

- [ ] **Step 3: Commit**

```sh
git add src/components/WelcomeWizard.jsx scripts/copy-static-assets.mjs
git commit -m "feat(route-search): WelcomeWizard overlay with reducer + catalog fetch"
```

---

## Task 13: Mount `WelcomeWizard` from `App.jsx`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add import**

Near the top of `src/App.jsx`:

```jsx
import WelcomeWizard, { WELCOME_WIZARD_SKIP_FLAG } from "./components/WelcomeWizard.jsx";
```

- [ ] **Step 2: Add visibility state + helper inside the `App()` component**

After the existing `useState` declarations near the top:

```jsx
const [welcomeWizardOpen, setWelcomeWizardOpen] = useState(() => {
  if (typeof window === "undefined") return false;
  const hasRoute = new URLSearchParams(window.location.search).has("route");
  if (hasRoute) return false;
  try {
    return localStorage.getItem(WELCOME_WIZARD_SKIP_FLAG) !== "1";
  } catch {
    return true;
  }
});
```

- [ ] **Step 3: Render the overlay at the top of the `App` return JSX**

Just before the existing top-level wrapper:

```jsx
<>
  <WelcomeWizard
    visible={welcomeWizardOpen}
    onDismiss={() => setWelcomeWizardOpen(false)}
  />
  {/* existing top-level JSX continues here */}
</>
```

(If the existing return is already a fragment, just add `<WelcomeWizard ... />` as the first child.)

- [ ] **Step 4: Expose an opener (for the TopBar in Task 14)**

Where children are rendered (specifically the `<TopBar />` instantiation), pass a prop:

```jsx
<TopBar
  /* existing props */
  onOpenWizard={() => setWelcomeWizardOpen(true)}
/>
```

- [ ] **Step 5: Smoke check**

```sh
npm run dev
```
Open `/` with no `?route=` and no localStorage flag set — wizard should appear. Click "דלג למפה" — wizard closes and reloading without route stays closed. Clear localStorage in devtools and reload — wizard appears again.

- [ ] **Step 6: Commit**

```sh
git add src/App.jsx
git commit -m "feat(route-search): mount WelcomeWizard on App with visibility rules"
```

---

## Task 14: TopBar "מצא מסלול" button

**Files:**
- Modify: `src/components/TopBar.jsx`

- [ ] **Step 1: Read existing TopBar to find a reasonable button placement**

Read `src/components/TopBar.jsx`. Identify where the existing nav-style controls live (icon row, menu, etc.).

- [ ] **Step 2: Accept the new prop and render the button**

In the props destructure, add `onOpenWizard`:

```jsx
function TopBar({ /* existing props */ onOpenWizard }) {
```

In the JSX, near the existing topbar controls:

```jsx
{onOpenWizard && (
  <button
    type="button"
    className="topbar-find-button"
    onClick={onOpenWizard}
  >
    מצא מסלול
  </button>
)}
```

- [ ] **Step 3: Add a small style if needed**

Append to `styles.css` (or wherever TopBar styles live):

```css
.topbar-find-button {
  background: #1976d2;
  color: white;
  border: 0;
  padding: 0.35rem 0.9rem;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
}
.topbar-find-button:hover { background: #1565c0; }
```

- [ ] **Step 4: Smoke check**

```sh
npm run dev
```
Verify the button appears on `/`. Click it — wizard re-opens even if localStorage flag is set. Close it — flag is set (already was), nothing changes.

- [ ] **Step 5: Commit**

```sh
git add src/components/TopBar.jsx styles.css
git commit -m "feat(route-search): TopBar button to manually reopen the wizard"
```

---

## Task 15: Migrate existing featured routes off `.meta.js`

**Files:**
- Modify: `src/components/featured/FeaturedRoute.jsx`
- Modify: `src/featured/index.js`
- Modify: `src/featured/sovev-beit-hillel.jsx`
- Modify: `src/featured/shdeh-nehemia-baniyas.jsx`
- Modify: `src/main.jsx` or `src/pages/FeaturedRoutePage.jsx` (whichever knows about featured routes)
- Delete: `src/featured/sovev-beit-hillel.meta.js`
- Delete: `src/featured/shdeh-nehemia-baniyas.meta.js`
- Modify: `public-data/route-catalog.json` (write the seed; produced manually here so runtime works without first promote)

**Prerequisite:** the catalog file must exist in `public-data/` before this commit so featured routes still load. You manually promote in the editor first (or write the seed file by hand using the editor's recompute output).

- [ ] **Step 1: Ensure `public-data/route-catalog.json` exists**

Open the editor's Route Catalog mode (Task 8), click Recompute, click Save Draft, then click Promote. Verify:

```sh
ls -la /Users/ohad/projects/cycleways/public-data/route-catalog.json
```

If preferred, hand-write the file at the same path with the two seed entries and computed metadata — same shape as the recompute output.

- [ ] **Step 2: Update `FeaturedRoute.jsx` to read meta from the catalog**

Currently `FeaturedRoute.jsx` takes `meta` as a prop. Change it to read by slug from the loaded catalog. Modify the component signature and load logic:

```jsx
import { loadCatalog, findCatalogEntryBySlug } from "../../data/catalog.js";

function FeaturedRoute({ slug, children }) {
  const isMobile = useIsMobile();
  const [meta, setMeta] = useState(null);
  // ... rest of existing state

  useEffect(() => {
    let cancelled = false;
    loadCatalog().then((catalog) => {
      if (cancelled) return;
      const entry = findCatalogEntryBySlug(catalog, slug);
      if (!entry) {
        setError(new Error(`Featured route ${slug} not in catalog`));
        setStatus("error");
        return;
      }
      setMeta({
        slug: entry.slug,
        name: entry.name,
        summary: entry.summary,
        route: entry.route,
        difficulty: entry.difficulty,
        tags: entry.style ? [entry.style] : [],
        hero: null,
      });
    });
    return () => { cancelled = true; };
  }, [slug]);

  // ... existing route-restore effect, but gate on meta:
  useEffect(() => {
    if (!meta) return;
    // existing logic that uses meta.route etc.
  }, [meta]);

  if (!meta && status !== "error") {
    return <div className="page-card"><div className="featured-route-loading">טוען…</div></div>;
  }
  // ... rest unchanged, but `meta` now comes from state
}
```

- [ ] **Step 3: Update `sovev-beit-hillel.jsx`**

```jsx
import React from "react";
import FeaturedRoute from "../components/featured/FeaturedRoute.jsx";

export default function SovevBeitHillel() {
  return (
    <FeaturedRoute slug="sovev-beit-hillel">
      {/* existing prose unchanged */}
    </FeaturedRoute>
  );
}
```

Drop the `export { meta }` and the `import { meta } from "./sovev-beit-hillel.meta.js"`.

- [ ] **Step 4: Update `shdeh-nehemia-baniyas.jsx`** — same pattern.

- [ ] **Step 5: Update `src/featured/index.js` to enumerate from catalog instead of imports**

Read the current file first. Replace its synchronous slug list with an async-friendly registry derived from the catalog at runtime:

```js
// src/featured/index.js
import { loadCatalog } from "../data/catalog.js";

const moduleLoaders = {
  "sovev-beit-hillel":     () => import("./sovev-beit-hillel.jsx"),
  "shdeh-nehemia-baniyas": () => import("./shdeh-nehemia-baniyas.jsx"),
};

export async function loadFeaturedSlugs() {
  const catalog = await loadCatalog();
  return (catalog?.entries || [])
    .filter((e) => e.featured)
    .map((e) => e.slug);
}

export function getFeaturedModuleLoader(slug) {
  return moduleLoaders[slug] || null;
}

export async function loadFeaturedMetaList() {
  const catalog = await loadCatalog();
  return (catalog?.entries || []).filter((e) => e.featured);
}
```

Update callers in `src/pages/FeaturedIndexPage.jsx` and `src/pages/FeaturedRoutePage.jsx` to use the new API. (Read those files first to see what they currently consume.)

- [ ] **Step 6: Delete the meta.js files**

```sh
git rm src/featured/sovev-beit-hillel.meta.js src/featured/shdeh-nehemia-baniyas.meta.js
```

- [ ] **Step 7: Build + smoke check**

```sh
npm run build && npm run dev
```
Open `/featured/sovev-beit-hillel` — page renders, route loads on map. Same for `/featured/shdeh-nehemia-baniyas` and `/featured` (index).

- [ ] **Step 8: Commit**

```sh
git add -A
git commit -m "refactor(featured-routes): read meta from route catalog instead of .meta.js files"
```

---

## Task 16: Wire `npm test` and run full suite

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm new tests are in the `test` script**

```sh
grep -o "test-wizard-reducer\|test-catalog-filter\|test-classify-route\|test-route-catalog-promote" package.json
```
Expected: all four appear. Add any missing.

- [ ] **Step 2: Run the full suite**

```sh
npm test
```
Expected: all pass.

- [ ] **Step 3: Run build**

```sh
npm run build
```
Expected: clean.

- [ ] **Step 4: Commit (if package.json changed)**

```sh
git add package.json
git diff --cached --quiet || git commit -m "test(route-search): wire route-search tests into npm test"
```

---

## Task 17: Playwright e2e — welcome wizard happy path

**Files:**
- Create: `tests/e2e/welcome-wizard.spec.mjs`

- [ ] **Step 1: Write the spec**

```js
import { test, expect } from "@playwright/test";

test.describe("welcome wizard", () => {
  test.beforeEach(async ({ context }) => {
    // clear the skip flag before each test
    await context.addInitScript(() => {
      try { localStorage.removeItem("cycleways:skipWelcome"); } catch {}
    });
  });

  test("appears on first visit and closes when route is picked", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    // Click the place "לא משנה" if no specific known place
    await page.getByRole("button", { name: "לא משנה" }).first().click();
    // Each subsequent question — click "לא משנה" / first option
    for (let i = 0; i < 4; i++) {
      const any = page.getByRole("button", { name: "לא משנה" }).first();
      if (await any.isVisible()) {
        await any.click();
      } else {
        await page.locator(".ww-option-btn").first().click();
      }
    }
    // Results visible
    const results = page.locator(".rc-result-card");
    await expect(results.first()).toBeVisible();
    // Click first result card
    await results.first().getByRole("button", { name: /במפה/ }).click();
    // Wizard closed; URL has ?route=
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/route=/);
  });

  test("skipped when ?route= is in URL", async ({ page }) => {
    await page.goto("/?route=DvsVvkJ2SiQeaAkhgGPtCZde8S8Q8xGxbG4BSY7c32agaEz219fTkrW2ZA");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("dismiss persists across reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /דלג למפה/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run e2e**

```sh
npm run test:smoke -- welcome-wizard.spec.mjs
```

(Replace with the exact playwright command pattern the project uses if different.)

- [ ] **Step 3: Commit**

```sh
git add tests/e2e/welcome-wizard.spec.mjs
git commit -m "test(route-search): playwright e2e for welcome wizard"
```

---

## Task 18: Final cleanup + push

- [ ] **Step 1: Verify all tests + build**

```sh
npm test && npm run build
```

- [ ] **Step 2: Push branch**

```sh
git push -u origin claude/route-suggestions
```

---

## Self-Review Checklist (for the agent executing this plan)

Before opening a PR, do a manual exercise:

1. **First-visit flow** — clear localStorage + cookies; load `/`. Wizard appears. Click through 4 buttons. A result card appears. Click "ראו את המסלול במפה". URL gets `?route=`, wizard closes, planner shows the route on the map.
2. **Skip-on-direct-link** — load `/?route=<token>` directly. Wizard does not appear.
3. **Dismiss persistence** — close the wizard via "דלג למפה". Reload. Wizard does not re-appear. Click "מצא מסלול" in the topbar. Wizard re-appears.
4. **Featured pages still work** — `/featured/sovev-beit-hillel` renders with the route loaded. `/featured` index lists both featured routes.
5. **Editor workflow** — open the editor, switch to Route Catalog tab. Pick an entry, edit summary, click Save Draft. Refresh editor. Edit survives. Click Promote. Reload the public site — change is reflected (via cleared module cache or a fresh tab).

If any of these fail, fix before merging.
