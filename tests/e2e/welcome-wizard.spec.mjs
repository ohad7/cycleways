import { test, expect } from "@playwright/test";

async function openRouteDiscovery(page) {
  const button = page.locator(".topbar-find-button");
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return;
  }
  const menuButton = page.locator(".mobile-menu-btn");
  if ((await menuButton.count()) === 1) {
    await menuButton.click({ force: true });
    await expect(page.locator("#nav-links")).toHaveClass(/active/);
  }
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return;
  }
  await button.evaluate((element) => element.click());
}

test("route discovery is available by default", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "מפת שבילי אופניים - גליל עליון וגולן" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".topbar-find-button")).toHaveCount(1);
  await openRouteDiscovery(page);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test.describe("welcome discover", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
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
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openRouteDiscovery(page);
    await expect(page.getByRole("dialog")).toBeVisible();
    // Results should appear without any required answers
    const cards = page.locator(".rc-result-card");
    await expect(cards.first()).toBeVisible();
    await cards.first().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/route=/);
  });

  test("surface chip filters results", async ({ page }) => {
    await page.goto("/");
    await openRouteDiscovery(page);
    const dirtChip = page.getByRole("button", { name: "שטח", exact: true });
    await dirtChip.click();
    await expect(dirtChip).toHaveClass(/wd-chip--active/);
  });

  test("start autocomplete filters results", async ({ page }) => {
    await page.goto("/");
    await openRouteDiscovery(page);
    const startInput = page.getByLabel("התחלה", { exact: true });
    await startInput.fill("גבעת");
    await startInput.press("Enter");
    await expect(page.locator(".rc-result-card", { hasText: "מסע בעקבות כובשי הגולן" })).toBeVisible();
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
    await openRouteDiscovery(page);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "סגור וחזור למפה" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
