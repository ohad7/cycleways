import React from "react";

function DataSummary({ activeDataPoints, selectedDataMarker }) {
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

      {selectedDataMarker && (
        <div className="react-selected-marker">
          <p className="react-shell__eyebrow">נקודת מידע שנבחרה</p>
          <strong>
            <span aria-hidden="true">{selectedDataMarker.emoji}</span>{" "}
            {selectedDataMarker.type || "מידע"}
          </strong>
          <span>{selectedDataMarker.segmentName}</span>
          {selectedDataMarker.information && (
            <p>{selectedDataMarker.information}</p>
          )}
        </div>
      )}
    </section>
  );
}

export default DataSummary;
