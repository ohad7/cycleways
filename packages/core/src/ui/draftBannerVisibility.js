// De-duplication rule for the draft-restore offer: the floating map banner
// yields to the Build panel's empty-state draft row whenever that row is
// actually visible (Build state; on mobile only while the sheet is open).
// The first three checks mirror the banner's original render condition.
export function shouldShowFloatingDraftBanner({
  hasDraft,
  hasRouteParam,
  pointCount,
  panelState,
  isMobileSheet,
  sheetSnap,
}) {
  if (!hasDraft || hasRouteParam || pointCount > 0) return false;
  const panelRowVisible =
    panelState === "build" && (!isMobileSheet || sheetSnap !== "peek");
  return !panelRowVisible;
}
