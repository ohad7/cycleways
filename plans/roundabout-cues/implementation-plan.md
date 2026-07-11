# Roundabout Detection and Direction Cues — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `plans/roundabout-cues/design.md` (C1–C6): offline tag-based roundabout detection shipped as a separate `roundabouts.json` artifact (shards untouched), route-baked roundabout clusters, and one entry-anchored direction-only cue per traversal.

**Architecture:** Data flows offline→app: `processing/build_roundabouts.py` (new) extracts clusters from the fetched OSM network; `processing/build_map.py` publishes the artifact + manifest entry during Build; the editor Promote copies it like other single-file artifacts. In the app, a pure core matcher (`roundaboutsOnRoute`) bakes `kind: "roundabout"` records into `route.junctions` at ride-confirm, `navigationCues` collapses in-cluster corners into one direction cue, and voice/presentation phrase it. A missing artifact degrades to today's behavior at every stage.

**Tech Stack:** Python 3 processing scripts (plain-assert test scripts, no pytest dependency), node test scripts (`node tests/test-*.mjs`), `@cycleways/core`, React Native mobile app.

## Global Constraints

- Run node tests from the repo root: `node tests/test-<name>.mjs`; python from the repo root: `python3 processing/<script>.py`.
- **Never hand-edit `public-data/`** — the artifact reaches production only via Build + Promote, which the owner runs (CLAUDE.md). This plan only changes pipeline *code*; committing generated `public-data/roundabouts.json` is a plan violation.
- Hebrew UI copy, RTL.
- Commit after every task; `feat(nav): …` messages with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Finish with `node tests/test-mobile-undefined-references.mjs`.

---

### Task 1: `build_roundabouts.py` — clusters from OSM tags (C1)

**Files:**
- Create: `processing/build_roundabouts.py`
- Create: `processing/test_build_roundabouts.py` (plain-assert script)

**Interfaces:**
- Consumes: the fetched OSM network GeoJSON (`build/osm/osm-raw-ways.geojson`, written by `fetch_osm_network.py`, which retains all OSM tags in feature properties — verified). Mini-roundabout *nodes* are not in the ways file; fetch them from the same Overpass response if present (`build/osm/overpass-response.json`, elements with `type: "node"` and `tags.highway == "mini_roundabout"`); tolerate the response file being absent.
- Produces: `extract_roundabouts(ways_geojson, overpass_data) -> list[dict]` and a CLI writing `{ "schemaVersion": 1, "generatedAt": ..., "roundabouts": [{ "center": { "lat": ..., "lng": ... }, "radiusM": ... }, ...] }`. Task 2 calls `extract_roundabouts` from `build_map.py`.

- [ ] **Step 1: Write the failing test**

Create `processing/test_build_roundabouts.py`:

```python
#!/usr/bin/env python3
"""Plain-assert tests for build_roundabouts (run: python3 processing/test_build_roundabouts.py)."""
from build_roundabouts import extract_roundabouts


def ring(lng0, lat0, r_deg, tag="roundabout"):
    # Square "ring" is fine: clustering uses vertices, not curvature.
    coords = [
        [lng0 - r_deg, lat0 - r_deg],
        [lng0 + r_deg, lat0 - r_deg],
        [lng0 + r_deg, lat0 + r_deg],
        [lng0 - r_deg, lat0 + r_deg],
        [lng0 - r_deg, lat0 - r_deg],
    ]
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {"junction": tag, "highway": "residential", "osmId": 1},
    }


# Tagged ring becomes one cluster with a sane radius.
ways = {"type": "FeatureCollection", "features": [ring(35.6, 33.1, 0.0002)]}
clusters = extract_roundabouts(ways, None)
assert len(clusters) == 1, clusters
c = clusters[0]
assert abs(c["center"]["lat"] - 33.1) < 1e-4 and abs(c["center"]["lng"] - 35.6) < 1e-4
assert 10 <= c["radiusM"] <= 60, c["radiusM"]

# Two rings sharing a vertex merge into one cluster.
shared = ring(35.6, 33.1, 0.0002)
neighbor = ring(35.6004, 33.1, 0.0002)
neighbor["geometry"]["coordinates"][0] = shared["geometry"]["coordinates"][1]
ways2 = {"type": "FeatureCollection", "features": [shared, neighbor]}
assert len(extract_roundabouts(ways2, None)) == 1

# junction=circular counts; untagged ways are ignored.
ways3 = {
    "type": "FeatureCollection",
    "features": [ring(35.7, 33.2, 0.0002, tag="circular"), ring(35.8, 33.3, 0.0002, tag="")],
}
only = extract_roundabouts(ways3, None)
assert len(only) == 1 and abs(only[0]["center"]["lng"] - 35.7) < 1e-4

# Mini-roundabout node from the overpass response: fixed 10 m radius.
overpass = {
    "elements": [
        {"type": "node", "id": 7, "lat": 33.4, "lon": 35.9, "tags": {"highway": "mini_roundabout"}}
    ]
}
mini = extract_roundabouts({"type": "FeatureCollection", "features": []}, overpass)
assert len(mini) == 1 and mini[0]["radiusM"] == 10

print("build_roundabouts tests passed")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd processing && python3 test_build_roundabouts.py`
Expected: `ModuleNotFoundError: build_roundabouts`.

