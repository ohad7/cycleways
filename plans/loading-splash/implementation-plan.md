# Loading Splash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an instant, branded inline loading splash (logo + real-milestone progress bar) to `index.html` so slow-network users see immediate feedback instead of a "dead gap" before React mounts.

**Architecture:** A `<div id="splash">` is painted in the first frame from inline CSS in `<head>` (no dependency on the JS bundle or any image download). A tiny inline `window.__splash` controller advances a progress bar at real load milestones (Mapbox GL loaded → main bundle executing → React mounted) and removes the splash when React mounts. A failure-safety timeout guarantees removal even if a milestone never fires.

**Tech Stack:** Plain HTML/CSS/JS inlined in `index.html`, the React entry in `src/main.jsx`, Playwright e2e (`tests/e2e/`) against the Vite dev server.

**Spec:** `plans/loading-splash/design.md`

---

## File Structure

- `index.html` — add an inline `<style>` (splash styles), the `<div id="splash">` markup as the first child of `<body>`, the inline `window.__splash` controller script, and an `onload` hook on the Mapbox GL `<script>` tag.
- `src/main.jsx` — add the "module executing" progress bump (`set(0.75)`) and the React-mount removal call (`done()`).
- `tests/e2e/loading-splash.spec.mjs` — new Playwright spec covering: splash paints with logo + title + bar; `window.__splash` API exists and `done()` removes it; splash is gone after the app is ready.

All work happens on the current branch `codex/loading-time-performance`.

---

## Task 1: Static splash markup + styles (paints instantly, 15% by default)

This task adds the visible splash with **no** JS removal logic yet, so after load the splash stays on screen. That makes the "splash is present and painted" behavior independently testable. Removal comes in Task 3.

**Files:**
- Modify: `index.html` (add inline `<style>` in `<head>`; add `<div id="splash">` as first child of `<body>`)
- Test: `tests/e2e/loading-splash.spec.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/loading-splash.spec.mjs`:

```js
import { test, expect } from "@playwright/test";

test("splash paints with logo, title, and progress bar", async ({ page }) => {
  await page.goto("/");
  const splash = page.locator("#splash");
  await expect(splash).toBeVisible();
  // Brand logo image is present (reuses the favicon SVG data URI)
  await expect(splash.locator("img.splash__logo")).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml/,
  );
  // Hebrew site title is shown
  await expect(
    splash.getByText("מפת שבילי אופניים - גליל עליון וגולן"),
  ).toBeVisible();
  // Progress bar fill exists and starts partially filled (default 15%)
  const fill = splash.locator(".splash__bar-fill");
  await expect(fill).toBeVisible();
  const width = await fill.evaluate(
    (el) => getComputedStyle(el).getPropertyValue("--splash-progress").trim(),
  );
  expect(width).toBe("0.15");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/loading-splash.spec.mjs --project=desktop`
Expected: FAIL — `#splash` does not exist yet.

- [ ] **Step 3: Add the inline splash styles**

In `index.html`, immediately before the closing `</head>` (after the `styles.css` link on line 94), add:

```html
  <!-- Loading splash (inline so it paints before the JS bundle) -->
  <style>
    #splash {
      --splash-progress: 0.15;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      direction: rtl;
      background: linear-gradient(180deg, #87CEEB 0%, #cde7c4 55%, #32CD32 100%);
      transition: opacity 300ms ease;
      font-family: 'Arial', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    #splash.splash--hidden {
      opacity: 0;
      pointer-events: none;
    }
    .splash__logo {
      width: 96px;
      height: 96px;
      filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.25));
    }
    .splash__title {
      margin: 0;
      padding: 0 24px;
      font-size: 20px;
      font-weight: 700;
      color: #1f3d1f;
      text-align: center;
      max-width: 90vw;
    }
    .splash__bar {
      width: min(280px, 70vw);
      height: 8px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.55);
      overflow: hidden;
    }
    .splash__bar-fill {
      height: 100%;
      width: calc(var(--splash-progress) * 100%);
      border-radius: 999px;
      background: #1f3d1f;
      transition: width 350ms ease;
    }
  </style>
```

