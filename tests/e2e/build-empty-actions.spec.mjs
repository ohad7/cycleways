import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";
import { ensurePanelOpen, revealMapOnMobile } from "./sheet-helpers.mjs";

const COMPACT_ROUTE = "Bjjy1nRHHDArrNAoctqGv4RHL3un";
const SEEDED_DRAFT = {
  param: COMPACT_ROUTE,
  distanceKm: 12.4,
  savedAt: 1718000000000,
};

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

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

test("empty Build shows the steps and starting actions", async ({ page, isMobile }) => {
  await openEmptyBuild(page, isMobile);
  const actions = page.getByTestId("build-empty-actions");
  await expect(actions).toBeVisible();
  await expect(actions.locator(".build-empty-actions__steps li")).toHaveCount(3);
  await expect(actions.getByLabel("חיפוש מיקום")).toBeVisible();
  await expect(actions.getByRole("button", { name: "המיקום שלי" })).toBeVisible();
  await expect(page.locator(".build-panel__empty")).toHaveCount(0);
});

test("panel search input shares state with the map search overlay", async ({ page, isMobile }) => {
  await openEmptyBuild(page, isMobile);
  const actions = page.getByTestId("build-empty-actions");
  await actions.getByLabel("חיפוש מיקום").fill("דפנה");
  await expect(page.locator("#location-search")).toHaveValue("דפנה");
});

test("draft offer moves into the panel on Build and the floating banner yields", async ({ page, isMobile }) => {
  await page.addInitScript((draft) => {
    window.localStorage.setItem("cycleways:planner-draft", JSON.stringify(draft));
  }, SEEDED_DRAFT);

  await page.goto("/");
  if (!isMobile) {
    await expect(page.locator(".draft-restore-banner")).toBeVisible();
  }

  await revealMapOnMobile(page, isMobile);
  await ensurePanelOpen(page);
  if (!isMobile) {
    await page
      .getByTestId("front-panel")
      .getByRole("tab", { name: "בניית מסלול" })
      .click();
  }

  const draftRow = page.locator(".build-empty-actions__draft");
  await expect(draftRow).toBeVisible();
  await expect(draftRow).toContainText("12.4");
  await expect(page.locator(".draft-restore-banner")).toHaveCount(0);
});
