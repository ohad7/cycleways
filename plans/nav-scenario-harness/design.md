# Navigation scenario harness — design

Date: 2026-07-03
Status: approved design, pre-implementation

## Problem

Field-testing turn-by-turn navigation is slow and unrepeatable: each change
needs a real bike ride, the tester must watch for many behaviors at once, and a
given failure (missed reroute, late banner) may not reproduce on the next ride.
The repo already has the building blocks — an injectable `locationSource`, a
pure node replay harness (`replaySession`), a synthetic track generator
(`generateTrack`), a `__DEV__` in-app simulate button, and a real-ride fix
recorder — but they form one hardcoded scenario with no expected outcomes and
no way to grow a library.

Target bug classes (from field experience): **UX/presentation** (banner
text/timing, cue quality, camera behavior) and **session logic** (off-route
detection, reroute, progress, arrival). Device/platform issues (real GPS noise,
backgrounding) are explicitly out of scope — physical rides remain the test for
those.

## Approach (chosen)

A declarative **scenario library** with two consumers of the same scenario
definition:

1. **Headless runner** — node, CI, milliseconds per scenario, asserts expected
   milestones against a user-visible timeline; failure artifacts are
   agent-readable JSON.
2. **Visual runner** — a dev-only in-app scenario picker that replays the same
   deterministic ride through the real app UI on the iOS simulator or a phone,
   at selectable speed.

Rejected alternatives: full simulator E2E automation (Maestro/Detox +
`simctl location`) — high fidelity but slow, flaky, new toolchain, and aimed at
device/platform bugs we're not targeting; headless-only golden snapshots —
drops "see what the user sees" entirely.

## 1. Scenario format and library

Scenarios live in `packages/core/src/navigation/scenarios/` as JS modules with
an `index.js` registry, importable by both the node test suite and Metro.

```js
export default {
  name: "missed-turn-reroute",
  description: "Rider overshoots the second turn by ~100m, expects reroute",

  // Route: exactly one of —
  route: { slug: "banias-loop" },              // catalog route, or
  // route: { points: [...], geometry: [...] }  // inline synthetic route state

  // Track: exactly one of —
  track: {                                      // generateTrack options
    speedMps: 5, jitterM: 8, seed: 3,
    offRouteExcursion: { startMeters: 400, lengthMeters: 250, offsetMeters: 100 },
  },
  // track: { fixesFile: "recorded/ride-2026-06-21.json" }  // recorded ride

  connector: "straight-line",                   // "straight-line" | "fail" | "none"

  expect: [                                     // milestones (headless runner)
    { type: "status", value: "off-route", betweenMeters: [400, 480] },
    { type: "banner", match: "פנה ימינה", beforeMeters: 380 },
    { type: "rerouted", withinFixesOfOffRoute: 15 },
    { type: "arrived" },
  ],
};
```

- Recorded fixture JSONs (captured with the existing `[NAV-RECORDER]` REC
  button) live in `scenarios/recorded/`.
- Adding a scenario = one file + one registry line. Every scenario is
  simultaneously a CI regression test and a watchable replay.
- A shared `resolveScenario()` loader validates the definition (route resolves,
  track well-formed) and fails fast with a clear message; both runners use it.

## 2. Headless runner (CI + agent-facing)

New `packages/core/src/navigation/scenarioRunner.js`:

- Wraps the existing `replaySession` (real navigation session, clockless,
  timestamps from fixes).
- Additionally maps every recorded state through `navigationPresentation` and
  `cueHaptics`, producing a **user-visible timeline**: per fix — status, banner
  text/icon, context line, distance readouts, haptic events — plus session
  facts (off-route flag, progress meters, connector/reroute requests).
- A small evaluator checks `expect` milestones against that timeline.
  Milestone vocabulary for v1: `status` (value reached, optional
  `betweenMeters`), `banner` (regex/substring, optional
  `beforeMeters`/`afterMeters`), `rerouted` (optional
  `withinFixesOfOffRoute`), `arrived`, `haptic` (event name, optional bounds).
  The evaluator is unit-tested on its own.

Connector handling per scenario: `straight-line` (stub direct geometry between
request endpoints — default), `fail` (dispatch `CONNECTOR_FAILED` to exercise
error UX), `none` (leave the request pending). Real base-routing reroutes are a
noted later extension (the routing network already runs in node).

Test integration: `tests/test-nav-scenarios.mjs` iterates the registry, runs
every scenario, and joins the `npm test` chain. On failure it prints the failed
milestone and writes the full timeline JSON to
`test-results/nav-scenarios/<name>.json` — the artifact an agent reads to
diagnose e.g. "banner flipped too early at fix 142" without a device.

## 3. Visual runner (simulator / phone, on demand)

Replaces the hardcoded `__DEV__` SIM behavior in BuildScreen:

- Tapping **SIM** opens a dev-only **scenario picker** sheet: every registry
  entry (name + description) plus a playback-speed toggle (1× / 4× / 8×).
- Picking a scenario:
  1. Loads its route — catalog slug via the app's existing catalog loading
     path, or `navigationRouteFromRouteState` for inline routes. The
     `current-route-generic` scenario instead runs on whatever route is
     currently built (preserving today's SIM behavior).
  2. Builds fixes exactly as the headless runner does (same generator, same
     seed → identical ride).
  3. Installs `createSimulateRideSource(fixes, { intervalMs })` through the
     existing `devSourceProxy` and starts navigation.
- Speed control only shrinks playback `intervalMs`; fix timestamps are
  untouched, and since the session is clockless the logic is identical at any
  speed — only watching time compresses.
- Works on the iOS simulator with no OS-level location faking (the injected
  source bypasses expo-location entirely) and on a dev build on the phone
  (where haptics can be felt).

Invocation flow: run a dev build (`npx expo run:ios` or dev build on phone) →
Build screen → SIM → pick scenario + speed → watch → end navigation → repeat.
`__DEV__` gating keeps all of this out of production builds.

## 4. Feedback loop

Watch a scenario on the simulator → report what looked wrong ("banner flipped
too early at the second turn") → an agent reruns the same scenario headlessly,
reads the timeline artifact, fixes, re-verifies — and the scenario remains as a
permanent regression test.

## 5. Error handling

- Bad route slug / malformed track / unknown connector mode → fail fast in
  `resolveScenario()` with a message naming the scenario and field; both
  runners surface it (test failure / dev alert).
- A scenario whose `expect` list is empty still runs headlessly as a
  smoke test (no crash, session reaches a terminal or steady state).

## 6. Seed scenario set (v1)

Roughly the field checklist, plus one recorded real ride:

1. `on-route-happy-path` — clean ride start to arrival.
2. `approach-from-distance` — start ~500 m off the route start.
3. `missed-turn-reroute` — off-route excursion, reroute, rejoin.
4. `reroute-failure` — same excursion with `connector: "fail"`.
5. `gps-gap` — timestamp jump mid-ride (signal loss/recovery).
6. `stop-and-stand` — zero speed with jitter (no false off-route/progress).
7. `arrival` — end-of-route behavior.
8. `recorded-real-ride` — replay of `nav-ride-realistic.json` with milestones.
9. `current-route-generic` — visual-runner-only; today's SIM behavior.

## 7. Testing

- Evaluator unit tests (milestone matching logic).
- `test-nav-scenarios.mjs` in the `npm test` chain runs the whole library.
- Existing `test-navigation-replay.mjs` stays; the scenario runner builds on
  the same primitives.
- Visual runner is dev-only UI; verified manually on the simulator (it shares
  scenario resolution and track generation with the tested headless path).