- [ ] **Step 4: Add the splash markup**

In `index.html`, make `<div id="splash">` the **first** child of `<body>`, immediately after the `<body>` tag (currently line 114 `<body>` then line 115 `<div id="root"></div>`):

```html
<body>
  <div id="splash" role="status" aria-live="polite" aria-label="טוען את המפה">
    <img class="splash__logo" alt="" src="REPLACE_WITH_FAVICON_DATA_URI">
    <div class="splash__title">מפת שבילי אופניים - גליל עליון וגולן</div>
    <div class="splash__bar"><div class="splash__bar-fill"></div></div>
  </div>
  <div id="root"></div>
```

Replace `REPLACE_WITH_FAVICON_DATA_URI` with the **exact** value of the `href` attribute on the existing favicon link in `index.html` (the `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,...">`, around line 84). Copy the full `data:image/svg+xml,...` string verbatim so the splash logo matches the favicon mark with zero network cost.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test tests/e2e/loading-splash.spec.mjs --project=desktop`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e/loading-splash.spec.mjs
git commit -m "feat(splash): add instant inline loading splash markup and styles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Progress controller (`window.__splash`) + failure-safety timeout

Add the inline controller that drives the bar and removes the splash. At this point only the 15s failure-safety timeout calls `done()`; real milestones are wired in Task 3.

**Files:**
- Modify: `index.html` (add inline `<script>` in `<head>`)
- Test: `tests/e2e/loading-splash.spec.mjs` (add a case)

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/loading-splash.spec.mjs`:

```js
test("window.__splash API advances the bar and removes the splash", async ({
  page,
}) => {
  await page.goto("/");
  const splash = page.locator("#splash");

  // API exists
  const hasApi = await page.evaluate(
    () =>
      !!window.__splash &&
      typeof window.__splash.set === "function" &&
      typeof window.__splash.done === "function",
  );
  expect(hasApi).toBe(true);

  // set() advances the progress variable
  await page.evaluate(() => window.__splash.set(0.5));
  const mid = await splash
    .locator(".splash__bar-fill")
    .evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--splash-progress").trim(),
    );
  expect(mid).toBe("0.5");

  // done() hides then removes the node
  await page.evaluate(() => window.__splash.done());
  await expect(splash).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/loading-splash.spec.mjs --project=desktop -g "window.__splash API"`
Expected: FAIL — `window.__splash` is undefined.

Note: the existing app entry (`src/main.jsx`) may already call `window.__splash?.done()` in a later task; for now the optional-chaining call is harmless because it does not exist yet.

- [ ] **Step 3: Add the controller script**

In `index.html`, add this inline `<script>` inside `<head>`, immediately after the splash `<style>` block from Task 1 (it must be defined before the Mapbox `<script>` so the Task 3 `onload` hook can call it):

```html
  <script>
    (function () {
      var el = null;
      function splashEl() {
        if (!el) el = document.getElementById("splash");
        return el;
      }
      var removed = false;
      function remove() {
        var s = splashEl();
        if (s && s.parentNode) s.parentNode.removeChild(s);
      }
      window.__splash = {
        set: function (pct) {
          var s = splashEl();
          if (!s) return;
          var clamped = Math.max(0, Math.min(1, Number(pct) || 0));
          s.style.setProperty("--splash-progress", String(clamped));
        },
        done: function () {
          if (removed) return;
          removed = true;
          this.set(1);
          var s = splashEl();
          if (!s) return;
          s.classList.add("splash--hidden");
          var fallback = setTimeout(remove, 600);
          s.addEventListener(
            "transitionend",
            function () {
              clearTimeout(fallback);
              remove();
            },
            { once: true },
          );
        },
      };
      // Failure safety: never trap the user behind the splash.
      setTimeout(function () {
        window.__splash.done();
      }, 15000);
    })();
  </script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/e2e/loading-splash.spec.mjs --project=desktop -g "window.__splash API"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e/loading-splash.spec.mjs
git commit -m "feat(splash): add window.__splash progress controller and failsafe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire real milestones and React-mount removal

Hook the bar to real load events: Mapbox GL loaded (50%), main bundle executing (75%), React mounted (100% + remove).

**Files:**
- Modify: `index.html` (add `onload` to the Mapbox GL `<script>`)
- Modify: `src/main.jsx` (add `set(0.75)` at module start and `done()` after render)
- Test: `tests/e2e/loading-splash.spec.mjs` (add a case)

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/loading-splash.spec.mjs`:

