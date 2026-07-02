# Build Empty-State Guidance Vignette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the empty Build panel (0 route points) with a persistent animated SVG/CSS "how to plan" vignette plus three Hebrew how-to steps.

**Architecture:** One new presentational component (`BuildEmptyGuide.jsx`, no props, no state) rendered by `BuildPanel.jsx` when the route has zero points. All animation is CSS keyframes on inline SVG — no image assets, no JS timers, no storage. The existing on-map `PlannerHints` are untouched.

**Tech Stack:** React 19 (JSX), plain CSS in `front-panel.css`, Playwright e2e (`tests/e2e/`, node-assert style repo conventions).

Spec: `plans/build-empty-guide-vignette/design.md`.

> **⚠️ Mutually exclusive alternative:** This plan competes with
> `plans/build-empty-actions/` for the same UI space (the `build-panel__empty`
> paragraph in `BuildPanel.jsx`). Before starting, check that
> `src/components/frontPanel/BuildEmptyActions.jsx` does NOT exist and
> `BuildPanel.jsx` has no `emptyState` prop. If the other design was already
> implemented, STOP and ask the user.

## Global Constraints

- Hebrew/RTL app. Copy strings must be used **verbatim** as written in the tasks below.
- Do not modify `src/components/PlannerHints.jsx`.
- Do not touch `data/` or `public-data/` (pipeline-owned; see CLAUDE.md).
- The vignette must respect `prefers-reduced-motion: reduce` (static final frame).
- The vignette SVG is decorative: `aria-hidden="true"`; the `<ol>` steps carry meaning.
- Mobile breakpoint used by the planner CSS: `@media (max-width: 860px)`.
- The guide shows only at `routeState.points.length === 0`. With exactly 1 point the existing plain paragraph (`סמנו נקודות על המפה כדי לבנות מסלול.`) must still render.
- Never `git add -A` (build artifacts / generated files may be dirty); stage listed files explicitly.

---

### Task 1: BuildEmptyGuide component (static) wired into BuildPanel

**Files:**
- Create: `src/components/frontPanel/BuildEmptyGuide.jsx`
- Modify: `src/components/frontPanel/BuildPanel.jsx` (empty-state branch, ~lines 65–73)
- Modify: `src/components/frontPanel/front-panel.css` (append structural styles)
- Test: `tests/e2e/build-empty-guide.spec.mjs`

**Interfaces:**
- Consumes: `BuildPanel`'s existing `routeState` prop (`routeState.points` array) and `getPlannerBuildModel(routeState).hasRoute`.
- Produces: `BuildEmptyGuide` — default export, zero props, renders `div[data-testid="build-empty-guide"]` containing an `aria-hidden` SVG (`.build-empty-guide__vignette`) and `ol.build-empty-guide__steps` with exactly 3 `<li>`. Task 2 relies on the SVG class names `beg-bg`, `beg-trail`, `beg-route`, `beg-point--a`, `beg-point--b`, `beg-point__pulse`, `beg-pointer`.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/build-empty-guide.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen, revealMapOnMobile } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

// Mobile lands on the discover-home screen (no map); revealMapOnMobile taps
// "+ תכנן מסלול" which enters Build directly. Desktop uses the panel tab.
async function openEmptyBuild(page, isMobile) {
  await page.goto("/");
  await revealMapOnMobile(page, isMobile);
  await ensurePanelOpen(page);
  if (!isMobile) {
    await page
      .getByTestId("front-panel")
      .getByRole("tab", { name: "בניית מסלול" })
      .click();
  }
}

test("empty Build tab shows the guide vignette and steps", async ({ page, isMobile }) => {
  await openEmptyBuild(page, isMobile);
  const guide = page.getByTestId("build-empty-guide");
  await expect(guide).toBeVisible();
  await expect(guide.locator(".build-empty-guide__steps li")).toHaveCount(3);
  await expect(guide.locator("svg[aria-hidden='true']")).toHaveCount(1);
  // The old one-line empty paragraph is replaced at 0 points.
  await expect(page.locator(".build-panel__empty")).toHaveCount(0);
});

