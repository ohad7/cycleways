# Navigation Intro Rethink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-screen ride-setup sheet with a slim mini-confirm card over the visible map, give every distance the same live "getting to the route" state (beeline pointer only — no routed connector suggestion before the route is acquired), and demote the old setup sheet to an opt-in settings screen.

**Architecture:** All decision logic stays in pure `@cycleways/core` modules tested with plain node scripts; the React Native components (`RideIntroCard`, `ApproachPanel`) are dumb renderers. `BuildScreen.jsx` rewires the flow: tap נווט → intro card → confirm always starts the foreground navigation session (status `approaching` until the effective start is physically acquired) → existing acquisition transition. Connector suggestions become rejoin-only inside `navigationSession.js`. External handoff (existing `DestinationSheet` + `pendingRidePlan` persistence) is reachable from the card and the approach state.

**Tech Stack:** React Native (Expo) app in `apps/mobile`, pure JS core in `packages/core`, node `assert` test scripts in `tests/` chained in the root `package.json` `test` script.

**Design spec:** `plans/navigation-intro-rethink/design.md` (committed). Read it before starting.

## Global Constraints

- Hebrew copy is exact and RTL. Strings used in this plan (verbatim): `אתה בנקודת ההתחלה`, `תחילת המסלול במרחק`, `נקודת ההתחלה שבחרת`, `הניווט במסלול יתחיל כשתגיע לנקודת ההתחלה.`, `צא לדרך`, `התחל ניווט במסלול`, `הגדרות רכיבה`, `אפליקציית ניווט`, `בדרך למסלול`, `הניווט במסלול יתחיל כשתגיע`, `אתה קרוב לנקודה על המסלול — אפשר להתחיל ממנה בהגדרות רכיבה.`
- Never modify anything under `public-data/` or `data/map-source.geojson` (pipeline-owned).
- The source route / share token / planner draft must never be mutated; only the derived effective route changes.
- Tracking during approach is foreground-only (no change to background behavior, which starts with route guidance).
- Text styles come from `apps/mobile/src/theme/typography.js` (`text.*` tokens) and `apps/mobile/src/planner/theme.js` (`palette`, `radius`, `space`) — no raw `fontSize`/`fontWeight` (a guard test enforces this).
- Tests run individually: `node tests/<file>.mjs` from the repo root. New test files must be added to the `test` script chain in `package.json`.
- Off-route / rejoin behavior after route acquisition is out of scope and must not change (the dashed rejoin suggestion stays).
- Commit after every task with the message given in the task.

---

### Task 1: Core ride-intro presentation model

**Files:**
- Create: `packages/core/src/navigation/rideIntroPresentation.js`
- Test: `tests/test-ride-intro-presentation.mjs`
- Modify: `package.json` (register the new test)

