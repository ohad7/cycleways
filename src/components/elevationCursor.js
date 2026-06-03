// Map a 0..1 route fraction to the SVG x coordinate (0..100), or null if the
// fraction is not a finite number. Extracted to a plain module so it can be
// unit-tested by the node test runner without loading the JSX component.
export function elevationCursorX(fraction) {
  if (!Number.isFinite(fraction)) return null;
  return Math.max(0, Math.min(100, fraction * 100));
}
