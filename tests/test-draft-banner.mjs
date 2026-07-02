import assert from "node:assert/strict";
import { shouldShowFloatingDraftBanner } from "@cycleways/core/ui/draftBannerVisibility.js";

const base = {
  hasDraft: true,
  hasRouteParam: false,
  pointCount: 0,
  panelState: "discover",
  isMobileSheet: false,
  sheetSnap: "half",
};

assert.equal(shouldShowFloatingDraftBanner({ ...base, hasDraft: false }), false);
assert.equal(shouldShowFloatingDraftBanner({ ...base, hasRouteParam: true }), false);
assert.equal(shouldShowFloatingDraftBanner({ ...base, pointCount: 2 }), false);
assert.equal(shouldShowFloatingDraftBanner(base), true);

assert.equal(
  shouldShowFloatingDraftBanner({ ...base, panelState: "build" }),
  false,
);

assert.equal(
  shouldShowFloatingDraftBanner({
    ...base,
    panelState: "build",
    isMobileSheet: true,
    sheetSnap: "peek",
  }),
  true,
);

for (const sheetSnap of ["half", "full"]) {
  assert.equal(
    shouldShowFloatingDraftBanner({
      ...base,
      panelState: "build",
      isMobileSheet: true,
      sheetSnap,
    }),
    false,
  );
}

console.log("test-draft-banner: OK");