- [ ] **Step 3: Implement**

Create `processing/build_roundabouts.py` following the style of the other processing scripts (argparse, `write_json` helper, summary print):

```python
#!/usr/bin/env python3
"""Extract roundabout clusters from the fetched OSM network (C1,
plans/roundabout-cues). Tag-based only: ways tagged junction=roundabout or
junction=circular, plus highway=mini_roundabout nodes. Output feeds
build_map.py which publishes public-data/roundabouts.json.
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

MINI_ROUNDABOUT_RADIUS_M = 10.0
MERGE_DISTANCE_M = 25.0  # rings within this merge into one roundabout
MIN_RADIUS_M = 10.0

M_PER_DEG_LAT = 111_320.0


def _meters(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    dx = (a[0] - b[0]) * M_PER_DEG_LAT * math.cos(lat)
    dy = (a[1] - b[1]) * M_PER_DEG_LAT
    return math.hypot(dx, dy)


def _is_roundabout_way(properties):
    return str(properties.get("junction", "")).lower() in {"roundabout", "circular"}


def extract_roundabouts(ways_geojson, overpass_data):
    # Collect member vertex groups: one group per tagged way, one per mini node.
    groups = []
    for feature in (ways_geojson or {}).get("features", []):
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "LineString" or not _is_roundabout_way(properties):
            continue
        coords = geometry.get("coordinates") or []
        if len(coords) >= 2:
            groups.append(list(coords))
    for element in (overpass_data or {}).get("elements", []):
        tags = element.get("tags") or {}
        if element.get("type") == "node" and tags.get("highway") == "mini_roundabout":
            groups.append([[element["lon"], element["lat"]]])

    # Union-find merge: groups whose nearest vertices are within MERGE_DISTANCE_M
    # (shared vertices included) belong to one roundabout.
    parent = list(range(len(groups)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            if find(i) == find(j):
                continue
            if any(
                _meters(a, b) <= MERGE_DISTANCE_M for a in groups[i] for b in groups[j]
            ):
                parent[find(j)] = find(i)

    merged = {}
    for index, group in enumerate(groups):
        merged.setdefault(find(index), []).extend(group)

    clusters = []
    for points in merged.values():
        lng = sum(p[0] for p in points) / len(points)
        lat = sum(p[1] for p in points) / len(points)
        radius = max(
            (_meters([lng, lat], p) for p in points),
            default=0.0,
        )
        clusters.append(
            {
                "center": {"lat": round(lat, 7), "lng": round(lng, 7)},
                "radiusM": round(max(radius, MIN_RADIUS_M), 1),
            }
        )
    clusters.sort(key=lambda c: (c["center"]["lat"], c["center"]["lng"]))
    return clusters


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--osm-dir", type=Path, default=Path("build/osm"))
    parser.add_argument("--out", type=Path, default=Path("build/osm/roundabouts.json"))
    args = parser.parse_args()

    with (args.osm_dir / "osm-raw-ways.geojson").open() as handle:
        ways = json.load(handle)
    overpass_path = args.osm_dir / "overpass-response.json"
    overpass = json.loads(overpass_path.read_text()) if overpass_path.exists() else None

    clusters = extract_roundabouts(ways, overpass)
    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "roundabouts": clusters,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"build_roundabouts: {len(clusters)} clusters -> {args.out}")


if __name__ == "__main__":
    main()
```

