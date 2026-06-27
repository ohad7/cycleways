function kebabToCamel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Maps a Mapbox-GL { layout, paint } spec to @rnmapbox camelCase style props.
// Values (including expression arrays) are passed through untouched; @rnmapbox
// accepts the same expression dialect the shared specs emit.
export function paintToRNStyle(spec = {}) {
  const out = {};
  for (const group of ["layout", "paint"]) {
    const section = spec[group];
    if (!section) continue;
    for (const [key, value] of Object.entries(section)) {
      out[kebabToCamel(key)] = value;
    }
  }
  return out;
}
