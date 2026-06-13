# Planner Retention Implementation Plan (planning-surface D1+D2+D3, roadmap step 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-11
**Design:** [design.md](design.md) — D1 (draft autosave + recents), D2 (contextual onboarding replaces the tutorial modal), D3 (send-to-phone QR).

**Goal:** The in-progress route survives a closed tab (restore banner), the last 5 loaded/downloaded routes appear as a "המסלולים שלי" strip in Discover, three contextual hints replace the hidden tutorial modal, and the Build panel gains a QR "send to phone" output.

**Architecture:** All persistence goes through the existing `platform/storage.js` service (web localStorage / native sibling), with pure list/serialize helpers in a new `@cycleways/core/data/plannerMemory.js` (node-tested). The encoded `?route=` string is the single storage format — `shareInfo` (already memoized in `useCyclewaysApp`) gains a `param` field, and restore reuses `handleLoadRouteParam` from step 1. UI pieces (restore banner, recents strip, hints, QR modal) are thin React components; the QR uses the zero-dependency `qrcode-generator` package, lazy-loaded.

**Tech Stack:** React 19, `@cycleways/core` hook + platform services, `qrcode-generator@2`, node assert tests, Playwright e2e (the discover-card select flow loads a real route under the mapbox mock, which makes draft/recents flows testable end-to-end).

**Execution notes:** Worktree branch (e.g. `step-3-retention`) off the current `claude/fable-ux-improvements-step2` HEAD. Known pre-existing/flaky e2e failures (NOT yours): `routes-index.spec.mjs:8`, `:114`, `featured-index.spec.mjs:37`, `react-migration-smoke.spec.mjs:81` (flaky), and `viewport-meta`/`loading-splash`/`routes-index-mobile-filters` can flake under parallel full-suite load (all green serially/isolated).

**Storage keys (used consistently across tasks):** draft `cycleways:planner-draft`, recents `cycleways:recent-routes`, hints `cycleways:hint-build-start`, `cycleways:hint-add-second`, `cycleways:hint-edit-route`.

---

### Task 1: Expose the encoded param on shareInfo

**Files:**
- Modify: `packages/core/src/routing/routeActions.js` (`shareInfoFromEncodedRoute`, ~line 340)
- Modify: `tests/test-react-route-actions.mjs` (add one assertion)

- [ ] **Step 1: Extend the existing test (it must fail first)**

In `tests/test-react-route-actions.mjs`, after the existing `assert.equal(shareInfo.url, shareUrl);` (~line 97), add:

```js
assert.equal(
  new URL(shareInfo.url).searchParams.get("route"),
  shareInfo.param,
  "shareInfo.param is the raw encoded route string",
);
```

Run: `node tests/test-react-route-actions.mjs` → FAIL (`shareInfo.param` is undefined).

- [ ] **Step 2: Implement**

In `shareInfoFromEncodedRoute` (~line 340 of `packages/core/src/routing/routeActions.js`), add `param: encodedRoute,` to the returned object:

```js
  return {
    url: shareUrl,
    param: encodedRoute,
    format,
    length: shareUrl.length,
    status: ...
  };
```

Check whether the `status: "unavailable"` fallback object in `useCyclewaysApp` (~line 952: `{ url: "", status: "unavailable", length: 0, format: null }`) should gain `param: ""` — yes, add it for shape consistency. Also check `buildShareInfo`'s other return paths in routeActions.js (there may be a legacy/fallback branch besides `shareInfoFromEncodedRoute` — search the function for other `return` statements and give them `param` too, `""` when there's no encoded route).

- [ ] **Step 3: Verify + commit**

Run: `node tests/test-react-route-actions.mjs` → passes.

```bash
git add packages/core/src/routing/routeActions.js packages/core/src/app/useCyclewaysApp.js tests/test-react-route-actions.mjs
git commit -m "feat(core): shareInfo exposes the raw encoded route param"
```
(Append to every commit in this plan the trailer line: "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>")

---

### Task 2: plannerMemory — pure draft/recents helpers

**Files:**
- Create: `packages/core/src/data/plannerMemory.js`
- Test: `tests/test-planner-memory.mjs` (create)
- Modify: `package.json` (add to `test` chain next to `test-near-me.mjs`)

- [ ] **Step 1: Write the failing test**

Create `tests/test-planner-memory.mjs`:

```js
import assert from "node:assert/strict";
import {
  parseDraft,
  serializeDraft,
  parseRecents,
  upsertRecent,
  serializeRecents,
  RECENTS_CAP,
} from "@cycleways/core/data/plannerMemory.js";

// Draft round-trips; junk parses to null.
{
  const draft = { param: "abc123", distanceKm: 12.4, savedAt: 1718000000000 };
  assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
  assert.equal(parseDraft(null), null);
  assert.equal(parseDraft("not json"), null);
  assert.equal(parseDraft('{"noParam":1}'), null);
}

// Recents: newest first, deduped by param (re-adding moves to front,
// refreshes metadata), capped.
{
  const e = (n) => ({ param: `p${n}`, name: `route ${n}`, distanceKm: n, savedAt: n });
  let list = [];
  for (let n = 1; n <= 7; n += 1) list = upsertRecent(list, e(n));
  assert.equal(list.length, RECENTS_CAP);
  assert.equal(RECENTS_CAP, 5);
  assert.deepEqual(list.map((r) => r.param), ["p7", "p6", "p5", "p4", "p3"]);
  list = upsertRecent(list, { ...e(5), name: "renamed" });
  assert.equal(list.length, RECENTS_CAP);
  assert.equal(list[0].param, "p5");
  assert.equal(list[0].name, "renamed");
}

// Recents serialization round-trips; junk parses to [].
{
  const list = upsertRecent([], { param: "x", name: "שם", distanceKm: 3.2, savedAt: 5 });
  assert.deepEqual(parseRecents(serializeRecents(list)), list);
  assert.deepEqual(parseRecents(null), []);
  assert.deepEqual(parseRecents("oops"), []);
  assert.deepEqual(parseRecents('{"a":1}'), []);
  // Entries missing a param are dropped on parse.
  assert.deepEqual(parseRecents('[{"name":"no param"},{"param":"ok"}]').length, 1);
}

console.log("planner memory tests passed");
```

Run: `node tests/test-planner-memory.mjs` → FAIL (module not found).

- [ ] **Step 2: Implement**

Create `packages/core/src/data/plannerMemory.js`:

```js
// Pure helpers for the planner's local memory: the autosaved draft (the
// in-progress route, stored as its encoded ?route= param) and the recents
// list ("המסלולים שלי"). Storage I/O stays in the caller (platform/storage);
// these functions only parse, validate, and order.
export const RECENTS_CAP = 5;

export function serializeDraft(draft) {
  return JSON.stringify(draft);
}

export function parseDraft(raw) {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    if (!draft || typeof draft.param !== "string" || !draft.param) return null;
    return draft;
  } catch {
    return null;
  }
}

export function serializeRecents(list) {
  return JSON.stringify(list);
}

export function parseRecents(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (entry) => entry && typeof entry.param === "string" && entry.param,
    );
  } catch {
    return [];
  }
}

// Newest first; re-adding an existing param moves it to the front with the
// fresh metadata; the list is capped at RECENTS_CAP.
export function upsertRecent(list, entry) {
  const rest = (Array.isArray(list) ? list : []).filter(
    (item) => item.param !== entry.param,
  );
  return [entry, ...rest].slice(0, RECENTS_CAP);
}
```

- [ ] **Step 3: Verify, register, commit**

Run: `node tests/test-planner-memory.mjs` → `planner memory tests passed`.
Add `node tests/test-planner-memory.mjs && ` to the `test` chain in `package.json` (next to `node tests/test-near-me.mjs && `).

```bash
git add packages/core/src/data/plannerMemory.js tests/test-planner-memory.mjs package.json
git commit -m "feat(core): plannerMemory helpers for draft + recents persistence"
```

---

### Task 3: Hook wiring — autosave, draft restore, recents

**Files:**
- Modify: `packages/core/src/app/useCyclewaysApp.js`

- [ ] **Step 1: Imports and state**

Add imports (storage service already has a native sibling, so this stays platform-agnostic):

```js
import { getStoredItem, setStoredItem } from "../platform/storage.js";
import {
  parseDraft,
  serializeDraft,
  parseRecents,
  serializeRecents,
  upsertRecent,
} from "../data/plannerMemory.js";
```

Module-level keys near the top (after imports):

```js
const PLANNER_DRAFT_KEY = "cycleways:planner-draft";
const RECENT_ROUTES_KEY = "cycleways:recent-routes";
```

State inside the hook (near the other useState calls):