**Interfaces:**
- Consumes: `formatDistanceMeters(meters)` from `packages/core/src/navigation/navigationPresentation.js` (existing; returns `"650 מ׳"` / `"3.4 ק״מ"`), the ride-plan object returned by `createRidePlan` in `packages/core/src/navigation/ridePlan.js` (fields used: `distanceToStartMeters`, `approachTier`, `locationQuality`, `startMode`, `direction`, `skippedMeters`, `guidedDistanceMeters`, `candidates.nearestIsMeaningful`).
- Produces (used by Tasks 5, 6, 8):
  - `getRideIntroPresentation(plan, locationStatus)` → `{ headline, expectationText, primaryLabel, primaryEnabled, atStart, showExternalNav, nearestHintText, noticeText, showRetry, rideLengthText, skipNoteText, directionNoteText }` (all strings, booleans as named).
  - `confirmDistanceBucket(meters)` → `"at" | "1km" | "5km" | "20km" | "20km+" | "unknown"`.
  - `rideSetupLocationNotice(status, quality)` → notice string (moves the copy currently in `RideSetupSheet.jsx`'s local `locationMessage` into core).

- [ ] **Step 1: Write the failing test**

Create `tests/test-ride-intro-presentation.mjs`:

```js
import assert from "node:assert/strict";
import {
  confirmDistanceBucket,
  getRideIntroPresentation,
  rideSetupLocationNotice,
} from "@cycleways/core/navigation/rideIntroPresentation.js";

// Far rider, fresh fix, official start: the situation headline leads.
{
  const p = getRideIntroPresentation(
    {
      distanceToStartMeters: 12000,
      approachTier: "far",
      locationQuality: "fresh",
      startMode: "official",
      direction: "forward",
      skippedMeters: 0,
      guidedDistanceMeters: 24600,
      candidates: { nearestIsMeaningful: false },
    },
    "ready",
  );
  assert.equal(p.headline, "תחילת המסלול במרחק 12.0 ק״מ");
  assert.equal(p.expectationText, "הניווט במסלול יתחיל כשתגיע לנקודת ההתחלה.");
  assert.equal(p.primaryLabel, "צא לדרך");
  assert.equal(p.primaryEnabled, true);
  assert.equal(p.atStart, false);
  assert.equal(p.showExternalNav, true);
  assert.equal(p.nearestHintText, "");
  assert.equal(p.rideLengthText, "אורך המסלול: 24.6 ק״מ");
  assert.equal(p.skipNoteText, "");
  assert.equal(p.directionNoteText, "");
}

// At the start: no expectation line, no external nav, direct-start label.
{
  const p = getRideIntroPresentation(
    {
      distanceToStartMeters: 10,
      approachTier: "at",
      locationQuality: "fresh",
      startMode: "official",
      direction: "forward",
      skippedMeters: 0,
      guidedDistanceMeters: 24600,
      candidates: { nearestIsMeaningful: false },
    },
    "ready",
  );
  assert.equal(p.headline, "אתה בנקודת ההתחלה");
  assert.equal(p.expectationText, "");
  assert.equal(p.primaryLabel, "התחל ניווט במסלול");
  assert.equal(p.atStart, true);
  assert.equal(p.showExternalNav, false);
}

// Loading: headline reports the search, primary disabled.
{
  const p = getRideIntroPresentation(null, "loading");
  assert.equal(p.headline, "מאתר את המיקום שלך…");
  assert.equal(p.primaryEnabled, false);
}

// No usable fix: honest headline, retry offered, starting still allowed.
{
  const p = getRideIntroPresentation(
    {
      distanceToStartMeters: null,
      approachTier: "unknown",
      locationQuality: "unavailable",
      startMode: "official",
      direction: "forward",
      skippedMeters: 0,
      guidedDistanceMeters: 24600,
      candidates: null,
    },
    "unavailable",
  );
  assert.equal(p.headline, "לא הצלחנו לקבל מיקום עדכני");
  assert.equal(p.showRetry, true);
  assert.equal(p.primaryEnabled, true);
  assert.equal(p.showExternalNav, true);
}

// Nearest-join hint fires only for fresh location + meaningful nearest + official mode.
{
  const base = {
    distanceToStartMeters: 8000,
    approachTier: "far",
    locationQuality: "fresh",
    startMode: "official",
    direction: "forward",
    skippedMeters: 0,
    guidedDistanceMeters: 24600,
    candidates: { nearestIsMeaningful: true },
  };
  assert.equal(
    getRideIntroPresentation(base, "ready").nearestHintText,
    "אתה קרוב לנקודה על המסלול — אפשר להתחיל ממנה בהגדרות רכיבה.",
  );
  assert.equal(
    getRideIntroPresentation({ ...base, locationQuality: "stale" }, "ready").nearestHintText,
    "",
  );
  assert.equal(
    getRideIntroPresentation({ ...base, startMode: "nearest" }, "ready").nearestHintText,
    "",
  );
}

// Custom start reflects the choice and its consequence.
{
  const p = getRideIntroPresentation(
    {
      distanceToStartMeters: 650,
      approachTier: "near",
      locationQuality: "fresh",
      startMode: "custom",
      direction: "reverse",
      skippedMeters: 3100,
      guidedDistanceMeters: 21500,
      candidates: { nearestIsMeaningful: true },
    },
    "ready",
  );
  assert.equal(p.headline, "נקודת ההתחלה שבחרת במרחק 650 מ׳");
  assert.equal(p.skipNoteText, "ההתחלה שבחרת מדלגת על 3.1 ק״מ");
  assert.equal(p.directionNoteText, "המסלול ינווט בכיוון ההפוך.");
}

// Stale fix: distance still shown, notice carries the caveat.
{
  const p = getRideIntroPresentation(
    {
      distanceToStartMeters: 2000,
      approachTier: "unknown",
      locationQuality: "stale",
      startMode: "official",
      direction: "forward",
      skippedMeters: 0,
      guidedDistanceMeters: 24600,
      candidates: null,
    },
    "ready",
  );
  assert.equal(p.headline, "תחילת המסלול במרחק 2.0 ק״מ");
  assert.equal(p.noticeText, rideSetupLocationNotice("ready", "stale"));
  assert.equal(p.showRetry, true);
}

// Location-notice copy matches the strings the setup sheet used.
assert.equal(rideSetupLocationNotice("loading"), "מאתר את המיקום שלך…");
assert.equal(
  rideSetupLocationNotice("denied"),
  "אין הרשאת מיקום. אפשר לבחור התחלה ידנית או לנסות שוב.",
);
assert.equal(rideSetupLocationNotice("unavailable"), "לא הצלחנו לקבל מיקום עדכני.");
assert.equal(
  rideSetupLocationNotice("ready", "stale"),
  "המיקום הקיים אינו עדכני; ההמלצה לא נבחרה אוטומטית.",
);
assert.equal(
  rideSetupLocationNotice("ready", "inaccurate"),
  "דיוק המיקום נמוך; מומלץ לבחור נקודת התחלה ידנית.",
);
assert.equal(rideSetupLocationNotice("ready", "fresh"), "");

// Analytics distance buckets.
assert.equal(confirmDistanceBucket(40), "at");
assert.equal(confirmDistanceBucket(900), "1km");
assert.equal(confirmDistanceBucket(4200), "5km");
assert.equal(confirmDistanceBucket(18000), "20km");
assert.equal(confirmDistanceBucket(30000), "20km+");
assert.equal(confirmDistanceBucket(null), "unknown");
assert.equal(confirmDistanceBucket(-5), "unknown");

console.log("test-ride-intro-presentation OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-ride-intro-presentation.mjs`
Expected: FAIL with `Cannot find module ... rideIntroPresentation.js`

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/navigation/rideIntroPresentation.js`:

```js
// Pure presentation model for the pre-ride intro card (the slim mini-confirm
// card that replaced the full-screen ride-setup sheet). One situation headline,
// one primary action; see plans/navigation-intro-rethink/design.md.
import { formatDistanceMeters } from "./navigationPresentation.js";

// Location notice copy shared by the intro card and the ride-settings screen.
export function rideSetupLocationNotice(status, quality) {
  if (status === "loading") return "מאתר את המיקום שלך…";
  if (status === "denied") {
    return "אין הרשאת מיקום. אפשר לבחור התחלה ידנית או לנסות שוב.";
  }
  if (status === "unavailable") return "לא הצלחנו לקבל מיקום עדכני.";
  if (quality === "stale") {
    return "המיקום הקיים אינו עדכני; ההמלצה לא נבחרה אוטומטית.";
  }
  if (quality === "inaccurate") {
    return "דיוק המיקום נמוך; מומלץ לבחור נקודת התחלה ידנית.";
  }
  return "";
}

// Coarse analytics bucket for the distance-to-start at confirmation time.
export function confirmDistanceBucket(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return "unknown";
  if (m <= 100) return "at";
  if (m <= 1000) return "1km";
  if (m <= 5000) return "5km";
  if (m <= 20000) return "20km";
  return "20km+";
}

export function getRideIntroPresentation(plan, locationStatus = "idle") {
  const distance = Number(plan?.distanceToStartMeters);
  const hasDistance = Number.isFinite(distance) && distance >= 0;
  const atStart =
    plan?.locationQuality === "fresh" && plan?.approachTier === "at";
  const startLabel =
    plan?.startMode === "official" ? "תחילת המסלול" : "נקודת ההתחלה שבחרת";
  const headline = atStart
    ? "אתה בנקודת ההתחלה"
    : hasDistance
      ? `${startLabel} במרחק ${formatDistanceMeters(distance)}`
      : locationStatus === "loading"
        ? "מאתר את המיקום שלך…"
        : "לא הצלחנו לקבל מיקום עדכני";
  const guided = Number(plan?.guidedDistanceMeters);
  const skipped = Number(plan?.skippedMeters);
  return {
    headline,
    expectationText: atStart
      ? ""
      : "הניווט במסלול יתחיל כשתגיע לנקודת ההתחלה.",
    primaryLabel: atStart ? "התחל ניווט במסלול" : "צא לדרך",
    primaryEnabled: Boolean(plan) && locationStatus !== "loading",
    atStart,
    showExternalNav: Boolean(plan) && !atStart,
    nearestHintText:
      !atStart &&
      plan?.locationQuality === "fresh" &&
      plan?.startMode === "official" &&
      plan?.candidates?.nearestIsMeaningful
        ? "אתה קרוב לנקודה על המסלול — אפשר להתחיל ממנה בהגדרות רכיבה."
        : "",
    noticeText: rideSetupLocationNotice(locationStatus, plan?.locationQuality),
    showRetry:
      locationStatus === "denied" ||
      locationStatus === "unavailable" ||
      plan?.locationQuality === "stale" ||
      plan?.locationQuality === "inaccurate" ||
      plan?.locationQuality === "unavailable",
    rideLengthText: Number.isFinite(guided)
      ? `אורך המסלול: ${formatDistanceMeters(guided)}`
      : "",
    skipNoteText:
      Number.isFinite(skipped) && skipped > 50
        ? `ההתחלה שבחרת מדלגת על ${formatDistanceMeters(skipped)}`
        : "",
    directionNoteText:
      plan?.direction === "reverse" ? "המסלול ינווט בכיוון ההפוך." : "",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-ride-intro-presentation.mjs`
Expected: PASS (`test-ride-intro-presentation OK`)

- [ ] **Step 5: Register the test in `package.json`**

In the root `package.json` `test` script, immediately after `node tests/test-ride-plan.mjs && ` insert:

```
node tests/test-ride-intro-presentation.mjs &&
```

(one entry in the existing `&&` chain, same style as its neighbors).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/navigation/rideIntroPresentation.js tests/test-ride-intro-presentation.mjs package.json
git commit -m "feat(core): ride-intro card presentation model"
```

---

### Task 2: Session — connector suggestions become rejoin-only

**Files:**
- Modify: `packages/core/src/navigation/navigationSession.js` (the `NAV_ACTIONS.LOCATION` pre-acquisition branch, currently ~lines 217–263)
- Test: `tests/test-navigation-session.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: while `status === "approaching"` the session state now always has `approach.suggestionStatus === "idle"`, `approach.suggestionGeometry === null`, and `routeRequest === null`. Off-route (rejoin) suggestion behavior is byte-for-byte unchanged. Tasks 4 and 9 rely on this.

- [ ] **Step 1: Update the session tests to the new contract**

In `tests/test-navigation-session.mjs`:

(a) In the `--- approaching status ---` block (~line 198), after the existing `far` assertions add:

```js
  assert.equal(
    far.approach.suggestionStatus,
    "idle",
    "pre-route approach never requests a connector suggestion",
  );
  assert.equal(far.routeRequest, null, "no connector request while approaching");
```

(b) Replace the `approachingSession` helper (~lines 220–229) with an off-route-based helper. The suggestion plumbing (READY / FAILED / stale / paused) is still real behavior — for rejoin — so the tests drive it through the off-route path instead:

```js
// Acquire the route, then drift off it far enough (sustained) to enter
// off-route; the rejoin branch issues the connector request.
function offRouteRequestedSession() {
  const session = navigatingSession();
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.605, 500) });
  const off = (timestamp) => fix(35.605, timestamp, { lat: 33.101 });
  session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(1000) });
  const requested = session.dispatch({ type: NAV_ACTIONS.LOCATION, fix: off(6000) });
  return { session, requested };
}
```

(c) Rewrite the `--- approach slot: suggestion is orthogonal to acquisition ---` block (~lines 231–271) as a rejoin-slot test:

```js
// --- rejoin slot: suggestion is orthogonal to recovery ---------------------
{
  const { session: s } = offRouteRequestedSession();
  let st = s.getState();
  assert.equal(st.status, "off-route");
  assert.equal(st.approach.target.mode, "rejoin");
  assert.equal(st.approach.suggestionStatus, "requesting");
  assert.ok(st.routeRequest && st.routeRequest.to);
  assert.ok(Number.isFinite(st.approach.distanceToRouteMeters));

  s.dispatch({
    type: NAV_ACTIONS.CONNECTOR_READY,
    requestId: st.routeRequest.requestId,
    geometry: [
      { lat: 33.101, lng: 35.605 },
      { lat: 33.1, lng: 35.605 },
    ],
    distanceMeters: 800,
    snappedEndpoints: [],
  });
  st = s.getState();
  assert.equal(st.status, "off-route", "READY never changes status");
  assert.equal(st.approach.suggestionStatus, "ready");
  assert.ok(st.approach.suggestionGeometry.length >= 2);
  assert.equal(st.approach.suggestionDistanceMeters, 800);
  assert.equal(st.routeRequest, null, "completed connector request is cleared");

  s.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.605, 8000) });
  st = s.dispatch({ type: NAV_ACTIONS.LOCATION, fix: fix(35.6051, 12000) });
  assert.equal(st.status, "navigating", "physical recovery is the only handoff");
}
```

(d) In the three remaining suggestion blocks (`long / over-cap suggestion`, `invalid (single-point) geometry`, `CONNECTOR_FAILED`, `stale and paused results`), replace every `approachingSession()` call with `offRouteRequestedSession()` and every `assert.equal(..., "approaching")` status assertion in those blocks with `"off-route"`. In the paused block, the final `RESUME` assertion becomes:

```js
  assert.equal(
    session.dispatch({ type: NAV_ACTIONS.RESUME }).status,
    "off-route",
    "RESUME restores the pre-pause status",
  );
