# Navigation Ride-Feedback Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ten issues surfaced by real-ride feedback: per-fix persistence sluggishness, silent lock screen, permanently-disengaging camera, missing voice content (segment names, compound turns, wrong-way, rejoin, compass), production routes missing junction data (false turn cues), the unintelligible data pill, and the Always-permission question.

**Architecture:** All decision logic goes in pure `packages/core` modules covered by the node test suite; `apps/mobile` files stay thin native glue. See `plans/navigation-ride-feedback/design.md` for decisions D1–D10.

**Tech Stack:** Node test scripts (`node tests/test-*.mjs`, plain `assert`), React Native / Expo (expo-location, expo-speech, expo-audio), pure-JS core in `packages/core`.

## Implementation Status — 2026-07-10

All code, automated-test, diagnostic, and source-analysis stages are complete.
The implementation incorporates four safety corrections from pre-implementation
review:

- filesystem persistence is serialized/coalesced and advances its throttle only
  after a successful write;
- due/final segment cues outrank farther previews, so named-segment speech cannot
  be starved by the selector;
- junction arrays are authoritative only after complete shard coverage, and are
  prefetched before confirmation without delaying the confirmation tap; and
- a compound follow-up is silent only when the earlier combined instruction was
  actually accepted by the voice planner.

Automated verification (`npm test`, including `test:navigation-camera`) passes,
both rider route tokens were inspected, and Expo config resolution confirms the
native iOS background modes. A clean native iOS Simulator build also completed
with zero errors, installed on an iPhone 15 simulator, bundled, and launched.
The remaining checks need interactive journey playback or a physical iPhone:
the scenario-level voice/camera smoke, lock-screen speech, and the When-In-Use
permission protocol. See `route-verification.md` and
`permission-spike-findings.md`.

**Update 2026-07-11:** The next real ride showed Task 4's fix was
insufficient — voice was still silent under lock. Root cause (design D11): the
audio session category is set but the session is never *activated*, and iOS
refuses the implicit activation that makes foreground speech work. Tasks 19–20
(below) add explicit session activation around utterances and an indoor
lock-screen soak test on the ride-setup test-voice button.

## Global Constraints

- Never hand-edit `data/map-source.geojson` or anything under `public-data/` (CLAUDE.md). The diagnostic script *reads* `public-data/`, never writes it.
- All Hebrew strings in this plan are copy — use them verbatim.
- Every new test file must be appended to the `"test"` script chain in the root `package.json` (the chain of `node tests/...` commands).
- `apps/mobile/app.json` changes to `infoPlist` require a native rebuild (`npx expo prebuild -p ios` / EAS) before device verification; JS-only changes do not.
- Existing per-session voice philosophy stands: new speech goes through `createNavigationVoicePlanner`'s dedupe/cooldown/priority machinery — no direct `speakUtterance` calls from new code paths.
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Run tests from the repo root: `/Users/ohad/projects/cycleways`.

## File Structure

New files:
- `packages/core/src/navigation/persistencePolicy.js` — pure persist-now/skip decision.
- `packages/core/src/navigation/speechAudioSessionPolicy.js` — pure activate/deactivate timing for the iOS audio session around utterances (Task 19).
- `apps/mobile/src/navigation/lockScreenVoiceTest.js` — lock-screen voice soak-test controller (Task 20).
- `tests/test-speech-audio-session-policy.mjs` (Task 19).
- `packages/core/src/routing/junctionsNearRoute.js` — pure junction derivation (network + geometry → junction points), cell-indexed.
- `scripts/inspect-route-cues.mjs` — diagnostic: decode a shared-route token, print cues with/without junctions.
- `tests/test-navigation-persistence-policy.mjs`, `tests/test-junctions-near-route.mjs`.
- `plans/navigation-ride-feedback/route-verification.md`, `plans/navigation-ride-feedback/permission-spike-findings.md` — recorded outcomes of the two investigation tasks.

Modified (main ones):
- `packages/core/src/navigation/navigationSession.js` — slim snapshot, auto-refollow, wrong-way + rejoin-ready events.
- `packages/core/src/navigation/navigationCues.js` — compound turn pairs, spacing-floor split.
- `packages/core/src/navigation/navigationVoice.js` — new phrases (segment names, compound, wrong-way, rejoin, compass, bend-mute).
- `packages/core/src/navigation/effectiveNavigationRoute.js` — `junctions` pass-through.
- `packages/core/src/routing/shardedRouteSession.js`, `packages/core/src/app/useCyclewaysApp.js` — junction computation exposure.
- `apps/mobile/src/navigation/useNavigationSession.js`, `apps/mobile/src/screens/BuildScreen.jsx`, `apps/mobile/src/navigation/speechAdapter.js`, `apps/mobile/app.json`, `apps/mobile/src/planner/NavPanel.jsx`.

---

### Task 1: Persistence policy helper (pure core)

**Files:**
- Create: `packages/core/src/navigation/persistencePolicy.js`
- Test: `tests/test-navigation-persistence-policy.mjs`
- Modify: `package.json` (append test to the `"test"` chain)

**Interfaces:**
- Consumes: nothing.
- Produces: `shouldPersistNavigationSnapshot({ lastPersistAtMs, lastStatus, status, hasCueEvent, nowMs, intervalMs }) -> boolean`, used by Task 3.

- [ ] **Step 1: Write the failing test**

```js
// tests/test-navigation-persistence-policy.mjs
import assert from "node:assert/strict";
import { shouldPersistNavigationSnapshot } from "@cycleways/core/navigation/persistencePolicy.js";

// First persist (no history) always persists.
assert.equal(
  shouldPersistNavigationSnapshot({ status: "navigating", nowMs: 1000 }),
  true,
  "no history -> persist",
);

// Status change always persists, even inside the interval.
assert.equal(
  shouldPersistNavigationSnapshot({
    lastPersistAtMs: 1000,
    lastStatus: "navigating",
    status: "off-route",
    nowMs: 1500,
  }),
  true,
  "status transition -> persist",
);

// A cue event always persists (keeps voice dedupe memory fresh for handoff).
assert.equal(
  shouldPersistNavigationSnapshot({
    lastPersistAtMs: 1000,
    lastStatus: "navigating",
    status: "navigating",
    hasCueEvent: true,
    nowMs: 1500,
  }),
  true,
  "cue event -> persist",
);

// Same status, no cue, inside the interval -> skip.
assert.equal(
  shouldPersistNavigationSnapshot({
    lastPersistAtMs: 1000,
    lastStatus: "navigating",
    status: "navigating",
    nowMs: 5000,
  }),
  false,
  "steady state inside interval -> skip",
);

// Interval elapsed -> persist.
assert.equal(
  shouldPersistNavigationSnapshot({
    lastPersistAtMs: 1000,
    lastStatus: "navigating",
    status: "navigating",
    nowMs: 11_001,
  }),
  true,
  "interval elapsed -> persist",
);

console.log("test-navigation-persistence-policy ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-persistence-policy.mjs`
Expected: FAIL with `Cannot find module ... persistencePolicy.js`

- [ ] **Step 3: Write the implementation**

```js
// packages/core/src/navigation/persistencePolicy.js
// Decides whether the active-navigation snapshot is persisted for a given
// dispatch. Persisting on every GPS fix serialized the full route geometry
// ~1/sec and made the phone sluggish on long rides; this throttles steady
// state to one write per interval while keeping transitions and cue events
// immediate (cue events keep the voice-dedupe memory fresh for the
// background-task handoff).

const DEFAULT_PERSIST_INTERVAL_MS = 10_000;

export function shouldPersistNavigationSnapshot({
  lastPersistAtMs = null,
  lastStatus = null,
  status,
  hasCueEvent = false,
  nowMs,
  intervalMs = DEFAULT_PERSIST_INTERVAL_MS,
} = {}) {
  if (status !== lastStatus) return true;
  if (hasCueEvent) return true;
  const last = Number(lastPersistAtMs);
  if (!Number.isFinite(last)) return true;
  return Number(nowMs) - last >= intervalMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-persistence-policy.mjs`
Expected: `test-navigation-persistence-policy ok`

- [ ] **Step 5: Append `node tests/test-navigation-persistence-policy.mjs` to the `"test"` chain in root `package.json`** (insert next to `node tests/test-navigation-session.mjs`).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/navigation/persistencePolicy.js tests/test-navigation-persistence-policy.mjs package.json
git commit -m "feat(nav): pure persistence-throttle policy for active session snapshots

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Slim the session snapshot (drop duplicated route geometry)

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js:913-927` (snapshot) and `:99-120` (restore overrides)
- Test: `tests/test-navigation-session.mjs`

**Interfaces:**
- Consumes: existing `createNavigationSession(route, { snapshot })`.
- Produces: `session.snapshot().state.route === null` and `.state.cameraTransition === null`; restore behavior unchanged (route re-injected from the constructor argument). Task 3 and the existing background task rely on `record.navigationRoute` being the *only* geometry copy.

- [ ] **Step 1: Write the failing test** — append to `tests/test-navigation-session.mjs` (reuse the file's existing `straightRoute()` helper):

```js
// --- Snapshot slimming: no route-geometry duplication ----------------------
{
  const route = straightRoute();
  const session = createNavigationSession(route);
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6, accuracy: 5, timestamp: 1_000 },
  });

  const snap = session.snapshot();
  assert.equal(snap.state.route, null, "snapshot omits the route object");
  assert.equal(snap.state.cameraTransition, null, "snapshot omits camera transitions");

  const restored = createNavigationSession(route, { snapshot: snap });
  assert.equal(restored.getState().route, route, "restore re-injects the live route");
  assert.equal(restored.getState().status, "navigating", "restore keeps status");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL on "snapshot omits the route object" (snapshot currently carries `state.route`).

