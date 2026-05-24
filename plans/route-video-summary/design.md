# Route Video Summary Design

## Goal

Let a curated featured route carry a video summary of the ride that the visitor
can play inline on the route page, with the map cursor tracking the video's
current position — and, in the other direction, with a click on the route
seeking the video to that moment.

The feature should:

- attach a video to any featured route without touching the route's JSX module;
- show a "you are here in the video" marker that follows the route as the
  video plays;
- softly auto-pan the map so the marker stays in view;
- let a click on or near the route seek the video to the corresponding moment;
- be authored entirely in the existing `editor/` tool — no hand-edited data
  files, no hand-edited JS;
- ship through the existing **promote** flow that already publishes map data,
  so updating keyframes does not require a code commit or rebuild;
- degrade gracefully when the YouTube IFrame API is blocked, when the keyframes
  file is missing, or when the click is far from the route.

## Current Shape

After the `origin/featured-routes` merge that this work builds on:

- `/featured/:slug` routes are served via `react-router-dom`. Each curated
  route is a JSX module under `src/featured/<slug>.jsx` with a sibling
  `<slug>.meta.js`.
- The `FeaturedRoute` shell loads map assets, decodes the route token from
  `meta.route`, exposes everything via `FeaturedRouteContext`, and renders
  `MapView` in a desktop sticky aside or a mobile inline slot.
- A `VideoEmbed` component already exists in
  `src/components/featured/VideoEmbed.jsx`. It is a dumb lazy-loaded
  `<iframe>` with no IFrame API integration, no playback hooks, and no
  coupling to the map.
- The existing editor at `editor/` has a **promote** action
  (`POST /api/promote` in `editor/server.mjs`) that copies validated build
  artifacts from `build/` into `public-data/`. Promotion is the production
  path for data going live; the runtime always reads from `public-data/`.
- No client-side concept of "video time → map position" exists today.

## Product And Architecture Decision

**Keyframe-based time→location mapping.** The author hand-places a small set
of keyframes — `{ t, lat, lon }` triples — at recognizable landmarks. At
runtime we snap each keyframe's `(lat, lon)` to the current route polyline
and interpolate along the polyline (not in lat/lon space) between adjacent
keyframes. Sparse keyframes (5–15 per video) produce a marker that
visibly tracks the path even on switchbacks.

**No GPX or telemetry path.** We considered auto-syncing from a GPS track or
GoPro GPMF metadata; the author does not record those, and the manual
keyframe path is cheap, robust, and easier to test.

**YouTube unlisted + IFrame API.** Free hosting, mature player, no ads on
unlisted uploads, polling-based `getCurrentTime()` is sufficient for marker
sync (~250 ms cadence is invisible to users on a map). The author tolerates
YT's player UI and a small re-encode quality hit; in exchange we get unlimited
bandwidth at zero cost. Alternatives (self-hosted MP4, Cloudflare Stream,
Vimeo) were ruled out on cost, bandwidth, or branding grounds.

**Per-route keyframes JSON, no per-route JS file edit.** Video metadata lives
in `public-data/route-videos/<slug>.json`, indexed by
`public-data/route-videos/index.json`. The route's `meta.js` does **not**
declare that it has a video — the runtime discovers this by checking the
index. Adding/removing/updating a video is a pure data operation handled by
the editor's promote, never a code edit.

**videoSync as a pure module.** All time↔location math lives in a
DOM-less, YT-less, React-less module
(`src/components/featured/videoSync.js`, alongside the other shared
featured-route building blocks) that takes
`(keyframes, videoDuration, routeGeometry)` and returns
`{ timeToPosition, positionToTime, snapClickToRoute }`. The same module is
used by both the editor authoring mode (for the live preview) and the
runtime — single source of truth for the interpolation logic.

**Symmetric sync.** The same lookup table that maps `videoTime → fraction`
also maps `fraction → videoTime`. This makes map-click-to-seek essentially
free: clicking near the route snaps to a fraction, the table converts to a
time, the player seeks.

## Data Model

### Canonical published files (served at runtime)

```
public-data/route-videos/
  index.json                       # { "<slug>": "<slug>.json", ... }
  sovev-beit-hillel.json           # per-route keyframes
  shdeh-nehemia-baniyas.json
```

#### `index.json`

```jsonc
{
  "version": 1,
  "routes": {
    "sovev-beit-hillel": "sovev-beit-hillel.json"
  }
}
```

A tiny lookup. One fetch per featured route page tells the runtime whether
any video data exists for the current slug.

#### Per-route `<slug>.json`

