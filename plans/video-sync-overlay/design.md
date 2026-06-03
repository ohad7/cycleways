# Video-Sync Overlay — Design

Date: 2026-06-03

## Problem

The editor's Video Sync mode anchors video time to map location: you scrub a
YouTube video to a recognizable moment, then click that spot on the map, which
records `{ t: player.getCurrentTime(), lat, lon }`. The interpolated keyframes
later drive the live "where is the rider now" marker on featured-route pages.

Two things make this painful today:

1. **Landing on the exact moment is hard.** The only control is the coarse
   YouTube scrubber, which overshoots. There is no live current-time readout, no
   fine nudge, and no way to jump to a known timestamp.
2. **The video is tiny.** The player is `width:100%` of a 340px sidebar column,
   so recognizing the precise moment is difficult.

There is also no feedback loop: you cannot see whether the keyframes you have
already placed actually track the video until you promote and look at the live
site.

## Goals

- Precise, low-friction control over the player: live time readout, type-a-time
  seek, fine nudge buttons, and keyboard shortcuts.
- A large, side-by-side video + map workspace.
- A live "ghost" marker on the map showing where the current keyframes *predict*
  the rider is at the current video time, so drift is visible while editing.

## Non-goals (YAGNI)

- No custom scrub bar, no playback-speed control, no auto-detection of moments.
- No second Mapbox instance — the existing map is reused.
- The keyframe commit model is unchanged: a keyframe is still created by clicking
  the route on the map (which reads the now-precise current time). There is no
  standalone "add keyframe" button/key, because a keyframe needs a map location.

## Design

### Shared interpolation (one source of truth)

`editor.js` is already an ES module. It will
`import { createVideoSync } from "../src/components/featured/videoSync.js"` — the
exact module the production runtime and the editor server already use. The
editor preview and the live site are then guaranteed to use identical math.

Because the dev server's static allowlist currently serves only
`packages/core/src` (not `src/`), `src/components/featured/videoSync.js` must be
added to the allowlist (mirroring the existing single-file `poiTypesModulePath`
exception), or the browser import 404s.

### Dedicated overlay layout

Video Sync becomes a full-screen overlay (`#vs-overlay`, hidden by default), a
CSS grid of header / main / footer:

```
┌ header: "Video Sync — <route>"  [Route ▾] [YouTube URL]  [Save] [Promote] [✕] ┐
├ main (1fr) ───────────────────────┬──────────────────────────────────────────┤
│   VIDEO (large, 16:9)             │   MAP  (the relocated #map, interactive)   │
│                                   │   route + red keyframes + blue ghost ring  │
├ footer (auto) ────────────────────┴──────────────────────────────────────────┤
│  now 1:23.45 / 12:04  ▶/⏸   [ 3:42 ](Go)   −5 −1 −0.1 +0.1 +1 +5   ⟨kf chips…⟩ │
└────────────────────────────────────────────────────────────────────────────────┘
```

**One map, relocated — not duplicated.** Entering Video Sync
(`setWorkspaceMode("video-sync")`) appends the existing `#map` node into the
overlay's right pane, calls `map.resize()`, and shows the overlay. Leaving (the
✕ calls `setWorkspaceMode("segments")`) moves `#map` back into `.map-area`,
calls `map.resize()`, and hides the overlay. All sources, layers (route,
keyframes, ghost), and the click-to-add handler are on that one instance, so
nothing is re-wired. After a `style.load` while the overlay is open, call
`map.resize()` so a basemap switch repaints at the overlay size.

> Fallback: if reparenting a live Mapbox node ever misbehaves, create a second
> map instance in the overlay instead. Reparenting is the primary plan because
> it avoids duplicating every layer and handler.

**Controls move into the overlay.** The old sidebar `#video-sync-panel` is
removed. Its elements (slug `select`, YouTube URL `input`, player div, Save /
Promote buttons, status span) keep the same IDs inside the overlay, so every
`vsEls` reference and existing handler keeps working. The panel-hidden toggle for
video-sync (`els.videoSyncPanel.hidden = …`) is removed; overlay visibility is
managed explicitly in `setWorkspaceMode`.

### Transport bar (footer)

- **Live readout** `#vs-time-now`: `m:ss.ss / m:ss` (current / duration),
  refreshed by a ~100 ms `setInterval` that reads `player.getCurrentTime()`.
  Started on entering video-sync, **cleared on leaving** (`vsDeactivate()`), and
  guards for "player not loaded yet".
