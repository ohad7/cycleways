# Video-Sync Overlay — Implementation Plan

Date: 2026-06-03

See `design.md` for rationale. Steps are ordered so each leaves the editor in a
working state. All UI work is concentrated in `editor/editor.js`,
`editor/index.html`, and `editor/styles.css`, so it is done sequentially (the
files are too coupled to parallelize safely).

## Step 1 — Pure time helpers + unit test (TDD)

1. Create `editor/lib/vs-time.mjs` exporting:
   - `vsFormatTime(seconds)` → `m:ss.ss` (moved verbatim from `editor.js`).
   - `vsParseTime(str)` → seconds or `null` when unparseable. Accepts:
     - plain number: `"222.5"` → `222.5`
     - `m:ss` / `m:ss.ss`: `"3:42"` → `222`, `"3:42.50"` → `222.5`
     - `h:mm:ss(.ss)`: `"1:03:42"` → `3822`
     - rejects empty, negative, non-numeric, malformed.
2. Create `tests/test-vs-time.mjs` (style of `tests/test-video-sync.mjs`,
   `node:assert/strict`) covering each format, round-trip
   `vsParseTime(vsFormatTime(x)) ≈ x`, and invalid inputs returning `null`.
3. Add `&& node tests/test-vs-time.mjs` to the `test` script in `package.json`
   (next to `test-video-sync.mjs`).
4. Run `node tests/test-vs-time.mjs` — must pass.

## Step 2 — Serve the shared interpolator to the browser

In `editor/server.mjs`:
- Add `const videoSyncModulePath = resolve(repoRoot, "src/components/featured/videoSync.js");`
  near `poiTypesModulePath` (line ~44).
- In `serveStatic`, add `const allowedVideoSyncFile = filePath === videoSyncModulePath;`
  and include it in the allow check (line ~1306).

Verify: with the editor server running, `GET /src/components/featured/videoSync.js`
returns 200 (not 404).

## Step 3 — Wire imports in editor.js

At the top of `editor/editor.js`:
- `import { createVideoSync } from "../src/components/featured/videoSync.js";`
- `import { vsFormatTime, vsParseTime } from "./lib/vs-time.mjs";`
- Delete the now-duplicated local `vsFormatTime` definition (lines ~7261–7265).

## Step 4 — Overlay markup (index.html)

1. Remove the `#video-sync-panel` `<section>` (lines ~187–206).
2. Add `#vs-overlay` (hidden) as a direct child of `.app-shell` (after
   `.map-area`/`.details`, before the closing `</div>`), with the same element
   IDs the old panel used so `vsEls`/handlers stay valid:
   - **Header:** title `#vs-overlay-title`, `Route:` `<select id="vs-slug">`,
     `YouTube URL` `<input id="vs-yt-url">`, `#vs-save-draft`, `#vs-promote`,
     `#vs-status`, and a close button `#vs-close`.
   - **Main:** left `#vs-player`; right `#vs-map-slot` (empty; receives `#map`).
   - **Footer:** `#vs-time-now`, `#vs-playpause`, `#vs-seek-input`,
     `#vs-seek-go`, nudge buttons (`data-step="-5|-1|-0.1|0.1|1|5"`), and the
     keyframe strip `<ul id="vs-keyframes" class="vs-kf-strip">`.

## Step 5 — Overlay styles (styles.css)

- `#vs-overlay`: `position: fixed; inset: 0; z-index: 50; display: grid;
  grid-template-rows: auto 1fr auto; background: var(--bg);` and `[hidden]` →
  `display:none`.
- Header: flex row, wrap, gap; URL input flexes.
- Main: `display:grid; grid-template-columns: 1fr 1fr; min-height:0;`
  `#vs-player` keeps 16:9 and fills its cell; `#vs-map-slot { min-height:0; }`
  with the moved `#map` set to `width:100%; height:100%`.
- Footer: flex row, wrap, gap, mono readout.
- `.vs-kf-strip`: `display:flex; overflow-x:auto;` chips with time + ✕,
  `.selected` highlighted (reuse existing colors).
- Replace the old `.vs-keyframes` vertical rules as needed (keep generic bits).

## Step 6 — Overlay show/hide + map relocation (editor.js)

1. Add element refs: `vsEls.overlay`, `vsEls.mapSlot`, `vsEls.close`,
   `vsEls.timeNow`, `vsEls.playPause`, `vsEls.seekInput`, `vsEls.seekGo`,
   `vsEls.title`, plus the nudge container.
2. `vsActivateOverlay()`: move `#map` into `#vs-map-slot`
   (`vsEls.mapSlot.appendChild(mapContainer)`), `vsEls.overlay.hidden = false`,
   then `map.resize()` (next frame). Set title from current slug.
