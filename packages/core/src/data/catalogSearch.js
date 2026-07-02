// Free-text catalog filter for the discovery list: case-insensitive substring
// over the route name and the names of the route's nearby places. An empty
// query returns the input array unchanged.
export function filterCatalogBySearch(entries, query, placeById) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return entries;
  const list = Array.isArray(entries) ? entries : [];
  return list.filter((entry) => {
    const haystacks = [entry?.name];
    for (const id of entry?.passesNear || []) {
      const place = placeById?.get?.(id);
      if (place?.name) haystacks.push(place.name);
    }
    return haystacks.some(
      (text) => typeof text === "string" && text.toLowerCase().includes(needle),
    );
  });
}