Note the O(n²) union-find pair scan: fine for a few thousand rings; if the real dataset makes it slow, bucket groups by ~0.001° grid cells first (same pattern as `detect_osm_intersections.py`).

- [ ] **Step 4: Run tests + real data spot-check**

Run: `cd processing && python3 test_build_roundabouts.py`
Expected: `build_roundabouts tests passed`.

If `build/osm/osm-raw-ways.geojson` exists locally, also run `python3 processing/build_roundabouts.py` and sanity-check the count (Israel-wide network: hundreds to a few thousands) and one known roundabout's coordinates against the map. If the file is absent, note that in the commit message and rely on the fixture tests.

- [ ] **Step 5: Commit**

```bash
git add processing/build_roundabouts.py processing/test_build_roundabouts.py
git commit -m "feat(nav): offline roundabout cluster extraction from OSM tags"
```

---

### Task 2: Publish `roundabouts.json` through Build + Promote (C2 + C6)

**Files:**
- Modify: `processing/build_map.py` (manifest composition, ~line 2890 `manifest_path`, `"baseRoutingShards"` entries at ~2902/2908 show the pattern)
- Modify: `editor/server.mjs` (promote copy list ~lines 2608-2610 `cwBaseIndex` single-file copy pattern; manifest validation ~2677)
- Modify: `apps/mobile/scripts/sync-offline-assets.mjs` (bundle list, ~line 27)

**Interfaces:**
- Consumes: `build/osm/roundabouts.json` from Task 1 (or invokes `extract_roundabouts` directly — prefer copying the already-generated file so `build_map.py` does not re-run Overpass-dependent code).
- Produces: `map-manifest.json` gains `"roundabouts": "roundabouts.json"` plus a `hashes.roundabouts` digest; promote copies `roundabouts.json` from the build dir to `public-data/`; the mobile offline bundle includes it. **All optional:** when `build/osm/roundabouts.json` is missing, the manifest omits the key, promote skips it, and the app treats it as "no data".

- [ ] **Step 1: build_map.py**

Mirror the `baseRoutingShards` manifest entries (~2902, 2908, 2938): copy `build/osm/roundabouts.json` into the build public-data dir when present, add the manifest key and `file_digest` hash, and include it in the build summary. Follow the surrounding code style exactly; guard with `if roundabouts_src.exists():`.

- [ ] **Step 2: editor/server.mjs promote**

Mirror the `cwBaseIndex` single-file copy (lines ~2608-2610): when `manifest.roundabouts` is set, copy `resolveManifestPath(buildPublicDataDir, manifest.roundabouts)` → `resolveManifestPath(publicDataDir, manifest.roundabouts)`. Do **not** add it to the required-keys validation (~2677) — the artifact is optional by design (C6).

- [ ] **Step 3: Offline bundle**

In `apps/mobile/scripts/sync-offline-assets.mjs` add to the entries list:

```js
  { logicalPath: "public-data/roundabouts.json", optional: true },
```

Check whether the entries support an `optional` flag (read how the list is consumed); if not, add missing-file tolerance for this entry rather than failing the sync.

- [ ] **Step 4: Verify**

Run: `node tests/test-ios-release-config.mjs && node tests/test-asset-injection.mjs` (and any test the repo has for the sync script — `grep -l sync-offline tests/*.mjs`).
Expected: PASS. Then run a local Build (`python3 processing/build_map.py --help` first; run the build the way `plans/`/`processing/README.md` documents) if the inputs exist, and confirm the manifest gains the key. **Do not run Promote** — the owner promotes.

- [ ] **Step 5: Commit**

```bash
git add processing/build_map.py editor/server.mjs apps/mobile/scripts/sync-offline-assets.mjs
git commit -m "feat(nav): publish roundabouts.json through build+promote and the offline bundle"
```

---

### Task 3: Core matcher `roundaboutsOnRoute` (C3)

**Files:**
- Create: `packages/core/src/routing/roundaboutsOnRoute.js`
- Test: `tests/test-roundabouts-on-route.mjs` (new)

