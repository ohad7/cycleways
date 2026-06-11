// Native sibling resolved by Metro. The iPhone app has its own location stack
// (plans/rn-mobile-location); core callers on native should not reach this.
export function getCurrentPosition() {
  return Promise.reject(new Error("geolocation-unsupported"));
}