```jsonc
{
  "version": 1,
  "youtubeId": "dQw4w9WgXcQ",
  "videoDuration": 112.4,
  "keyframes": [
    { "t":   0.0, "lat": 33.0102, "lon": 35.4711 },
    { "t":  18.3, "lat": 33.0089, "lon": 35.4763 },
    { "t":  42.7, "lat": 33.0051, "lon": 35.4798 },
    { "t":  88.0, "lat": 32.9991, "lon": 35.4889 },
    { "t": 112.4, "lat": 32.9968, "lon": 35.4921 }
  ]
}
```

Invariants enforced at promote time and re-validated at runtime:

- `keyframes` sorted by `t` ascending, no duplicate timestamps;
- `keyframes[0].t === 0` and `keyframes[last].t === videoDuration`;
- each `(lat, lon)` lies within a sanity threshold (default 80 m) of the
  current route polyline. Promote rejects drafts that fail this; runtime
  logs and falls back to no-video on a hard mismatch.

### Editor draft files (server-side, not served)

```
editor/.drafts/route-videos/
  <slug>.json
```

Same shape as the canonical file. The promote handler copies draft → canonical
and removes the draft on success.

## Runtime: `videoSync.js` And `VideoEmbed`

### `src/components/featured/videoSync.js`

Pure module — no DOM, no fetch, no React, no YT API.

```js
export function createVideoSync({ keyframes, videoDuration, routeGeometry }) {
  // 1. For each keyframe, find the nearest point on routeGeometry and its
  //    cumulative distance along the polyline. Convert to fraction in [0, 1].
  // 2. Build two sorted arrays:
  //      byTime:     [{ t, fraction }] sorted by t
  //      byFraction: [{ fraction, t }] sorted by fraction
  // 3. Cache a cumulative-distance array for the route polyline.
  return {
    timeToPosition(t),         // → { lat, lon, fraction }
    positionToTime(fraction),  // → t
    snapClickToRoute(latLng, maxMeters = 80), // → { fraction, distanceMeters } | null
  };
}
```

Interpolation between keyframes is linear in *fraction-along-route*, then
fraction is resolved to a `(lat, lon)` by indexing into the polyline's
cumulative-distance array. This keeps the marker on the path even when
keyframes are sparse.

### `VideoEmbed.jsx` (replaces the current dumb iframe)

The component's external API changes: today it takes a `src` prop and renders
that URL as an iframe. After this work it takes no props — slug, route
geometry, and video data all come from `FeaturedRouteContext`. Existing
usage in `sovev-beit-hillel.jsx` (`<FeaturedRoute.Video src={undefined} />`)
becomes `<FeaturedRoute.Video />`.

Behavior:

- Reads `meta.slug` from `FeaturedRouteContext`, fetches
  `route-videos/index.json` once (cached across mounts), then fetches the
  per-slug JSON if present. If either fetch fails or the slug is not in the
  index, renders `null` and the slot is invisible.
- Lazy-loads `https://www.youtube.com/iframe_api` once per page; module-level
  promise so multiple `VideoEmbed` mounts share the same load.
- Constructs a `YT.Player` with `enablejsapi=1`. On `onReady`, snapshots
  duration and instantiates `videoSync` against the current
  `routeState.geometry`.
- While the player is in PLAYING state, a `requestAnimationFrame` loop gated
  by elapsed time (~250 ms cadence) calls `player.getCurrentTime()` →
  `videoSync.timeToPosition(t)` → writes the result to context
  (`setVideoCursor({ t, lat, lon, fraction })`).
- On PAUSED / ENDED / BUFFERING, the loop stops and the cursor freezes —
  marker stays visible at the last known spot.
- Exposes `seek(t)` via a context-shared ref so the map's click handler can
  call it.
- If `YT.Player.onReady` does not fire within 5 seconds (API blocked, ad
  blocker, offline), falls back to rendering the original lazy iframe with
  no sync. Video still plays; just no marker.

## Map Integration

### Two additions to `MapView`

Both optional and additive; the planner UI at `/` is unaffected.

1. **`videoCursor: { lat, lon } | null` prop.** When non-null, renders a
   distinct marker layer (different style from the POI focus marker) at that
   point. Soft auto-pan: if the marker enters the outer 15 % band of the
   viewport, animate-pan to recenter. No pan otherwise — the map stays
   visually quiet when the marker is comfortably in view.

2. **`onRouteClick(latLng) → void` prop.** When set, a click handler raises
   the clicked coordinate. POI clicks keep priority — `onRouteClick` only
   fires when the click did not hit a POI.