```js
  // Draft offered for restore (read once at mount); null once consumed/dismissed.
  const [plannerDraft, setPlannerDraft] = useState(() =>
    parseDraft(getStoredItem(PLANNER_DRAFT_KEY)),
  );
  const [recentRoutes, setRecentRoutes] = useState(() =>
    parseRecents(getStoredItem(RECENT_ROUTES_KEY)),
  );
```

- [ ] **Step 2: Autosave effect**

Add after the `shareInfo` useMemo (~line 1050; it computes `{url, param, status, ...}` per route change). Debounced so drag streams don't hammer storage:

```js
  // Autosave the in-progress route as a draft (the encoded ?route= param is
  // the storage format). Empty routes don't overwrite an existing draft —
  // clearing is explicit (handleRouteClear) or via restore/dismiss.
  useEffect(() => {
    if (!shareInfo.param || routeState.points.length === 0) return undefined;
    const timer = setTimeout(() => {
      setStoredItem(
        PLANNER_DRAFT_KEY,
        serializeDraft({
          param: shareInfo.param,
          distanceKm: Math.round((routeState.distance / 1000) * 10) / 10,
          savedAt: Date.now(),
        }),
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [shareInfo.param, routeState.distance, routeState.points.length]);
```

- [ ] **Step 3: Restore / dismiss / recents handlers**

Add after `handleLoadRouteParam`:

```js
  // Restores the autosaved draft into the live session. The draft offer is
  // consumed either way; the stored draft itself survives (it will simply be
  // re-offered next session if the user clears the restored route).
  const handleRestoreDraft = useCallback(async () => {
    const draft = plannerDraft;
    setPlannerDraft(null);
    if (!draft?.param) return false;
    return handleLoadRouteParam(draft.param);
  }, [plannerDraft, handleLoadRouteParam]);

  const handleDismissDraft = useCallback(() => {
    setPlannerDraft(null);
  }, []);

  // Records a route in the recents list ("המסלולים שלי"). Callers supply the
  // best name they have (catalog name for Discover selects, a generic label
  // for downloads of a hand-built route).
  const handleAddRecentRoute = useCallback((entry) => {
    if (!entry?.param) return;
    setRecentRoutes((current) => {
      const next = upsertRecent(current, { savedAt: Date.now(), ...entry });
      setStoredItem(RECENT_ROUTES_KEY, serializeRecents(next));
      return next;
    });
  }, []);
```

- [ ] **Step 4: Auto-record + draft clear at the natural moments**

1. In `handleDownloadGpx` (~line 1088): after a successful download trigger, add:

```js
    if (shareInfo.param) {
      handleAddRecentRoute({
        param: shareInfo.param,
        name: "מסלול שבניתי",
        distanceKm: Math.round((routeState.distance / 1000) * 10) / 10,
      });
    }
```

(Read the function first: it may build the GPX from refs — add the recording after the download call, and add the new deps (`shareInfo.param`, `handleAddRecentRoute`, `routeState.distance`) to its dep array.)

2. Opening a shared link is a "viewed route" too — in the `initializeRouting` effect (~line 241), after a successful `?route=` restore (`if (snapshot) { ... }` block), record it:

```js
          handleAddRecentRoute({
            param: routeParam,
            name: "מסלול משותף",
            distanceKm: Math.round((snapshot.distance / 1000) * 10) / 10,
          });
```

(`handleAddRecentRoute` is defined with `useCallback` later in the hook — the effect can't reference it before definition inside the same render; simplest is to inline the same `setRecentRoutes`+`setStoredItem` logic there, or hoist a small module-level helper. Pick whichever keeps the effect readable; do NOT reorder the hook's existing blocks.)

3. In `handleRouteClear` (~line 620): clearing is the explicit "I'm done with this" signal — drop the draft:

```js
    setStoredItem(PLANNER_DRAFT_KEY, "");
    setPlannerDraft(null);
```

- [ ] **Step 5: Export from the hook**

Add to the return block:

```js
    plannerDraft,
    recentRoutes,
    handleRestoreDraft,
    handleDismissDraft,
    handleAddRecentRoute,
```

- [ ] **Step 6: Verify + commit**

Run: `node tests/test-react-route-actions.mjs && node tests/test-route-reducer.mjs && node tests/test-planner-memory.mjs && echo OK` → OK.

```bash
git add packages/core/src/app/useCyclewaysApp.js
git commit -m "feat(core): draft autosave, restore offer, and recent-routes recording"
```

---

### Task 4: Draft restore banner + recents recording in App

