import { test, expect } from "@playwright/test";
import { installMapboxMock } from "./mapbox-mock.mjs";

test.beforeEach(async ({ page }) => {
  await installMapboxMock(page);
});

async function clickTopbarLink(page, name) {
  await expect.poll(async () => {
    const links = page.getByRole("link", { name, exact: true });
    const count = await links.count();
    for (let i = 0; i < count; i += 1) {
      if (await links.nth(i).isVisible().catch(() => false)) return "link";
    }
    if (await page.getByRole("button", { name: "פתיחת תפריט", exact: true }).isVisible().catch(() => false)) {
      return "menu";
    }
    return "waiting";
  }).not.toBe("waiting");
  const links = page.getByRole("link", { name, exact: true });
  const count = await links.count();
  for (let i = 0; i < count; i += 1) {
    const link = links.nth(i);
    if (await link.isVisible().catch(() => false)) {
      await link.click();
      return;
    }
  }
  const menuButton = page.getByRole("button", { name: "פתיחת תפריט", exact: true });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  await expect(page.locator("#nav-links")).toHaveClass(/active/);
  await links.first().click();
}

function routeCardByTitle(page, title) {
  return page.locator(".route-card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

async function expectSectionScrolledIntoView(page, selector) {
  await expect.poll(
    () =>
      page.locator(selector).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const headerHeight = document.querySelector(".header")?.getBoundingClientRect().height || 0;
        const viewportHeight = window.innerHeight;
        return {
          inViewport: rect.top < viewportHeight && rect.bottom > headerHeight,
          belowHeader: rect.top >= headerHeight - 8 || rect.bottom > headerHeight + 120,
          scrolled: window.scrollY > 100,
        };
      }),
    { message: `${selector} should be scrolled below the fixed header` },
  ).toEqual({ inViewport: true, belowHeader: true, scrolled: true });
}

