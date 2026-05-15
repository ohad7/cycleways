import React from "react";
import { getSegmentQualityLabel } from "./quality.js";

function SegmentInfoPanel({ featureFlags, segmentMetadata, segmentName, source }) {
  if (!segmentName) {
    return (
      <section className="react-side-panel">
        <h2>מקטע</h2>
        <p>רחף מעל קו במפה כדי לראות פרטים. לחץ על קו כדי להשאיר אותו מסומן.</p>
      </section>
    );
  }

  const dataPoints = segmentMetadata?.data || [];
  const qualityLabel = getSegmentQualityLabel(segmentMetadata, featureFlags);

  return (
    <section className="react-side-panel">
      <p className="react-shell__eyebrow">
        {source === "focused" ? "מקטע מסומן" : "מקטע נבחר"}
      </p>
      <h2>{segmentName}</h2>
      {qualityLabel && (
        <span
          className={`react-quality-badge react-quality-badge--${qualityLabel.tone}`}
        >
          {qualityLabel.text}
        </span>
      )}
      <dl className="react-detail-grid">
        {segmentMetadata?.id && (
          <div>
            <dt>ID</dt>
            <dd>{segmentMetadata.id}</dd>
          </div>
        )}
        {segmentMetadata?.roadType && (
          <div>
            <dt>סוג דרך</dt>
            <dd>{segmentMetadata.roadType}</dd>
          </div>
        )}
        <div>
          <dt>נקודות מידע</dt>
          <dd>{dataPoints.length}</dd>
        </div>
      </dl>
      {dataPoints.length > 0 && (
        <ul className="react-data-list">
          {dataPoints.map((dataPoint, index) => (
            <li key={dataPoint.id || `${segmentName}-${index}`}>
              <span aria-hidden="true">{dataPoint.emoji}</span>
              <span>{dataPoint.information}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default SegmentInfoPanel;
