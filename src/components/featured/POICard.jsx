import React from "react";
import { POI_EMOJIS, POI_LABELS } from "@cycleways/core/data/poiTypes.js";

export default function POICard({ poi, focused, onSelect }) {
  return (
    <button
      type="button"
      className={`poi-card${focused ? " poi-card--focused" : ""}`}
      onClick={() => onSelect(poi)}
    >
      <div className="poi-card-header">
        <span className="poi-card-emoji" aria-hidden="true">
          {POI_EMOJIS[poi.type] || "📍"}
        </span>
        <div>
          <div className="poi-card-title">{poi.name || POI_LABELS[poi.type] || poi.type}</div>
          <div className="poi-card-type">{POI_LABELS[poi.type] || poi.type}</div>
        </div>
      </div>
      {poi.photo && <img className="poi-card-photo" src={poi.photo} alt={poi.name || poi.type} />}
      {poi.information && <p className="poi-card-info">{poi.information}</p>}
      {(poi.phone || poi.website || poi.hours) && (
        <ul className="poi-card-meta">
          {poi.phone && <li>📞 <a href={`tel:${poi.phone}`}>{poi.phone}</a></li>}
          {poi.website && <li>🌐 <a href={poi.website} target="_blank" rel="noreferrer">אתר</a></li>}
          {poi.hours && <li>🕒 {poi.hours}</li>}
        </ul>
      )}
    </button>
  );
}
