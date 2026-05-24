import { test, expect } from "@playwright/test";

test.describe("welcome wizard", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        localStorage.removeItem("cycleways:skipWelcome");
      } catch {}
    });
  });

  test("appears on first visit and closes when route is picked", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "לא משנה" }).first().click();
    for (let i = 0; i < 4; i++) {
      const any = page.getByRole("button", { name: "לא משנה" }).first();
      if (await any.isVisible().catch(() => false)) {
        await any.click();
      } else {
        await page.locator(".ww-option-btn").first().click();
      }
    }
    const results = page.locator(".rc-result-card");
    await expect(results.first()).toBeVisible();
    await results.first().getByRole("button", { name: /במפה/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/route=/);
  });

  test("skipped when ?route= is in URL", async ({ page }) => {
    await page.goto(
      "/?route=DvsVvkJ2SiQeaAkhgGPtCZde8S8Q8xGxbG4BSY7c32agaEz219fTkrW2ZA",
    );
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("dismiss persists across reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /דלג למפה/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
