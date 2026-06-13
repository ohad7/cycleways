# Mobile Bottom-Sheet Implementation Plan (discovery-surface D2+D5+D4, roadmap step 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-12
**Design:** [design.md](design.md) — D2 (bottom-sheet mobile layout), D5 (first-screen two-action story), D4 (catalog unification), plus the deferred Discover filter-state lift from the step-1 plan.

**Goal:** On phones the map becomes the full-height stage with the Discover/Build panel in a draggable bottom sheet (peek / half / full); the peek state presents exactly two actions (מצאו מסלול מוכן / בנו מסלול); Discover cards link to their route page; filters survive the Discover↔Build toggle. Desktop is unchanged.

**Architecture:** A `BottomSheet` wrapper around the existing `FrontPanel` — CSS-inert on desktop (it just becomes the 408px flex column), absolutely positioned and `translateY`-driven at ≤860px. Snap selection is a pure, node-tested helper (`sheetSnap.js`); drag happens only on a handle strip (panel body keeps native scrolling, and `useCardViewport`'s `.front-panel__body` observer root keeps working). App owns the snap state and the snap behaviors (select route → peek, "בנו מסלול" → build at peek). Filter state lifts from `DiscoverPanel` to App so the panel can unmount freely.

**Tech Stack:** React 19, CSS transforms + `dvh`, touch events (no new deps), node assert tests for the snap math, Playwright e2e (mobile = Pixel 5 project).

**Two phases, independently testable.** STOP after Phase A for user testing; Phase B is content-level and cheap.

**Execution notes:** Worktree branch (e.g. `step-4-sheet`) off the current `claude/fable-ux-improvements-step2` HEAD. Known pre-existing/flaky e2e (NOT yours): `routes-index.spec.mjs:8`, `:114`, `featured-index.spec.mjs:37` (+hash-scroll flakes), `react-migration-smoke.spec.mjs:81`; `viewport-meta`/`loading-splash`/`routes-index-mobile-filters` can flake under parallel load (green serially).

**⚠ Existing-spec impact (read before Task 3):** several mobile e2e flows tap panel content (`discover-route-select`, `planner-retention`, `locate-me`, `front-panel`, `send-to-phone`, `planner-hints`). Once the sheet defaults to peek, that content is off-screen until the sheet opens. Task 3 ships a shared helper and updates every affected spec — budget for it; do not "fix" failures by weakening assertions.

---

## Phase A — sheet mechanics (D2 + D5)

### Task 1: Pure snap math

**Files:**
- Create: `src/components/frontPanel/sheetSnap.js`
- Test: `tests/test-sheet-snap.mjs` (create)
- Modify: `package.json` (test chain, next to `test-panel-state.mjs`)

- [ ] **Step 1: Failing test.** Create `tests/test-sheet-snap.mjs`:

```js
import assert from "node:assert/strict";
import {
  SNAPS,
  offsetsForHeight,
  resolveSnap,
  nextSnap,
} from "../src/components/frontPanel/sheetSnap.js";

// Offsets: peek leaves PEEK_PX visible, half is 50%, full leaves a top gap.
{
  const o = offsetsForHeight(800);
  assert.deepEqual(SNAPS, ["full", "half", "peek"]);
  assert.equal(o.peek, 800 - 96);
  assert.equal(o.half, 400);
  assert.equal(o.full, 12);
  assert.equal(offsetsForHeight(0).peek, 0, "degenerate height clamps to 0");
}

// resolveSnap projects the fling and picks the nearest snap offset.
{
  const o = offsetsForHeight(800); // full=12, half=400, peek=704
  assert.equal(resolveSnap(420, 0, o), "half", "released near half settles at half");
  assert.equal(resolveSnap(60, 0, o), "full");
  assert.equal(resolveSnap(650, 0, o), "peek");
  // Downward fling (positive velocity) from half lands on peek.
  assert.equal(resolveSnap(420, 1.2, o), "peek");
  // Upward fling (negative) from half lands on full.
  assert.equal(resolveSnap(420, -1.2, o), "full");
}

// nextSnap cycles peek → half → full → peek (the tap-the-handle affordance).
{
  assert.equal(nextSnap("peek"), "half");
  assert.equal(nextSnap("half"), "full");
  assert.equal(nextSnap("full"), "peek");
  assert.equal(nextSnap("bogus"), "half", "unknown states recover to half");
}

console.log("sheet snap tests passed");
```

Run: `node tests/test-sheet-snap.mjs` → FAIL (module not found). (Note the relative import — this file is web-side `src/`, not `@cycleways/core`.)

- [ ] **Step 2: Implement.** Create `src/components/frontPanel/sheetSnap.js`:

```js
// Pure snap math for the mobile bottom sheet. Offsets are translateY pixels
// from the top of the shell (small offset = sheet mostly open).
export const SNAPS = ["full", "half", "peek"];
export const PEEK_PX = 96;
const TOP_GAP_PX = 12;
// How far (ms) a fling is projected forward before picking the nearest snap.
const FLING_LOOKAHEAD_MS = 150;

export function offsetsForHeight(shellHeight) {
  const h = Math.max(shellHeight, 0);
  return {
    full: Math.min(TOP_GAP_PX, h),
    half: Math.round(h * 0.5),
    peek: Math.max(h - PEEK_PX, 0),
  };
}

export function resolveSnap(offsetPx, velocityPxPerMs, offsets) {
  const projected = offsetPx + velocityPxPerMs * FLING_LOOKAHEAD_MS;
  let best = "peek";
  let bestDistance = Infinity;
  for (const snap of SNAPS) {
    const distance = Math.abs(offsets[snap] - projected);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = snap;
    }
  }
  return best;
}

export function nextSnap(snap) {
  if (snap === "peek") return "half";
  if (snap === "half") return "full";
  if (snap === "full") return "peek";
  return "half";
}
```

- [ ] **Step 3: Verify, register, commit.** `node tests/test-sheet-snap.mjs` → passes. Add `node tests/test-sheet-snap.mjs && ` to the `test` chain in package.json (next to `node tests/test-panel-state.mjs &&`).

```bash
git add src/components/frontPanel/sheetSnap.js tests/test-sheet-snap.mjs package.json
git commit -m "feat(sheet): pure snap math for the mobile bottom sheet"
```
(Every commit in this plan: append trailer "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>")

---

### Task 2: BottomSheet component + layout CSS + App integration

**Files:**
- Create: `src/components/frontPanel/BottomSheet.jsx`
- Modify: `src/components/frontPanel/front-panel.css` (replace the `@media (max-width: 860px)` block; add sheet rules)
- Modify: `src/App.jsx` (snap state, wrap FrontPanel, peek actions, snap behaviors, fit registry)
- Modify: `styles.css` (mobile `.container` height → `dvh`)

This task has no isolated test of its own — Task 3's e2e is its acceptance test. Implement, then eyeball with `npm run dev` at a phone viewport before committing.

- [ ] **Step 1: The component.** Create `src/components/frontPanel/BottomSheet.jsx`:

```jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  SNAPS,
  offsetsForHeight,
  resolveSnap,
  nextSnap,
} from "./sheetSnap.js";

// Mobile bottom sheet around the front panel. On desktop (>860px) the CSS
// neutralizes it into the plain 408px side column — this component then only
// adds an inert wrapper div. On mobile it is absolutely positioned over the
// map and translateY-driven between peek / half / full snap points. Dragging
// happens ONLY on the handle strip, so the panel body keeps native scrolling.
export default function BottomSheet({ snap, onSnapChange, peekContent, children }) {
  const sheetRef = useRef(null);
  const [shellHeight, setShellHeight] = useState(0);
  const dragRef = useRef(null); // { startY, startOffset, lastY, lastT, velocity }
  const [dragOffset, setDragOffset] = useState(null);

  // Track the shell's height (the sheet's positioning parent) for offsets.
  useEffect(() => {
    const shell = sheetRef.current?.parentElement;
    if (!shell || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setShellHeight(shell.clientHeight));
    ro.observe(shell);
    setShellHeight(shell.clientHeight);
    return () => ro.disconnect();
  }, []);

  const offsets = offsetsForHeight(shellHeight);

  const handleTouchStart = useCallback(
    (event) => {
      const y = event.touches[0].clientY;
      dragRef.current = {
        startY: y,
        startOffset: offsets[snap] ?? 0,
        lastY: y,
        lastT: performance.now(),
        velocity: 0,
      };
    },
    [offsets, snap],
  );

  const handleTouchMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const y = event.touches[0].clientY;
    const now = performance.now();
    const dt = Math.max(now - drag.lastT, 1);
    drag.velocity = (y - drag.lastY) / dt;
    drag.lastY = y;
    drag.lastT = now;
    const offset = Math.max(drag.startOffset + (y - drag.startY), 0);
    setDragOffset(offset);
  }, []);

  const handleTouchEnd = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragOffset((current) => {
      if (current !== null && drag) {
        onSnapChange(resolveSnap(current, drag.velocity, offsetsForHeight(
          sheetRef.current?.parentElement?.clientHeight ?? 0,
        )));
      }
      return null;
    });
  }, [onSnapChange]);

  const dragging = dragOffset !== null;
  const offset = dragging ? dragOffset : offsets[snap] ?? 0;

  return (
    <div
      ref={sheetRef}
      className={`front-sheet front-sheet--${snap}${dragging ? " front-sheet--dragging" : ""}`}
      data-snap={snap}
      style={{ "--sheet-offset": `${offset}px` }}
    >
      <div
        className="front-sheet__handle"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <button
          type="button"
          className="front-sheet__grip"
          aria-label="שנה גודל פאנל"
          onClick={() => onSnapChange(nextSnap(snap))}
        />
      </div>
      {peekContent ? <div className="front-sheet__peek">{peekContent}</div> : null}
      {children}
    </div>
  );
}
```

- [ ] **Step 2: CSS.** In `src/components/frontPanel/front-panel.css`:

a. Desktop-neutral wrapper — the sheet takes over `.front-panel`'s flex slot (adjust the existing `.front-panel { flex: 0 0 408px; ... }` rule):

```css
/* The sheet wrapper owns the desktop flex slot; the panel fills it. */
.front-sheet {
  display: flex;
  flex-direction: column;
  flex: 0 0 408px;
  min-height: 0;
}
.front-sheet .front-panel {
  flex: 1 1 auto;
  min-height: 0;
}
.front-sheet__handle,
.front-sheet__peek {
  display: none; /* mobile-only affordances */
}
```

(Then REMOVE `flex: 0 0 408px;` from the `.front-panel` rule — its `transition` for collapse stays; verify the collapse animation still works on desktop by reading how `.front-shell--collapsed .front-panel` shrinks `flex-basis` — that rule must move to target `.front-shell--collapsed .front-sheet` instead. Update both rules coherently and re-test desktop collapse via the front-panel e2e in Task 3.)

b. Replace the whole existing `@media (max-width: 860px)` block with:

```css
/* Narrow viewports: full-height map stage with the panel in a bottom sheet. */
@media (max-width: 860px) {
  .front-shell {
    position: relative;
    flex-direction: column;
    padding: 0;
    gap: 0;
    height: 100%;
    overflow: hidden;
  }
  .front-shell .map-container {
    min-height: 0;
    height: 100%;
  }
  .front-sheet {
    position: absolute;
    inset: 0 0 auto 0;
    height: 100%;
    z-index: 20;
    flex: none;
    transform: translateY(var(--sheet-offset, 0px));
    transition: transform 0.25s ease;
    will-change: transform;
    border-radius: 16px 16px 0 0;
    background: #fff;
    box-shadow: 0 -6px 24px rgb(40 48 38 / 18%);
  }
  .front-sheet--dragging {
    transition: none;
  }
  .front-sheet__handle {
    display: flex;
    justify-content: center;
    padding: 8px 0 4px;
    touch-action: none;
  }
  .front-sheet__grip {
    width: 44px;
    height: 5px;
    border: none;
    border-radius: 999px;
    background: #d5ddd8;
    cursor: pointer;
  }
  .front-sheet__peek {
    display: none;
  }
  .front-sheet--peek .front-sheet__peek {
    display: flex;
    gap: 10px;
    padding: 4px 14px 12px;
  }
  /* At peek only the handle + actions are useful; hide the panel beneath. */
  .front-sheet--peek .front-panel {
    visibility: hidden;
  }
  .front-panel {
    flex: 1 1 auto;
    max-height: none;
    border-radius: 0;
    border: none;
    box-shadow: none;
    min-height: 0;
  }
  /* The desktop collapse affordance is replaced by the sheet. */
  .front-panel__collapse,
  .front-shell__reopen {
    display: none;
  }
  .front-sheet__peek button {
    flex: 1;
    padding: 12px 10px;
    border-radius: 12px;
    border: 1px solid #dce4df;
    background: #fff;
    font-weight: 800;
    font-size: 0.95rem;
    color: #2f4533;
    cursor: pointer;
  }
  .front-sheet__peek button.primary {
    background: #2f6b3c;
    border-color: #2f6b3c;
    color: #fff;
  }
}
```

c. In `styles.css`, the mobile `.container` rule (~line 439, `height: calc(100vh - 140px) !important`): change `100vh` to `100dvh` (mobile browser chrome makes `vh` lie; check whether the `-140px` headroom still matches the fixed header + margins by inspecting in the browser — adjust the constant if the layout shows a gap, and say what you found).

- [ ] **Step 3: App integration.** In `src/App.jsx`:

```js
import BottomSheet from "./components/frontPanel/BottomSheet.jsx";
```

```js
  const [sheetSnap, setSheetSnap] = useState("peek");
```

Wrap the existing `<FrontPanel ...>` element (keep all its props):

```jsx
              <BottomSheet
                snap={sheetSnap}
                onSnapChange={setSheetSnap}
                peekContent={
                  <>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        handlePanelStateChange("discover");
                        setSheetSnap("half");
                      }}
                    >
                      מצאו מסלול מוכן
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handlePanelStateChange("build");
                        setSheetSnap("peek");
                      }}
                    >
                      בנו מסלול
                    </button>
                  </>
                }
              >
                <FrontPanel ... />
              </BottomSheet>
```

Snap behaviors:
- In `handleSelectRecommended`'s success branch (after `handlePanelStateChange("build")`): `setSheetSnap("peek");` — the user should see the loaded route on the map.
- In the existing `route-points-changed` panel effect (the one calling `resolvePanelState`), when the FIRST point lands the panel auto-switches to build; also drop the sheet so the map is workable: extend that effect to call `setSheetSnap("peek")` when `routePointCount` goes 0→1 (it has the previous count via `panel.lastPointCount` — read the effect and wire it without breaking the reducer).
- Add to `plannerFitRegistry`: `{ selector: ".front-sheet", side: "bottom" },` — route fits then pad above the sheet at any snap.

NOTE on "בנו מסלול" at peek: the Build panel stays hidden (peek hides the panel) — intended: the map is the workspace and the step-3 hint ("לחצו על המפה ליד שביל...") guides the user; stats appear when they drag the sheet up.

- [ ] **Step 4: Eyeball it.** `npm run dev`, browser at 390×844: map fills the stage above a white sheet showing the grip + two action buttons; "מצאו מסלול מוכן" raises the sheet to half with Discover cards scrollable inside; the grip tap cycles snaps; desktop (1280px) is pixel-identical to before including panel collapse. Fix what's off — Task 3's specs will lock it in.

- [ ] **Step 5: Commit.**

```bash
git add src/components/frontPanel/BottomSheet.jsx src/components/frontPanel/front-panel.css src/App.jsx styles.css
git commit -m "feat(mobile): bottom-sheet panel — full-height map with peek/half/full snaps"
```

---

### Task 3: e2e — sheet behaviors + existing-spec repair

**Files:**
- Create: `tests/e2e/sheet-helpers.mjs`
- Test: `tests/e2e/mobile-sheet.spec.mjs` (create)
- Modify: `tests/e2e/discover-route-select.spec.mjs`, `tests/e2e/planner-retention.spec.mjs`, `tests/e2e/locate-me.spec.mjs`, `tests/e2e/send-to-phone.spec.mjs`, `tests/e2e/planner-hints.spec.mjs`, `tests/e2e/front-panel.spec.mjs`

- [ ] **Step 1: Shared helper.** Create `tests/e2e/sheet-helpers.mjs`:

```js
import { expect } from "@playwright/test";

// On mobile the front panel lives in a bottom sheet that defaults to peek
// (content hidden). Call this before interacting with panel content; it is a
// no-op on desktop, where the sheet wrapper is inert.
export async function ensurePanelOpen(page) {
  const sheet = page.locator(".front-sheet");
  if ((await sheet.getAttribute("data-snap")) === null) return; // desktop
  const snap = await sheet.getAttribute("data-snap");
  if (snap === "peek") {
    await sheet.getByRole("button", { name: "שנה גודל פאנל" }).click();
    await expect(sheet).toHaveAttribute("data-snap", "half");
  }
}
```

Wait — on desktop `data-snap` IS rendered (the wrapper always gets it) but the CSS makes it inert. Detect mobile instead by the handle's visibility:

```js
export async function ensurePanelOpen(page) {
  const grip = page.locator(".front-sheet__grip");
  if (!(await grip.isVisible().catch(() => false))) return; // desktop: handle hidden
  const sheet = page.locator(".front-sheet");
  if ((await sheet.getAttribute("data-snap")) === "peek") {
    await grip.click();
    await expect(sheet).toHaveAttribute("data-snap", "half");
  }
}
```

Use the second version only.

- [ ] **Step 2: New spec.** Create `tests/e2e/mobile-sheet.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("mobile: peek shows the two-action story; find-route opens Discover", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const sheet = page.locator(".front-sheet");
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(sheet.getByRole("button", { name: "מצאו מסלול מוכן" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "בנו מסלול" })).toBeVisible();
  // Panel content is hidden at peek.
  await expect(sheet.locator(".panel-route-card").first()).toBeHidden();
  await sheet.getByRole("button", { name: "מצאו מסלול מוכן" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await expect(sheet.locator(".panel-route-card").first()).toBeVisible();
});

test("mobile: selecting a route drops the sheet back to peek", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toHaveAttribute("data-route-status", "ready", { timeout: 30_000 });
  const sheet = page.locator(".front-sheet");
  await sheet.getByRole("button", { name: "מצאו מסלול מוכן" }).click();
  await sheet.locator(".panel-route-card").first().click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  await expect(sheet).toHaveAttribute("data-snap", "peek");
});

test("mobile: בנו מסלול switches to Build and keeps the map front", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only");
  await page.goto("/");
  const sheet = page.locator(".front-sheet");
  await sheet.getByRole("button", { name: "בנו מסלול" }).click();
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await sheet.getByRole("button", { name: "שנה גודל פאנל" }).click();
  await expect(
    page.getByTestId("front-panel").getByRole("tab", { name: "בניית מסלול" }),
  ).toHaveAttribute("aria-selected", "true");
});

test("desktop: no sheet affordances, side panel as before", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop-only");
  await page.goto("/");
  await expect(page.getByTestId("front-panel")).toBeVisible();
  await expect(page.locator(".front-sheet__grip")).toBeHidden();
  await expect(page.locator(".front-sheet__peek")).toBeHidden();
});
```

- [ ] **Step 3: Repair the existing mobile flows.** In each of `discover-route-select.spec.mjs`, `planner-retention.spec.mjs`, `locate-me.spec.mjs`, `send-to-phone.spec.mjs`: import `{ ensurePanelOpen } from "./sheet-helpers.mjs"` and call `await ensurePanelOpen(page)` immediately before the first interaction with panel content (cards, chips, build buttons) in every test/helper (e.g. `loadFirstDiscoverRoute`). In `planner-hints.spec.mjs`: the Build-tab click needs the sheet open first — same helper before `getByRole("tab", ...)`. In `front-panel.spec.mjs`: the toggle test needs `ensurePanelOpen`; the collapse test is desktop-only now — add `test.skip(isMobile, "collapse is desktop-only; mobile uses the sheet")`.

Do NOT weaken any assertion; only add the open-sheet step (and the one documented skip).

- [ ] **Step 4: Run everything that could be affected.**

`npx playwright test tests/e2e/mobile-sheet.spec.mjs tests/e2e/front-panel.spec.mjs tests/e2e/discover-route-select.spec.mjs tests/e2e/planner-retention.spec.mjs tests/e2e/locate-me.spec.mjs tests/e2e/send-to-phone.spec.mjs tests/e2e/planner-hints.spec.mjs --project=desktop --project=mobile 2>&1 | tail -4`
Expected: ALL green. Then `npm test 2>&1 | tail -3` → green.

- [ ] **Step 5: Commit.**

```bash
git add tests/e2e/sheet-helpers.mjs tests/e2e/mobile-sheet.spec.mjs tests/e2e/discover-route-select.spec.mjs tests/e2e/planner-retention.spec.mjs tests/e2e/locate-me.spec.mjs tests/e2e/send-to-phone.spec.mjs tests/e2e/planner-hints.spec.mjs tests/e2e/front-panel.spec.mjs
git commit -m "test(mobile): sheet behaviors e2e + open-sheet repairs for panel flows"
```

---

### Task 4: Phase A verification — STOP for user testing

- [ ] Real-browser smoke (no mock), iPhone-13 viewport, screenshots LOOKED at: (1) first screen = full map + peek sheet with the two actions; (2) מצאו מסלול מוכן → half sheet, cards scroll, map repaints recommended lines behind; (3) select route → peek + route framed above the sheet (fit padding respects the sheet); (4) בנו מסלול → peek + build hint visible on map; (5) drag the handle up/down with `touchscreen` swipes → snaps settle sanely; (6) overlays (locate button, playback transport, point pill) sit above the peek sheet, not under it — adjust bottom offsets in CSS if anything is buried (the transport `.planner-route-playback` mobile `bottom: 15px` likely needs `bottom: calc(96px + 12px)` when the sheet is present; check visually and fix).
- [ ] `npx playwright test --workers=1 2>&1 | tail -8` → only the known pre-existing failures.
- [ ] Merge to `claude/fable-ux-improvements-step2` via superpowers:finishing-a-development-branch. **STOP here; the user tests on a real phone before Phase B.**

---

## Phase B — content (D4 + filter lift)

### Task 5: Lift Discover filter state to App

**Files:**
- Modify: `src/components/frontPanel/DiscoverPanel.jsx` (controlled filters)
- Modify: `src/App.jsx` (own the state)
- Test: extend `tests/e2e/mobile-sheet.spec.mjs`

- [ ] **Step 1: Failing e2e.** Add to `tests/e2e/mobile-sheet.spec.mjs` (runs on BOTH projects — filter loss bites desktop too):

```js
test("Discover filters survive a toggle to Build and back", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toBeVisible();
  const { ensurePanelOpen } = await import("./sheet-helpers.mjs");
  await ensurePanelOpen(page);
  // Activate a difficulty chip in Discover.
  const chip = panel.getByRole("button", { name: "קל", exact: true }).first();
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  // Toggle to Build and back.
  await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  await panel.getByRole("tab", { name: "חפש מסלול" }).click();
  await expect(
    panel.getByRole("button", { name: "קל", exact: true }).first(),
  ).toHaveAttribute("aria-pressed", "true");
});
```

NOTE: check what the Discover `FilterChip` actually renders (`src/components/WelcomeDiscover.jsx`) — if it lacks `aria-pressed`, assert on its active class instead (read the component; `FilterChip` takes an `active` prop). Match reality; don't add aria attributes just for the test unless trivial (adding `aria-pressed={active}` to FilterChip IS trivial and good a11y — prefer that).

Run → FAIL (filters reset because DiscoverPanel unmounts).

- [ ] **Step 2: Lift.** In `src/components/frontPanel/DiscoverPanel.jsx`: remove the local `const [filters, setFilters] = useState(emptyFilters);` and `const [nearMeSort, setNearMeSort] = useState(false);` — receive `filters`, `onFiltersChange`, `nearMeSort`, `onNearMeSortChange` as props; rewrite `toggleAxis`/`addFilterValue`/`removeFilterValue` to call `onFiltersChange(next)` (compute `next` from the `filters` prop with the same Set logic). In `src/App.jsx`:

```js
  const [discoverFilters, setDiscoverFilters] = useState(emptyFilters);
  const [nearMeSort, setNearMeSort] = useState(false);
```

(`emptyFilters` is exported from `src/components/WelcomeDiscover.jsx` — import it.) Pass all four props to `<DiscoverPanel>`.

- [ ] **Step 3: Verify + commit.** The new e2e passes on both projects; `node tests/test-discover-route-list.mjs` and the full mobile-sheet + front-panel specs stay green.

```bash
git add src/components/frontPanel/DiscoverPanel.jsx src/App.jsx src/components/WelcomeDiscover.jsx tests/e2e/mobile-sheet.spec.mjs
git commit -m "feat(discover): filters survive the Discover/Build toggle (state lifted to App)"
```

---

### Task 6: Route-page links on Discover cards (D4)

**Files:**
- Modify: `src/components/frontPanel/PanelRouteCard.jsx`
- Modify: `src/components/frontPanel/front-panel.css`
- Modify: `src/components/frontPanel/DiscoverPanel.jsx` (pass the flag)
- Test: extend `tests/e2e/mobile-sheet.spec.mjs`

- [ ] **Step 1: Failing e2e.** Add:

```js
test("Discover cards link to the route page without hijacking card selection", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toBeVisible();
  const { ensurePanelOpen } = await import("./sheet-helpers.mjs");
  await ensurePanelOpen(page);
  const link = panel.locator(".panel-route-card-wrap").first().getByRole("link", { name: "לעמוד המסלול" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /\/routes\/[a-z0-9-]+/);
});
```

Run → FAIL.

- [ ] **Step 2: Implement.** A link cannot nest inside the card's `<button>`; wrap them as siblings. In `PanelRouteCard.jsx`, change the root to:

```jsx
  return (
    <div className="panel-route-card-wrap">
      <button ...existing card button unchanged... </button>
      <a
        className="panel-route-card__story-link"
        href={`/routes/${entry.slug}`}
        aria-label="לעמוד המסלול"
        onClick={(event) => event.stopPropagation()}
      >
        לעמוד המסלול ←
      </a>
    </div>
  );
```

Move the `ref={cardRef}` carefully: `useCardViewport` observes the card element for the scroll-coupled map — keep `ref={cardRef}` on the WRAPPER div (read `useCardViewport`/`registerCard` usage in DiscoverPanel to confirm the observed element only needs to be the scroll item; the wrapper is). Use a plain `<a>` (the planner page is the `*` route; a full navigation to `/routes/<slug>` is correct and also works from the card list — react-router `Link` would need importing into the panel; plain `<a>` is fine here since it leaves the planner anyway).

CSS (`front-panel.css`):

```css
.panel-route-card-wrap {
  position: relative;
}

.panel-route-card-wrap .panel-route-card {
  width: 100%;
}

.panel-route-card__story-link {
  position: absolute;
  bottom: 8px;
  left: 10px;
  font-size: 0.78rem;
  font-weight: 700;
  color: #2f6b3c;
  text-decoration: none;
}
```

(Verify the card's meta text doesn't collide with the link at 390px width; nudge padding if it does. The design says link only when a story exists — but every catalog entry has a `/routes/<slug>` detail page, so linking all cards is more consistent; this is a deliberate, documented deviation.)

- [ ] **Step 3: Verify + commit.** New e2e green on both projects; `discover-route-select` + `mobile-sheet` specs stay green (card click still loads the route in place — the link must not swallow card taps).

```bash
git add src/components/frontPanel/PanelRouteCard.jsx src/components/frontPanel/DiscoverPanel.jsx src/components/frontPanel/front-panel.css tests/e2e/mobile-sheet.spec.mjs
git commit -m "feat(discover): cards link to the route page"
```

---

### Task 7: Phase B verification

- [ ] `npm test` → green. `npx playwright test --workers=1 2>&1 | tail -8` → only known pre-existing failures.
- [ ] Real-browser spot-check: filters survive toggle; the card link opens `/routes/<slug>`; card tap still loads the route in place.
- [ ] Merge via superpowers:finishing-a-development-branch.