```

The connector geometry literals in those blocks (`{ lat: 33.105, lng: 35.6 }` pairs) can stay as-is — the reducer does not validate that geometry matches the fix position, only its shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-session.mjs`
Expected: FAIL — the approaching block still requests a suggestion, so `far.approach.suggestionStatus` is `"requesting"`, not `"idle"`.

- [ ] **Step 3: Change the reducer**

In `packages/core/src/navigation/navigationSession.js`, replace the entire pre-acquisition branch body (from `if (!mainProgress.hasAcquiredRoute) {` through its closing `}` before `const offRoute = mainProgress.offRoute;`) with:

```js
        // Not yet on the route: stay in `approaching` with a live straight-line
        // distance to the chosen target. The pre-route approach is a beeline
        // pointer only — connector suggestions are rejoin-only, because the
        // uncurated base data is not trusted for approach routing and external
        // apps own that leg (plans/navigation-intro-rethink/design.md).
        if (!mainProgress.hasAcquiredRoute) {
          const choices = approachTargetChoices(navigationRoute, action.fix);
          let target = state.approach.target;
          if (!target && choices) {
            target = { ...choices.start, mode: "start" };
          }
          return set({
            status: "approaching",
            progress: mainProgress,
            activeCue: null,
            offRoute: false,
            cueEvent: null,
            justAcquired: false,
            approach: {
              ...state.approach,
              choices,
              target,
              distanceToRouteMeters: target
                ? getDistance(action.fix, target.point)
                : null,
            },
          });
        }
```

