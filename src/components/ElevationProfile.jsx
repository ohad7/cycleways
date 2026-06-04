import React, { useEffect, useMemo, useRef, useState } from "react";
import { GRADE_CLASSES, GRADE_COLORS, GRADE_LABELS_HE } from "@cycleways/core/utils/grade.js";
import {
  buildElevationHoverPayload,
  buildElevationProfile,
  findClosestElevationPoint,
  formatLegacyDistance,
} from "@cycleways/core/ui/elevationProfile.js";
import { elevationCursorX } from "./elevationCursor.js";

export default function ElevationProfile({
  animator,
  distance,
  geometry,
  onElevationHover,
  onElevationSelect = null,
  cursorFraction = null,
}) {
  const profile = useMemo(() => buildElevationProfile(geometry), [geometry]);
  const markerLineRef = useRef(null);
  const animatorMarkerEnabledRef = useRef(true);
  const [hoverInfo, setHoverInfo] = useState(null);

  useEffect(() => {
    if (!animator) return undefined;
    const unsubscribe = animator.subscribe("elevation", (payload) => {
      if (!animatorMarkerEnabledRef.current) return;
      const line = markerLineRef.current;
      if (!line) return;
      if (!payload) {
        line.setAttribute("opacity", "0");
        return;
      }
      const x = Math.max(0, Math.min(100, payload.t * 100));
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
      line.setAttribute("opacity", "1");
    });
    return unsubscribe;
  }, [animator]);

  // When there is no animator (e.g. featured pages), drive the marker line from
  // an external cursor fraction (the video/map position). With an animator the
  // animator owns the marker, so this effect is a no-op for the planner.
  useEffect(() => {
    if (animator) return undefined;
    const line = markerLineRef.current;
    if (!line) return undefined;
    const x = elevationCursorX(cursorFraction);
    if (x === null) {
      line.setAttribute("opacity", "0");
    } else {
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
      line.setAttribute("opacity", "1");
    }
    return undefined;
  }, [animator, cursorFraction]);

  useEffect(() => {
    animatorMarkerEnabledRef.current = true;
  }, [geometry]);

  if (!profile) return null;

  const handleInteraction = (event) => {
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    if (!Number.isFinite(clientX)) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const xPercent = ((clientX - rect.left) / rect.width) * 100;
    const closestPoint = findClosestElevationPoint(profile.elevationData, xPercent);
    if (!closestPoint) return;

    const payload = buildElevationHoverPayload(closestPoint);
    if (animator && animatorMarkerEnabledRef.current) {
      animatorMarkerEnabledRef.current = false;
      const line = markerLineRef.current;
      if (line) line.setAttribute("opacity", "0");
    }
    setHoverInfo(payload);
    onElevationHover?.(payload);
  };

  const clearHover = () => {
    setHoverInfo(null);
    onElevationHover?.(null);
  };

  const handleSelect = (event) => {
    if (!onElevationSelect) return;
    const clientX = event.changedTouches?.[0]?.clientX ?? event.clientX;
    if (!Number.isFinite(clientX)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xPercent = ((clientX - rect.left) / rect.width) * 100;
    const closestPoint = findClosestElevationPoint(profile.elevationData, xPercent);
    if (!closestPoint) return;
    onElevationSelect(buildElevationHoverPayload(closestPoint));
  };

  return (
    <div className="elevation-profile">
      <h4>גרף גובה (Elevation Profile)</h4>
      <div className="elevation-chart" id="elevation-chart">
        {hoverInfo && (
          <div className="react-elevation-hover-info">
            <span>
              📍 מרחק: {(hoverInfo.distance / 1000).toFixed(1)} km • גובה:{" "}
              {Math.round(hoverInfo.elevation)} m
            </span>
            {hoverInfo.gradeClass && Number.isFinite(hoverInfo.grade) && (
              <span
                className="react-grade-chip"
                style={{
                  background: `${GRADE_COLORS[hoverInfo.gradeClass]}2e`,
                  color: GRADE_COLORS[hoverInfo.gradeClass],
                  borderColor: `${GRADE_COLORS[hoverInfo.gradeClass]}66`,
                }}
              >
                {GRADE_LABELS_HE[hoverInfo.gradeClass]} · {hoverInfo.grade.toFixed(1)}%
              </span>
            )}
          </div>
        )}
        <svg
          aria-hidden="true"
          focusable="false"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          {profile.clusterPaths.map((cluster, index) => (
            <path
              key={`${cluster.gradeClass}-${index}`}
              d={cluster.d}
              fill={cluster.color}
              fillOpacity="0.45"
              stroke="none"
            />
          ))}
          <path
            d={profile.outlinePath}
            fill="none"
            stroke="#3d3d3d"
            strokeOpacity="0.5"
            strokeWidth="0.4"
          />
          <line
            ref={markerLineRef}
            x1="0"
            x2="0"
            y1="0"
            y2="100"
            stroke="#74b8c8"
            strokeOpacity="0.72"
            strokeWidth="0.45"
            strokeLinecap="round"
            opacity="0"
            style={{ pointerEvents: "none" }}
          />
        </svg>
        <div
          className="elevation-hover-overlay"
          onMouseMove={handleInteraction}
          onMouseLeave={clearHover}
          onTouchStart={handleInteraction}
          onTouchMove={handleInteraction}
          onTouchEnd={clearHover}
          onClick={handleSelect}
        />
      </div>
      <div className="react-elevation-footer">
        <span className="distance-label">{formatLegacyDistance(distance)}</span>
        <div className="react-elevation-legend" aria-label="מקרא שיפועים">
          {GRADE_CLASSES.map((cls) => (
            <span key={cls} className="react-elevation-legend__item">
              <span
                className="react-elevation-legend__swatch"
                style={{ background: GRADE_COLORS[cls] }}
              />
              <span className="react-elevation-legend__label">
                {GRADE_LABELS_HE[cls]}
              </span>
            </span>
          ))}
        </div>
        <span className="distance-label">0 ק"מ</span>
      </div>
    </div>
  );
}
export { formatLegacyDistance, elevationCursorX };