**Files:**
- Create: `src/components/DraftRestoreBanner.jsx`
- Modify: `src/App.jsx`
- Modify: `src/react-app.css`
- Test: `tests/e2e/planner-retention.spec.mjs` (create; covers Tasks 4–5)

- [ ] **Step 1: Write the failing e2e**

Create `tests/e2e/planner-retention.spec.mjs`. The flow uses the Discover-select path (loads a real route under the mapbox mock), whose autosave creates a draft; a reload without `?route=` must then offer the restore.

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

async function loadFirstDiscoverRoute(page) {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toHaveAttribute("data-route-status", "ready", { timeout: 30_000 });
  const card = panel.locator(".panel-route-card").first();
  const name = (await card.locator(".panel-route-card__title").textContent()).trim();
  await card.click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  // Let the 800ms autosave debounce flush.
  await page.waitForTimeout(1200);
  return name;
}

test("draft restore banner revives the last route after a reload", async ({ page }) => {
  await loadFirstDiscoverRoute(page);
  await page.goto("/"); // no ?route= → restore offer
  const banner = page.locator(".draft-restore-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await banner.getByRole("button", { name: "שחזור" }).click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  await expect(
    page.getByTestId("front-panel").getByRole("tab", { name: "בניית מסלול" }),
  ).toHaveAttribute("aria-selected", "true");
});