Also update the file's top comment (lines 1–4) so it no longer claims the session offers the connector as an approach suggestion — it should say the connector suggestion is offered for off-route rejoin only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test-navigation-session.mjs && node tests/test-nav-scenarios.mjs && node tests/test-nav-scenario-runner.mjs && node tests/test-nav-scenario-expectations.mjs`
Expected: all PASS. (`approach-from-distance` asserts only status/banner/acquired — no suggestion expectations. If `test-nav-scenarios.mjs` fails on the `approach-calculated-route` scenario, that scenario is retired in Task 3 — check the failure is only there before proceeding.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationSession.js tests/test-navigation-session.mjs
git commit -m "feat(core): pre-route approach is beeline-only; connector suggestions become rejoin-only"
```

---

### Task 3: Retire the pre-route connector demo scenario

The `approach-calculated-route` scenario existed solely to demo the routed pre-route connector, which no longer renders. Its pinned test would fail its purpose silently, so both go. (Rejoin connectors stay covered by the `off-route-excursion` scenario, `tests/test-compute-connector.mjs`, and `tests/test-connector-targeting.mjs`.)

**Files:**
- Delete: `packages/core/src/navigation/scenarios/approach-calculated-route.js`
- Delete: `tests/test-nav-approach-connector.mjs`
- Modify: `packages/core/src/navigation/scenarios/index.js` (remove the import and registry entry)
- Modify: `package.json` (remove `node tests/test-nav-approach-connector.mjs && ` from the `test` chain)

**Interfaces:**
- Consumes / Produces: nothing — pure removal. `getScenario("approach-calculated-route")` stops existing; the dev scenario picker lists one fewer scenario.

- [ ] **Step 1: Remove the scenario and test**

```bash
git rm packages/core/src/navigation/scenarios/approach-calculated-route.js tests/test-nav-approach-connector.mjs
```

In `packages/core/src/navigation/scenarios/index.js`, delete the line `import approachCalculatedRoute from "./approach-calculated-route.js";` and its entry in the scenario list/registry (grep for `approachCalculatedRoute`).

In `package.json`, delete the segment `node tests/test-nav-approach-connector.mjs && ` from the `test` script.

- [ ] **Step 2: Verify**

Run: `node tests/test-nav-scenarios.mjs && node tests/test-nav-scenario-resolve.mjs && node -e "import('@cycleways/core/navigation/scenarios/index.js').then(m => console.log('scenarios OK'))"`
Expected: all PASS, no dangling-import error.

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "chore(core): retire the pre-route connector demo scenario and its pinned test"
```

---

### Task 4: Presentation — no suggestion chip while approaching

**Files:**
- Modify: `packages/core/src/navigation/navigationPresentation.js` (the `chip` computation, ~lines 184–190)
- Test: `tests/test-navigation-presentation.mjs` (~lines 329–339)

**Interfaces:**
- Produces: `getNavigationPresentation(state).chip` is `null` whenever `status === "approaching"`. The `rejoin` chip and all other fields are unchanged. Task 9's map rendering relies on the rejoin chip still existing.

- [ ] **Step 1: Update the test**

In `tests/test-navigation-presentation.mjs`, the `approaching` block currently asserts a suggestion chip. Replace:

```js
  assert.equal(approaching.cardMode, "approach");
  assert.deepEqual(approaching.chip, { kind: "approach", text: "המסלול המוצע" });
```

with:

```js
  assert.equal(approaching.cardMode, "approach");
  assert.equal(approaching.chip, null, "no suggestion chip while approaching");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-navigation-presentation.mjs`
Expected: FAIL on the chip assertion.

- [ ] **Step 3: Change the chip computation**

In `packages/core/src/navigation/navigationPresentation.js`, replace:

```js
  const chip = offRoute
    ? { kind: "rejoin", text: "חזרה למסלול" }
    : status === "approaching"
      ? (hasSuggestionGeometry ? { kind: "approach", text: "המסלול המוצע" } : null)
      : (cardMode === "cue" || cardMode === "arrived") && segmentChipText
        ? { kind: "segment", text: segmentChipText }
        : null;
```

with:

```js
  const chip = offRoute
    ? { kind: "rejoin", text: "חזרה למסלול" }
    : (cardMode === "cue" || cardMode === "arrived") && segmentChipText
      ? { kind: "segment", text: segmentChipText }
      : null;
```

Leave `approachDisplayDistance`, `tier`, and `approachDistanceSource` as they are: with Task 2 in place the suggestion fields are simply never populated while approaching, so the distance is the beeline automatically, and the off-route path still uses them.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-navigation-presentation.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/navigation/navigationPresentation.js tests/test-navigation-presentation.mjs
git commit -m "feat(core): drop the approach suggestion chip from navigation presentation"
```

---

### Task 5: RideIntroCard component

**Files:**
- Create: `apps/mobile/src/planner/RideIntroCard.jsx`

**Interfaces:**
- Consumes: `getRideIntroPresentation(plan, locationStatus)` from Task 1; `Icon`, `palette`, `radius`, `space`, `text` like sibling planner components.
- Produces (used by Task 8): default export `RideIntroCard({ visible, plan, locationStatus, onConfirm, onOpenExternal, onOpenSettings, onRefreshLocation, onClose })`. Renders `null` when not visible. It is an absolutely-positioned bottom card (NOT a `Modal`) so the map above stays visible and interactive.

- [ ] **Step 1: Write the component**

Create `apps/mobile/src/planner/RideIntroCard.jsx`:

```jsx
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getRideIntroPresentation } from "@cycleways/core/navigation/rideIntroPresentation.js";
import Icon from "./Icon.jsx";
import { palette, radius, space } from "./theme.js";
import { text } from "../theme/typography.js";

