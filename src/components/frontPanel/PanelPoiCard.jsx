import React from "react";
import { POI_EMOJIS, POI_LABELS, primaryPoiImage } from "@cycleways/core/data/poiTypes.js";
import RichText from "../RichText.jsx";

export default function PanelPoiCard({ poi, distanceLabel, onSelect }) {
  const img = primaryPoiImage(poi);
  const src = img ? (img.thumbnail || img.photo) : null;
  return (
    <button type="button" className="panel-poi-card" onClick={() => onSelect?.(poi)}>
      <div className="panel-poi-card__head">
        <span className="panel-poi-card__emoji" aria-hidden="true">{POI_EMOJIS[poi.type] || "📍"}</span>
        <div className="panel-poi-card__titles">
          <span className="panel-poi-card__title">{poi.name || POI_LABELS[poi.type] || poi.type}</span>
          <span className="panel-poi-card__type">{POI_LABELS[poi.type] || poi.type}{distanceLabel ? ` · ${distanceLabel}` : ""}</span>
        </div>
      </div>
      {src && <img className="panel-poi-card__photo" src={src} alt="" loading="lazy" />}
      <RichText className="panel-poi-card__desc" text={poi.information} stopLinkPropagation />
    </button>
  );
}
