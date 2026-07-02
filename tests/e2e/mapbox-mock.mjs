export async function installMapboxMock(page) {
  await page.addInitScript(MAPBOX_MOCK_SCRIPT);
  await page.route("https://api.mapbox.com/mapbox-gl-js/**/mapbox-gl.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: MAPBOX_MOCK_SCRIPT,
    }),
  );
  await page.route("https://api.mapbox.com/mapbox-gl-js/**/mapbox-gl.css", (route) =>
    route.fulfill({
      contentType: "text/css",
      body: "",
    }),
  );
  await page.route("https://unpkg.com/ionicons**", (route) =>
    route.fulfill({
      contentType: route.request().url().endsWith(".css")
        ? "text/css"
        : "application/javascript",
      body: "",
    }),
  );
  await page.route("**/mapbox-token.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'window.CYCLEWAYS_MAPBOX_TOKEN = "test-token";',
    }),
  );
}

const MAPBOX_MOCK_SCRIPT = `
(() => {
  window.__mockMapboxEvents = [];
  window.__mockMapboxMaps = [];
  window.__mockMapboxRenderedFeatures = [];

  class MockSource {
    constructor(data) {
      this.data = data;
    }

    setData(data) {
      this.data = data;
    }
  }

  class MockMap {
    constructor(options = {}) {
      this.options = options;
      this.sources = new Map();
      this.layers = new Map();
      this.images = new Map();
      this.handlers = [];
      this.dragPan = {
        disable() {},
        enable() {},
      };
      this.canvas = document.createElement("canvas");
      this.canvas.className = "mapboxgl-canvas";
      this.canvas.width = 960;
      this.canvas.height = 520;
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      const container =
        typeof options.container === "string"
          ? document.getElementById(options.container)
          : options.container;
      container?.appendChild(this.canvas);
      window.__mockMapboxMaps.push(this);
      window.__mockMapboxCurrentMap = this;

      setTimeout(() => this._emit("load", {}), 0);
    }

    on(type, layerOrHandler, maybeHandler) {
      const handler = maybeHandler || layerOrHandler;
      const layerId = maybeHandler ? layerOrHandler : null;
      this.handlers.push({ type, layerId, handler });
      return this;
    }

    off(type, layerOrHandler, maybeHandler) {
      const handler = maybeHandler || layerOrHandler;
      this.handlers = this.handlers.filter(
        (entry) => entry.type !== type || entry.handler !== handler,
      );
      return this;
    }

    _emit(type, event) {
      this.handlers
        .filter((entry) => entry.type === type && !entry.layerId)
        .forEach((entry) => entry.handler(this._event(event)));
    }

    _emitLayer(type, layerId, event = {}) {
      const normalized = this._event(event);
      this.handlers
        .filter((entry) => entry.type === type && entry.layerId === layerId)
        .forEach((entry) => entry.handler(normalized));
    }

    _event(event = {}) {
      return {
        point: event.point || { x: 0, y: 0 },
        points: event.points || [event.point || { x: 0, y: 0 }],
        lngLat: event.lngLat || { lng: 35.58, lat: 33.11 },
        features: event.features || [],
        originalEvent: {
          stopPropagation() {},
          preventDefault() {},
          ...(event.originalEvent || {}),
        },
        preventDefault() {},
        ...event,
      };
    }

    addSource(id, source) {
      this.sources.set(id, new MockSource(source.data));
    }

    getSource(id) {
      return this.sources.get(id);
    }

    removeSource(id) {
      this.sources.delete(id);
    }

    addLayer(layer) {
      this.layers.set(layer.id, layer);
    }

    getLayer(id) {
      return this.layers.get(id);
    }

    removeLayer(id) {
      this.layers.delete(id);
    }

    setFilter(layerId, filter) {
      const layer = this.layers.get(layerId);
      if (layer) {
        layer.filter = filter;
      }
    }
    setLayoutProperty() {}
    setPaintProperty() {}
    isMoving() {
      return false;
    }
    isStyleLoaded() {
      return true;
    }
    getZoom() {
      return Number.isFinite(this.options.zoom) ? this.options.zoom : 11.5;
    }
    getBounds() {
      // Fixed bbox around the project area, consistent with project() below.
      const west = 35.45;
      const east = 35.78;
      const south = 33.0;
      const north = 33.25;
      return {
        getWest: () => west,
        getEast: () => east,
        getSouth: () => south,
        getNorth: () => north,
      };
    }
    easeTo(options) {
      window.__mockMapboxEvents.push({ type: "easeTo", options });
    }

    project(lngLat) {
      const lng = Array.isArray(lngLat) ? lngLat[0] : lngLat.lng;
      const lat = Array.isArray(lngLat) ? lngLat[1] : lngLat.lat;
      return {
        x: (Number(lng) - 35.45) * 3600,
        y: (33.25 - Number(lat)) * 3600,
      };
    }

    hasImage(id) {
      return this.images.has(id);
    }

    addImage(id, image) {
      this.images.set(id, image);
    }

    queryRenderedFeatures(_point, options = {}) {
      const features = window.__mockMapboxRenderedFeatures || [];
      const layers = Array.isArray(options.layers) ? new Set(options.layers) : null;
      if (!layers) return features;

      return features.filter((feature) => {
        const layerId = feature?.layer?.id || feature?.layerId;
        return layerId ? layers.has(layerId) : false;
      });
    }

    fitBounds(bounds, options) {
      window.__mockMapboxEvents.push({
        type: "fitBounds",
        points: bounds.points || [],
        options,
      });
    }

    flyTo(options) {
      window.__mockMapboxEvents.push({ type: "flyTo", options });
    }

    getCanvas() {
      return this.canvas;
    }

    remove() {
      this.canvas.remove();
      if (window.__mockMapboxCurrentMap === this) {
        window.__mockMapboxCurrentMap = null;
      }
    }
  }

  class MockMarker {
    constructor(element) {
      this.element = element || document.createElement("div");
    }

    setLngLat(lngLat) {
      this.lngLat = lngLat;
      return this;
    }

    addTo() {
      this.map = arguments[0];
      this.map?.getCanvas?.().parentElement?.appendChild(this.element);
      window.__mockMapboxEvents.push({
        type: "marker",
        className: this.element.className || "",
        lngLat: this.lngLat,
      });
      return this;
    }

    remove() {
      this.element.remove();
    }
  }

  class MockLngLatBounds {
    constructor() {
      this.points = [];
    }

    extend(coord) {
      if (Array.isArray(coord)) {
        this.points.push(coord);
      } else if (coord && Number.isFinite(coord.lng) && Number.isFinite(coord.lat)) {
        this.points.push([coord.lng, coord.lat]);
      }
      return this;
    }

    isEmpty() {
      return this.points.length === 0;
    }
  }

  class MockPopup {
    constructor(options = {}) {
      this.options = options;
    }
    setLngLat(lngLat) {
      this.lngLat = lngLat;
      return this;
    }
    setHTML(html) {
      this.html = html;
      return this;
    }
    addTo(map) {
      this.map = map;
      window.__mockMapboxEvents.push({ type: "popup", lngLat: this.lngLat });
      return this;
    }
    remove() {}
  }

  window.mapboxgl = {
    Map: MockMap,
    Marker: MockMarker,
    LngLatBounds: MockLngLatBounds,
    Popup: MockPopup,
  };
})();
`;
