import React from "react";
import { useFeaturedRoute } from "./FeaturedRouteContext.js";

const DIFFICULTY_HE = {
  easy: "קל",
  moderate: "בינוני",
  hard: "מאתגר",
};

function surfaceLabel(roadMix) {
  if (!roadMix) return null;
  const { paved = 0, dirt = 0, road = 0 } = roadMix;
  if (paved >= dirt && paved >= road) return "סלול";
  if (dirt >= paved && dirt >= road) return "שביל עפר";
  return "כביש";
}

export default function FeaturedRouteStats({ className = "" }) {
  const { meta } = useFeaturedRoute();
  if (!meta) return null;

  const items = [
    Number.isFinite(meta.distanceKm) && { label: "אורך", value: `${meta.distanceKm} ק"מ` },
    Number.isFinite(meta.elevationGainM) && { label: "טיפוס", value: `${meta.elevationGainM} מ׳` },
    Number.isFinite(meta.elevationLossM) && { label: "ירידה", value: `${meta.elevationLossM} מ׳` },
    meta.difficulty && { label: "רמת קושי", value: DIFFICULTY_HE[meta.difficulty] || meta.difficulty },
    surfaceLabel(meta.roadMix) && { label: "משטח", value: surfaceLabel(meta.roadMix) },
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