// Slim pre-ride intro card over the visible map: one situation headline
// ("the start is X away"), one primary action; options and external nav are
// secondary. Deliberately not a Modal so the rider can see themselves and the
// route start behind it (plans/navigation-intro-rethink/design.md).
export default function RideIntroCard({
  visible,
  plan,
  locationStatus,
  onConfirm,
  onOpenExternal,
  onOpenSettings,
  onRefreshLocation,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  const intro = getRideIntroPresentation(plan, locationStatus);
  const showNotice = Boolean(
    intro.noticeText && intro.noticeText !== intro.headline,
  );
  return (
    <View
      style={[styles.wrap, { paddingBottom: insets.bottom + space.md }]}
      pointerEvents="box-none"
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="סגירה"
            onPress={onClose}
            hitSlop={8}
          >
            <Icon name="close" size={22} color={palette.muted} />
          </Pressable>
          <Text style={styles.headline}>{intro.headline}</Text>
        </View>
        {intro.expectationText ? (
          <Text style={styles.expectation}>{intro.expectationText}</Text>
        ) : null}
        {intro.rideLengthText ? (
          <Text style={styles.meta}>{intro.rideLengthText}</Text>
        ) : null}
        {intro.skipNoteText ? (
          <Text style={styles.warning}>{intro.skipNoteText}</Text>
        ) : null}
        {intro.directionNoteText ? (
          <Text style={styles.meta}>{intro.directionNoteText}</Text>
        ) : null}
        {intro.nearestHintText ? (
          <Text style={styles.hint}>{intro.nearestHintText}</Text>
        ) : null}
        {showNotice ? (
          <View style={styles.noticeRow}>
            <Text style={styles.notice}>{intro.noticeText}</Text>
            {intro.showRetry ? (
              <Pressable accessibilityRole="button" onPress={onRefreshLocation}>
                <Text style={styles.retry}>נסה שוב</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={!intro.primaryEnabled}
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.primary,
            !intro.primaryEnabled ? styles.primaryDisabled : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.primaryText}>{intro.primaryLabel}</Text>
        </Pressable>
        <View style={styles.secondaryRow}>
          {intro.showExternalNav ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="ניווט לנקודת ההתחלה באפליקציית ניווט"
              onPress={onOpenExternal}
              style={({ pressed }) => [
                styles.secondary,
                pressed ? styles.pressed : null,
              ]}
            >
              <Icon name="open-outline" color={palette.forest} size={17} />
              <Text style={styles.secondaryText}>אפליקציית ניווט</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="הגדרות רכיבה"
            onPress={onOpenSettings}
            style={({ pressed }) => [
              styles.secondary,
              pressed ? styles.pressed : null,
            ]}
          >
            <Icon name="options-outline" color={palette.forest} size={17} />
            <Text style={styles.secondaryText}>הגדרות רכיבה</Text>
          </Pressable>
        </View>
        <Text style={styles.safety}>
          ההנחיות הן עזר לתכנון בלבד. רכבו בזהירות וצייתו לתמרורים ולתנאי הדרך
          — הם קודמים לכל הנחיה מהאפליקציה.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.md,
    zIndex: 25,
    elevation: 25,
  },
  card: {
    backgroundColor: palette.paper,
    borderRadius: radius.lg,
    padding: space.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
  },
  headline: {
    ...text.subheading,
    color: palette.ink,
    flex: 1,
    textAlign: "right",
    writingDirection: "rtl",
  },
  expectation: {
    ...text.body,
    color: palette.ink,
    marginTop: space.xs,
    textAlign: "right",
    writingDirection: "rtl",
  },
  meta: {
    ...text.caption,
    color: palette.muted,
    marginTop: 2,
    textAlign: "right",
    writingDirection: "rtl",
  },
  warning: {
    ...text.captionStrong,
    color: "#92400e",
    marginTop: 2,
    textAlign: "right",
    writingDirection: "rtl",
  },
  hint: {
    ...text.caption,
    color: palette.forest,
    marginTop: space.xs,
    textAlign: "right",
    writingDirection: "rtl",
  },
  noticeRow: {
    flexDirection: "row-reverse",
    gap: space.sm,
    alignItems: "center",
    backgroundColor: palette.cream,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.sm,
  },
  notice: {
    ...text.caption,
    color: palette.ink,
    flex: 1,
    textAlign: "right",
    writingDirection: "rtl",
  },
  retry: { ...text.captionStrong, color: palette.forest },
  primary: {
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: palette.forest,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.md,
  },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { ...text.bodyStrong, color: palette.white, writingDirection: "rtl" },
  secondaryRow: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.sm,
  },
  secondary: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.xs,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.forest,
    backgroundColor: palette.white,
  },
  secondaryText: { ...text.navBody, color: palette.forest, writingDirection: "rtl" },
  safety: {
    ...text.caption,
    color: palette.muted,
    marginTop: space.md,
    textAlign: "right",
    writingDirection: "rtl",
  },
  pressed: { opacity: 0.72 },
});
```

If `text.body` does not exist in `apps/mobile/src/theme/typography.js` (check its exported tokens), use the nearest body-size token that exists (e.g. `text.navBody`); do not invent raw font sizes.

- [ ] **Step 2: Verify tokens and lint-level sanity**

Run: `node tests/test-mobile-typography.mjs && node tests/test-typography-guard.mjs`
Expected: PASS (guards scan mobile sources for raw font styles).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/planner/RideIntroCard.jsx
git commit -m "feat(mobile): slim pre-ride intro card component"
```

---

### Task 6: Demote RideSetupSheet to the ride-settings screen

**Files:**
- Modify: `apps/mobile/src/planner/RideSetupSheet.jsx`

**Interfaces:**
- Consumes: `rideSetupLocationNotice` from Task 1.
- Produces (used by Task 8): the same component and props, minus tier-dependent behavior: the primary button is always `אישור` and simply calls `onConfirm`; the sheet no longer decides what happens next. All option controls (direction, start modes, haptics, voice, lock-screen, consequence summary) stay.

- [ ] **Step 1: Apply the edits**

In `apps/mobile/src/planner/RideSetupSheet.jsx`:

(a) Delete the local `locationMessage` function and import the shared one instead. Add to the imports:

```js
import { rideSetupLocationNotice } from "@cycleways/core/navigation/rideIntroPresentation.js";
```

and change its call site from `locationMessage(locationStatus, plan?.locationQuality)` to `rideSetupLocationNotice(locationStatus, plan?.locationQuality)`.

(b) Delete the `primaryLabel(plan)` function. In the primary button JSX replace `{primaryLabel(plan)}` with `{"אישור"}`.

(c) Retitle. Replace:

```jsx
            <Text style={styles.title}>הכנת הרכיבה</Text>
            <Text style={styles.subtitle}>בחרו כיוון ונקודת התחלה לפני הניווט</Text>
```

with:

```jsx
            <Text style={styles.title}>הגדרות רכיבה</Text>
            <Text style={styles.subtitle}>כיוון, נקודת התחלה והעדפות הנחיה</Text>
```

(d) Remove the far-tier summary line — delete this block (the card owns the situation now):

```jsx
              {plan.approachTier === "far" ? (
                <Text style={styles.farText}>המסלול רחוק. מומלץ להגיע לנקודת ההתחלה בעזרת אפליקציית ניווט.</Text>
              ) : null}
```

and the now-unused `farText` style.

(e) Remove the safety note block (it moved to the intro card, which is the mandatory path) — delete the `<View style={styles.safetyNote}>…</View>` block and the `safetyNote` / `safetyNoteText` styles.

- [ ] **Step 2: Verify**

Run: `node tests/test-mobile-typography.mjs && node tests/test-typography-guard.mjs`
Expected: PASS. Also `grep -n "locationMessage\|primaryLabel\|farText\|safetyNote" apps/mobile/src/planner/RideSetupSheet.jsx` returns nothing.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/planner/RideSetupSheet.jsx
git commit -m "refactor(mobile): RideSetupSheet becomes the opt-in ride-settings screen"
```

---

### Task 7: ApproachPanel component + NavPanel trim

**Files:**
- Create: `apps/mobile/src/planner/ApproachPanel.jsx`
- Modify: `apps/mobile/src/planner/NavPanel.jsx`

**Interfaces:**
- Consumes: `getNavigationPresentation` fields `approachHeading`, `destinationLabel`, `approachDistanceShort`, `approachSupportText`, `approachBearingDeg`, `guidanceArrowDeg`; `sessionState.cameraIntent`.
- Produces (used by Task 9):
  - `ApproachPanel({ sessionState, compassHeading, onOpenExternal, onOpenSettings, onStop, onRecenter })` — the waiting-state overlay rendered ONLY while `status === "approaching"`.
  - `NavPanel` loses the `onOpenExternal` and `onChangeRideSettings` props and its `approach` card mode; `off-route`, `cue`, `status`, and `arrived` modes are unchanged.

- [ ] **Step 1: Create ApproachPanel**

Create `apps/mobile/src/planner/ApproachPanel.jsx`:

```jsx
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getNavigationPresentation } from "@cycleways/core/navigation/navigationPresentation.js";
import Icon from "./Icon.jsx";
import { palette, radius, space } from "./theme.js";
import { text } from "../theme/typography.js";

// Waiting-state overlay for the pre-route approach: a bearing pointer and a
// live distance, deliberately NOT dressed as active navigation (no data pill,
// no pause/mute). Route guidance earns the navigation chrome only after the
// start is acquired (plans/navigation-intro-rethink/design.md).
export default function ApproachPanel({
  sessionState,
  compassHeading = null,
  onOpenExternal,
  onOpenSettings,
  onStop,
  onRecenter,
}) {
  const insets = useSafeAreaInsets();
  const p = getNavigationPresentation(sessionState);
  const showRecenter = sessionState?.cameraIntent === "free";
  // Phone-relative arrow when the compass is available, movement-course otherwise.
  const arrowDeg =
    Number.isFinite(p.approachBearingDeg) && Number.isFinite(compassHeading)
      ? ((p.approachBearingDeg - compassHeading) % 360 + 360) % 360
      : p.guidanceArrowDeg;
  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={[styles.banner, { marginTop: insets.top + space.sm }]}>
        <Text style={styles.heading}>{p.approachHeading}</Text>
        <View style={styles.pointerRow}>
          {Number.isFinite(arrowDeg) ? (
            <View style={{ transform: [{ rotate: `${arrowDeg}deg` }] }}>
              <Icon name="navigate" color={palette.forest} size={26} />
            </View>
          ) : null}
          <Text style={styles.pointerText} numberOfLines={1}>
            {p.destinationLabel}
            {p.approachDistanceShort ? ` · ${p.approachDistanceShort}` : ""}
          </Text>
        </View>
        {p.approachSupportText ? (
          <Text style={styles.support}>{p.approachSupportText}</Text>
        ) : null}
      </View>

      {showRecenter ? (
        <View style={[styles.recenterWrap, { bottom: insets.bottom + 96 }]}>
          <ActionButton icon="locate-outline" label="מרכוז" onPress={onRecenter} />
        </View>
      ) : null}

      <View style={[styles.controls, { marginBottom: insets.bottom + space.md }]}>
        <ActionButton
          icon="open-outline"
          label="אפליקציית ניווט"
          onPress={onOpenExternal}
        />
        <ActionButton
          icon="options-outline"
          label="הגדרות רכיבה"
          onPress={onOpenSettings}
        />
        <ActionButton icon="stop" label="סיום" danger onPress={onStop} />
      </View>
    </View>
  );
}

