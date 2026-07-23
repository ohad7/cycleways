export function validateProofEdit(value) {
  if (!value || value.schemaVersion !== 1 || value.kind !== "proof") throw new Error("proof edit schemaVersion/kind is invalid");
  for (const field of ["bundleDigest", "captureRunId"]) {
    if (typeof value[field] !== "string" || !value[field]) throw new Error(`proof edit ${field} is required`);
  }
  const source = value.source || {};
  if (!Number.isFinite(Number(source.inMs)) || !Number.isFinite(Number(source.outMs)) || Number(source.outMs) <= Number(source.inMs)) {
    throw new Error("proof edit source in/out is invalid");
  }
  const sourceInMs = Number(source.inMs);
  const sourceOutMs = Number(source.outMs);
  const rawSegments = source.segments === undefined ? [{ inMs: sourceInMs, outMs: sourceOutMs }] : source.segments;
  if (!Array.isArray(rawSegments) || rawSegments.length < 1 || rawSegments.length > 6) throw new Error("proof edit must contain between one and six source segments");
  const segments = rawSegments.map((segment, index) => {
    const inMs = Number(segment?.inMs);
    const outMs = Number(segment?.outMs);
    if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) throw new Error(`proof edit source segment ${index + 1} is invalid`);
    if (inMs < sourceInMs || outMs > sourceOutMs) throw new Error(`proof edit source segment ${index + 1} is outside the capture window`);
    if (index > 0 && inMs < Number(rawSegments[index - 1]?.outMs)) throw new Error(`proof edit source segment ${index + 1} overlaps the previous segment`);
    const mapped = { inMs, outMs };
    if (segment.sourceId !== undefined) {
      if (typeof segment.sourceId !== "string" || !segment.sourceId) throw new Error(`proof edit source segment ${index + 1} sourceId is invalid`);
      const sourceInMs = Number(segment.sourceInMs);
      const sourceOutMs = Number(segment.sourceOutMs);
      if (!Number.isFinite(sourceInMs) || !Number.isFinite(sourceOutMs) || sourceOutMs <= sourceInMs) {
        throw new Error(`proof edit source segment ${index + 1} clip timing is invalid`);
      }
      Object.assign(mapped, { sourceId: segment.sourceId, sourceInMs, sourceOutMs });
    }
    return mapped;
  });
  const layout = value.layout || {};
  const [width, height] = String(layout.master || "").split("x").map(Number);
  if (![width, height, Number(layout.fps), Number(layout.roadFraction)].every(Number.isFinite)) throw new Error("proof edit layout is invalid");
  if (layout.roadFraction < 0.58 || layout.roadFraction > 0.72) throw new Error("roadFraction must be between 0.58 and 0.72");
  return {
    ...value,
    source: { inMs: sourceInMs, outMs: sourceOutMs, segments },
    layout: { ...layout, width, height, fps: Number(layout.fps), roadFraction: Number(layout.roadFraction) },
  };
}