```js
test("splash is removed once the app is ready", async ({ page }) => {
  await page.goto("/");
  // App has rendered its header
  await expect(
    page.getByRole("heading", {
      name: "מפת שבילי אופניים - גליל עליון וגולן",
      exact: true,
    }),
  ).toBeVisible();
  // Splash has been removed (not just hidden)
  await expect(page.locator("#splash")).toHaveCount(0);
});
```

Note: the splash title is a `<div class="splash__title">` (not a heading), so it never matches `getByRole("heading")`. The only heading on the page is the app header, so this assertion is unambiguous whether or not the splash is still present.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/loading-splash.spec.mjs --project=desktop -g "removed once the app is ready"`
Expected: FAIL — nothing calls `done()` within the load window, so `#splash` is still present (count 1) after the header renders.

- [ ] **Step 3: Add the Mapbox `onload` milestone**

In `index.html`, find the Mapbox GL script tag in `<body>`:

```html
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.js"></script>
```

Change it to advance the bar to 50% when it finishes loading:

```html
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.js" onload="window.__splash&&window.__splash.set(0.5)"></script>
```

- [ ] **Step 4: Add the module-executing and React-mount hooks in `src/main.jsx`**

Edit `src/main.jsx`. Add the 75% bump as the first executable statement (after the imports), and call `done()` after `createRoot(...).render(...)`. The current file ends with the `render(...)` call; update it to:

```js
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import FeaturedIndexPage from "./pages/FeaturedIndexPage.jsx";
import FeaturedRoutePage from "./pages/FeaturedRoutePage.jsx";

// Splash milestone: the main bundle has parsed and is executing.
window.__splash?.set(0.75);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/featured" element={<FeaturedIndexPage />} />
        <Route path="/featured/:slug" element={<FeaturedRoutePage />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);

// Splash milestone: React has mounted. Remove the splash on the next frame
// (after React has painted), handing off to the in-app loading spinner.
requestAnimationFrame(() => {
  requestAnimationFrame(() => window.__splash?.done());
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test tests/e2e/loading-splash.spec.mjs --project=desktop -g "removed once the app is ready"`
Expected: PASS.

- [ ] **Step 6: Run the full splash spec on both projects**

Run: `npx playwright test tests/e2e/loading-splash.spec.mjs`
Expected: PASS on both `desktop` and `mobile` projects.

- [ ] **Step 7: Commit**

```bash
git add index.html src/main.jsx tests/e2e/loading-splash.spec.mjs
git commit -m "feat(splash): wire real load milestones and React-mount removal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Regression check (existing suites still pass)

**Files:** none (verification only)

- [ ] **Step 1: Run the existing welcome-wizard e2e (shares the `/` route and the header heading)**

Run: `npx playwright test tests/e2e/welcome-wizard.spec.mjs`
Expected: PASS. The splash title is a non-heading `<div>`, so it does not collide with `getByRole("heading")` assertions; the splash is a fixed full-screen overlay that is removed at React mount, so it does not intercept interactions in these tests either.

- [ ] **Step 2: Run the broader smoke suite**

Run: `npm run test:smoke`
Expected: PASS (or no new failures vs. the pre-change baseline).

- [ ] **Step 3: Commit any test adjustments (only if changes were required)**

```bash
git add -A
git commit -m "test(splash): adjust e2e assertions for splash coexistence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manual verification (slow-network feel)

After the automated tests pass, confirm the actual perceived experience:

1. Run `npm run dev`.
2. Open Chrome DevTools → Network → throttle to "Slow 4G".
3. Hard-reload `/`. Confirm: the gradient splash with logo + title + bar paints
   almost immediately; the bar advances at ~15% → 50% (Mapbox loaded) → 75%
   (bundle) → 100%; the splash fades and the in-app spinner takes over for the
   map-data load.