function ActionButton({ icon, label, onPress, danger = false }) {
  return (
    <View style={styles.actionWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.actionBtn,
          danger ? styles.actionBtnDanger : null,
          pressed ? styles.pressed : null,
        ]}
      >
        <Icon name={icon} color={danger ? palette.white : palette.ink} size={22} />
      </Pressable>
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    elevation: 20,
    justifyContent: "space-between",
    paddingHorizontal: space.md,
  },
  banner: {
    backgroundColor: palette.paper,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  heading: {
    ...text.navBody,
    color: palette.ink,
    writingDirection: "rtl",
    textAlign: "right",
    marginBottom: space.xs,
  },
  pointerRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.md,
  },
  pointerText: {
    ...text.navTitle,
    color: palette.ink,
    writingDirection: "rtl",
    textAlign: "right",
    flex: 1,
  },
  support: {
    ...text.navCaption,
    color: palette.muted,
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: space.xs,
  },
  controls: {
    flexDirection: "row-reverse",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: space.lg,
  },
  recenterWrap: { position: "absolute", left: space.md },
  actionWrap: { alignItems: "center", gap: 4, maxWidth: 96 },
  actionBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  actionBtnDanger: { backgroundColor: palette.danger },
  actionLabel: {
    ...text.navCaption,
    color: palette.ink,
    writingDirection: "rtl",
  },
  pressed: { opacity: 0.85 },
});
```

- [ ] **Step 2: Trim NavPanel**

In `apps/mobile/src/planner/NavPanel.jsx`:

(a) Remove `onOpenExternal` and `onChangeRideSettings` from the props destructuring.

(b) In `dataPillMainText`, remove the approach fallback — replace:

```js
  const dataPillMainText =
    p.remainingText ||
    (p.cardMode === "approach"
      ? "בדרך למסלול"
      : p.cardMode === "off-route"
        ? "חזרה למסלול"
        : "");
```

with:

```js
  const dataPillMainText =
    p.remainingText || (p.cardMode === "off-route" ? "חזרה למסלול" : "");