test("/routes lists recommended routes", async ({ page }) => {
  await page.goto("/routes/");
  await expect(page).toHaveTitle(/מסלולים מומלצים/);
  await expect(page.locator(".breadcrumbs")).toContainText("מפה");
  await expect(page.locator(".breadcrumbs")).toContainText("מסלולים");
  await expect(routeCardByTitle(page, "סובב בית הלל")).toBeVisible();
  await expect(routeCardByTitle(page, "בניאס וגן הצפון")).toBeVisible();
  await expect(
    routeCardByTitle(page, "סובב בית הלל").locator(".route-card__badges"),
  ).toContainText("מעגלי");
  await expect(
    routeCardByTitle(page, "מסע בעקבות כובשי הגולן").locator(".route-card__badges"),
  ).toContainText("חד כיווני");
  const imageLocator = page.locator(".route-card__photo");
  await expect(imageLocator).not.toHaveCount(0);
  const imageCount = await imageLocator.count();
  for (let i = 0; i < imageCount; i++) {
    const image = imageLocator.nth(i);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() =>
      image.evaluate((img) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
  }
  const images = await page.locator(".route-card__photo").evaluateAll((imgs) =>
    imgs.map((img) => ({
      currentSrc: img.currentSrc,
      naturalWidth: img.naturalWidth,
    })),
  );
  expect(
    images.every((image) =>
      image.currentSrc.includes("/public-data/poi-images/")
    ),
  ).toBe(true);
  expect(images.every((image) => !image.currentSrc.includes("/routes/public-data/"))).toBe(true);
  const mapThumbs = await page.locator(".route-card__map-thumb").evaluateAll((thumbs) =>
    thumbs.map((thumb) => {
      const rect = thumb.getBoundingClientRect();
      const mediaRect = thumb.closest(".route-card__media").getBoundingClientRect();
      return {
        currentSrc: thumb.querySelector("img")?.currentSrc || "",
        naturalWidth: thumb.querySelector("img")?.naturalWidth || 0,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        mediaRect: { left: mediaRect.left, top: mediaRect.top },
      };
    }),
  );
  expect(mapThumbs.length).toBeGreaterThan(0);
  expect(
    mapThumbs.every((image) =>
      image.currentSrc.includes("/public-data/route-map-images/") &&
      image.naturalWidth > 0
    ),
  ).toBe(true);
  expect(
    mapThumbs.every(({ rect, mediaRect }) =>
      rect.width <= 100 &&
      rect.height <= 72 &&
      Math.abs(rect.left - mediaRect.left - 10) <= 1 &&
      Math.abs(rect.top - mediaRect.top - 10) <= 1
    ),
  ).toBe(true);
});

test("front page routes nav opens /routes without blank client transition", async ({ page }) => {
  await page.goto("/");
  await clickTopbarLink(page, "מסלולים");
  await expect(page).toHaveURL(/\/routes\/$/);
  await expect(page.locator(".routes-page")).toBeVisible();
  await expect(routeCardByTitle(page, "סובב בית הלל")).toBeVisible();
});

test("front page contact hash then routes nav still opens /routes", async ({ page, isMobile }) => {
  test.skip(isMobile, "mobile root is the standalone Discover home, not the marketing front page");
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("link", { name: "המלצות", exact: true })).toHaveCount(0);
  await clickTopbarLink(page, "צרו קשר");
  await expect(page).toHaveURL(/\/#contact$/);
  await expect(page.locator("#contact")).toBeVisible();
  await expectSectionScrolledIntoView(page, "#contact");

  await clickTopbarLink(page, "מסלולים");
  await expect(page).toHaveURL(/\/routes\/$/);
  await expect(page.locator(".routes-page")).toBeVisible();
  await expect(routeCardByTitle(page, "סובב בית הלל")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("front page hash links scroll after route transitions", async ({ page, isMobile }) => {
  test.skip(isMobile, "mobile root is the standalone Discover home, not the marketing front page");
  await page.goto("/#contact");
  await expect(page.locator("#contact")).toBeVisible();
  await expectSectionScrolledIntoView(page, "#contact");

  await page.goto("/routes/");
  await clickTopbarLink(page, "צרו קשר");
  await expect(page).toHaveURL(/\/#contact$/);
  await expect(page.locator("#contact")).toBeVisible();
  await expectSectionScrolledIntoView(page, "#contact");
});

test("route card details open canonical /routes detail page", async ({ page }) => {
  await page.goto("/routes");
  const card = page.locator(".route-card", { hasText: "סובב בית הלל" });
  await expect(card.getByRole("link", { name: "פתח במפה" })).toHaveAttribute("href", /route=/);
  await page
    .locator(".route-card", { hasText: "סובב בית הלל" })
    .getByRole("link", { name: "פתח פרטי מסלול: סובב בית הלל" })
    .click();
  await expect(page).toHaveURL(/\/routes\/sovev-beit-hillel$/);
  await expect(page.locator(".featured-route-header h1")).toContainText("סובב בית הלל");
  await expect(page.locator(".breadcrumbs")).toContainText("מפה");
  await expect(page.locator(".breadcrumbs")).toContainText("מסלולים");
  await expect(page.locator(".breadcrumbs")).toContainText("סובב בית הלל");
});

test("TopBar appears on /routes page", async ({ page }) => {
  await page.goto("/routes");
  await expect(page.locator("header.header")).toBeVisible();
  await expect(page.locator(".site-title")).toContainText("מפת שבילי אופניים");
  const link = page.getByRole("link", { name: "מסלולים" });
  if (!(await link.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "פתיחת תפריט", exact: true }).click();
    await expect(page.locator("#nav-links")).toHaveClass(/active/);
  }
  await expect(page.getByRole("link", { name: "מסלולים" })).toHaveAttribute("href", /\/routes\/$/);
  await expect(page.getByRole("link", { name: "מסלולים" })).toHaveClass(/nav-link--active/);
  await expect(page.getByRole("button", { name: "מדריך", exact: true })).toHaveCount(0);
});

test("TopBar site title links back to /", async ({ page }) => {
  await page.goto("/routes/sovev-beit-hillel");
  await page.locator(".site-title-link").click();
  await expect(page).toHaveURL(/\/$/);
});

test("/featured redirects to canonical /routes", async ({ page }) => {
  await page.goto("/featured/");
  await expect(page).toHaveURL(/\/routes\/?$/);
  await expect(page.locator(".routes-page")).toBeVisible();
});
