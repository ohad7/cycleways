
import React from 'react';

const MapContainer = ({ selectedSegments, routePoints, segmentMetrics }) => {
  const checkRouteContinuity = () => {
    if (selectedSegments.length <= 1) {
      return { isContinuous: true, brokenSegmentIndex: -1 };
    }
    // Simplified implementation - would need full logic from original
    return { isContinuous: true, brokenSegmentIndex: -1 };
  };

  const hasSegmentWarnings = () => {
    // Simplified implementation - would need full logic from original  
    return { hasWarnings: false, warningSegments: [], count: 0 };
  };

  const continuityResult = checkRouteContinuity();
  const warningsResult = hasSegmentWarnings();

  return (
    <div className="container">
      <div className="map-container">
        {/* Legend */}
        <div className="legend-container">
          <div className="legend-box open" id="legend-box">
            <div className="legend-title">סוגי דרכים</div>
            <div className="legend-item">
              <div className="legend-color paved-trail"></div>
              <div className="legend-label">שביל סלול</div>
            </div>
            <div className="legend-item">
              <div className="legend-color dirt-trail"></div>
              <div className="legend-label">שביל עפר</div>
            </div>
            <div className="legend-item">
              <div className="legend-color road"></div>
              <div className="legend-label">כביש</div>
            </div>
          </div>
          
          {selectedSegments.length > 1 && !continuityResult.isContinuous && (
            <div className="route-warning issue-warning">
              ⚠️ מסלול שבור
            </div>
          )}
          
          {warningsResult.hasWarnings && (
            <div className="segment-warning issue-warning">
              ⚠️ אזהרות {warningsResult.count > 1 ? `(${warningsResult.count})` : ''}
            </div>
          )}
        </div>

        {/* Map */}
        <div id="map"></div>

        {/* Segment name display */}
        <div className="segment-name-display" id="segment-name-display">
          No segment selected
        </div>

        {/* Route description panel */}
        <div className={`route-description-panel ${selectedSegments.length === 0 ? 'empty' : ''}`}>
          <div id="route-description">
            {selectedSegments.length === 0 
              ? "לחץ על המפה ליד קטעי דרך כדי לבנות את המסלול שלך."
              : `נבחרו ${selectedSegments.length} קטעים`
            }
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapContainer;