test("dismissing the draft banner hides it for the session", async ({ page }) => {
  await loadFirstDiscoverRoute(page);
  await page.goto("/");
  const banner = page.locator(".draft-restore-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await banner.getByRole("button", { name: "סגירה" }).click();
  await expect(banner).toBeHidden();
});

test("a loaded route appears in the recents strip", async ({ page }) => {
  const name = await loadFirstDiscoverRoute(page);
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toBeVisible();
  const strip = panel.locator(".recent-routes");
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await expect(strip).toContainText("המסלולים שלי");
  await expect(strip.locator(".recent-routes__item").first()).toContainText(
    name.replace(/\s+/g, " ").trim().split(" ").slice(-2).join(" "),
  );
});
```

(The name assertion tolerates the color-swatch prefix in the card title by matching on its last words; if that proves brittle while implementing, assert on the recents item being non-empty plus the strip heading — don't weaken the visibility/click assertions.)

Run: `npx playwright test tests/e2e/planner-retention.spec.mjs --project=desktop` → FAIL (no banner, no strip — red until Task 5).

- [ ] **Step 2: The banner component**

Create `src/components/DraftRestoreBanner.jsx`:

```jsx
import React from "react";

// Offers to restore the autosaved in-progress route. Shown only when the
// planner opened without a shared route and the map is empty.
export default function DraftRestoreBanner({ draft, onRestore, onDismiss }) {
  if (!draft) return null;
  return (
    <div className="draft-restore-banner" role="status">
      <span className="draft-restore-banner__text">
        להמשיך את המסלול הקודם
        {Number.isFinite(draft.distanceKm) ? ` (${draft.distanceKm} ק"מ)` : ""}?
      </span>
      <button type="button" className="draft-restore-banner__restore" onClick={onRestore}>
        שחזור
      </button>
      <button
        type="button"
        className="draft-restore-banner__dismiss"
        aria-label="סגירה"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
```

Wait: the e2e clicks a button NAMED "סגירה" — `aria-label="סגירה"` on the × button provides that accessible name. Keep them consistent.

- [ ] **Step 3: Wire it in App.jsx**

Destructure `plannerDraft, recentRoutes, handleRestoreDraft, handleDismissDraft, handleAddRecentRoute` from `useCyclewaysApp`. Render the banner inside the `.map-container` ready-fragment (near the search container, so it sits at the top of the map):

```jsx
                {plannerDraft && !hasQueryParam("route") && routePointCount === 0 && (
                  <DraftRestoreBanner
                    draft={plannerDraft}
                    onRestore={async () => {
                      const ok = await handleRestoreDraft();
                      if (ok) handlePanelStateChange("build");
                    }}
                    onDismiss={handleDismissDraft}
                  />
                )}
```

`hasQueryParam` comes from `@cycleways/core/platform/location.js` — import it in App.jsx. NOTE: it must never auto-restore over an explicit shared link (the `!hasQueryParam("route")` guard) and disappears as soon as the user starts building (`routePointCount === 0` guard). Place the JSX so these conditions read naturally; `routePointCount` already exists in App.

Also record recents on Discover selects — extend `handleSelectRecommended`'s success branch:

```js
      if (loaded) {
        handlePanelStateChange("build");
        handleAddRecentRoute({
          param: entry.route,
          name: entry.name || "מסלול",
          distanceKm: Number(entry.distanceKm) || undefined,
        });
      }
```

(add `handleAddRecentRoute` to its deps).

- [ ] **Step 4: Banner CSS**

Append to `src/react-app.css`:

```css
.draft-restore-banner {
  position: absolute;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 32px);
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid #e7dfca;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 4px 14px rgb(40 48 38 / 18%);
  font-size: 0.9rem;
}

.draft-restore-banner__restore {
  border: none;
  border-radius: 999px;
  padding: 6px 14px;
  background: #2f6b3c;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.draft-restore-banner__dismiss {
  border: none;
  background: transparent;
  color: #52615c;
  font-size: 1.1rem;
  cursor: pointer;
}
```

(Check it clears the search container's position — `.search-container` sits at the top; adjust `top` so they don't overlap on mobile or desktop. Look at the rendered result in the e2e trace/screenshot if unsure.)

- [ ] **Step 5: Run the first two e2e tests**

Run: `npx playwright test tests/e2e/planner-retention.spec.mjs --project=desktop 2>&1 | tail -5`
Expected: tests 1–2 PASS; test 3 (recents strip) still FAILS — that's Task 5.

```bash
git add src/components/DraftRestoreBanner.jsx src/App.jsx src/react-app.css tests/e2e/planner-retention.spec.mjs
git commit -m "feat(planner): draft autosave restore banner"
```

---

### Task 5: "המסלולים שלי" recents strip in Discover

**Files:**
- Create: `src/components/frontPanel/RecentRoutesStrip.jsx`
- Modify: `src/components/frontPanel/DiscoverPanel.jsx`
- Modify: `src/App.jsx` (pass props to DiscoverPanel)
- Modify: `src/components/frontPanel/front-panel.css`

- [ ] **Step 1: The strip component**

Create `src/components/frontPanel/RecentRoutesStrip.jsx`:

```jsx
import React from "react";

// Compact "המסלולים שלי" strip at the top of Discover: the last few routes
// the user loaded or downloaded, clickable to reload them into the planner.
export default function RecentRoutesStrip({ recents, onSelect }) {
  if (!Array.isArray(recents) || recents.length === 0) return null;
  return (
    <div className="recent-routes">
      <div className="recent-routes__title">המסלולים שלי</div>
      <div className="recent-routes__list">
        {recents.map((entry) => (
          <button
            key={entry.param}
            type="button"
            className="recent-routes__item"
            onClick={() => onSelect(entry)}
          >
            <span className="recent-routes__name">{entry.name || "מסלול"}</span>
            {Number.isFinite(entry.distanceKm) && (
              <span className="recent-routes__meta">{entry.distanceKm} ק״מ</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into DiscoverPanel**

In `src/components/frontPanel/DiscoverPanel.jsx`: add props `recentRoutes` and `onSelectRecent`; render the strip at the very top of the panel body, BEFORE `discover-panel__intro`:

```jsx
      <RecentRoutesStrip recents={recentRoutes} onSelect={onSelectRecent} />
```

In `src/App.jsx`, pass to `<DiscoverPanel ...>`:

```jsx
                    recentRoutes={recentRoutes}
                    onSelectRecent={(entry) =>
                      handleSelectRecommended({
                        route: entry.param,
                        name: entry.name,
                        distanceKm: entry.distanceKm,
                      })
                    }
```

(`handleSelectRecommended` already does load → Build switch → re-record, and falls back to a full-page `?route=` load when needed — recents entries reuse it by mapping `param` onto the `route` field it expects.)

- [ ] **Step 3: CSS**

Append to `src/components/frontPanel/front-panel.css`:

```css
.recent-routes {
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid #efe8d7;
}

.recent-routes__title {
  font-size: 0.8rem;
  font-weight: 800;
  color: #5f6f67;
  margin-bottom: 6px;
}

.recent-routes__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.recent-routes__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid #dce4df;
  border-radius: 999px;
  background: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  color: #2f4533;
  cursor: pointer;
}

.recent-routes__meta {
  color: #5f6f67;
  font-weight: 500;
}
```

- [ ] **Step 4: All three retention e2e tests green**

Run: `npx playwright test tests/e2e/planner-retention.spec.mjs --project=desktop --project=mobile 2>&1 | tail -4` → all pass.

```bash
git add src/components/frontPanel/RecentRoutesStrip.jsx src/components/frontPanel/DiscoverPanel.jsx src/App.jsx src/components/frontPanel/front-panel.css
git commit -m "feat(discover): recent-routes strip — המסלולים שלי"
```

---

### Task 6: Contextual onboarding hints replace the tutorial

**Files:**
- Create: `src/components/PlannerHints.jsx`
- Modify: `src/App.jsx` (render hints; remove Tutorial usage)
- Delete: `src/components/Tutorial.jsx`
- Modify: `src/components/TopBar.jsx` + `src/components/PageShell.jsx` (remove the "מדריך" button and `onOpenTutorial` threading)
- Modify: `packages/core/src/app/useCyclewaysApp.js` (remove `tutorialOpen`, `handleOpenTutorial`, `handleCloseTutorial`, the `trackTutorial` import/usages, and the Escape-key `tutorialOpen` reset)
- Modify: `src/react-app.css` (hint styles)
- Test: `tests/e2e/planner-hints.spec.mjs` (create)

- [ ] **Step 1: Write the failing e2e**

Create `tests/e2e/planner-hints.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("build tab shows the first-time hint once, never again after dismiss", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  const hint = page.locator(".planner-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("לחצו על המפה");
  await hint.getByRole("button", { name: "הבנתי" }).click();
  await expect(hint).toBeHidden();
  // Persisted: a reload + Build tab shows no hint.
  await page.reload();
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "בניית מסלול" }).click();
  await expect(page.locator(".planner-hint")).toBeHidden();
});

test("the tutorial modal and its nav item are gone from the planner", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("front-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "מדריך", exact: true })).toHaveCount(0);
  await expect(page.locator(".react-tutorial")).toHaveCount(0);
});
```

Run: `npx playwright test tests/e2e/planner-hints.spec.mjs --project=desktop` → FAIL (no `.planner-hint`; "מדריך" still present).

- [ ] **Step 2: The hints component**

Create `src/components/PlannerHints.jsx`:

```jsx
import React, { useEffect, useState } from "react";
import { getStoredItem, setStoredItem } from "@cycleways/core/platform/storage.js";

// Three one-time hints that replace the old tutorial modal. Each fires off
// the user's actual progress and is dismissed forever once acknowledged
// (or once the user progresses past it, which marks it as seen implicitly).
const HINTS = [
  {
    key: "cycleways:hint-build-start",
    text: "לחצו על המפה ליד שביל כדי להתחיל מסלול",
    active: ({ panelState, pointCount }) => panelState === "build" && pointCount === 0,
  },
  {
    key: "cycleways:hint-add-second",
    text: "הוסיפו נקודה נוספת כדי לחשב מסלול",
    active: ({ pointCount, routeReady }) => pointCount === 1 && !routeReady,
  },
  {
    key: "cycleways:hint-edit-route",
    text: "גררו את הקו או הנקודות כדי לשנות; הקישו על נקודה כדי להסיר אותה",
    active: ({ routeReady }) => routeReady,
  },
];

export default function PlannerHints({ panelState, pointCount, routeReady }) {
  const [, forceRender] = useState(0);
  const progress = { panelState, pointCount, routeReady };

  // Progressing past a hint marks it seen even without an explicit dismiss,
  // so returning users don't get stale earlier-stage hints.
  useEffect(() => {
    const activeIndex = HINTS.findIndex((h) => h.active(progress));
    HINTS.forEach((h, i) => {
      if (activeIndex > i || (activeIndex === -1 && pointCount > 0)) {
        if (!getStoredItem(h.key)) setStoredItem(h.key, "seen");
      }
    });
  }, [panelState, pointCount, routeReady]);

  const hint = HINTS.find((h) => h.active(progress) && !getStoredItem(h.key));
  if (!hint) return null;
  return (
    <div className="planner-hint" role="status">
      <span>{hint.text}</span>
      <button
        type="button"
        onClick={() => {
          setStoredItem(hint.key, "seen");
          forceRender((n) => n + 1);
        }}
      >
        הבנתי
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Render in App.jsx + remove the tutorial**

In `src/App.jsx`:
- Import `PlannerHints`; render inside the map-container ready-fragment:

```jsx
                <PlannerHints
                  panelState={panel.state}
                  pointCount={routePointCount}
                  routeReady={plannerRouteReady}
                />
```

- Remove: the `Tutorial` import and the `<Tutorial open={...} ...>` element; `handleOpenTutorial`/`handleCloseTutorial` from the destructuring; `onOpenTutorial={handleOpenTutorial}` from `<PageShell>`.

In `src/components/PageShell.jsx`: remove the `onOpenTutorial` prop and its threading to TopBar.
In `src/components/TopBar.jsx`: remove `onOpenTutorial`, `handleTutorialClick`, `showTutorialButton`, and the "מדריך" button JSX. NOTE: other pages render `PageShell` without `onOpenTutorial` — grep `onOpenTutorial` repo-wide and clean every usage.
In `packages/core/src/app/useCyclewaysApp.js`: remove `tutorialOpen` from mapUi, the `handleOpenTutorial`/`handleCloseTutorial` callbacks (~line 778-795), their exports, the `tutorialOpen: false` reset inside the Escape-key handler (~line 1010; keep the `downloadModalOpen` reset), and the now-unused `trackTutorial` import. Check `packages/core/src/platform/analytics.js`: if `trackTutorial` has no remaining callers, remove the export there too (and its native sibling if mirrored).
Delete `src/components/Tutorial.jsx`. Grep for leftover CSS (`react-tutorial` classes in `src/react-app.css` / `styles.css`) and remove those rules.

- [ ] **Step 4: Hint CSS**

Append to `src/react-app.css`:

```css
.planner-hint {
  position: absolute;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 11;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: calc(100% - 32px);
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid #e7dfca;
  background: rgba(47, 69, 51, 0.92);
  color: #fff;
  font-size: 0.9rem;
  box-shadow: 0 4px 14px rgb(40 48 38 / 25%);
}

.planner-hint button {
  border: none;
  border-radius: 999px;
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
```

(If the draft banner (Task 4) and a hint can be visible simultaneously — both top-center — stagger them: the hint only renders in Build state, the banner only with 0 points... both can hold in Build+0 points. Offset the hint lower (`top: 110px`) when that's a real collision; check visually via the e2e screenshot.)

- [ ] **Step 5: Green + regression sweep + commit**

Run: `npx playwright test tests/e2e/planner-hints.spec.mjs tests/e2e/front-panel.spec.mjs tests/e2e/react-migration-smoke.spec.mjs tests/e2e/featured-index.spec.mjs tests/e2e/routes-index.spec.mjs --project=desktop 2>&1 | tail -6`
Expected: planner-hints + front-panel green; the known pre-existing failures in the others unchanged (routes-index:8/:114; react-migration-smoke:81 may flake). The "מדריך" count-0 assertions in featured-index/routes-index must still pass.
Also: `node tests/test-react-route-actions.mjs && npm test 2>&1 | tail -3` (the hook changed).

```bash
git add -A src/components packages/core/src/app/useCyclewaysApp.js packages/core/src/platform/analytics.js src/App.jsx src/react-app.css styles.css tests/e2e/planner-hints.spec.mjs
git rm src/components/Tutorial.jsx 2>/dev/null || true
git commit -m "feat(planner): contextual onboarding hints replace the tutorial modal"
```

(Adjust the `git add` list to what actually changed — never `git add -A` at repo root; the pipeline-owned `public-data/` must not be touched.)

---

### Task 7: Send-to-phone QR

**Files:**
- Modify: `package.json` (+ `qrcode-generator@^2.0.4` dependency)
- Create: `src/components/SendToPhone.jsx`
- Modify: `src/components/frontPanel/BuildPanel.jsx` (third action button)
- Modify: `src/App.jsx` (state + lazy mount)
- Modify: `src/react-app.css` (modal styles)
- Test: `tests/e2e/send-to-phone.spec.mjs` (create)

- [ ] **Step 1: Write the failing e2e**

Create `tests/e2e/send-to-phone.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("build panel offers a QR that encodes the share URL", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  await expect(panel).toHaveAttribute("data-route-status", "ready", { timeout: 30_000 });
  await panel.locator(".panel-route-card").first().click();
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  await panel.getByRole("button", { name: "שלחו לטלפון" }).click();
  const modal = page.locator(".send-to-phone");
  await expect(modal).toBeVisible();
  // The QR is rendered as an SVG (qrcode-generator's createSvgTag output).
  await expect(modal.locator("svg, img")).toHaveCount(1);
  await expect(modal).toContainText("סרקו עם הטלפון");
  await modal.getByRole("button", { name: "סגירה" }).click();
  await expect(modal).toBeHidden();
});
```

Run: `npx playwright test tests/e2e/send-to-phone.spec.mjs --project=desktop` → FAIL.

- [ ] **Step 2: Install the dependency**

Run: `npm install qrcode-generator@^2.0.4`
(Zero-dependency MIT QR encoder. Verify `package-lock.json` only gained this one package.)

- [ ] **Step 3: The component**

Create `src/components/SendToPhone.jsx`:

```jsx
import React, { useMemo } from "react";
import qrcode from "qrcode-generator";

// Renders the share URL as a QR so a desktop-planned route hops to the phone
// (today: opens mobile web; later the same URL deep-links into the app — see
// plans/navigation-handoff/design.md).
export default function SendToPhone({ shareUrl, onClose }) {
  const svgMarkup = useMemo(() => {
    if (!shareUrl) return "";
    // Type 0 auto-sizes to the data; M error correction is the QR default.
    const qr = qrcode(0, "M");
    qr.addData(shareUrl);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
  }, [shareUrl]);

  if (!shareUrl) return null;
  return (
    <div className="react-modal" role="dialog" aria-modal="true" aria-label="שליחת המסלול לטלפון">
      <div className="react-modal__content react-modal__content--narrow send-to-phone">
        <header className="react-modal__header">
          <h2>שלחו לטלפון</h2>
          <button className="react-modal__close" type="button" aria-label="סגירה" onClick={onClose}>
            ×
          </button>
        </header>
        <div
          className="send-to-phone__qr"
          // qrcode-generator emits a self-contained <svg> string; nothing
          // user-controlled beyond the URL is interpolated into it.
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
        <p className="send-to-phone__hint">סרקו עם הטלפון כדי לפתוח את המסלול בנייד</p>
      </div>
    </div>
  );
}
```

(`react-modal` classes already exist — they styled the old tutorial modal and the download modal; verify they're still present after Task 6's CSS cleanup. If Task 6 removed shared `react-modal` styles, restore them — only the `react-tutorial` list styles were tutorial-specific.)

- [ ] **Step 4: Button + lazy mount**

In `src/components/frontPanel/BuildPanel.jsx`, add to the props `onSendToPhone`, and a third button in `build-panel__actions`:

```jsx
          <button type="button" className="btn-ghost" disabled={!canShare} onClick={onSendToPhone}>
            שלחו לטלפון
          </button>
```

In `src/App.jsx`:

```js
const SendToPhone = lazy(() => import("./components/SendToPhone.jsx"));
```

```js
  const [sendToPhoneOpen, setSendToPhoneOpen] = useState(false);
```

Pass `onSendToPhone={() => setSendToPhoneOpen(true)}` to `<BuildPanel>`. Render next to the DownloadModal mount:

```jsx
      {state.status === "ready" && sendToPhoneOpen && (
        <Suspense fallback={null}>
          <SendToPhone shareUrl={shareUrl} onClose={() => setSendToPhoneOpen(false)} />
        </Suspense>
      )}
```

- [ ] **Step 5: Styles**

Append to `src/react-app.css`:

```css
.send-to-phone__qr {
  display: flex;
  justify-content: center;
  padding: 12px;
}

.send-to-phone__qr svg {
  width: 240px;
  height: 240px;
}

.send-to-phone__hint {
  text-align: center;
  color: #52615c;
  margin: 0 0 12px;
}
```

- [ ] **Step 6: Green + commit**

Run: `npx playwright test tests/e2e/send-to-phone.spec.mjs --project=desktop --project=mobile 2>&1 | tail -3` → pass.

```bash
git add package.json package-lock.json src/components/SendToPhone.jsx src/components/frontPanel/BuildPanel.jsx src/App.jsx src/react-app.css tests/e2e/send-to-phone.spec.mjs
git commit -m "feat(planner): send-to-phone QR for the share URL"
```

---

### Task 8: Verification

- [ ] `npm test` → green (includes test-planner-memory).
- [ ] `npx playwright test --workers=1 2>&1 | tail -10` → no NEW failures beyond the known pre-existing/flaky set in the header.
- [ ] Real-browser smoke (no mock), dev server on a spare port: (1) select a Discover route → reload `/` → banner offers restore with the distance → restore works; (2) recents strip shows the route, clicking reloads it; (3) fresh profile (new browser context): Build tab → hint 1 visible → הבנתי → gone after reload; (4) "שלחו לטלפון" shows a scannable QR (LOOK at the screenshot); (5) the "מדריך" nav item is gone. Screenshot each.
- [ ] Hand off with superpowers:finishing-a-development-branch (merge target: `claude/fable-ux-improvements-step2`).