- **Type-a-time seek** `#vs-seek-input` + `#vs-seek-go`: a pure
  `vsParseTime(str)` accepts plain seconds (`222.5`), `m:ss(.ss)`, and
  `h:mm:ss`. Enter in the box or clicking Go parses → clamps to
  `[0, duration]` → `player.seekTo(t, true)`. Invalid input → `vsSetStatus`.
- **Nudge buttons** carry `data-step` of `±0.1 / ±1 / ±5`. `vsSeekBy(delta)`
  **pauses first** (`pauseVideo()`) then seeks to the clamped target, so you
  settle on an exact frame.
- **Play/pause** `#vs-playpause` toggles `playVideo()`/`pauseVideo()` and updates
  its label from player state.

### Keyboard shortcuts

A new branch at the top of the existing `keydown` handler (`editor.js:6600`),
placed **after** the input/textarea/select guard (so it is inert while typing in
the seek box) and gated on `state.workspaceMode === "video-sync"`:

- `←` / `→` → ∓1s / ±1s
- `Shift+←` / `Shift+→` → ∓5s / ±5s
- `,` / `.` → ∓0.1s / ±0.1s
- `Space` → play/pause

Each handled key `preventDefault()`s and returns before the segments-mode logic,
so `Space` no longer triggers quick-snap while in video-sync mode.

### Live ghost marker

- **State:** `videoSyncState.sync`, rebuilt whenever keyframes change (add,
  delete, draft load) and a route + duration are known, via
  `createVideoSync({ keyframes, videoDuration, routeGeometry: routePolyline })`,
  wrapped in try/catch. It needs ≥2 keyframes and a known duration; otherwise
  `sync = null` and the ghost hides. (`routePolyline` is already `{lat,lng}`,
  which `createVideoSync` expects.)
- **Marker:** a new `vs-ghost-source` / `vs-ghost-layer` styled distinctly from
  the red keyframe dots — a hollow blue ring — so "predicted position" reads
  apart from "anchored keyframes".
- **Update:** on the same ~100 ms tick that drives the readout, if `sync` exists
  set the ghost to `sync.timeToPosition(currentTime)`; otherwise hide it.
  `timeToPosition` clamps, so before the first / after the last keyframe the
  ghost simply parks at that endpoint.
- **Cleanup:** cleared in `vsDeactivate()` and `vsClearMapLayers()`.

**Payoff:** play the video and watch the blue ring travel the route. Where it
leads or lags the on-screen location, that is exactly where a correction keyframe
is needed — guess-and-check becomes a visible feedback loop.

### Keyframe list as a horizontal chip strip

The footer renders `videoSyncState.keyframes` as horizontally scrollable chips
(time label; click → select + seek; ✕ → delete; selected highlighted). Same data
and selection model as today, rendered horizontally to fit the footer.

## Testing

- `vsParseTime` and `vsFormatTime` are extracted into a pure, importable module
  `editor/lib/vs-time.mjs` (mirroring `editor/lib/edge-pick.mjs`). A new
  `tests/test-vs-time.mjs` unit-tests the time formats, round-tripping, and edge
  cases, added to the `npm test` chain.
- The interpolation itself is already covered by `tests/test-video-sync.mjs`
  (the editor reuses that exact module).
- Readout polling, nudge/seek, keyboard shortcuts, the ghost marker, the overlay
  layout, and map relocation depend on the YouTube iframe API and Mapbox GL, so
  they are verified manually in the running editor against a real route + video.

## Files touched

- `editor/lib/vs-time.mjs` — new pure helpers (`vsParseTime`, `vsFormatTime`).
- `tests/test-vs-time.mjs` — new unit test; wired into `package.json` `test`.
- `editor/server.mjs` — allow `src/components/featured/videoSync.js` static read.
- `editor/index.html` — remove `#video-sync-panel`; add `#vs-overlay` markup.
- `editor/styles.css` — overlay grid, transport bar, chip strip styling.
- `editor/editor.js` — import `createVideoSync` + vs-time helpers; transport
  logic; ghost marker; horizontal chip rendering; overlay show/hide + `#map`
  relocation and `vsDeactivate()` in `setWorkspaceMode`; keyboard branch; rebuild
  `videoSyncState.sync` on keyframe changes.
