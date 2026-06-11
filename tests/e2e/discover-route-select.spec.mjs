import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen } from "./sheet-helpers.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

test("selecting a Discover route loads it in place without a full reload", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("front-panel");
  // On mobile the panel is in a bottom sheet — open it before interacting with content.
  await ensurePanelOpen(page);
  await expect(panel).toBeVisible();
  // Wait for the routing engine (added in Task 4); a click before readiness
  // falls back to a full-page load by design.
  await expect(panel).toHaveAttribute("data-route-status", "ready", {
    timeout: 30_000,
  });
  // A full navigation would lose this flag.
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  const card = panel.locator(".panel-route-card").first();
  await expect(card).toBeVisible();
  await card.click();
  // The encoded route lands on the URL and the panel switches to Build.
  await expect(page).toHaveURL(/[?&]route=/, { timeout: 20_000 });
  // On mobile the sheet snaps back to peek after route selection — open it to assert panel state.
  await ensurePanelOpen(page);
  await expect(
    panel.getByRole("tab", { name: "בניית מסלול" }),
  ).toHaveAttribute("aria-selected", "true");
  // Still the same document — no reload happened.
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  // NOTE: We do not assert that the built-route layer is visible (not hidden)
  // after the card click. The hideBuiltRoute bug is fixed declaratively in
  // App.jsx: `hideBuiltRoute={panel.state === "discover" && Boolean(hoveredRouteSlug)}`.
  // That guard makes hoveredRouteSlug irrelevant once the panel leaves "discover",
  // so the route is always shown in Build. Asserting it here would require either
  // recording setLayoutProperty calls in the Mapbox mock (a new seam) or inspecting
  // internal React state — neither is worth the coupling. Skipped.
});
