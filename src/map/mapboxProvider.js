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
