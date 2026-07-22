export function revisionKeysEqual(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => Object.is(value, right[index]));
}
/**
 * Lazily updates one Mapbox GeoJSON source.
 *
 * A revision key skips collection construction as well as source.setData(). All
 * values which can affect the collection must be included in that key.
 */
export function updateGeoJsonSource({
  cache,
  getSource,
  sourceId,
  buildData,
  revisionKey,
  onResult,
}) {
  const source = getSource(sourceId);
  if (!source) return { status: "missing" };

  const cached = cache.get(sourceId);
  if (
    revisionKey !== undefined &&
    cached?.source === source &&
    revisionKeysEqual(cached.revisionKey, revisionKey)
  ) {
    const result = { status: "skipped-revision", sourceId };
    onResult?.(result);
    return result;
  }

  const startedAt = performance.now();
  const data = typeof buildData === "function" ? buildData() : buildData;
  const buildDurationMs = performance.now() - startedAt;
  if (cached?.source === source && cached.data === data) {
    cache.set(sourceId, { ...cached, revisionKey });
    const result = { status: "skipped-identity", sourceId, buildDurationMs };
    onResult?.(result);
    return result;
  }

  const updateStartedAt = performance.now();
  source.setData(data);
  const setDataDurationMs = performance.now() - updateStartedAt;
  cache.set(sourceId, { source, data, revisionKey });
  const result = { status: "updated", sourceId, buildDurationMs, setDataDurationMs };
  onResult?.(result);
  return result;
}