test("guide disappears once a route is loaded", async ({ page, isMobile }) => {
  await page.goto("/");
  const discoverScope = isMobile
    ? page.getByTestId("mobile-discover-home")
    : page.getByTestId("front-panel");
  if (!isMobile) await ensurePanelOpen(page);
  await expect(discoverScope).toBeVisible();
  const card = discoverScope.locator(".panel-route-card-wrap").first();
  await expect(card).toBeVisible();
  const href = await card.getAttribute("href");
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 20_000 });
  // The route page links back into the planner with ?route=; load it directly.
  const plannerHref = await page
    .locator('a[href*="?route="]')
    .first()
    .getAttribute("href");
  await page.goto(plannerHref);
  await ensurePanelOpen(page);
  await expect(page.locator(".build-panel")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("build-empty-guide")).toHaveCount(0);
  await expect(page.locator(".build-panel__stats")).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/e2e/build-empty-guide.spec.mjs --workers=1`
Expected: FAIL — first test times out waiting for `getByTestId("build-empty-guide")` (element does not exist yet). The second test may pass already (no guide anywhere); that is fine — it guards Task 1's wiring condition.

- [ ] **Step 3: Create the component**

Create `src/components/frontPanel/BuildEmptyGuide.jsx`:

```jsx
import React from "react";

// Persistent Build empty state: a decorative animated mini-map (inline
// SVG + CSS, no assets) demonstrating tap → tap → route, plus the three
// planning steps. Rendered only while the route has zero points; the
// on-map PlannerHints keep covering the contextual moments after that.
export default function BuildEmptyGuide() {
  return (
    <div className="build-empty-guide" data-testid="build-empty-guide">
      <svg
        className="build-empty-guide__vignette"
        viewBox="0 0 320 200"
        aria-hidden="true"
        focusable="false"
      >
        <rect className="beg-bg" x="0" y="0" width="320" height="200" rx="12" />
        <path
          className="beg-trail"
          d="M20 150 C 80 120, 120 160, 170 120 S 270 60, 300 40"
        />
        <path
          className="beg-trail beg-trail--alt"
          d="M10 60 C 70 80, 150 40, 220 90 S 290 150, 310 160"
        />
        <path
          className="beg-route"
          d="M60 132 C 100 128, 130 148, 170 120 S 240 78, 262 66"
          pathLength="100"
        />
        <g className="beg-point beg-point--a">
          <circle className="beg-point__pulse" cx="60" cy="132" r="10" />
          <circle className="beg-point__dot" cx="60" cy="132" r="9" />
          <text className="beg-point__num" x="60" y="136" textAnchor="middle">
            1
          </text>
        </g>
        <g className="beg-point beg-point--b">
          <circle className="beg-point__pulse" cx="262" cy="66" r="10" />
          <circle className="beg-point__dot" cx="262" cy="66" r="9" />
          <text className="beg-point__num" x="262" y="70" textAnchor="middle">
            2
          </text>
        </g>
        <g className="beg-pointer">
          <circle className="beg-pointer__ring" cx="0" cy="0" r="8" />
          <circle className="beg-pointer__dot" cx="0" cy="0" r="3.5" />
        </g>
      </svg>
      <ol className="build-empty-guide__steps">
        <li>לחצו על המפה ליד שביל כדי להתחיל</li>
        <li>הוסיפו נקודה נוספת — המסלול יחושב לאורך השבילים</li>
        <li>גררו את הקו או הנקודות כדי לדייק, ואז הורידו GPX או שתפו</li>
      </ol>
    </div>
  );
}
```

Note `pathLength="100"` on `.beg-route`: it normalizes the path length so Task 2's dash animation can use round numbers (`stroke-dasharray: 100`).

- [ ] **Step 4: Wire it into BuildPanel**

In `src/components/frontPanel/BuildPanel.jsx`, add the import after the existing `PanelPoiCard` import:

```jsx
import BuildEmptyGuide from "./BuildEmptyGuide.jsx";
```

Replace the existing empty-state branch:

```jsx
      ) : (
        <p className="build-panel__empty">סמנו נקודות על המפה כדי לבנות מסלול.</p>
      )}
```

with:

```jsx
      ) : routeState.points.length === 0 ? (
        <BuildEmptyGuide />
      ) : (
        <p className="build-panel__empty">סמנו נקודות על המפה כדי לבנות מסלול.</p>
      )}