**Interfaces:**
- Consumes: cluster list `[{ center: { lat, lng }, radiusM }]` (artifact shape from Task 1), route geometry `[{ lat, lng }, ...]`.
- Produces: `roundaboutsOnRoute(clusters, routeGeometry, { padM = 0 } = {})` → `[{ kind: "roundabout", lat, lng, radiusM }]` for every cluster whose circle (radius + `padM`) the route passes through (any vertex inside, or any segment crossing the circle). Task 4 appends these to `route.junctions`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-roundabouts-on-route.mjs`:

```js
import assert from "node:assert/strict";
import { roundaboutsOnRoute } from "@cycleways/core/routing/roundaboutsOnRoute.js";

const cluster = { center: { lat: 33.1, lng: 35.605 }, radiusM: 20 };
const route = [
  { lat: 33.1, lng: 35.6 },
  { lat: 33.1, lng: 35.61 },
];

// The route passes straight through the circle (segment crossing, no vertex
// inside): matched.
const hits = roundaboutsOnRoute([cluster], route);
assert.equal(hits.length, 1);
assert.equal(hits[0].kind, "roundabout");
assert.equal(hits[0].radiusM, 20);
assert.ok(Math.abs(hits[0].lat - 33.1) < 1e-9 && Math.abs(hits[0].lng - 35.605) < 1e-9);

// 30m north of the circle edge: not matched.
const far = { center: { lat: 33.1006, lng: 35.605 }, radiusM: 20 };
assert.equal(roundaboutsOnRoute([far], route).length, 0);

// Degenerate inputs are safe.
assert.deepEqual(roundaboutsOnRoute(null, route), []);
assert.deepEqual(roundaboutsOnRoute([cluster], []), []);

console.log("roundabouts-on-route tests passed");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-roundabouts-on-route.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/core/src/routing/roundaboutsOnRoute.js`, reusing `projectToSegment` from `@cycleways/core` navigation (`packages/core/src/navigation/routeProgress.js` exports it) for point-to-segment distance:

```js
// Match roundabout clusters against a route line (C3, plans/roundabout-cues).
// Pure point-in-circle / segment-distance checks — no network topology.
import { projectToSegment } from "../navigation/routeProgress.js";

export function roundaboutsOnRoute(clusters, routeGeometry, { padM = 0 } = {}) {
  const list = Array.isArray(clusters) ? clusters : [];
  const geometry = Array.isArray(routeGeometry) ? routeGeometry : [];
  if (list.length === 0 || geometry.length < 2) return [];
  const matches = [];
  for (const cluster of list) {
    const lat = Number(cluster?.center?.lat);
    const lng = Number(cluster?.center?.lng);
    const radiusM = Number(cluster?.radiusM);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusM)) {
      continue;
    }
    const center = { lat, lng };
    const reach = radiusM + Math.max(0, Number(padM) || 0);
    let hit = false;
    for (let i = 0; i < geometry.length - 1 && !hit; i++) {
      const proj = projectToSegment(center, geometry[i], geometry[i + 1]);
      hit = proj.crossTrackMeters <= reach;
    }
    if (hit) matches.push({ kind: "roundabout", lat, lng, radiusM });
  }
  return matches;
}
```

For nationwide cluster lists this linear scan is O(clusters × segments); if profiling shows it matters at ride-confirm, add the grid-bucket pre-filter used by `junctionsNearRoute.js` — not before.

- [ ] **Step 4: Run to verify pass**

Run: `node tests/test-roundabouts-on-route.mjs`
Expected: `roundabouts-on-route tests passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/routing/roundaboutsOnRoute.js tests/test-roundabouts-on-route.mjs
git commit -m "feat(nav): pure roundabout-cluster route matcher"
```

---

### Task 4: Bake roundabout records into `route.junctions` (C3 wiring)

**Files:**
- Modify: `packages/core/src/app/useCyclewaysApp.js:147-153` (`computeRouteJunctions`)
- Modify: whatever supplies `useCyclewaysApp`'s data dependencies with a roundabouts loader (find with `grep -rn "useCyclewaysApp(" apps/mobile packages/core/src` and read how the sharded route session/data assets are injected — mirror that pattern for a lazily-loaded, cached `loadRoundabouts()` that resolves the artifact or `null`)
- Modify: `apps/mobile` asset loading — the native side loads bundled JSON via `getJsonAsset("public-data/...")` (see the comment in `sync-offline-assets.mjs`); the web side may pass a no-op loader (navigation is app-only)

**Interfaces:**
- Consumes: `roundaboutsOnRoute` (Task 3); the bundled/fetched `roundabouts.json` (Tasks 1–2).
- Produces: `computeRouteJunctions(geometry)` resolves to plain junction nodes **plus** `{ kind: "roundabout", lat, lng, radiusM }` records. Plain nodes additionally gain `kind: "junction"` — read `junctionsNearRoute.js`'s returned record shape first and add the field there. Task 5 consumes `route.junctions` entries by `kind`.

- [ ] **Step 1: Extend `computeRouteJunctions`**

```js
  const computeRouteJunctions = useCallback(async (geometry) => {
    const session = shardedRouteSessionRef.current;
    if (typeof session?.junctionsNearRoute !== "function") return null;
    const junctions = await session.junctionsNearRoute(geometry);
    if (!Array.isArray(junctions)) return junctions;
    // Roundabout clusters ride along as kind-tagged junction records
    // (plans/roundabout-cues C3). Missing artifact = no records = today's cues.
    const clusters = await loadRoundaboutsOnce();
    if (!Array.isArray(clusters) || clusters.length === 0) return junctions;
    return [...junctions, ...roundaboutsOnRoute(clusters, geometry)];
  }, []);