### Context additions in `FeaturedRouteContext`

- `videoCursor`, `setVideoCursor` — drives the map marker.
- `videoSyncRef` — the `videoSync` instance, so the click handler can call
  `snapClickToRoute` and `positionToTime`.
- `playerSeekRef` — the YT player's `seek(t)` function, exposed by
  `VideoEmbed` so the click handler can drive it.

### Click-to-seek flow

```
MapView click
  → onRouteClick(latLng)
  → videoSyncRef.current?.snapClickToRoute(latLng)   // returns null if too far
  → if hit: videoSyncRef.current.positionToTime(fraction)
  → playerSeekRef.current(t)
```

The YT player briefly pauses to rebuffer on seek; we accept this — it reads
as "the video is jumping" to users. A short pulse animation on the video
marker confirms the seek visually.

### Mobile vs desktop

`FeaturedRoute` renders `MapView` in a sticky aside on desktop and via
`FeaturedRouteMapSlot` (inline) on mobile. Both consume the same context, so
`videoCursor` updates and `onRouteClick` work in either layout. Only one
`MapView` is mounted at a time — no duplication.

## Editor Authoring Mode And Promote

A new "Video Sync" mode inside the existing `editor/`. Mirrors how the editor
already works: load state, edit, save draft, promote.

### Layout

The existing map stays on the right. A new left column contains:

- A slug dropdown populated by reading `src/featured/*.meta.js`.
- A YouTube URL input (pre-filled if a draft already exists).
- An embedded YouTube player (IFrame API) — full controls and 0.25×/0.5× speed
  for slow scrubbing.
- A keyframes list — each row shows `t` formatted as `mm:ss.ms`, the snapped
  `lat/lon`, and a delete button. Selectable.
- Action buttons: **Add keyframe at current video time**, **Update selected
  to current map click**, **Save draft**, **Promote**.

### Authoring loop

1. Pick slug → editor loads route geometry from the meta's `route` token,
   renders the route polyline on the map.
2. Paste YT URL → player loads. (Or pre-filled from existing draft.)
3. Scrub video to a landmark → click on map.
4. Editor captures `player.getCurrentTime()`, snaps the click to the route
   via the same `videoSync.snapClickToRoute` used at runtime, appends or
   replaces the keyframe.
5. Live preview: as keyframes are added, an in-memory `videoSync` instance
   drives a preview marker that moves along the route while the video plays.
   The author watches for drift and adds correction keyframes where needed.
6. **Save draft** → `PUT /api/video-keyframes/<slug>/draft` writes
   `editor/.drafts/route-videos/<slug>.json`.
7. **Promote** → `POST /api/video-keyframes/<slug>/promote` validates the
   draft and writes the canonical files in `public-data/route-videos/`
   (per-slug JSON + index update), then removes the draft.

### Promote handler

`handlePromoteVideoKeyframes(slug)`:

1. Read the draft.
2. Validate: schema, sort order, `t[0] === 0`, `t[last] === videoDuration`,
   each `(lat, lon)` within sanity threshold of the route polyline (loaded
   from `meta.route`).
3. Write `public-data/route-videos/<slug>.json` atomically (write to
   `<slug>.json.tmp`, then rename).
4. Read or create `public-data/route-videos/index.json`; add/replace the
   entry; write atomically.
5. Remove the draft file.
6. Return success with the written paths.

Validation failures abort the promote with a structured error the editor
surfaces inline.

### Narrow editor cleanup (in scope, bounded)

The editor's toolbar is already crowded. Adding a new mode without cleanup
will make it worse. This work touches only:

- Extract the existing mode-switching UI into a small `ModeBar` component so
  "Video Sync" slots in next to existing modes without piling onto the global
  toolbar.
- Move the existing "Promote" button into a per-mode action area; the map
  data promote stays where it is; the new video-keyframes promote lives in
  the Video Sync mode and does not gate on map build state.

The cycleways-network editing surface is **not** touched.

## Video Processing Pipeline

The 1 GB+ source MP4 is compressed and timelapsed locally before upload.
This lives outside the runtime — a small script under `processing/` so the
recipe is captured in the repo and rerunnable.

### `processing/process-video.sh`

```sh
#!/bin/zsh
# Usage: process-video.sh <input.mp4> <output.mp4> [speedup-factor]
ffmpeg -i "$1" \
  -vf "setpts=PTS/${3:-15},scale=2560:1440:flags=lanczos" \
  -r 30 \
  -an \
  -c:v hevc_videotoolbox -q:v 60 -tag:v hvc1 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  "$2"
```

