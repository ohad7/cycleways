// Single accessor for the Mapbox GL JS global. Keeps the rest of the map code
// free of `window.mapboxgl` reads so the MapSurface contract has no browser
// global dependency. `setMapboxGlForTesting` exists only for unit tests.
let testOverride;

export function setMapboxGlForTesting(value) {
  // null = force "absent" (getMapboxGl throws); undefined = not overridden
  // (fall back to window.mapboxgl); any object = inject that instance.
  testOverride = value;
}

export function getMapboxGl() {
  const instance =
    testOverride !== undefined
      ? testOverride
      : typeof window !== "undefined"
        ? window.mapboxgl
        : undefined;
  if (!instance) {
    throw new Error("Mapbox GL is not loaded");
  }
  return instance;
}

// Resolves with the Mapbox GL global once it is available. The CDN <script> is
// loaded `async` so it no longer blocks the app shell; callers that need to
// create a map await this instead of assuming the global is already present.
// Resolves with `undefined` if it never appears (caller treats that as absent).
export function whenMapboxReady() {
  if (testOverride !== undefined) {
    return Promise.resolve(testOverride || undefined);
  }
  if (typeof window === "undefined") {
    return Promise.resolve(undefined);
  }
  if (window.mapboxgl) {
    return Promise.resolve(window.mapboxgl);
  }
  return new Promise((resolve) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (window.mapboxgl || Date.now() - start > 20000) {
        clearInterval(id);
        resolve(window.mapboxgl);
      }
    }, 30);
  });
}