```

`loadRoundaboutsOnce` caches a single load attempt (memoized promise), resolves the artifact's `.roundabouts` array via the injected loader, and swallows failures to `null`. Wire the loader through the same dependency surface `useCyclewaysApp` already uses for data assets — read the hook's options/parameters first and follow its existing injection pattern.

- [ ] **Step 2: `kind` on plain junction records**

In `junctionsNearRoute.js`, add `kind: "junction"` to each returned record (read the return mapping at the end of the file). Run `node tests/test-*.mjs`-suite members that cover it: `grep -l junctionsNearRoute tests/*.mjs`, run those.
Expected: PASS (consumers ignore unknown fields; fix any exact-shape assertions to include `kind`).

- [ ] **Step 3: Native loader**

On the mobile side, supply the loader reading `getJsonAsset("public-data/roundabouts.json")` (grep `getJsonAsset` in `apps/mobile/src` for the exact helper and its error behavior); absent asset → `null`.

- [ ] **Step 4: Static + suite check**

Run: `node tests/test-mobile-undefined-references.mjs` and the tests found in Step 2.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/app/useCyclewaysApp.js packages/core/src/routing/junctionsNearRoute.js apps/mobile
git commit -m "feat(nav): bake roundabout clusters into route junctions at ride-confirm"
```

---

### Task 5: One entry-anchored direction cue per roundabout (C4)

**Files:**
- Modify: `packages/core/src/navigation/navigationCues.js` (corner-cue loop; `JUNCTION_GATE_M` gating at the top of `buildRouteCues`)
- Test: `tests/test-navigation-cues.mjs` (extend)

**Interfaces:**
- Consumes: `route.junctions` entries with `kind: "roundabout"`, `lat`, `lng`, `radiusM` (Task 4).
- Produces: cue objects `{ type: "roundabout", direction: "straight" | "right" | "left" | "u-turn", distanceMeters }` anchored at the route's entry into the cluster; corners inside a cluster emit no turn/bend cues. New exported constant `ROUNDABOUT_DIRECTION_THRESHOLDS = { straightMaxDeg: 40, uTurnMinDeg: 130 }`. Cue `type: "roundabout"` joins `SELECTION_PRIORITY` at turn priority (0).

- [ ] **Step 1: Write the failing tests**

Read `tests/test-navigation-cues.mjs` for its route-fixture helpers, then append fixtures (geometry with `distanceFromStartMeters`; a roundabout cluster junction at a corner):

```js
// --- C4: roundabout traversals collapse to one direction cue ---------------
// Straight through: the route jogs around the circle center (two ~45°
// corners inside the cluster) but enters and leaves on the same bearing.
{
  const route = {
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.6045, distanceFromStartMeters: 419 },
      { lat: 33.10012, lng: 35.605, distanceFromStartMeters: 467 },
      { lat: 33.1, lng: 35.6055, distanceFromStartMeters: 515 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 934 },
    ],
    junctions: [{ kind: "roundabout", lat: 33.1, lng: 35.605, radiusM: 25 }],
  };
  const cues = buildRouteCues(route);
  const roundaboutCues = cues.filter((cue) => cue.type === "roundabout");
  assert.equal(roundaboutCues.length, 1, "one cue per traversal");
  assert.equal(roundaboutCues[0].direction, "straight");
  assert.ok(
    roundaboutCues[0].distanceMeters < 467,
    "anchored at entry, before the center",
  );
  assert.equal(
    cues.filter((cue) => cue.type === "turn" || cue.type === "bend").length,
    0,
    "in-cluster corners suppressed",
  );
}

// Right exit: net bearing change ~90° to the right.
{
  const route = {
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.605, distanceFromStartMeters: 467 },
      { lat: 33.0995, lng: 35.605, distanceFromStartMeters: 523 },
      { lat: 33.095, lng: 35.605, distanceFromStartMeters: 1024 },
    ],
    junctions: [{ kind: "roundabout", lat: 33.1, lng: 35.605, radiusM: 25 }],
  };
  const roundaboutCues = buildRouteCues(route).filter((c) => c.type === "roundabout");
  assert.equal(roundaboutCues.length, 1);
  assert.equal(roundaboutCues[0].direction, "right");
}

// A cluster the route passes near but not through changes nothing.
{
  const route = {
    geometry: [
      { lat: 33.1, lng: 35.6, distanceFromStartMeters: 0 },
      { lat: 33.1, lng: 35.61, distanceFromStartMeters: 934 },
    ],
    junctions: [{ kind: "roundabout", lat: 33.1008, lng: 35.605, radiusM: 25 }],
  };
  assert.equal(
    buildRouteCues(route).filter((c) => c.type === "roundabout").length,
    0,
  );
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/test-navigation-cues.mjs`
Expected: FAIL — no `roundabout` cue type exists.

- [ ] **Step 3: Implement in `buildRouteCues`**

1. Split `route.junctions` by `kind`: plain nodes keep feeding the existing `JUNCTION_GATE_M` turn gating (records without a `kind` count as plain — backward compatibility with already-persisted routes); `kind: "roundabout"` records feed the new pass.
2. For each roundabout record, walk the geometry to find the **entry index** (first vertex/segment-crossing within `radiusM + JUNCTION_GATE_M` of the center — reuse the same distance helper the file already uses) and the **exit index** (first vertex beyond that range again).
3. Entry course = bearing into the entry segment; exit course = bearing out of the exit segment; `delta = signedTurn(entryCourse, exitCourse)` (the file's existing helper). Direction via the exported constant `export const ROUNDABOUT_DIRECTION_THRESHOLDS = { straightMaxDeg: 40, uTurnMinDeg: 130 };` — `|delta| < straightMaxDeg` → `"straight"`; up to `uTurnMinDeg` → `delta > 0 ? "right" : "left"`; beyond → `"u-turn"`.
4. Push `{ type: "roundabout", direction, distanceMeters: entryDistance }` where `entryDistance` is the `distanceFromStartMeters` at the entry point.
5. Suppress corner cues whose corner vertex lies within `radiusM + JUNCTION_GATE_M` of any roundabout center (filter them in the existing corner loop).
6. Add `roundabout: 0` to `SELECTION_PRIORITY`.

- [ ] **Step 4: Run cue + downstream suites**

Run: `node tests/test-navigation-cues.mjs && node tests/test-navigation-session.mjs && node tests/test-cue-haptics.mjs && node tests/test-navigation-voice.mjs`
Expected: PASS (voice/haptics treat unknown cue types conservatively today; Task 6 adds the phrasing).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationCues.js tests/test-navigation-cues.mjs
git commit -m "feat(nav): entry-anchored direction cue replaces roundabout corner noise"
```

---

### Task 6: Voice and card phrasing (C5)

**Files:**
- Modify: `packages/core/src/navigation/navigationVoice.js` (cue phrasing — the `cuePhrase` turn section)
- Modify: `packages/core/src/navigation/navigationPresentation.js` (cue card text/icon — the `case "arrive"` block at ~line 55 shows the shape)
- Test: `tests/test-navigation-voice.mjs`, `tests/test-navigation-presentation.mjs` (extend)

**Interfaces:**
- Consumes: cue events with `cue.type === "roundabout"` and `cue.direction` (Task 5).
- Produces: Hebrew phrases — `straight`: "בכיכר, המשיכו ישר"; `right`: "בכיכר, פנו ימינה"; `left`: "בכיכר, פנו שמאלה"; `u-turn`: "בכיכר, חזרו לאחור" — with the same distance prefixes as turns ("בעוד 100 מטר — בכיכר, פנו ימינה"); card `{ text: <same>, icon: "reload-outline" }` (or the icon the repo's icon set uses for rotation — check existing icon names in `navigationPresentation.js` and pick the closest).

- [ ] **Step 1: Write the failing tests**

Read the existing turn-phrase cases in `tests/test-navigation-voice.mjs` and mirror one per direction, e.g.:

```js
// --- C5: roundabout phrasing ------------------------------------------------
{
  const plan = planner.plan(
    {
      kind: "cue",
      cueType: "roundabout",
      phase: "final",
      cue: { type: "roundabout", direction: "straight", distanceMeters: 500 },
    },
    baseState,
    1_000,
  );
  assert.ok(plan.utterance.text.includes("בכיכר"), plan.utterance.text);
  assert.ok(plan.utterance.text.includes("ישר"), plan.utterance.text);
}
```

(match the file's actual planner construction/`baseState` helpers; add a `right` + distance-prefix case and a presentation-card case in `test-navigation-presentation.mjs` asserting text + icon for `direction: "left"`.)

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/test-navigation-voice.mjs && node tests/test-navigation-presentation.mjs`
Expected: FAIL — unknown cue type falls through to generic/none.

- [ ] **Step 3: Implement**

In `navigationVoice.js`'s cue phrasing, add a `roundabout` branch next to the turn phrasing, reusing the existing distance-prefix helper:

```js
  const ROUNDABOUT_PHRASES = {
    straight: "בכיכר, המשיכו ישר",
    right: "בכיכר, פנו ימינה",
    left: "בכיכר, פנו שמאלה",
    "u-turn": "בכיכר, חזרו לאחור",
  };
```

English fallback (the file phrases both locales): "At the roundabout, continue straight / turn right / turn left / turn back". In `navigationPresentation.js`, add the `case "roundabout"` card next to `case "arrive"` with the same Hebrew text and the chosen icon.

- [ ] **Step 4: Run to verify pass**

Run: `node tests/test-navigation-voice.mjs && node tests/test-navigation-presentation.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationVoice.js packages/core/src/navigation/navigationPresentation.js tests/test-navigation-voice.mjs tests/test-navigation-presentation.mjs
git commit -m "feat(nav): roundabout voice and cue-card phrasing"
```

---

### Task 7: Full verification and rollout notes

**Files:** none.

- [ ] **Step 1: Full node suite + python tests**

```bash
for f in tests/test-*.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo suite-done
cd processing && python3 test_build_roundabouts.py
```
Expected: only `suite-done` + `build_roundabouts tests passed`.

- [ ] **Step 2: Degradation check**

With no `roundabouts.json` present (the default in a fresh checkout), `node tests/test-navigation-cues.mjs` fixtures without roundabout junctions must produce byte-identical cues to before this plan (the suite passing covers it — state it in the task summary explicitly).

- [ ] **Step 3: Rollout (owner steps — document, do not run)**

Record at the end of this file: the owner runs `python3 processing/build_roundabouts.py` after the next `osm:fetch`, then Build + Promote to publish `roundabouts.json`; then `npm run assets:sync -w @cycleways/mobile` picks it up for the next app build. Ship order is free (C6): app without data degrades; data without app is ignored.

- [ ] **Step 4: Device validation note**

After the next TestFlight ride: one straight-through roundabout and one right-exit must each produce a single correct instruction, and no "right… left" artifacts.
