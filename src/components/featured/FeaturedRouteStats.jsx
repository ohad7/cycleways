import React from "react";
import {
  routeDifficultyLabel,
  routeShapeLabel,
  routeSurfaceLabel,
} from "@cycleways/core/data/catalog.js";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

export default function FeaturedRouteStats({
  className = "",
  difficultyLabel = null,
  surfaceLabel: surfaceLabelOverride = null,
}) {
  const { meta } = useFeaturedRoute();
  if (!meta) return null;

  const difficulty = difficultyLabel || routeDifficultyLabel(meta);
  const surface = surfaceLabelOverride || routeSurfaceLabel(meta);
  const shape = routeShapeLabel(meta);
  const items = [
    Number.isFinite(meta.distanceKm) && { label: "אורך", value: `${meta.distanceKm} ק"מ` },
    Number.isFinite(meta.elevationGainM) && { label: "טיפוס", value: `${meta.elevationGainM} מ׳` },
    Number.isFinite(meta.elevationLossM) && { label: "ירידה", value: `${meta.elevationLossM} מ׳` },
    shape && { label: "סוג", value: shape },
    difficulty && { label: "רמת קושי", value: difficulty },
    surface && { label: "משטח", value: surface },
  ].filter(Boolean);

  if (items.length === 0) return null;

  return (
    <dl className={["fv-route-stats", className].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
