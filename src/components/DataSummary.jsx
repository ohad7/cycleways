import React from "react";

// The tapped-marker detail now lives in DataMarkerCard; this panel keeps showing
// the active route's data points only.
function DataSummary({ activeDataPoints }) {
  return (
    <section className="react-side-panel">
      <h2>מידע חשוב במסלול</h2>
      {activeDataPoints.length === 0 ? (
        <p>אין מידע מיוחד למסלול זה.</p>
      ) : (
        <ul className="react-data-list">
          {activeDataPoints.map((dataPoint) => (
            <li key={dataPoint.id}>
              <span aria-hidden="true">{dataPoint.emoji}</span>
              <span>{dataPoint.information}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default DataSummary;
