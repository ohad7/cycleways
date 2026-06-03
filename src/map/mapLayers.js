// Back-compat barrel: existing callers import map layer helpers/IDs/styles from
// here. New callers should import directly from mapStyles.js (data),
// or mapLayers.product.js (end-user layers).
export * from "@cycleways/core/map/mapStyles.js";
export * from "./mapLayers.product.js";