Decisions:

- **15× default speedup** turns a typical 18–45 min ride into 1–3 min.
- **1440p upscale** is the single biggest knob for YouTube playback quality;
  YT assigns a higher-tier encoder (VP9/AV1) with much more generous bitrate
  to ≥ 1440p uploads, even when viewers watch at 1080p.
- **Apple hardware HEVC encoder** (`hevc_videotoolbox`) — ~10× faster than
  `libx264 -preset slow` on Apple Silicon; quality is irrelevant because YT
  re-encodes everything anyway.
- **30 fps** rather than 60 — the source is 24 fps, the speedup already
  produces a hyperlapse, and 60 fps doubles the bitrate for no perceptual
  gain.
- **Audio stripped** — timelapse audio is unusable.
- **`-pix_fmt yuv420p` + `-tag:v hvc1`** keep the file compatible with YT
  and Apple tooling.

Upload the output as **unlisted** on YouTube. Wait until 1440p/2160p
renditions are available in the player's quality menu before judging
playback quality — earlier you only see the cheap fast-path encode.

## Edge Cases

| Case | Behavior |
|------|----------|
| `route-videos/index.json` fetch fails (404/network) | Silently skip video panel. Page works as before. |
| Per-slug JSON fetch fails after index says it exists | Log warning, skip video panel. Treat as temporarily unavailable. |
| Keyframes file invalid (schema/sort/t mismatch) | `createVideoSync` throws. `VideoEmbed` catches and renders nothing. |
| YT IFrame API blocked or `onReady` doesn't fire within 5 s | Fall back to the original dumb-iframe rendering. Video plays without sync. |
| User scrubs the YT progress bar manually | Next tick's `getCurrentTime()` jumps; marker snaps to new spot. Acceptable feedback. |
| Map click far from route while video panel mounted | `snapClickToRoute` returns `null`; click is ignored for seeking; normal map pan/zoom continues. |
| Video paused / ended / buffering | Tick loop stops; marker frozen at last position. |
| Route geometry shifts between authoring and runtime | Snap-at-runtime self-corrects small shifts (a few m). Gross mismatches (a road moved) caught by promote-time validation and would require re-authoring. |
| Mobile layout | `FeaturedRouteMapSlot` renders inline; `videoCursor` and `onRouteClick` work against that map instance. |

## Testing Strategy

**Unit (Node, no browser):**

- `videoSync.js` — ~10 tests covering keyframe validation, time→position
  monotonicity, position→time round-trip, snap-to-route distance, edge
  keyframes at `t=0` and `t=videoDuration`, sparse-keyframe interpolation
  staying along the polyline rather than cutting through space.
- Editor promote endpoints — validation rejection cases and the
  write-to-disk happy path against a tmp dir.

**Integration (Node):**

- A fixture with a small synthetic route polyline and a small keyframe set;
  assert `timeToPosition(t)` at sample t-values matches expected positions
  within tolerance.

**E2E (Playwright, existing harness):**

- Load `/featured/sovev-beit-hillel`, wait for video panel, assert marker
  appears; programmatically seek the player and assert marker moves.
- Click map at a known on-route location, assert player time changed.
- Load a featured route with no `route-videos/<slug>.json`; assert the
  video slot renders nothing.
- Stub the YT IFrame API to never fire `onReady`; assert fallback iframe
  rendering after 5 s.

**Out of scope for tests:** the real YT IFrame API surface (mocked in unit,
real in e2e), YouTube's re-encode quality.

## Non-Goals

- Frame-accurate sync. `getCurrentTime()` is ~250 ms; that is fine for a map
  marker, not for, e.g., highlighting subtitles.
- Multi-video routes. One video per slug.
- Self-hosted video. Possible later; today's choice is YouTube unlisted.
- Sync to the elevation profile. The current featured-routes shell does not
  render an elevation profile; this is deferred until the shell gains an
  `<FeaturedRoute.Elevation />` slot.
- Author-time editing of the route geometry from inside Video Sync mode.
  Routes are authored in their existing editor mode.
- Auto-extraction of keyframes from GPS/GoPro telemetry. Out of scope; the
  author does not record telemetry.

## Open Questions

None currently blocking. Items to revisit if they become friction:

- Whether the editor's draft for video keyframes should be tracked by git or
  ignored. Default: git-ignored (mirrors how editor working state is
  handled today).
- Whether to add a "drag along the route to scrub" interaction in addition
  to click-to-seek. Same handler family; defer to v2.
