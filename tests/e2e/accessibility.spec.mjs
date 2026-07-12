import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMapboxMock } from "./mapbox-mock.mjs";

const COMPACT_ROUTE = "Bjjy1nRHHDArrNAoctqGv4RHL3un";

async function seriousViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  return results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
}

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

for (const path of ["/privacy", "/terms", "/support", "/accessibility", "/routes"]) {
  test("first-party accessibility scan: " + path, async ({ page }) => {
    await page.goto(path);
    await page.locator("#main-content").waitFor();
    const serious = await seriousViolations(page);
    expect(
      serious,
      serious
        .map((violation) => violation.id + ": " + violation.help)
        .join("\n"),
    ).toEqual([]);
  });
}

test("planner empty and routed states have no serious first-party violations", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    await page.getByTestId("mobile-discover-home").waitFor();
  } else {
    await page.locator("#map").waitFor();
  }
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto("/?route=" + COMPACT_ROUTE);
  await expect(page.getByTestId("front-panel")).toHaveAttribute("data-route-status", "ready", {
    timeout: 30_000,
  });
  expect(await seriousViolations(page)).toEqual([]);
});

test("route detail has no serious first-party violations", async ({ page }) => {
  await page.goto("/routes/sovev-beit-hillel");
  await page.locator("#main-content").waitFor();
  expect(await seriousViolations(page)).toEqual([]);
});

test("skip link bypasses repeated navigation", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop keyboard navigation assertion");
  await page.goto("/privacy");
  const skipLink = page.getByRole("link", { name: "דלג לתוכן הראשי" });
  await skipLink.waitFor();
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("mobile menu exposes state and restores focus on Escape", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile menu assertion");
  await page.goto("/privacy");
  const toggle = page.getByRole("button", { name: "פתיחת תפריט" });
  await toggle.click();
  await expect(page.getByRole("button", { name: "סגירת תפריט" })).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "פתיחת תפריט" })).toBeFocused();
});

test("route filters expose a keyboard-operable combobox", async ({ page, isMobile }) => {
  await page.goto("/routes");
  if (isMobile) {
    const filterToggle = page.getByRole("button", { name: "סינון וחיפוש" });
    await expect(filterToggle).toBeVisible();
    await filterToggle.click();
    await expect(page.locator(".routes-page__search-panel")).toBeVisible();
  }
  const combo = page.getByRole("combobox", { name: "התחלה" });
  await combo.focus();
  await combo.press("ArrowDown");
  await expect(combo).toHaveAttribute("aria-expanded", "true");
  await expect(combo).toHaveAttribute("aria-activedescendant", /option-/);
  await combo.press("Escape");
  await expect(combo).toHaveAttribute("aria-expanded", "false");
});

test("reduced-motion preference disables nonessential transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/privacy");
  const duration = await page.locator(".nav-link").first().evaluate(
    (element) => getComputedStyle(element).transitionDuration,
  );
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001);
});