3. `vsDeactivate()`: move `#map` back to `.map-area`, `vsEls.overlay.hidden = true`,
   `map.resize()`, clear the readout interval, hide/remove the ghost.
4. In `setWorkspaceMode` (line ~3545): when entering `"video-sync"` call
   `vsActivateOverlay()` after `activateVideoSyncMode()`. When the mode changes
   to anything else, if it *was* video-sync, call `vsDeactivate()`. Capture the
   previous mode at the top of `setWorkspaceMode` to detect leaving.
5. Remove the `els.videoSyncPanel.hidden = …` line (~3111) and the `vsEls`/`els`
   reference to the deleted panel.
6. `#vs-close` → `setWorkspaceMode("segments")`.
7. Keep a reference to the `#map` element and its home parent (`.map-area`) so
   relocation is reliable.

## Step 7 — Transport bar logic (editor.js)

1. Readout interval: `vsStartTicker()` sets a ~100 ms `setInterval` storing the
   id on `videoSyncState.ticker`; each tick updates `#vs-time-now` (current /
   duration via `vsFormatTime`) and updates the ghost (Step 8). `vsDeactivate()`
   clears it. Guard when `player.getCurrentTime` is unavailable.
2. `vsSeekTo(t)`: clamp to `[0, duration]`, `player.seekTo(t, true)`, refresh
   readout.
3. Seek box: on Enter / `#vs-seek-go` click, `const t = vsParseTime(value)`;
   if `t == null` → status error, else `vsSeekTo(t)`.
4. `vsSeekBy(delta)`: `player.pauseVideo?.()` then
   `vsSeekTo((player.getCurrentTime?.() || 0) + delta)`. Delegate nudge clicks
   via `data-step`.
5. `#vs-playpause`: read `player.getPlayerState()`; toggle play/pause; update
   label.

## Step 8 — Ghost marker (editor.js)

1. Constants `VS_GHOST_SOURCE_ID` / `VS_GHOST_LAYER_ID`.
2. `vsRebuildSync()`: if `routePolyline` and a known duration and
   `keyframes.length >= 2`, `try { videoSyncState.sync = createVideoSync({
   keyframes, videoDuration, routeGeometry: routePolyline }); } catch {
   videoSyncState.sync = null; }`; else `null`. Call it wherever keyframes change
   (`handleVideoSyncMapClick`, delete handler, `vsLoadExistingDraft`) and after a
   route loads / video duration becomes known.
3. `vsRenderGhost(t)`: if `sync`, compute `pos = sync.timeToPosition(t)` and set
   a 1-point source at `[pos.lng, pos.lat]`; else empty source. Add the layer
   (hollow blue ring: `circle-color` transparent-ish or distinct blue,
   `circle-stroke-color:#1565c0`, larger radius) once, alongside the existing
   keyframe layer.
4. Call `vsRenderGhost(currentTime)` from the ticker. Clear in
   `vsClearMapLayers()` and `vsDeactivate()`.

## Step 9 — Keyframe chip strip (editor.js)

Rewrite `vsRenderKeyframesList()` to render horizontal chips into `#vs-keyframes`:
each chip shows `vsFormatTime(kf.t)`, click → select + `player.seekTo(kf.t,true)`,
a ✕ button → splice + `vsRebuildSync()` + re-render layer/list. Keep
`selectedIndex` highlight behavior.

## Step 10 — Keyboard shortcuts (editor.js)

In the `keydown` handler (line ~6600), immediately after the
input/textarea/select guard, add:

```js
if (state.workspaceMode === "video-sync") {
  if (handleVideoSyncKey(event)) return;
}
```

`handleVideoSyncKey(event)` returns `true` when it handles a key:
- `ArrowRight`/`ArrowLeft` → `vsSeekBy(±(event.shiftKey ? 5 : 1))`
- `,`/`.` → `vsSeekBy(∓0.1 / ±0.1)`
- `Space` → toggle play/pause
…each calling `event.preventDefault()`.

## Step 11 — Verification

1. `node tests/test-vs-time.mjs` and `npm test` (or at least the touched
   subset) pass.
2. Manual in the editor (`npm run dev`-equivalent editor server): open Video
   Sync → overlay fills the screen, video large left, map large right and still
   clickable to add keyframes; readout ticks; type a time + Enter seeks; nudge
   buttons pause-and-step; `←/→ , . Space` work; blue ghost ring tracks playback
   once ≥2 keyframes exist; chips select/seek/delete; Save/Promote still work;
   ✕ returns to Segments with the map back in place and correctly sized.
