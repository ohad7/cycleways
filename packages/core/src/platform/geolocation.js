// One-shot device location for discovery features ("near me" labels, locate
// button). Wraps the browser geolocation API in a promise. Deliberately NOT a
// tracking/watch API: mobile-web location is unreliable for navigation, which
// is app-only (see plans/navigation-handoff/design.md).
export function getCurrentPosition({ timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const geo = globalThis.navigator?.geolocation;
    if (!geo || typeof geo.getCurrentPosition !== "function") {
      reject(new Error("geolocation-unsupported"));
      return;
    }
    geo.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => reject(error),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}