- [ ] **Step 3: Implement** — in `navigationSession.js`:

Snapshot (route and cameraTransition both embed full route geometry — persisting
them tripled every write):

```js
    snapshot: () => ({
      version: 1,
      state: { ...state, cueEvent: null, route: null, cameraTransition: null },
      tracker: mainTracker.snapshot(),
      mainCueKey,
      wasOffRoute,
      lastConfirmedProgressMeters,
      lastRequestPos,
      connectorRequestAttempt,
      requestSeq,
      cameraTransitionSeq,
      prePauseStatus,
    }),
```

Restore overrides (initial `state` construction) — pre-slimming snapshots on
disk may still carry a stale transition, so override it after the spread:

```js
    ...(restored?.state || {}),
    route: navigationRoute,
    cueEvent: null,
    cameraTransition: null,
  };
```

(`approach.suggestionGeometry` is intentionally retained — the rejoin line must redraw after restore, and connectors are small.)

- [ ] **Step 4: Run the navigation suite**

Run: `node tests/test-navigation-session.mjs && npm run test:navigation-camera`
Expected: all PASS (scenario/replay tests exercise snapshots — if any assert on `snapshot().state.route`, update them to expect `null`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs
git commit -m "perf(nav): slim session snapshots - drop route + cameraTransition duplication

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire throttled persistence into the foreground hook

**Files:**
- Modify: `apps/mobile/src/navigation/useNavigationSession.js:169-190` (the `dispatch` callback)

**Interfaces:**
- Consumes: `shouldPersistNavigationSnapshot` (Task 1).
- Produces: nothing new — `persistCurrent` call sites change only in frequency. This file is native glue (see its NOTE header); no node test.

- [ ] **Step 1: Implement** — add the import and a throttle ref, and gate the per-dispatch persist:

```js
import { shouldPersistNavigationSnapshot } from "@cycleways/core/navigation/persistencePolicy.js";
```

Inside `useNavigationSession`, next to the other refs:

```js
  const lastPersistRef = useRef({ atMs: null, status: null });
```

In `dispatch`, replace:

```js
      if (shouldPersist(next)) void persistCurrent(action?.fix || latestFixRef.current);
```

with:

```js
      if (
        shouldPersist(next) &&
        shouldPersistNavigationSnapshot({
          lastPersistAtMs: lastPersistRef.current.atMs,
          lastStatus: lastPersistRef.current.status,
          status: next.status,
          hasCueEvent: Boolean(next.cueEvent),
          nowMs,
        })
      ) {
        lastPersistRef.current = { atMs: nowMs, status: next.status };
        void persistCurrent(action?.fix || latestFixRef.current);
      }
```

Leave the settings-change effect (`useEffect` on `hapticsEnabled`/`voiceEnabled`/...) and the explicit `pause`/`start` persists untouched — extra persists there are rare and harmless. Also reset the ref when the session is recreated (inside the `[routeId]` effect, next to `lastProcessedFixKeyRef.current = null`):

```js
    lastPersistRef.current = { atMs: null, status: null };
```

- [ ] **Step 2: Run the full nav suite + smoke the flow**

Run: `npm run test:navigation-camera`
Expected: PASS.
Then verify in the dev journey harness (simulator, `npm run mobile:ios`, DevJourneyControls playback): ride a scenario, confirm state persists across a kill/relaunch mid-ride (restore banner/state appears) — persistence still works, just less often.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/navigation/useNavigationSession.js
git commit -m "perf(nav): throttle active-session persistence to transitions, cues, and 10s steady-state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Lock-screen voice — audio background mode

**Files:**
- Modify: `apps/mobile/app.json` (ios.infoPlist.UIBackgroundModes)
- Modify: `apps/mobile/src/navigation/speechAdapter.js:12-26`
- Test: `tests/test-ios-release-config.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: speech audible while the app is backgrounded/locked (needed by Task 18's device protocol).

- [ ] **Step 1: Write the failing test** — append to `tests/test-ios-release-config.mjs` (it already loads `apps/mobile/app.json` into `ios`):

```js
assert.deepEqual(
  ios.infoPlist.UIBackgroundModes,
  ["location", "audio"],
  "navigation needs background location AND background audio (lock-screen voice)",
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-ios-release-config.mjs`
Expected: FAIL — current value is `["location"]`.

- [ ] **Step 3: Implement** — in `apps/mobile/app.json`:

```json
        "UIBackgroundModes": [
          "location",
          "audio"
        ],
```

And in `speechAdapter.js` `configureForNavigationAudio`:

```js
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
      shouldPlayInBackground: true,
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-ios-release-config.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app.json apps/mobile/src/navigation/speechAdapter.js tests/test-ios-release-config.mjs
git commit -m "fix(nav): enable lock-screen voice - audio background mode + background audio session

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Device verification (requires native rebuild)** — after `npx expo prebuild -p ios` (or the next EAS/TestFlight build): start navigation with lock-screen guidance ON, lock the phone, walk/simulate past a cue, confirm the cue is spoken while locked. Record pass/fail in the PR description.

---

### Task 5: Camera auto-refollow (pure session logic)

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js` (USER_PANNED/RECENTER cases, LOCATION handler, snapshot/restore, options)
- Test: `tests/test-navigation-session.mjs`

**Interfaces:**
- Consumes: existing session action flow.
- Produces: `USER_PANNED` accepts `{ timestamp }`; new session option `refollowIdleMs` (default 12000); `cameraIntent` returns to `"follow"` on the first fix ≥ `refollowIdleMs` after the last pan. Task 6 dispatches the timestamp.

- [ ] **Step 1: Write the failing test** — append to `tests/test-navigation-session.mjs`:

```js
// --- Camera auto-refollow after pan idle -----------------------------------
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.6, accuracy: 5, timestamp: 1_000 },
  });

  const panned = session.dispatch({ type: NAV_ACTIONS.USER_PANNED, timestamp: 2_000 });
  assert.equal(panned.cameraIntent, "free", "pan disengages follow");

  const still = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.601, accuracy: 5, timestamp: 8_000 },
  });
  assert.equal(still.cameraIntent, "free", "stays free inside the idle window");

  const refollow = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.602, accuracy: 5, timestamp: 14_100 },
  });
  assert.equal(refollow.cameraIntent, "follow", "12s idle re-engages follow");

  // A fresh pan restarts the clock.
  session.dispatch({ type: NAV_ACTIONS.USER_PANNED, timestamp: 15_000 });
  const freeAgain = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.603, accuracy: 5, timestamp: 20_000 },
  });
  assert.equal(freeAgain.cameraIntent, "free", "new pan restarts the idle clock");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL on "12s idle re-engages follow".

- [ ] **Step 3: Implement** — in `navigationSession.js`:

Option + module state (next to `prePauseStatus`):

```js
  const refollowIdleMs = Number.isFinite(Number(options.refollowIdleMs))
    ? Number(options.refollowIdleMs)
    : 12_000;
  let lastUserPanAt = Number.isFinite(Number(restored?.lastUserPanAt))
    ? Number(restored.lastUserPanAt)
    : null;
```

In the LOCATION case, right after the existing `expiredTransition` block sets
`state = { ...state, latestFix, ... }` (fix-clock, not wall-clock, so dev
journey playback stays coherent):

```js
        if (
          state.cameraIntent === "free" &&
          Number.isFinite(lastUserPanAt) &&
          Number.isFinite(fixTimestamp) &&
          fixTimestamp - lastUserPanAt >= refollowIdleMs
        ) {
          lastUserPanAt = null;
          state = { ...state, cameraIntent: "follow" };
        }
```

Replace the USER_PANNED and RECENTER cases:

```js
      case NAV_ACTIONS.RECENTER:
        lastUserPanAt = null;
        return set({ cameraIntent: "follow" });

      case NAV_ACTIONS.USER_PANNED: {
        const ts = Number(action.timestamp);
        lastUserPanAt = Number.isFinite(ts)
          ? ts
          : Number(state.latestFix?.timestamp) || null;
        return set({ cameraIntent: "free" });
      }
```

Add `lastUserPanAt,` to the `snapshot()` return object.

- [ ] **Step 4: Run tests**

Run: `node tests/test-navigation-session.mjs && npm run test:navigation-camera`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs
git commit -m "feat(nav): auto-refollow camera after 12s pan idle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Gesture wiring for auto-refollow (native glue)

**Files:**
- Modify: `apps/mobile/src/navigation/useNavigationSession.js:473-476` (`userPanned`)
- Modify: `apps/mobile/src/screens/BuildScreen.jsx:2941-2954` (`handleCameraChanged`)

**Interfaces:**
- Consumes: `USER_PANNED` with `{ timestamp }` (Task 5).
- Produces: ongoing gestures keep resetting the session's idle clock (throttled to 1/s).

- [ ] **Step 1: Implement hook side** — `userPanned` passes the fix clock:

```js
  const userPanned = useCallback(
    () =>
      dispatch({
        type: NAV_ACTIONS.USER_PANNED,
        timestamp: latestFixRef.current?.timestamp ?? Date.now(),
      }),
    [dispatch],
  );
```