```

(The 1-point-no-route state keeps the plain paragraph; the on-map hint "הוסיפו נקודה נוספת" owns that moment.)

- [ ] **Step 5: Add structural CSS (static final frame — animation comes in Task 2)**

Append to `src/components/frontPanel/front-panel.css`:

```css
/* Build empty-state guide (vignette + steps). Task order note: these rules
   render the static final frame; the animation timeline is appended below
   them and overrides where needed. */
.build-empty-guide {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.build-empty-guide__vignette {
  width: 100%;
  height: auto;
  display: block;
}
.beg-bg {
  fill: #eef2ea;
}
.beg-trail {
  fill: none;
  stroke: #b5742e;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 7 6;
  opacity: 0.5;
}
.beg-trail--alt {
  stroke: #7a8c76;
}
.beg-route {
  fill: none;
  stroke: #355e3b;
  stroke-width: 4;
  stroke-linecap: round;
}
.beg-point__dot {
  fill: #355e3b;
}
.beg-point__num {
  fill: #fff;
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
}
.beg-point__pulse {
  fill: none;
  stroke: #355e3b;
  stroke-width: 2;
  opacity: 0;
}
.beg-pointer {
  opacity: 0;
}
.beg-pointer__ring {
  fill: rgba(53, 94, 59, 0.15);
  stroke: #355e3b;
  stroke-width: 1.5;
}
.beg-pointer__dot {
  fill: #355e3b;
}
.build-empty-guide__steps {
  margin: 0;
  padding-inline-start: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: #283026;
  line-height: 1.5;
}
```

- [ ] **Step 6: Run the e2e test to verify it passes**

Run: `npx playwright test tests/e2e/build-empty-guide.spec.mjs --workers=1`
Expected: PASS (both tests, desktop and mobile projects).

- [ ] **Step 7: Commit**

```bash
git add src/components/frontPanel/BuildEmptyGuide.jsx src/components/frontPanel/BuildPanel.jsx src/components/frontPanel/front-panel.css tests/e2e/build-empty-guide.spec.mjs
git commit -m "feat: show how-to guide in the empty Build panel"
```

---

### Task 2: Vignette animation + reduced-motion fallback

**Files:**
- Modify: `src/components/frontPanel/front-panel.css` (append animation block after Task 1's rules)

**Interfaces:**
- Consumes: the SVG class names produced in Task 1 (`beg-route`, `beg-point--a`, `beg-point--b`, `beg-point__pulse`, `beg-pointer`) and `pathLength="100"` on `.beg-route`.
- Produces: nothing consumed by later tasks (Task 3 only adds a media query on the container classes).

- [ ] **Step 1: Append the animation timeline CSS**

Append to `src/components/frontPanel/front-panel.css` (after Task 1's block). One shared 7s timeline; percentages align across the keyframe sets:

```css
/* Vignette timeline (7s loop): pointer slides in → tap A (~10%) → move →
   tap B (~35%) → route draws itself (38%–70%) → hold → reset. */
.beg-route {
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: beg-route-draw 7s linear infinite;
}
.beg-point {
  opacity: 0;
}
.beg-point--a {
  animation: beg-point-a 7s linear infinite;
}
.beg-point--b {
  animation: beg-point-b 7s linear infinite;
}
.beg-point--a .beg-point__pulse,
.beg-point--b .beg-point__pulse {
  transform-box: fill-box;
  transform-origin: center;
}
.beg-point--a .beg-point__pulse {
  animation: beg-pulse-a 7s linear infinite;
}
.beg-point--b .beg-point__pulse {
  animation: beg-pulse-b 7s linear infinite;
}
.beg-pointer {
  animation: beg-pointer-move 7s ease-in-out infinite;
}
@keyframes beg-pointer-move {
  0% {
    transform: translate(150px, 195px);
    opacity: 0;
  }
  4% {
    opacity: 1;
  }
  10% {
    transform: translate(60px, 132px);
  }
  13% {
    transform: translate(60px, 132px);
  }
  32% {
    transform: translate(262px, 66px);
  }
  36% {
    transform: translate(262px, 66px);
    opacity: 1;
  }
  42% {
    transform: translate(300px, 110px);
    opacity: 0;
  }
  100% {
    transform: translate(300px, 110px);
    opacity: 0;
  }
}
@keyframes beg-point-a {
  0%, 9% {
    opacity: 0;
  }
  11%, 96% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@keyframes beg-point-b {
  0%, 34% {
    opacity: 0;
  }
  36%, 96% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@keyframes beg-pulse-a {
  0%, 9% {
    opacity: 0;
    transform: scale(0.5);
  }
  12% {
    opacity: 0.7;
  }
  20%, 100% {
    opacity: 0;
    transform: scale(2);
  }
}
@keyframes beg-pulse-b {
  0%, 34% {
    opacity: 0;
    transform: scale(0.5);
  }
  37% {
    opacity: 0.7;
  }
  45%, 100% {
    opacity: 0;
    transform: scale(2);
  }
}
@keyframes beg-route-draw {
  0%, 38% {
    stroke-dashoffset: 100;
  }
  70% {
    stroke-dashoffset: 0;
  }
  96% {
    stroke-dashoffset: 0;
  }
  100% {
    stroke-dashoffset: 100;
  }
}
@media (prefers-reduced-motion: reduce) {
  .beg-route,
  .beg-point--a,
  .beg-point--b,
  .beg-point--a .beg-point__pulse,
  .beg-point--b .beg-point__pulse,
  .beg-pointer {
    animation: none;
  }
  /* Static final frame: route drawn, both points visible, pointer hidden. */
  .beg-route {
    stroke-dashoffset: 0;
  }
  .beg-point {
    opacity: 1;
  }
  .beg-pointer {
    opacity: 0;
  }
}
```

- [ ] **Step 2: Verify the loop in the running app (desktop)**

Run: `npm run dev`, open `http://127.0.0.1:5173/` (or the port Vite prints) in a desktop-width window, click the "בניית מסלול" tab.

Verify, watching one full ~7s loop:
1. A pointer dot slides in and pauses at the lower-right of the mini-map; point ① appears with a pulse ring.
2. The pointer moves up-left, pauses; point ② appears with a pulse.
3. The green route line draws itself between ① and ② along the trail.
4. Brief hold on the finished frame, then the loop restarts cleanly (no flash).

- [ ] **Step 3: Verify reduced motion**

In Chrome DevTools: Rendering panel → "Emulate CSS media feature prefers-reduced-motion" → `reduce`. Reload, open Build.
Expected: no motion at all; the vignette shows the finished frame (route drawn, points ① ② visible, no pointer).

- [ ] **Step 4: Re-run the e2e spec (regression)**

Run: `npx playwright test tests/e2e/build-empty-guide.spec.mjs --workers=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/frontPanel/front-panel.css
git commit -m "feat: animate the Build empty-state vignette (tap-tap-draw loop)"
```

---

### Task 3: Mobile compact layout + final verification

**Files:**
- Modify: `src/components/frontPanel/front-panel.css` (append mobile media block)

**Interfaces:**
- Consumes: `.build-empty-guide`, `.build-empty-guide__vignette`, `.build-empty-guide__steps` from Task 1.
- Produces: nothing further.

- [ ] **Step 1: Append the mobile compact rules**

Append to `src/components/frontPanel/front-panel.css`:

```css
@media (max-width: 860px) {
  .build-empty-guide {
    gap: 8px;
  }
  .build-empty-guide__vignette {
    max-height: 130px;
  }
  .build-empty-guide__steps {
    gap: 4px;
    font-size: 12px;
    line-height: 1.4;
  }
}
```

(`max-height` letterboxes the SVG via its default `preserveAspectRatio`; the drawing scales down, it doesn't crop.)

- [ ] **Step 2: Verify on a mobile viewport**

With `npm run dev` running, open DevTools device emulation at 390×844, reload, tap "+ תכנן מסלול" on the discover home.
Verify: the sheet opens at half height; the vignette (≤130px tall) AND all three steps are visible without scrolling the sheet body.

- [ ] **Step 3: Run the spec plus the neighboring planner specs (regression)**

Run: `npx playwright test tests/e2e/build-empty-guide.spec.mjs tests/e2e/planner-hints.spec.mjs tests/e2e/front-panel.spec.mjs tests/e2e/mobile-sheet.spec.mjs --workers=1`
Expected: PASS (all).

- [ ] **Step 4: Commit**

```bash
git add src/components/frontPanel/front-panel.css
git commit -m "feat: compact mobile layout for the Build empty-state guide"
```

---

## Final verification

- [ ] Run the full smoke suite: `npm run test:smoke` — expected PASS (pre-existing failures, if any, must be shown to be present on the base commit too).
- [ ] `git status` — only the files listed in this plan are modified/created.
