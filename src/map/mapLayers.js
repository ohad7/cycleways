// Back-compat barrel: existing callers import map layer helpers/IDs/styles from
// here. New callers should import directly from mapStyles.js (data),
// mapLayers.product.js (end-user layers), or mapLayers.debug.js (web-only OSM).
export * from "@cycleways/core/map/mapStyles.js";
export * from "./mapLayers.product.js";
export * from "./mapLayers.debug.js";