- [ ] **Step 2: Implement screen side** — in `BuildScreen.jsx`, add a throttle ref next to `navUserPannedRef` and change `handleCameraChanged` so gestures *while already free* also signal (they currently don't, so the idle clock could never be reset by continued panning):

```js
  const lastPanSignalRef = useRef(0);
```

```js
  const handleCameraChanged = useCallback((mapState) => {
    const heading = Number(mapState?.properties?.heading);
    if (Number.isFinite(heading)) mapHeadingRef.current = heading;
    // A user pan/zoom while navigating disengages camera follow so the rider
    // can look around. Every ongoing gesture re-signals (throttled) so the
    // session's auto-refollow idle clock keeps resetting while the rider is
    // actively panning; 12s after the last touch it re-engages by itself.
    if (isNavigatingRef.current && mapState?.gestures?.isGestureActive) {
      const now = Date.now();
      if (
        cameraIntentRef.current === "follow" ||
        now - lastPanSignalRef.current >= 1000
      ) {
        lastPanSignalRef.current = now;
        navUserPannedRef.current?.();
      }
    }
  }, []);
```

- [ ] **Step 3: Verify in the simulator** — `npm run mobile:ios`, run a dev journey scenario: pan the map during navigation (follow disengages, "מרכז" button appears), stop touching, confirm the camera re-engages follow within ~12s of playback time and the button disappears.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/navigation/useNavigationSession.js apps/mobile/src/screens/BuildScreen.jsx
git commit -m "feat(nav): wire gesture stream to auto-refollow idle clock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Compound turn cues ("turn left, then right")

**Files:**
- Modify: `packages/core/src/navigation/navigationCues.js:15-127`
- Modify: `packages/core/src/navigation/navigationVoice.js:73-95` (turn phrase)
- Test: `tests/test-navigation-cues.mjs`, `tests/test-navigation-voice.mjs`

**Interfaces:**
- Consumes: existing cue builder.
- Produces: turn cues may carry `thenDirection: "left"|"right"`; the spacing floor drops to 10 m (pairs 10–60 m apart are kept and linked instead of the second being silently dropped); the enter-segment merge tolerance keeps its own constant `SPAN_MERGE_TOLERANCE_M = 20`.

- [ ] **Step 1: Write the failing cue test** — append to `tests/test-navigation-cues.mjs` (match the file's existing geometry-fixture style; build a route with two 90° turns ~40 m apart, e.g. an S: east 200 m, north 40 m, east 200 m — at lat 33, 0.00043° lng ≈ 40 m):

```js
// --- Compound turns: close pairs are linked, not dropped --------------------
{
  const route = {
    geometry: buildNavigationGeometry([
      { lat: 33.0, lng: 35.0 },
      { lat: 33.0, lng: 35.002 },      // ~186m east
      { lat: 33.00036, lng: 35.002 },  // ~40m north (left turn)
      { lat: 33.00036, lng: 35.004 },  // east again (right turn)
    ]),
  };
  const cues = buildRouteCues(route);
  const turns = cues.filter((c) => c.type === "turn");
  assert.equal(turns.length, 2, "both turns of a close pair survive");
  assert.equal(turns[0].direction, "left");
  assert.equal(turns[0].thenDirection, "right", "first turn links the follow-up");
  assert.equal(turns[1].thenDirection, undefined, "last turn links nothing");
}
```

(Import `buildNavigationGeometry` from `@cycleways/core/navigation/navigationRoute.js` if the test file doesn't already.)

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-navigation-cues.mjs`
Expected: FAIL — today the second turn is dropped (`turns.length` is 1) because it is within the 20 m spacing floor... if the fixture yields >20 m spacing, it fails on missing `thenDirection` instead. Either failure is the right starting point.

- [ ] **Step 3: Implement the cue builder** — in `navigationCues.js`, replace the constants:

```js
const MIN_TURN_SPACING_M = 10; // hard drop below this: geometry noise
const COMPOUND_TURN_WINDOW_M = 60; // link close turn pairs: "turn left, then right"
const SPAN_MERGE_TOLERANCE_M = 20; // merge an enter-segment into a turn this close
```

Replace the corner loop's direct `cues.push(...)` with a local list plus a linking pass (loop body otherwise unchanged):

```js
  const cornerCues = [];
  let lastTurnDistance = -Infinity;
  for (let i = 1; i < geometry.length - 1; i++) {
    // ... existing bearing/angle/junction logic unchanged ...
    const distanceMeters = geometry[i].distanceFromStartMeters;
    if (distanceMeters - lastTurnDistance < MIN_TURN_SPACING_M) continue;
    lastTurnDistance = distanceMeters;
    cornerCues.push({
      type,
      distanceMeters,
      direction: turn > 0 ? "right" : "left",
      turnAngleDeg: angle,
    });
  }
  // Close turn pairs get a compound instruction instead of the second turn
  // being a surprise (or, worse, silently dropped).
  for (let i = 0; i < cornerCues.length - 1; i++) {
    const current = cornerCues[i];
    const next = cornerCues[i + 1];
    if (
      current.type === "turn" &&
      next.type === "turn" &&
      next.distanceMeters - current.distanceMeters <= COMPOUND_TURN_WINDOW_M
    ) {
      current.thenDirection = next.direction;
    }
  }
  cues.push(...cornerCues);
```

Update the enter-segment merge to use the new constant:

```js
    const near = turnCues.find(
      (t) => Math.abs(t.distanceMeters - span.startMeters) <= SPAN_MERGE_TOLERANCE_M,
    );
```

- [ ] **Step 4: Write the failing voice test** — append to `tests/test-navigation-voice.mjs`:

```js
// --- Compound turn phrase ---------------------------------------------------
{
  const planner = createNavigationVoicePlanner();
  const compound = planner.plan(
    {
      kind: "cue",
      cueType: "turn",
      phase: "final",
      cue: { type: "turn", direction: "left", thenDirection: "right", distanceMeters: 800 },
    },
    {},
    1000,
  ).utterance;
  assert.ok(compound, "compound turn speaks");
  assert.match(compound.text, /פנה שמאלה ומיד ימינה/);
}
```

- [ ] **Step 5: Implement the phrase** — in `navigationVoice.js`, replace the `case "turn":` return with:

```js
    case "turn": {
      const then = cue.thenDirection
        ? locale === "he-IL"
          ? ` ומיד ${directionText(cue.thenDirection, locale)}`
          : `, then ${directionText(cue.thenDirection, locale)}`
        : "";
      return locale === "he-IL"
        ? `${prefix}פנה ${directionText(cue.direction, locale)}${then}`
        : `${prefix}turn ${directionText(cue.direction, locale)}${then}`;
    }
```

- [ ] **Step 6: Run tests**

Run: `node tests/test-navigation-cues.mjs && node tests/test-navigation-voice.mjs && npm run test:navigation-camera`
Expected: PASS (scenario expectation tests may assert cue counts on fixtures with close pairs — update expectations only where the new linked cue is genuinely correct).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/navigation/navigationCues.js packages/core/src/navigation/navigationVoice.js tests/test-navigation-cues.mjs tests/test-navigation-voice.mjs
git commit -m "feat(nav): compound turn cues - close pairs speak 'turn left, then right'

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Speak segment names (turn-merge + enter-segment)

**Files:**
- Modify: `packages/core/src/navigation/navigationVoice.js` (turn phrase, enter-segment phrase, planner name-dedupe, snapshot/reset memory)
- Test: `tests/test-navigation-voice.mjs`

**Interfaces:**
- Consumes: cue fields that already exist: `cue.ontoSegmentName` (merged turns), `cue.segmentName` (enter-segment cues).
- Produces: spoken names; planner memory gains `lastSegmentNameSpoken` (persisted via `snapshot()`, restored via `memory`).

- [ ] **Step 1: Write the failing tests** — append to `tests/test-navigation-voice.mjs`:

```js
// --- Segment names ----------------------------------------------------------
{
  const planner = createNavigationVoicePlanner();
  const turnOnto = planner.plan(
    {
      kind: "cue",
      cueType: "turn",
      phase: "final",
      cue: { type: "turn", direction: "right", ontoSegmentName: "גשר הירדן", distanceMeters: 900 },
    },
    {},
    1000,
  ).utterance;
  assert.ok(turnOnto, "merged turn speaks");
  assert.match(turnOnto.text, /פנה ימינה אל גשר הירדן/);

  const enter = planner.plan(
    {
      kind: "cue",
      cueType: "enter-segment",
      phase: "final",
      cue: { type: "enter-segment", segmentName: "שביל סובב כנרת", distanceMeters: 1500 },
    },
    {},
    5000,
  ).utterance;
  assert.ok(enter, "enter-segment final speaks");
  assert.match(enter.text, /ממשיכים על שביל סובב כנרת/);

  const enterPreview = planner.plan(
    {
      kind: "cue",
      cueType: "enter-segment",
      phase: "preview",
      cue: { type: "enter-segment", segmentName: "שביל אחר", distanceMeters: 2000 },
    },
    {},
    9000,
  );
  assert.equal(enterPreview.utterance, null, "enter-segment preview is silent");

  const repeat = planner.plan(
    {
      kind: "cue",
      cueType: "enter-segment",
      phase: "final",
      cue: { type: "enter-segment", segmentName: "שביל סובב כנרת", distanceMeters: 2500 },
    },
    {},
    20_000,
  );
  assert.equal(repeat.utterance, null, "same segment name is not repeated");
  assert.equal(repeat.reason, "same-segment");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-navigation-voice.mjs`
Expected: FAIL — merged-turn text has no name, enter-segment returns `no-phrase`.

- [ ] **Step 3: Implement** — in `navigationVoice.js`:

Extend the turn phrase from Task 7 with the name (name before the compound suffix):

```js
    case "turn": {
      const onto = cue.ontoSegmentName
        ? locale === "he-IL"
          ? ` אל ${cue.ontoSegmentName}`
          : ` onto ${cue.ontoSegmentName}`
        : "";
      const then = cue.thenDirection
        ? locale === "he-IL"
          ? ` ומיד ${directionText(cue.thenDirection, locale)}`
          : `, then ${directionText(cue.thenDirection, locale)}`
        : "";
      return locale === "he-IL"
        ? `${prefix}פנה ${directionText(cue.direction, locale)}${onto}${then}`
        : `${prefix}turn ${directionText(cue.direction, locale)}${onto}${then}`;
    }
```

Add the enter-segment case to the same switch:

```js
    case "enter-segment":
      if (event.phase !== "final" || !cue.segmentName) return null;
      return locale === "he-IL"
        ? `ממשיכים על ${cue.segmentName}`
        : `Continuing on ${cue.segmentName}`;
```

In `createNavigationVoicePlanner`, add name memory next to `lastUtterance`:

```js
  let lastSegmentNameSpoken = memory?.lastSegmentNameSpoken || null;
```

In `plan()`, after the `spokenIds` duplicate check and before phrase building:

```js
    if (
      cueEvent.kind === "cue" &&
      cueEvent.cue?.type === "enter-segment" &&
      cueEvent.cue.segmentName &&
      cueEvent.cue.segmentName === lastSegmentNameSpoken
    ) {
      return { utterance: null, reason: "same-segment" };
    }
```

After the utterance is accepted (next to `lastUtterance = utterance;`):

```js
    const spokenName =
      cueEvent.cue?.ontoSegmentName ||
      (cueEvent.cue?.type === "enter-segment" ? cueEvent.cue.segmentName : null);
    if (spokenName) lastSegmentNameSpoken = spokenName;
```

Add `lastSegmentNameSpoken,` to `snapshot()`, and to `reset()`:

```js
    lastSegmentNameSpoken = nextMemory?.lastSegmentNameSpoken || null;
```

- [ ] **Step 4: Run tests**

Run: `node tests/test-navigation-voice.mjs && npm run test:navigation-camera`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationVoice.js tests/test-navigation-voice.mjs
git commit -m "feat(nav): speak segment names on merged turns and enter-segment cues

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Wrong-way voice event

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js` (on-route LOCATION branch, snapshot)
- Modify: `packages/core/src/navigation/navigationVoice.js` (phrase, id, priority, repeatable)
- Test: `tests/test-navigation-session.mjs`, `tests/test-navigation-voice.mjs`

**Interfaces:**
- Consumes: `progress.wrongWay` (already produced by `routeProgress.js`).
- Produces: `cueEvent: { kind: "wrong-way" }` on the rising edge; spoken at alert priority. Session snapshot gains `wasWrongWay`.

- [ ] **Step 1: Write the failing voice test** — append to `tests/test-navigation-voice.mjs`:

```js
// --- Wrong-way --------------------------------------------------------------
{
  const planner = createNavigationVoicePlanner();
  const warn = planner.plan({ kind: "wrong-way" }, {}, 1000).utterance;
  assert.ok(warn, "wrong-way speaks");
  assert.match(warn.text, /נגד כיוון המסלול/);
  assert.equal(warn.interruptsCurrentSpeech, true, "alert priority interrupts");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-navigation-voice.mjs`
Expected: FAIL with reason `unsupported-event`.

- [ ] **Step 3: Implement voice side** — in `navigationVoice.js`:

In `cuePhrase`, before the `if (event.kind !== "cue")` guard:

```js
  if (event.kind === "wrong-way") {
    return locale === "he-IL"
      ? "אתה רוכב נגד כיוון המסלול"
      : "You are riding against the route direction.";
  }
```

In `utteranceIdFor`: `if (event.kind === "wrong-way") return "state:wrong-way";`
In `priorityFor`: `if (event.kind === "wrong-way") return PRIORITY.alert;`
In `isRepeatableStateEvent`: add `|| event?.kind === "wrong-way"`.

- [ ] **Step 4: Write the failing session test** — append to `tests/test-navigation-session.mjs`. The wrong-way detector needs a sustained reversed course (see `WRONG_WAY_*` constants in `routeProgress.js` — acquisition grace, then sustained disagreement), so acquire mid-route and feed fixes moving backward along `straightRoute()`; use `options` to shrink the grace if the defaults make the fixture unwieldy (check the constants and any existing wrong-way coverage in `tests/test-route-progress.mjs` for a reusable fix sequence):

```js
// --- Wrong-way rising edge emits one voice event ----------------------------
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  // Acquire near the middle, then ride backward (west) at speed.
  let state = session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.606, accuracy: 5, speed: 5, timestamp: 0 },
  });
  const events = [];
  for (let i = 1; i <= 60; i++) {
    state = session.dispatch({
      type: NAV_ACTIONS.LOCATION,
      fix: {
        lat: 33.1,
        lng: 35.606 - i * 0.00005, // ~4.7m west per second
        accuracy: 5,
        speed: 5,
        heading: 270,
        timestamp: i * 1000,
      },
    });
    if (state.cueEvent?.kind === "wrong-way") events.push(i);
    if (state.status !== "navigating") break; // stop once off-route takes over
  }
  assert.equal(events.length, 1, "wrong-way announced exactly once per episode");
}
```

- [ ] **Step 5: Implement session side** — in `navigationSession.js`:

Module state (next to `wasOffRoute`):

```js
  let wasWrongWay = restored?.wasWrongWay === true;
```

In the on-route branch (after `const activeCue = selectActiveCue(...)`), extend the cueEvent selection — acquisition events win, then wrong-way, then regular cues:

```js
        const wrongWayNow = mainProgress.wrongWay === true;
        const wrongWayStarted = wrongWayNow && !wasWrongWay;
        wasWrongWay = wrongWayNow;
        const cueEvent = recoveredFromOffRoute
          ? { kind: "acquired", acquisition: "reacquired" }
          : joinedFromOwnedApproach
          ? { kind: "acquired", acquisition: "join-route" }
          : enteredEffectiveRoute
          ? { kind: "acquired", acquisition: "initial" }
          : wrongWayStarted
          ? { kind: "wrong-way" }
          : cueFor(activeCue);
```

Reset `wasWrongWay = false;` in the PERMISSION_GRANTED case (next to `wasOffRoute = false;`), and add `wasWrongWay,` to `snapshot()`.

- [ ] **Step 6: Run tests**

Run: `node tests/test-navigation-session.mjs && node tests/test-navigation-voice.mjs && npm run test:navigation-camera`
Expected: PASS. If the fixture never trips the detector, dump `state.progress.wrongWay` per fix and adjust the backward speed/duration against `WRONG_WAY_CONFIRM_MS` — don't loosen the assertion.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js packages/core/src/navigation/navigationVoice.js tests/test-navigation-session.mjs tests/test-navigation-voice.mjs
git commit -m "feat(nav): announce wrong-way riding once per episode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Voiced rejoin guidance (with compass helper)

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js` (rejoin CONNECTOR_READY branch, off-route entry, snapshot)
- Modify: `packages/core/src/navigation/navigationVoice.js` (compassWord export, phrase, id, priority, repeatable)
- Test: `tests/test-navigation-voice.mjs`, `tests/test-navigation-session.mjs`

**Interfaces:**
- Consumes: rejoin connector results (already computed), `state.latestFix`, `state.approach.target.point`.
- Produces: `compassWord(bearingDeg, locale) -> string|null` (exported; reused by Task 11); `cueEvent: { kind: "rejoin-ready", distanceMeters, bearingDeg }` — at most once per off-route episode. Session snapshot gains `rejoinAnnounced`.

- [ ] **Step 1: Write the failing voice test** — append to `tests/test-navigation-voice.mjs`:

```js
// --- Rejoin guidance + compass ----------------------------------------------
import { compassWord } from "@cycleways/core/navigation/navigationVoice.js";

assert.equal(compassWord(0, "he-IL"), "צפונה");
assert.equal(compassWord(90, "he-IL"), "מזרחה");
assert.equal(compassWord(225, "he-IL"), "דרום-מערבה");
assert.equal(compassWord(359, "he-IL"), "צפונה");
assert.equal(compassWord(90, "en-US"), "east");
assert.equal(compassWord(null, "he-IL"), null);

{
  const planner = createNavigationVoicePlanner();
  const rejoin = planner.plan(
    { kind: "rejoin-ready", distanceMeters: 52, bearingDeg: 10 },
    {},
    1000,
  ).utterance;
  assert.ok(rejoin, "rejoin-ready speaks");
  assert.match(rejoin.text, /המסלול צפונה מכאן/);
  assert.match(rejoin.text, /50 מטר/);
  assert.match(rejoin.text, /עקוב אחרי הקו המסומן/);
}
```

(Hoist the `compassWord` import to the top of the test file with the existing import.)

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-navigation-voice.mjs`
Expected: FAIL — no `compassWord` export.

- [ ] **Step 3: Implement voice side** — in `navigationVoice.js`:

```js
export function compassWord(bearingDeg, locale = DEFAULT_LANGUAGE) {
  const bearing = Number(bearingDeg);
  if (!Number.isFinite(bearing)) return null;
  const names =
    locale === "he-IL"
      ? ["צפונה", "צפון-מזרחה", "מזרחה", "דרום-מזרחה", "דרומה", "דרום-מערבה", "מערבה", "צפון-מערבה"]
      : ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  return names[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}
```

In `cuePhrase`, next to the wrong-way branch:

```js
  if (event.kind === "rejoin-ready") {
    const direction = compassWord(event.bearingDeg, locale);
    const distanceText = formatSpeechDistanceMeters(event.distanceMeters, locale);
    if (locale === "he-IL") {
      const where = direction ? `המסלול ${direction} מכאן` : "המסלול קרוב";
      const dist = distanceText ? `, במרחק כ-${distanceText}` : "";
      return `${where}${dist}. עקוב אחרי הקו המסומן`;
    }
    const where = direction ? `The route is ${direction} of you` : "The route is nearby";
    const dist = distanceText ? `, about ${distanceText} away` : "";
    return `${where}${dist}. Follow the marked line.`;
  }
```

In `utteranceIdFor`: `if (event.kind === "rejoin-ready") return "state:rejoin-ready";`
In `priorityFor`: `if (event.kind === "rejoin-ready") return PRIORITY.info;`
In `isRepeatableStateEvent`: add `|| event?.kind === "rejoin-ready"`.

- [ ] **Step 4: Implement session side** — in `navigationSession.js`:

Import (top of file, next to `getDistance`): `import { computeBearing } from "../utils/geometry.js";`

Module state (next to `wasOffRoute`): `let rejoinAnnounced = restored?.rejoinAnnounced === true;`

In the off-route LOCATION branch, on first entry (where `firstOffRoute` is computed): add `if (firstOffRoute) rejoinAnnounced = false;`
In the on-route (reacquire) branch, next to `wasOffRoute = false;`: add `rejoinAnnounced = false;`
Reset in PERMISSION_GRANTED next to the other resets: `rejoinAnnounced = false;`

In the CONNECTOR_READY case, the final (non-`start` targetMode) `return set({...})` — this is the rejoin/approach-refresh path — add a cueEvent when this is the first ready rejoin of the episode. Before that `return set(...)`:

```js
        let rejoinCueEvent = null;
        if (
          state.status === "off-route" &&
          state.routeRequest?.targetMode === "rejoin" &&
          !rejoinAnnounced
        ) {
          rejoinAnnounced = true;
          rejoinCueEvent = {
            kind: "rejoin-ready",
            distanceMeters:
              Number.isFinite(distanceMeters) && distanceMeters > 0
                ? distanceMeters
                : null,
            bearingDeg:
              state.latestFix && state.approach.target?.point
                ? computeBearing(state.latestFix, state.approach.target.point)
                : null,
          };
        }
```

and include `cueEvent: rejoinCueEvent,` in that `set({...})` object.

Add `rejoinAnnounced,` to `snapshot()`.

- [ ] **Step 5: Write the failing session test** — append to `tests/test-navigation-session.mjs` (drive off-route until a rejoin request appears, answer it, assert one event):

```js
// --- Rejoin-ready announced once per off-route episode ----------------------
{
  const session = createNavigationSession(straightRoute());
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  session.dispatch({
    type: NAV_ACTIONS.LOCATION,
    fix: { lat: 33.1, lng: 35.605, accuracy: 5, timestamp: 0 },
  });
  // Ride away from the route until off-route triggers a rejoin request.
  let state = null;
  for (let i = 1; i <= 20 && !state?.routeRequest; i++) {
    state = session.dispatch({
      type: NAV_ACTIONS.LOCATION,
      fix: { lat: 33.1 + i * 0.0001, lng: 35.605, accuracy: 5, timestamp: i * 1000 },
    });
  }
  assert.equal(state.status, "off-route", "moved off-route");
  assert.ok(state.routeRequest, "rejoin connector requested");
  assert.equal(state.routeRequest.targetMode, "rejoin");

  const ready = session.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: state.routeRequest.requestId,
    geometry: [
      { lat: state.latestFix.lat, lng: state.latestFix.lng },
      { lat: 33.1, lng: 35.605 },
    ],
    distanceMeters: 120,
  });
  assert.equal(ready.cueEvent?.kind, "rejoin-ready", "first ready rejoin announces");
  assert.ok(Number.isFinite(ready.cueEvent.bearingDeg), "bearing included");

  // A refreshed rejoin later in the same episode stays silent.
  let refresh = null;
  for (let i = 21; i <= 60 && !refresh?.routeRequest; i++) {
    refresh = session.dispatch({
      type: NAV_ACTIONS.LOCATION,
      fix: { lat: 33.1 + i * 0.0001, lng: 35.605, accuracy: 5, timestamp: i * 1000 },
    });
  }
  if (refresh?.routeRequest) {
    const again = session.dispatch({
      type: NAV_ACTIONS.CONNECTOR_READY,
      requestId: refresh.routeRequest.requestId,
      geometry: [
        { lat: refresh.latestFix.lat, lng: refresh.latestFix.lng },
        { lat: 33.1, lng: 35.605 },
      ],
      distanceMeters: 300,
    });
    assert.equal(again.cueEvent, null, "refresh does not re-announce");
  }
}
```

- [ ] **Step 6: Run tests**

Run: `node tests/test-navigation-session.mjs && node tests/test-navigation-voice.mjs && npm run test:navigation-camera`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js packages/core/src/navigation/navigationVoice.js tests/test-navigation-session.mjs tests/test-navigation-voice.mjs
git commit -m "feat(nav): voice the rejoin suggestion with compass direction and distance

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Compass direction in acquisition phrases

**Files:**
- Modify: `packages/core/src/navigation/navigationVoice.js:42-56` (acquired phrases)
- Test: `tests/test-navigation-voice.mjs`

**Interfaces:**
- Consumes: `compassWord` (Task 10), `state.progress.bearingToNextDeg` (already produced).
- Produces: direction-suffixed acquisition phrases; silent no-op when bearing is unavailable.

- [ ] **Step 1: Write the failing test** — append to `tests/test-navigation-voice.mjs`:

```js
// --- Acquisition phrases carry the ride direction ---------------------------
{
  const planner = createNavigationVoicePlanner();
  const withBearing = planner.plan(
    { kind: "acquired", acquisition: "join-route" },
    { progress: { bearingToNextDeg: 180 } },
    1000,
  ).utterance;
  assert.ok(withBearing);
  assert.match(withBearing.text, /דרומה/);

  const planner2 = createNavigationVoicePlanner();
  const noBearing = planner2.plan(
    { kind: "acquired", acquisition: "join-route" },
    {},
    1000,
  ).utterance;
  assert.ok(noBearing, "still speaks without a bearing");
  assert.doesNotMatch(noBearing.text, /undefined|null/);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-navigation-voice.mjs`
Expected: FAIL — no "דרומה" in the join-route phrase.

- [ ] **Step 3: Implement** — in `cuePhrase`'s `acquired` branch:

```js
  if (event.kind === "acquired") {
    const direction = compassWord(state?.progress?.bearingToNextDeg, locale);
    if (event.acquisition === "join-route") {
      return locale === "he-IL"
        ? `הגעת למסלול, הניווט במסלול מתחיל${direction ? `, ממשיכים ${direction}` : ""}`
        : `You reached the route. Route navigation starts now${direction ? `, heading ${direction}` : ""}.`;
    }
    if (event.acquisition === "reacquired") {
      return locale === "he-IL"
        ? `חזרנו למסלול, ממשיכים בניווט${direction ? ` ${direction}` : ""}`
        : `Back on route. Continuing navigation${direction ? `, heading ${direction}` : ""}.`;
    }
    return locale === "he-IL"
      ? `הַכֹּל מוּכָן, יוֹצְאִים לַדֶּרֶךְ${direction ? ` ${direction}` : ""}. רִכְבוּ בִּזְהִירוּת`
      : `All set. Let's ride${direction ? `, heading ${direction}` : ""}. Ride safely.`;
  }
```

- [ ] **Step 4: Run tests**

Run: `node tests/test-navigation-voice.mjs && npm run test:navigation-camera`
Expected: PASS (existing acquisition-phrase assertions use `assert.match` on stable substrings; adjust any exact-equality assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationVoice.js tests/test-navigation-voice.mjs
git commit -m "feat(nav): speak the compass direction on route acquisition

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Stop voicing bend cues

**Files:**
- Modify: `packages/core/src/navigation/navigationVoice.js` (`case "bend"`)
- Test: `tests/test-navigation-voice.mjs`

**Interfaces:**
- Consumes/Produces: bend cues remain in the cue list (visual card + haptics untouched); voice returns `no-phrase`.

- [ ] **Step 1: Update/write the test** — search `tests/test-navigation-voice.mjs` for the existing bend assertion (`עיקול`) and replace it with:

```js
// Bends are visual/haptic only — the road curving is not a decision.
{
  const planner = createNavigationVoicePlanner();
  const bend = planner.plan(
    {
      kind: "cue",
      cueType: "bend",
      phase: "final",
      cue: { type: "bend", direction: "left", distanceMeters: 400 },
    },
    {},
    1000,
  );
  assert.equal(bend.utterance, null, "bend cues are silent");
  assert.equal(bend.reason, "no-phrase");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-navigation-voice.mjs`
Expected: FAIL — bends currently speak at final phase.

- [ ] **Step 3: Implement** — replace the `case "bend":` body:

```js
    case "bend":
      // Visual + haptic only (design D5): a curve the road forces isn't a
      // decision, and voicing it on twisty park paths reads as spam.
      return null;
```

- [ ] **Step 4: Run tests**

Run: `node tests/test-navigation-voice.mjs && npm run test:navigation-camera`
Expected: PASS (update any scenario expectation that counted a bend utterance).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationVoice.js tests/test-navigation-voice.mjs
git commit -m "feat(nav): mute bend cues - visual and haptic only

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Pure junction-derivation helper + script refactor

**Files:**
- Create: `packages/core/src/routing/junctionsNearRoute.js`
- Modify: `scripts/nav-scenario-route-snapshot.mjs:44-86` (use the helper)
- Test: `tests/test-junctions-near-route.mjs`
- Modify: `package.json` (append test to the `"test"` chain)

**Interfaces:**
- Consumes: network shape `{ nodes: [{ id, coord: [lng, lat] }], edges: [{ id, from, to }] }` — the shape `decodeCompactBaseRoutingShard` / `mergeBaseRoutingShards` produce (verify against `tests/test-base-routing-network.mjs` fixtures before coding; if the indexed network's shape differs, adapt the accessor here, in one place).
- Produces: `junctionsNearRoute(network, routeGeometry, { maxDistanceMeters = 50 }) -> [{ lat, lng }]`, used by Task 14 and the snapshot script.

- [ ] **Step 1: Write the failing test**

```js
// tests/test-junctions-near-route.mjs
import assert from "node:assert/strict";
import { junctionsNearRoute } from "@cycleways/core/routing/junctionsNearRoute.js";

// Route running east along lat 33.0.
const route = [];
for (let i = 0; i <= 20; i++) route.push({ lat: 33.0, lng: 35.0 + i * 0.0005 });

const network = {
  nodes: [
    { id: "j3-near", coord: [35.002, 33.0002] },   // ~22m from the route, degree 3
    { id: "j2-near", coord: [35.003, 33.0002] },   // near but degree 2
    { id: "j3-far", coord: [35.004, 33.01] },      // degree 3 but ~1.1km away
    { id: "dup", coord: [35.005, 33.0001] },       // degree looks 4 but is 2 after id-dedupe
    { id: "x1", coord: [35.0, 33.1] },
    { id: "x2", coord: [35.1, 33.1] },
  ],
  edges: [
    { id: "e1", from: "j3-near", to: "x1" },
    { id: "e2", from: "j3-near", to: "x2" },
    { id: "e3", from: "j3-near", to: "j2-near" },
    { id: "e4", from: "j2-near", to: "x1" },
    { id: "e5", from: "j3-far", to: "x1" },
    { id: "e6", from: "j3-far", to: "x2" },
    { id: "e7", from: "j3-far", to: "j2-near" },
    // Same edge duplicated across shard boundaries must not inflate degree.
    { id: "e8", from: "dup", to: "x1" },
    { id: "e8", from: "dup", to: "x1" },
    { id: "e9", from: "dup", to: "x2" },
  ],
};

const junctions = junctionsNearRoute(network, route);
assert.equal(junctions.length, 1, "only the near degree-3 node qualifies");
assert.ok(Math.abs(junctions[0].lng - 35.002) < 1e-9);

assert.deepEqual(junctionsNearRoute(null, route), [], "no network -> empty");
assert.deepEqual(junctionsNearRoute(network, []), [], "no route -> empty");

console.log("test-junctions-near-route ok");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-junctions-near-route.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement** — cell-indexed so it's fast on-device (the naive route-points × candidate-nodes scan in the snapshot script is fine offline but not on a phone):

```js
// packages/core/src/routing/junctionsNearRoute.js
// Network junctions (nodes referenced by 3+ distinct edges) within
// maxDistanceMeters of a route geometry. Feeds junction-gated turn cues
// (navigationCues.js): corner at a junction = turn, sharp open-road corner =
// bend, moderate curve = silence. Shared by the app (via ShardedRouteSession)
// and the scenario snapshot script.
import { getDistance } from "../utils/distance.js";

const DEFAULT_MAX_DISTANCE_M = 50;
// ~100m cells at Israel latitudes; must stay > maxDistanceMeters so a node
// within range of a route point is never more than one cell away.
const CELL_DEG = 0.001;

function cellKey(latCell, lngCell) {
  return `${latCell}:${lngCell}`;
}

export function junctionsNearRoute(
  network,
  routeGeometry,
  { maxDistanceMeters = DEFAULT_MAX_DISTANCE_M } = {},
) {
  const nodes = Array.isArray(network?.nodes) ? network.nodes : [];
  const edges = Array.isArray(network?.edges) ? network.edges : [];
  const geometry = Array.isArray(routeGeometry) ? routeGeometry : [];
  if (nodes.length === 0 || edges.length === 0 || geometry.length === 0) {
    return [];
  }

  const cells = new Map();
  for (const point of geometry) {
    const key = cellKey(Math.round(point.lat / CELL_DEG), Math.round(point.lng / CELL_DEG));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(point);
  }

  // Edges are duplicated across shard boundaries — dedupe by id before
  // counting degree, or boundary nodes read as junctions.
  const nodeEdges = new Map();
  for (const edge of edges) {
    for (const nodeId of [edge.from, edge.to]) {
      if (!nodeEdges.has(nodeId)) nodeEdges.set(nodeId, new Set());
      nodeEdges.get(nodeId).add(edge.id);
    }
  }

  const junctions = [];
  for (const node of nodes) {
    if ((nodeEdges.get(node.id)?.size ?? 0) < 3) continue;
    const point = { lat: node.coord[1], lng: node.coord[0] };
    const latCell = Math.round(point.lat / CELL_DEG);
    const lngCell = Math.round(point.lng / CELL_DEG);
    let near = false;
    for (let dLat = -1; dLat <= 1 && !near; dLat++) {
      for (let dLng = -1; dLng <= 1 && !near; dLng++) {
        const bucket = cells.get(cellKey(latCell + dLat, lngCell + dLng));
        if (!bucket) continue;
        near = bucket.some((p) => getDistance(p, point) <= maxDistanceMeters);
      }
    }
    if (near) junctions.push({ lat: point.lat, lng: point.lng });
  }
  return junctions;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-junctions-near-route.mjs`
Expected: `test-junctions-near-route ok`.

- [ ] **Step 5: Refactor the snapshot script** — in `scripts/nav-scenario-route-snapshot.mjs`, keep the shard loading/bbox filtering, but accumulate `nodes`/`edges` arrays and delegate:

```js
import { junctionsNearRoute } from "../packages/core/src/routing/junctionsNearRoute.js";
```

Replace the local `junctionsNearRoute(routeGeometry)` function body's degree/distance logic: after the shard loop, instead of the `nodeEdges` / `junctions` blocks, build `const nodes = []; const edges = [];` inside the loop (`nodes.push(...shard.nodes); edges.push(...shard.edges);`) and end with:

```js
  return junctionsNearRoute({ nodes, edges }, routeGeometry).map((j) => ({
    lat: Math.round(j.lat * 1e5) / 1e5,
    lng: Math.round(j.lng * 1e5) / 1e5,
  }));
```

Verify: `node scripts/nav-scenario-route-snapshot.mjs sovev-beit-hillel` and `git diff packages/core/src/navigation/scenarios/routes/sovev-beit-hillel.js` — the junction list must be unchanged (except the regenerated date header). Revert the fixture file after checking: `git checkout -- packages/core/src/navigation/scenarios/routes/`.

- [ ] **Step 6: Append `node tests/test-junctions-near-route.mjs` to the `"test"` chain in `package.json`, then commit**

```bash
git add packages/core/src/routing/junctionsNearRoute.js scripts/nav-scenario-route-snapshot.mjs tests/test-junctions-near-route.mjs package.json
git commit -m "feat(routing): extract cell-indexed junctionsNearRoute helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Expose junction computation to the app

**Files:**
- Modify: `packages/core/src/routing/shardedRouteSession.js` (new method)
- Modify: `packages/core/src/app/useCyclewaysApp.js:130-140` and the return object (~line 1286)
- Test: `tests/test-compute-connector.mjs` (extend — it already builds real sharded sessions from fixtures)

**Interfaces:**
- Consumes: `junctionsNearRoute` (Task 13), `this.ensureCoverage(points)`, `this.indexedNetwork()`.
- Produces: `session.junctionsNearRoute(geometry) -> Promise<[{lat,lng}]|null>`; `computeRouteJunctions(geometry)` exported from `useCyclewaysApp` (same session-access pattern as the adjacent `computeConnector`). Task 15 consumes `computeRouteJunctions`.

- [ ] **Step 1: Write the failing test** — `tests/test-compute-connector.mjs` builds a module-scope `session` from two synthetic shards (`west`/`east` around lat 33, lng 35–35.002). Append at the end of the file:

```js
// --- junctionsNearRoute over the loaded network -----------------------------
{
  const junctions = await session.junctionsNearRoute([
    { lat: 33.00001, lng: 35.0001 },
    { lat: 33.00001, lng: 35.0019 },
  ]);
  assert.ok(Array.isArray(junctions), "junctions computed over loaded shards");
  // The fixture network has no degree-3 node, so the list is empty — the
  // helper's junction logic is covered by tests/test-junctions-near-route.mjs.
  assert.equal(junctions.length, 0);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-compute-connector.mjs`
Expected: FAIL — `session.junctionsNearRoute is not a function`.

- [ ] **Step 3: Implement session method** — in `shardedRouteSession.js` (import the helper at top):

```js
import { junctionsNearRoute } from "./junctionsNearRoute.js";
```

```js
  // Junctions near a route geometry, for junction-gated turn cues. Coverage
  // is best-effort: on a load failure we still compute over whatever network
  // is already loaded (null junctions would mean legacy all-corners cues).
  async junctionsNearRoute(geometry, options = {}) {
    const points = Array.isArray(geometry) ? geometry : [];
    if (points.length === 0) return null;
    try {
      await this.ensureCoverage(points);
    } catch {
      // fall through — compute over the currently loaded network
    }
    const network = this.indexedNetwork();
    if (!network) return null;
    return junctionsNearRoute(network, points, options);
  }
```

**Shape check:** `indexedNetwork()` returns `this.manager.baseRoutingNetwork`. Confirm its `nodes`/`edges` element shape matches Task 13's contract (`node.coord` array, `edge.id/from/to`) by inspecting `mergeBaseRoutingShards` and the fixtures in `tests/test-base-routing-network.mjs`. If node coords live elsewhere (e.g. `node.lat/lng`), adapt **`junctionsNearRoute`'s accessor** (one place) and its test, not the callers.

- [ ] **Step 4: Implement app hook** — in `useCyclewaysApp.js`, directly below `computeConnector` (line ~134, which reads `shardedRouteSessionRef.current`):

```js
  const computeRouteJunctions = useCallback(async (geometry) => {
    const session = shardedRouteSessionRef.current;
    if (typeof session?.junctionsNearRoute === "function") {
      return session.junctionsNearRoute(geometry);
    }
    return null;
  }, []);
```

Add `computeRouteJunctions,` to the hook's return object next to `computeConnector` (~line 1286).

- [ ] **Step 5: Run tests**

Run: `node tests/test-compute-connector.mjs && npm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/routing/shardedRouteSession.js packages/core/src/app/useCyclewaysApp.js tests/test-compute-connector.mjs
git commit -m "feat(routing): expose route-junction computation through the sharded session

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Attach junctions to real rides

**Files:**
- Modify: `packages/core/src/navigation/effectiveNavigationRoute.js` (`reverseNavigationRoute` ~line 110, `buildEffectiveNavigationRoute` return paths ~lines 254-390)
- Modify: `apps/mobile/src/screens/BuildScreen.jsx:1377-1407` (`confirmRidePlan`)
- Test: `tests/test-effective-navigation-route.mjs`

**Interfaces:**
- Consumes: `computeRouteJunctions` (Task 14) — check how `computeConnector` reaches `BuildScreen` (props/context from `useCyclewaysApp`) and plumb `computeRouteJunctions` identically.
- Produces: `confirmedRidePlan.effectiveRoute.junctions` populated **before** `setConfirmedRidePlan`, so `useNavigationSession` (keyed on route id) builds junction-gated cues from the first session. Timeout/failure ⇒ `junctions: null` (legacy cues) — ride start is never blocked.

- [ ] **Step 1: Write the failing pass-through test** — append to `tests/test-effective-navigation-route.mjs` (its fixture helper is `route({ circular })`, a linear route from lat 32/lng 35 to lat 32.01/lng 35.01):

```js
// --- Junctions pass through forward / reverse / alternate-start -------------
{
  const junctions = [{ lat: 32, lng: 35.005 }];
  const source = { ...route(), junctions };
  const forward = buildEffectiveNavigationRoute(source, { direction: "forward" });
  assert.deepEqual(forward.junctions, junctions, "forward keeps junctions");

  const reverse = buildEffectiveNavigationRoute(source, { direction: "reverse" });
  assert.deepEqual(reverse.junctions, junctions, "reverse keeps junctions (position-based)");

  const midStart = buildEffectiveNavigationRoute(source, {
    direction: "forward",
    startProgressMeters: 200,
  });
  assert.deepEqual(midStart.junctions, junctions, "alternate start keeps junctions");
}
```

- [ ] **Step 2: Run to verify which paths fail**

Run: `node tests/test-effective-navigation-route.mjs`
Expected: at least the reverse path FAILS (`reverseNavigationRoute` builds an explicit object). Forward/rotated paths may pass via spread — keep the assertions regardless.

- [ ] **Step 3: Implement pass-through** — junctions are lat/lng positions, so direction/start changes never invalidate them. In `reverseNavigationRoute`'s returned object add:

```js
    junctions: Array.isArray(route?.junctions)
      ? route.junctions.map((j) => ({ ...j }))
      : null,
```

Then follow every `return`/object-build path in `buildEffectiveNavigationRoute` (the `withEffectiveCommon` calls for the direct, rotated-loop, and clipped-linear paths): where the built object does not already inherit `junctions` via spread of `directional`, add the same `junctions: directional.junctions ?? null` line. Run the test after each path until all three assertions pass.

- [ ] **Step 4: Implement ride-confirm attachment** — in `BuildScreen.jsx` `confirmRidePlan`, before `completeConfirmation` uses the plan (the function already defers via `confirmWithCurrentPermission`; attach first, with a hard timeout):

```js
  const confirmRidePlan = useCallback(
    async (plan) => {
      if (!plan?.effectiveRoute?.canNavigate) return;
      let confirmedPlan = plan;
      if (!plan.effectiveRoute.junctions) {
        // Junction-gated cues need network junctions; never block ride start
        // on them (null falls back to legacy corner cues).
        const junctions = await Promise.race([
          computeRouteJunctions(plan.effectiveRoute.geometry).catch(() => null),
          new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (Array.isArray(junctions)) {
          confirmedPlan = {
            ...plan,
            effectiveRoute: { ...plan.effectiveRoute, junctions },
          };
        }
      }
      // ... existing body, with every use of `plan` below this point
      // switched to `confirmedPlan` ...
```

`computeRouteJunctions` arrives the same way `computeConnector` does (find `computeConnector`'s source near the top of BuildScreen and add the sibling). Update `confirmRidePlan`'s callback deps and any caller that awaited it (the function becomes async; existing callers already fire-and-forget or can `void` it — verify each call site).

- [ ] **Step 5: Run tests + simulator verification**

Run: `node tests/test-effective-navigation-route.mjs && npm run test:navigation-camera`
Expected: PASS.
Simulator: start a ride on a catalog route with shards available; add a temporary `console.log("junctions", confirmedPlan.effectiveRoute.junctions?.length)` (remove after), confirm a non-zero count, and confirm ride start is not delayed when offline (timeout path).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/navigation/effectiveNavigationRoute.js apps/mobile/src/screens/BuildScreen.jsx tests/test-effective-navigation-route.mjs
git commit -m "feat(nav): attach network junctions to confirmed rides for junction-gated cues

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: Diagnostic script + verify the rider's two routes

**Files:**
- Create: `scripts/inspect-route-cues.mjs`
- Create: `plans/navigation-ride-feedback/route-verification.md` (findings record)

**Interfaces:**
- Consumes: `buildLiveDecodeRoute` (`editor/server.mjs` — read its decode signature first; the snapshot script calls `decode(entry.route, entry)` where `entry.route` is the share token), `junctionsNearRoute` shard loading pattern from `scripts/nav-scenario-route-snapshot.mjs`, `navigationRouteFromRouteState`, `buildRouteCues`.
- Produces: a printed cue table per token, with and without junctions. Read-only over `public-data/`.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// Decode a shared-route token and print its navigation cues, with and
// without derived network junctions — for verifying rider reports of false
// turn instructions. Reads public-data; never writes it.
//
// Usage: node scripts/inspect-route-cues.mjs <route-token>
import { readFileSync } from "node:fs";
import { buildLiveDecodeRoute } from "../editor/server.mjs";
import { decodeCompactBaseRoutingShard } from "../packages/core/src/routing/compactBaseRoutingShard.js";
import { junctionsNearRoute } from "../packages/core/src/routing/junctionsNearRoute.js";
import { navigationRouteFromRouteState } from "../packages/core/src/navigation/navigationRoute.js";
import { buildRouteCues } from "../packages/core/src/navigation/navigationCues.js";

const token = process.argv[2];
if (!token) {
  console.error("usage: node scripts/inspect-route-cues.mjs <route-token>");
  process.exit(1);
}

const decode = await buildLiveDecodeRoute();
const decoded = decode(token, null);
if (!decoded?.geometry || decoded.geometry.length < 2) {
  console.error("token failed to decode");
  process.exit(1);
}

function loadNetworkAround(geometry) {
  const base = "public-data/base-routing-shards";
  const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, "utf-8"));
  const lats = geometry.map((p) => p.lat);
  const lngs = geometry.map((p) => p.lng);
  const pad = 0.01;
  const bbox = [
    Math.min(...lngs) - pad, Math.min(...lats) - pad,
    Math.max(...lngs) + pad, Math.max(...lats) + pad,
  ];
  const nodes = [];
  const edges = [];
  for (const entry of manifest.shards) {
    const [w, s, e, n] = entry.bounds;
    if (e < bbox[0] || w > bbox[2] || n < bbox[1] || s > bbox[3]) continue;
    const shard = decodeCompactBaseRoutingShard(
      readFileSync(`${base}/${entry.formats.compact.path}`),
    );
    nodes.push(...shard.nodes);
    edges.push(...shard.edges);
  }
  return { nodes, edges };
}

const routeState = {
  points: [
    { id: "start", ...decoded.geometry[0] },
    { id: "end", ...decoded.geometry[decoded.geometry.length - 1] },
  ],
  selectedSegments: decoded.selectedSegments ?? [],
  geometry: decoded.geometry,
  segmentSpans: decoded.segmentSpans ?? [],
};

function printCues(label, junctions) {
  const route = navigationRouteFromRouteState(
    { ...routeState, junctions },
    { param: "inspect" },
  );
  const cues = buildRouteCues(route);
  console.log(`\n=== ${label} (${cues.length} cues) ===`);
  for (const cue of cues) {
    const parts = [
      `${Math.round(cue.distanceMeters)}m`,
      cue.type,
      cue.direction || "",
      cue.turnAngleDeg ? `${Math.round(cue.turnAngleDeg)}°` : "",
      cue.thenDirection ? `then ${cue.thenDirection}` : "",
      cue.ontoSegmentName || cue.segmentName || "",
    ].filter(Boolean);
    console.log("  " + parts.join("  "));
  }
}

printCues("WITHOUT junctions (legacy — what the rider heard)", null);
const junctions = junctionsNearRoute(loadNetworkAround(decoded.geometry), decoded.geometry);
console.log(`\nderived ${junctions.length} junctions near the route`);
printCues("WITH junctions (junction-gated)", junctions);
```

If `decode(token, null)` throws, read `buildLiveDecodeRoute` in `editor/server.mjs` and adjust the metadata argument (the snapshot script passes a catalog entry; a minimal `{}` may be required).

- [ ] **Step 2: Run on the rider's two tokens**

```bash
node scripts/inspect-route-cues.mjs T4kEVAKs8H14e89Eo5k65VDmVm9ueEqbt5imKejv5W2pjqVA33x
node scripts/inspect-route-cues.mjs Cr66s6zHjRufS8zsGz6phqBokJuYUDmyEpRH3vm2iyY
```

Expected: the "WITHOUT junctions" listing shows the spurious 40–75° turn cues the rider heard on the historic-jordan sections; the "WITH junctions" listing silences or downgrades them to (now-unvoiced) bends.

- [ ] **Step 3: Record findings** — write `plans/navigation-ride-feedback/route-verification.md` with: the two tokens, cue counts before/after, whether any suspicious turn cues survive junction gating, and (if any survive) whether they sit at genuine junctions. If sharp genuine bends still cue at ≥75° in the flagged sections and they're clearly road-following, note a threshold-tuning follow-up rather than changing thresholds ad hoc.

- [ ] **Step 4: Commit**

```bash
git add scripts/inspect-route-cues.mjs plans/navigation-ride-feedback/route-verification.md
git commit -m "chore(nav): route-cue inspection script + verification of reported false turns

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 17: NavPanel data-pill cleanup

**Files:**
- Modify: `apps/mobile/src/planner/NavPanel.jsx:174-204` (data pill), prop plumbing at `:19` and its call site in `BuildScreen.jsx`

**Interfaces:**
- Consumes/Produces: UI only. Voice state remains on the adjacent mute `RoundButton`; the lock/voice mode icons and the "מסך ער / ממשיך כשהמסך נעול" copy disappear.

- [ ] **Step 1: Check smoke-test coupling** — `grep -rn "מסך ער\|ממשיך כשהמסך" apps/mobile tests .maestro 2>/dev/null` — update any Maestro flow / test that targets the old accessibility label.

- [ ] **Step 2: Implement** — replace the data pill block with:

```jsx
            <View
              style={styles.dataPill}
              accessible
              accessibilityLabel={dataPillMainText}
            >
              <View style={styles.dataPillCopy}>
                <Text style={styles.dataPillMain} numberOfLines={1}>
                  {dataPillMainText}
                </Text>
                {showSpeedInDataPill ? (
                  <Text style={styles.dataPillSub} numberOfLines={1}>
                    {p.speedText}
                  </Text>
                ) : null}
              </View>
            </View>
```

Remove the `modeIcons` `<View>`, the `lockScreenGuidanceActive` prop (line 19) if nothing else in the file uses it, its pass-in from `BuildScreen.jsx` (`grep -n "lockScreenGuidanceActive" apps/mobile/src` to find all sites — the `useNavigationSession` return value keeps exposing it; only NavPanel's consumption goes), and the now-unused `styles.modeIcons` style.

- [ ] **Step 3: Verify visually** — simulator ride: pill shows distance + speed only; mute button still toggles voice; nothing overflows RTL layout.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner/NavPanel.jsx apps/mobile/src/screens/BuildScreen.jsx
git commit -m "ux(nav): simplify data pill - drop lock/voice mode icons

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 18: Permission spike — lock-screen guidance with When-In-Use only

**Files:**
- Create: `plans/navigation-ride-feedback/permission-spike-findings.md`
- (Possible dev-only toggle in `apps/mobile/src/navigation/locationService.js` for the device test — reverted or dev-gated after)

**Interfaces:**
- Consumes: Task 4 (background audio must be in the build being tested).
- Produces: a written go/no-go finding. **Deleting the Always path / background TaskManager machinery is out of scope** — if the spike passes, that removal is its own follow-up plan.

- [ ] **Step 1: Read the installed native module** —

```bash
grep -rn "allowsBackgroundLocationUpdates" apps/mobile/node_modules/expo-location/ios/
grep -rn "showsBackgroundLocationIndicator" apps/mobile/node_modules/expo-location/ios/
```

Answer in writing: does `watchPositionAsync`'s location manager set `allowsBackgroundLocationUpdates = true` when the app has the `location` background mode? Under what permission level? Does `startLocationUpdatesAsync` hard-require Always, or only warn?

- [ ] **Step 2: Device protocol** (dev build on a real device, `npx expo run:ios --device`):
  1. Fresh install; grant **While Using** only (deny/skip Always).
  2. Start a ride with lock-screen guidance ON (which today would try the TaskManager path — if Step 1 shows the foreground watch continues under lock, add a temporary dev flag in `locationService.js` that skips `startNavigationBackgroundUpdates` and relies on the watch).
  3. Lock the phone; ride/walk ~2 minutes past at least one cue.
  4. Record: was the cue spoken while locked? Did progress advance (unlock and check)? Was the blue location indicator shown?
  5. Repeat with the app backgrounded (home screen) instead of locked.

- [ ] **Step 3: Write findings** to `plans/navigation-ride-feedback/permission-spike-findings.md`: module-source answer, device results, and a recommendation — either "When-In-Use suffices; follow-up plan: drop the Always request and the background TaskManager path" or "Always still required because ⟨specific evidence⟩".

- [ ] **Step 4: Commit**

```bash
git add plans/navigation-ride-feedback/permission-spike-findings.md
git commit -m "docs(nav): permission spike findings - lock-screen guidance with When-In-Use

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 19: Explicit audio-session activation around utterances (D11)

**Files:**
- Create: `packages/core/src/navigation/speechAudioSessionPolicy.js`
- Create: `tests/test-speech-audio-session-policy.mjs` (append to the root `package.json` test chain)
- Modify: `apps/mobile/src/navigation/speechAdapter.js`

**Interfaces:**
- Consumes: expo-audio `setIsAudioActiveAsync(active)` (native `AVAudioSession.setActive`, with `notifyOthersOnDeactivation` on false).
- Produces: `createSpeechAudioSessionPolicy({ lingerMs })` with `onSpeakRequested() -> { shouldActivate }`, `onUtteranceSettled(nowMs)`, `shouldDeactivateNow(nowMs)`, `onDeactivated()`, `snapshot()`. Adapter activates before every `Speech.speak`, settles each utterance exactly once (onDone/onStopped/onError or a 30 s safety timeout), and deactivates after a linger once idle. `getSpeechDiagnostics()` grows `sessionActive`, `inFlight`, `activations`, `activationErrors`, and a `recentEvents` ring buffer (consumed by Task 20's UI).

- [x] **Step 1: Write the failing test** — `tests/test-speech-audio-session-policy.mjs`: first speak activates / concurrent speak doesn't re-activate; no deactivation while utterances are in flight; deactivation only after `lingerMs` past the last settle; a new speak inside the linger window suppresses deactivation; after `onDeactivated()` the next speak re-activates; settle without any speak never deactivates.
- [x] **Step 2: Run test to verify it fails** (module doesn't exist).
- [x] **Step 3: Implement** the pure policy + wire the adapter (activation before speak; per-utterance single-settle guard + safety timeout; linger-timer deactivation gated by `shouldDeactivateNow`; failed activation calls `onDeactivated()` so the next speak retries).
- [x] **Step 4: Tests pass** (`node tests/test-speech-audio-session-policy.mjs`, added to the chain).
- [x] **Step 5: Device verification** — 2026-07-11, physical iPhone, dev build, Always permission: Task 20 soak test run with the phone locked — numbered prompts audible while locked. D11 per-utterance background activation works; the hold-for-the-ride fallback is not needed.

---

### Task 20: Lock-screen voice soak test (D12)

**Files:**
- Create: `apps/mobile/src/navigation/lockScreenVoiceTest.js`
- Modify: `apps/mobile/src/planner/RideSetupSheet.jsx`

**Interfaces:**
- Consumes: `speakUtterance` + `getSpeechDiagnostics` (Task 19), `requestNavigationPermissions` / `startNavigationBackgroundUpdates` / `stopNavigationBackgroundUpdates` (existing).
- Produces: `startLockScreenVoiceTest()` / `stopLockScreenVoiceTest()` / `subscribeLockScreenVoiceTest` / `getLockScreenVoiceTestSnapshot` — a 12-tick × 10 s numbered-prompt soak run that starts ride-style background location updates (keep-alive under lock) and reports instrumented results. UI: long-press on the ride-setup "בדיקת קול" button toggles the soak test; a status line under the button shows progress, the missing-Always warning, and post-run results (spoken/errors/lastError deltas vs a baseline snapshot).

- [x] Implement controller + sheet wiring (short press keeps the one-shot sample).
- [x] Device lab protocol (run A — current permission model): **PASS 2026-07-11** — Always granted, phone locked, numbered prompts audible throughout. Lock-screen voice fix (D11) confirmed on device.
- [x] Device lab protocol (run B — Task 18 When-In-Use spike, same soak test): **PASS 2026-07-11** — While-Using only, spike flag active (status line showed "מצב ניסוי: בלי הרשאת תמיד", no Always prompt), phone locked: all 13 prompts audible. Recorded in `permission-spike-findings.md`; remaining before the Always-removal follow-up plan: Home-screen (backgrounded) case + fresh-relaunch repeat, both runnable with the same soak test. First attempt was invalid — a stale Metro served an unflagged bundle; the missing "מצב ניסוי" status text is the tell.

---

## Final verification

- [x] `npm test` (full chain) and `npm run test:navigation-camera` — all green.
- [x] Native iOS Simulator build/install/launch (`npx expo run:ios`) — 0 errors, 3 third-party linker warnings; app bundled and opened on an iPhone 15 simulator.
- [ ] Simulator end-to-end with a dev journey scenario: acquisition phrase includes a compass word; a close turn pair speaks a compound instruction; panning re-follows after ~12s; the data pill shows distance/speed only.
- [x] Device (after native rebuild): lock-screen voice check — **PASS 2026-07-11** via the Task 20 soak test (run A: Always; run B: When-In-Use spike, all prompts audible under lock). Permission spike protocol (Task 18): lock-screen case passed; Home-screen + fresh-relaunch cases remain (see `permission-spike-findings.md`).
- [ ] Real ride: confirm actual turn cues are spoken under lock (final end-to-end validation of D11).
