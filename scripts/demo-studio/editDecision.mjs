export function validateProofEdit(value) {
  if (!value || value.schemaVersion !== 1 || value.kind !== "proof") throw new Error("proof edit schemaVersion/kind is invalid");
  for (const field of ["bundleDigest", "captureRunId"]) {
    if (typeof value[field] !== "string" || !value[field]) throw new Error(`proof edit ${field} is required`);
  }
  const source = value.source || {};
  if (!Number.isFinite(Number(source.inMs)) || !Number.isFinite(Number(source.outMs)) || Number(source.outMs) <= Number(source.inMs)) {
    throw new Error("proof edit source in/out is invalid");
  }
  const layout = value.layout || {};
  const [width, height] = String(layout.master || "").split("x").map(Number);
  if (![width, height, Number(layout.fps), Number(layout.roadFraction)].every(Number.isFinite)) throw new Error("proof edit layout is invalid");
  if (layout.roadFraction < 0.58 || layout.roadFraction > 0.72) throw new Error("roadFraction must be between 0.58 and 0.72");
  return {
    ...value,
    source: { inMs: Number(source.inMs), outMs: Number(source.outMs) },
    layout: { ...layout, width, height, fps: Number(layout.fps), roadFraction: Number(layout.roadFraction) },
  };
}