```

(c) Change the branch condition `p.cardMode === "approach" || p.cardMode === "off-route" ? (` to `p.cardMode === "off-route" ? (`, and inside that branch delete the entire `{p.cardMode === "approach" ? (<View style={styles.approachActions}>…</View>) : null}` block (the two `destBtn` buttons). Keep the heading/arrow/support rendering — off-route still uses it (`חזרה למסלול`).

(d) Delete the now-unused styles `approachActions`, `destBtn`, `destBtnPressed`, `destBtnText` ONLY if nothing else references them (grep first — `destBtnPressed` is also used by the arrival card's done-button pressed state; keep anything still referenced).

- [ ] **Step 3: Verify**

Run: `node tests/test-mobile-typography.mjs && node tests/test-typography-guard.mjs`
Expected: PASS. `grep -n "cardMode === \"approach\"" apps/mobile/src/planner/NavPanel.jsx` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/planner/ApproachPanel.jsx apps/mobile/src/planner/NavPanel.jsx
git commit -m "feat(mobile): waiting-style ApproachPanel; NavPanel drops the approach mode"
```

---

### Task 8: BuildScreen — the intro card is the blocking step

This task rewires entry, confirmation, and settings. The screen must build and behave at the end of the task (the approach-state overlay switch lands in Task 9; until then NavPanel's off-route/status modes still cover approaching via `statusText`, which is acceptable mid-plan).

**Files:**
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Interfaces:**
- Consumes: `RideIntroCard` (Task 5), demoted `RideSetupSheet` (Task 6), `confirmDistanceBucket` (Task 1).
- Produces (used by Task 9): state `rideIntroVisible`, `rideSettingsVisible`, ref `rideSettingsOriginRef`, callbacks `openRideIntro(options)`, `handleIntroExternalNav()`, and a `confirmRidePlan(plan)` that ALWAYS starts the CycleWays session.

- [ ] **Step 1: Imports**

In the `@cycleways/core` import block (~line 45), remove `canFastStartRidePlan,` and add:

```js
import { confirmDistanceBucket } from "@cycleways/core/navigation/rideIntroPresentation.js";
```

Next to the `RideSetupSheet` import add:

```js
import RideIntroCard from "../planner/RideIntroCard.jsx";
```

- [ ] **Step 2: State**

Replace `const [rideSetupVisible, setRideSetupVisible] = useState(false);` with:

```js
  const [rideIntroVisible, setRideIntroVisible] = useState(false);
  const [rideSettingsVisible, setRideSettingsVisible] = useState(false);
  // Where the settings screen returns on confirm: the intro card, or straight
  // back into the approach state it interrupted.
  const rideSettingsOriginRef = useRef("intro");
```

- [ ] **Step 3: Rename `openRideSetup` → `openRideIntro`**

Replace the `openRideSetup` callback with:

```js
  const openRideIntro = useCallback(
    (options = {}) => {
      const preserveSelection = options?.preserveSelection === true;
      if (!preserveSelection) {
        setRideSetupSelection(DEFAULT_RIDE_SETUP_SELECTION);
      }
      setPendingExternalPlan(null);
      setRideIntroVisible(true);
      trackNavigationEvent("ride_setup_opened", {
        restored: preserveSelection,
      });
      void refreshRideSetupLocation();
      void refreshNavigationPermissionStatus();
    },
    [refreshNavigationPermissionStatus, refreshRideSetupLocation],
  );
```

Update every other `openRideSetup(` call site to `openRideIntro(` — there are three: the restore-params effect (~line 2027), `handleChangeRideSettings`'s `reopen` (rewritten in Step 6), and the external-handoff AppState return effect (~line 1431).

- [ ] **Step 4: `confirmRidePlan` always starts the session**

Replace the `completeConfirmation` closure inside `confirmRidePlan` with:

```js
      const completeConfirmation = () => {
        setConfirmedRidePlan(plan);
        trackNavigationEvent("ride_setup_confirmed", {
          direction: plan.direction,
          startMode: plan.startMode,
          distanceBucket: confirmDistanceBucket(plan.distanceToStartMeters),
          voiceGuidance: voiceGuidanceEnabled,
          lockScreenGuidance: lockScreenGuidanceEnabled,
        });
        setRideIntroVisible(false);
        setRideSettingsVisible(false);
        void clearPendingRideIntent();
        setPendingNavigationRouteId(plan.effectiveRoute.id);
      };
```

Also: delete the `const willStartCycleWays = …` line and remove `willStartCycleWays &&` from the lock-screen explainer condition; remove the now-unused `options` parameter and `options.fastStart` ternary (the signature becomes `(plan) => {…}`).

- [ ] **Step 5: `handleStartNavigation` shrinks; fast start is gone**

Replace the whole `handleStartNavigation` callback (~lines 1068–1092) with:

```js
  const handleStartNavigation = useCallback(() => {
    openRideIntro();
  }, [openRideIntro]);
```

Delete `handleRideSetupConfirm` (~lines 1064–1066) — the card and settings sheet call `confirmRidePlan` through the new handlers below.

- [ ] **Step 6: Settings-flow handlers**

Immediately after `confirmRidePlan`, add:

```js
  const handleIntroConfirm = useCallback(() => {
    confirmRidePlan(ridePlan);
  }, [confirmRidePlan, ridePlan]);

  const handleIntroOpenSettings = useCallback(() => {
    rideSettingsOriginRef.current = "intro";
    setRideIntroVisible(false);
    setRideSettingsVisible(true);
    trackNavigationEvent("ride_settings_opened", { origin: "intro" });
  }, []);

  // External chooser from the intro card: remember the plan so the pending
  // ride intent is persisted and the card reopens on return.
  const handleIntroExternalNav = useCallback(() => {
    setPendingExternalPlan(ridePlan);
    setRideIntroVisible(false);
    setDestSheetVisible(true);
  }, [ridePlan]);

  const handleIntroClose = useCallback(() => {
    setRideIntroVisible(false);
    trackNavigationEvent("ride_setup_cancelled");
    void clearPendingRideIntent();
  }, []);

  const handleRideSettingsConfirm = useCallback(() => {
    setRideSettingsVisible(false);
    if (rideSettingsOriginRef.current === "approach") {
      confirmRidePlan(ridePlan);
      return;
    }
    setRideIntroVisible(true);
  }, [confirmRidePlan, ridePlan]);

  const handleRideSettingsClose = useCallback(() => {
    setRideSettingsVisible(false);
    setRideIntroVisible(true);
  }, []);
```

(`setDestSheetVisible` is declared later in the file at ~line 1557; if the linter complains about use-before-declaration in the callback, move the `destSheetVisible` / `pickOnMapMode` state declarations up next to the ride-intro state — they are plain `useState` calls with no dependencies.)

Then rewrite `handleChangeRideSettings`'s `reopen` closure:

```js
    const reopen = () => {
      nav.stop();
      setConfirmedRidePlan(null);
      setPendingNavigationRouteId(null);
      rideSettingsOriginRef.current = "approach";
      setRideSettingsVisible(true);
      trackNavigationEvent("ride_settings_opened", { origin: "approach" });
      void refreshRideSetupLocation();
      void refreshNavigationPermissionStatus();
    };
```

and update that callback's dependency array to `[nav.state?.progress?.hasAcquiredRoute, nav.stop, refreshNavigationPermissionStatus, refreshRideSetupLocation]`.

- [ ] **Step 7: Remaining `rideSetupVisible` references**

- `mapPickHandlerRef.current` (~line 1575): `setRideSetupVisible(true)` → `setRideSettingsVisible(true)`.
- Pick-hint cancel button (~line 2570): `setRideSetupVisible(true)` → `setRideSettingsVisible(true)`.
- `directRideSetupPending` (~line 2133): `!rideSetupVisible` → `!rideIntroVisible`.
- Setup preview overlays (~lines 2191 and 2196): change both conditions from `(rideSetupVisible || pickOnMapMode)` to `(rideIntroVisible || rideSettingsVisible || pickOnMapMode)` — the effective-route preview and flag marker now also show behind the intro card.
- Hide the planner sheet behind the card: change `) : directRideSetupPending ? null : (` (~line 2468) to `) : directRideSetupPending || rideIntroVisible ? null : (`.

After this step `grep -n "rideSetupVisible" apps/mobile/src/screens/BuildScreen.jsx` must return nothing.

- [ ] **Step 8: Render the card and rewire the sheets**

Replace the `<RideSetupSheet …/>` element (~lines 2518–2551) with:

```jsx
      <RideIntroCard
        visible={rideIntroVisible && !pickOnMapMode}
        plan={ridePlan}
        locationStatus={rideSetupLocationStatus}
        onConfirm={handleIntroConfirm}
        onOpenExternal={handleIntroExternalNav}
        onOpenSettings={handleIntroOpenSettings}
        onRefreshLocation={refreshRideSetupLocation}
        onClose={handleIntroClose}
      />
      <RideSetupSheet
        visible={rideSettingsVisible}
        plan={ridePlan}
        selection={rideSetupSelection}
        locationStatus={rideSetupLocationStatus}
        reverseAllowed={sourceNavigationRoute?.routeShape?.type !== "one_way"}
        hapticsEnabled={nav.hapticsEnabled}
        onToggleHaptics={() => nav.setHapticsEnabled(!nav.hapticsEnabled)}
        voiceEnabled={voiceGuidanceEnabled}
        onToggleVoice={handleToggleVoiceGuidance}
        lockScreenGuidanceEnabled={lockScreenGuidanceEnabled}
        lockScreenGuidanceHasAlwaysPermission={lockScreenGuidanceHasAlwaysPermission}
        lockScreenGuidanceNeedsSettings={lockScreenGuidanceNeedsSettings}
        onToggleLockScreenGuidance={handleToggleLockScreenGuidance}
        onOpenLocationSettings={handleOpenLocationSettings}
        onTestVoice={handleTestVoiceGuidance}
        onDirectionChange={(direction) =>
          setRideSetupSelection((current) => ({ ...current, direction }))
        }
        onStartModeChange={(startMode) =>
          setRideSetupSelection((current) => ({ ...current, startMode }))
        }
        onPickCustom={() => {
          setRideSettingsVisible(false);
          setPickOnMapMode(true);
        }}
        onRefreshLocation={refreshRideSetupLocation}
        onConfirm={handleRideSettingsConfirm}
        onClose={handleRideSettingsClose}
      />
```

And in `DestinationSheet`'s `onClose` (~line 2558), change `if (pendingExternalPlan) setRideSetupVisible(true);` to `if (pendingExternalPlan) setRideIntroVisible(true);`.

- [ ] **Step 9: Verify and commit**

Run: `node tests/test-mobile-typography.mjs && node tests/test-typography-guard.mjs && grep -c "canFastStartRidePlan" apps/mobile/src/screens/BuildScreen.jsx || true`
Expected: typography tests PASS; the grep count is `0`.

Launch the app if a simulator is available (`cd apps/mobile && npx expo start --ios`) and smoke-check: open a route → נווט → the slim card appears over the map with a distance headline; `הגדרות רכיבה` opens the full sheet and `אישור` returns to the card.

```bash
git add apps/mobile/src/screens/BuildScreen.jsx
git commit -m "feat(mobile): intro card replaces the ride-setup sheet as the blocking step"
```

---

### Task 9: BuildScreen — one live approach state

**Files:**
- Modify: `apps/mobile/src/screens/BuildScreen.jsx`

**Interfaces:**
- Consumes: `ApproachPanel` (Task 7), rejoin-only suggestion state (Task 2), `openRideIntro` / `handleChangeRideSettings` (Task 8), existing `fitCameraToPoints` helper already imported in this file.
- Produces: the finished flow — ApproachPanel during `approaching`, dashed suggestion rendered only off-route, external-app return re-opens the intro card, camera frames rider + start when the card opens.

- [ ] **Step 1: Import ApproachPanel**

```js
import ApproachPanel from "../planner/ApproachPanel.jsx";
```

- [ ] **Step 2: Overlay switch**

Replace the `{isNavigating ? (<><NavPanel …/></>) : …}` opening (~lines 2451–2467) with:

```jsx
      {isNavigating ? (
        navStatus === "approaching" ? (
          <ApproachPanel
            sessionState={navPanelState}
            compassHeading={compassHeading}
            onOpenExternal={() => setDestSheetVisible(true)}
            onOpenSettings={handleChangeRideSettings}
            onStop={nav.stop}
            onRecenter={handleRecenter}
          />
        ) : (
          <NavPanel
            sessionState={navPanelState}
            onRecenter={handleRecenter}
            onPauseResume={() =>
              navStatus === "paused" ? nav.resume() : nav.pause()
            }
            onStop={nav.stop}
            compassHeading={compassHeading}
            voiceEnabled={nav.voiceEnabled}
            onToggleVoice={handleToggleVoiceGuidance}
            lockScreenGuidanceActive={nav.lockScreenGuidanceActive}
          />
        )
      ) : directRideSetupPending || rideIntroVisible ? null : (
```

(Note: `onOpenExternal`/`onChangeRideSettings` are no longer NavPanel props — Task 7 removed them. One subtlety: if the session pauses while approaching, `navStatus` is `"paused"` and NavPanel renders its status card; that is acceptable because ApproachPanel offers no pause control.)

- [ ] **Step 3: Suggestion line renders off-route only**

Replace (~lines 1481–1485):

```js
  const showSuggestion =
    showApproachLines &&
    navPresentation.tier === "near" &&
    Array.isArray(suggestionGeometry) &&
    suggestionGeometry.length >= 2;
```

with:

```js
  // The dashed road-preferring suggestion is rejoin-only; the pre-route
  // approach shows just the thin direct line (design: navigation-intro-rethink).
  const showSuggestion =
    navStatus === "off-route" &&
    navPresentation.tier === "near" &&
    Array.isArray(suggestionGeometry) &&
    suggestionGeometry.length >= 2;
```

(With Task 2 the geometry can't exist while approaching anyway; this makes the intent explicit and keeps rejoin behavior identical.)

- [ ] **Step 4: Start marker visible during approach**

Just before the `return (` of the main render, add:

```js
  const startMarkerPoint =
    navStatus === "approaching"
      ? confirmedRidePlan?.selectedPoint ?? null
      : rideIntroVisible || rideSettingsVisible || pickOnMapMode
        ? ridePlan?.selectedPoint ?? null
        : null;
```

and replace the flag-marker condition (~line 2196, as rewritten in Task 8) with:

```jsx
        {startMarkerPoint ? (
          <MarkerView
            coordinate={[startMarkerPoint.lng, startMarkerPoint.lat]}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
          >
            <View style={styles.setupStartMarker}>
              <Icon name="flag" size={18} color={palette.white} />
            </View>
          </MarkerView>
        ) : null}
```

- [ ] **Step 5: Camera frames rider + start when the card opens**

Near the other fit constants (grep `PLAYBACK_FIT_BOTTOM_PADDING` for the constants area), add:

```js
// Bottom padding when framing rider + route start behind the intro card.
const RIDE_INTRO_FIT_BOTTOM_PADDING = 320;
```

After the `fitRoute` callback definition (~line 2054), add:

```js
  // Frame the rider and the effective start together while the intro card is
  // open, so the "you are here, the start is there" gap is visible at a glance.
  useEffect(() => {
    if (!rideIntroVisible) return;
    const start = ridePlan?.selectedPoint;
    if (!start) return;
    const fixPoint =
      rideSetupFix &&
      Number.isFinite(Number(rideSetupFix.lat)) &&
      Number.isFinite(Number(rideSetupFix.lng))
        ? { lat: Number(rideSetupFix.lat), lng: Number(rideSetupFix.lng) }
        : null;
    stopFollowingLocation();
    fitCameraToPoints(
      cameraRef.current,
      fixPoint ? [fixPoint, start] : ridePlan?.effectiveRoute?.geometry ?? [start],
      RIDE_INTRO_FIT_BOTTOM_PADDING,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rideIntroVisible,
    rideSetupFix?.lat,
    rideSetupFix?.lng,
    ridePlan?.selectedPoint?.lat,
    ridePlan?.selectedPoint?.lng,
    stopFollowingLocation,
  ]);
```

- [ ] **Step 6: External return re-opens the card (already wired) — verify**

Task 8's rename means the AppState effect (~line 1431) now calls `openRideIntro({ preserveSelection: true })` after returning from the external app, and `openRideIntro` refreshes the fix so the card re-evaluates the distance. Confirm by reading the effect; also confirm `handleOpenExternalApp` (~line 1437) still persists the pending ride intent via `savePendingRideIntent` and update its analytics payload: replace `approachTier: pendingExternalPlan?.approachTier || "near",` with:

```js
        distanceBucket: confirmDistanceBucket(
          pendingExternalPlan?.distanceToStartMeters ??
            confirmedRidePlan?.distanceToStartMeters,
        ),
```

- [ ] **Step 7: Verify and commit**

Run: `node tests/test-mobile-typography.mjs && node tests/test-typography-guard.mjs`
Expected: PASS.

Simulator smoke-check with the dev scenario picker (`__DEV__` build): run the `approach-from-distance` scenario — expect the ApproachPanel (heading `בדרך למסלול`, arrow + distance, three round buttons, NO data pill / pause), only the thin direct line on the map (no dashed suggestion), then the acquisition banner and normal cue navigation. Run `off-route-excursion` — the dashed rejoin suggestion must still appear.

```bash
git add apps/mobile/src/screens/BuildScreen.jsx
git commit -m "feat(mobile): single live approach state with ApproachPanel; suggestion line is rejoin-only"
```

---

### Task 10: Remove the fast-start core helper

`canFastStartRidePlan` has no callers after Task 8 (verify: `grep -rn "canFastStartRidePlan" apps src packages --include="*.js*" | grep -v test` returns only the definition).

**Files:**
- Modify: `packages/core/src/navigation/ridePlan.js` (delete the `canFastStartRidePlan` export, ~lines 133–143)
- Modify: `tests/test-ride-plan.mjs` (delete its import at line 5 and the four assertion blocks at ~lines 83–98)

- [ ] **Step 1: Delete the function and its tests**

Remove the `canFastStartRidePlan` function from `ridePlan.js`; in `tests/test-ride-plan.mjs` remove `canFastStartRidePlan,` from the import and delete the assertion blocks that call it (keep the plan fixtures if other assertions use them — check before deleting whole blocks).

- [ ] **Step 2: Verify**

Run: `node tests/test-ride-plan.mjs && grep -rn "canFastStartRidePlan" apps src packages tests | wc -l`
Expected: test PASS; grep count `0`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/navigation/ridePlan.js tests/test-ride-plan.mjs
git commit -m "chore(core): remove unused fast-start ride-plan helper"
```

---

### Task 11: Full verification, docs, device acceptance

**Files:**
- Modify: `plans/README.md` (the `navigation-intro-rethink/` line: "design for" → "design and implementation plan for")

- [ ] **Step 1: Run the navigation-related test set**

```bash
node tests/test-ride-plan.mjs && \
node tests/test-ride-intro-presentation.mjs && \
node tests/test-pending-ride-plan.mjs && \
node tests/test-navigation-session.mjs && \
node tests/test-navigation-presentation.mjs && \
node tests/test-nav-scenarios.mjs && \
node tests/test-nav-scenario-runner.mjs && \
node tests/test-nav-scenario-expectations.mjs && \
node tests/test-nav-scenario-resolve.mjs && \
node tests/test-compute-connector.mjs && \
node tests/test-connector-targeting.mjs && \
node tests/test-external-nav.mjs && \
node tests/test-navigation-replay.mjs && \
npm run test:typography
```

Expected: all PASS.

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS (long; catches any missed chain edits from Tasks 1 and 3).

- [ ] **Step 3: Update `plans/README.md` and commit**

```bash
git add plans/README.md
git commit -m "docs: navigation intro rethink implemented"
```

- [ ] **Step 4: Physical-device acceptance (requires the user / a device — report, don't fake)**

Checklist against the design's acceptance criteria:

1. Far from a route (>1 km), tap נווט from a featured route: slim card over a visible map framed to show both you and the start; headline states the distance; primary `צא לדרך`.
2. Confirm: ApproachPanel waiting state — live distance counts down, no pause/mute/data-pill, no dashed line.
3. From the card, open Google Maps via `אפליקציית ניווט` (cycling mode), return to the app: the card reopens with a re-evaluated distance. Kill the app during handoff and relaunch: the pending plan restores.
4. Standing at the start: card says `אתה בנקודת ההתחלה`; primary `התחל ניווט במסלול` goes (via instant acquisition) into cue navigation with the acquisition banner + haptic.
5. `הגדרות רכיבה` from the card: reverse direction and custom start still work end-to-end; confirm returns to the card with updated headline/consequences; from the approach state, settings confirm re-enters approach.
6. Go off-route after acquisition: rejoin flow (dashed suggestion + red banner) is unchanged.
