import { test, expect } from "@playwright/test";

test("route discovery is hidden by default", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "מפת שבילי אופניים - גליל עליון וגולן" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "מצא מסלול" })).toHaveCount(0);
});

test.describe("welcome discover", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      window.CYCLEWAYS_FEATURE_FLAGS = { routeDiscovery: true };
      try {
        if (!sessionStorage.getItem("cycleways:e2eWelcomeReset")) {
          localStorage.removeItem("cycleways:skipWelcome");
          sessionStorage.setItem("cycleways:e2eWelcomeReset", "1");
        }
      } catch {}
    });
  });

  test("appears on first visit and lists routes; picking one closes overlay", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    // Results should appear without any required answers
    const cards = page.locator(".rc-result-card");
    await expect(cards.first()).toBeVisible();
    await cards.first().getByRole("button", { name: /במפה/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/route=/);
  });

  test("difficulty chip filters results", async ({ page }) => {
    await page.goto("/");
    const easyChip = page.getByRole("button", { name: /קל/ }).first();
    await easyChip.click();
    await expect(easyChip).toHaveClass(/wd-chip--active/);
  });

  test("skipped when ?route= is in URL", async ({ page }) => {
    await page.goto(
      "/?route=DvsVvkJ2SiQeaAkhgGPtCZde8S8Q8xGxbG4BSY7c32agaEz219fTkrW2ZA",
    );
    await expect(page.locator("#route-description")).toContainText("6.5 ק\"מ");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("dismiss persists across reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "סגור וחזור למפה" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
