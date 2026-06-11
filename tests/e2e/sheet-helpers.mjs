import { expect } from "@playwright/test";

// On mobile the front panel lives in a bottom sheet that defaults to peek
// (content hidden). Call this before interacting with panel content; it is a
// no-op on desktop, where the sheet wrapper is inert.
export async function ensurePanelOpen(page) {
  const grip = page.locator(".front-sheet__grip");
  // Wait briefly for the page to settle, then check grip visibility.
  // The grip is CSS-shown on mobile (≤860px) and CSS-hidden on desktop.
  await grip.waitFor({ state: "attached", timeout: 10_000 }).catch(() => {});
  if (!(await grip.isVisible().catch(() => false))) return; // desktop: handle hidden
  const sheet = page.locator(".front-sheet");
  if ((await sheet.getAttribute("data-snap")) === "peek") {
    await grip.click();
    await expect(sheet).toHaveAttribute("data-snap", "half");
  }
}
