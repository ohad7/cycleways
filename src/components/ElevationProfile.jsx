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
  chartId = "elevation-chart",
  onElevationHover,
  onElevationSelect = null,
  cursorFraction = null,
  cursorPlaying = false,
  cursorInfoVisible = false,
  externalCursorActive = false,
}) {
  const profile = useMemo(() => buildElevationProfile(geometry), [geometry]);
  const animatorMarkerEnabledRef = useRef(true);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [markerPoint, setMarkerPoint] = useState(null);
  const usesExternalCursor = externalCursorActive || !animator;
  const displayedMarkerPoint = useMemo(
    () =>
      usesExternalCursor
        ? markerPointForFraction(profile, cursorFraction)
        : markerPoint,
    [cursorFraction, markerPoint, profile, usesExternalCursor],
  );
  const progressPath = useMemo(
    () =>
      displayedMarkerPoint
        ? elevationProgressPath(profile?.elevationData, displayedMarkerPoint.x)
        : "",
    [displayedMarkerPoint, profile],
  );
  const cursorInfo = useMemo(
    () =>
      cursorInfoVisible
        ? hoverPayloadForFraction(profile, cursorFraction)
        : null,
    [cursorFraction, cursorInfoVisible, profile],
  );
  const displayedInfo = hoverInfo || cursorInfo;

  useEffect(() => {
    if (!animator) return undefined;
    const unsubscribe = animator.subscribe("elevation", (payload) => {
      if (externalCursorActive) return;
      if (!animatorMarkerEnabledRef.current) return;
      if (!payload) {
        setMarkerPoint(null);
        return;
      }
      setMarkerPoint(markerPointForFraction(profile, payload.t));
    });
    return unsubscribe;
  }, [animator, externalCursorActive, profile]);

  useEffect(() => {
    animatorMarkerEnabledRef.current = true;
    setMarkerPoint(null);
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
      setMarkerPoint(null);
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
      <div className="elevation-chart" id={chartId}>
        {displayedInfo && (
          <div className="react-elevation-hover-info">
            <span>
              📍 מרחק: <bdi dir="ltr">{(displayedInfo.distance / 1000).toFixed(1)} km</bdi> • גובה:{" "}
              <bdi dir="ltr">{Math.round(displayedInfo.elevation)} m</bdi>
            </span>
            {displayedInfo.gradeClass && Number.isFinite(displayedInfo.grade) && (
              <span
                className="react-grade-chip"
                style={{
                  background: `${GRADE_COLORS[displayedInfo.gradeClass]}2e`,
                  color: GRADE_COLORS[displayedInfo.gradeClass],
                  borderColor: `${GRADE_COLORS[displayedInfo.gradeClass]}66`,
                }}
              >
                {GRADE_LABELS_HE[displayedInfo.gradeClass]} · <bdi dir="ltr">{displayedInfo.grade.toFixed(1)}%</bdi>
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
          {profile.baseAreaPath && (
            <path
              d={profile.baseAreaPath}
              fill="#b7d3ba"
              fillOpacity="0.18"
              stroke="none"
            />
          )}
          {profile.clusterPaths.map((cluster, index) => (
            <path
              key={`${cluster.gradeClass}-${index}`}
              d={cluster.d}
              fill={cluster.color}
              fillOpacity="0.45"
              stroke={cluster.color}
              strokeOpacity="0.38"
              strokeWidth="0.08"
              strokeLinejoin="round"
            />
          ))}
          <path
            d={profile.outlinePath}
            fill="none"
            stroke="#3d3d3d"
            strokeOpacity="0.5"
            strokeWidth="0.4"
          />
          {progressPath && (
            <path
              className="elevation-progress-line"
              d={progressPath}
              fill="none"
              stroke="#0f766e"
              strokeOpacity="0.72"
              strokeWidth="0.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: "none" }}
            />
          )}
        </svg>
        {displayedMarkerPoint && (
          <div
            className={[
              "elevation-progress-head-pulse",
              cursorPlaying ? "elevation-progress-head-pulse--playing" : "",
            ].filter(Boolean).join(" ")}
            style={{
              left: `${displayedMarkerPoint.x}%`,
              top: `${displayedMarkerPoint.y}%`,
            }}
            aria-hidden="true"
          >
            <span className="elevation-progress-head-pulse__pulse" />
            <span className="elevation-progress-head-pulse__core">
              <span className="elevation-progress-head-pulse__symbol" />
            </span>
          </div>
        )}
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

function markerPointForFraction(profile, fraction) {
  const x = elevationCursorX(fraction);
  if (x === null || !profile?.elevationData) return null;
  const point = findClosestElevationPoint(profile.elevationData, x);
  if (!point) return null;
  return {
    x: Math.max(2.4, Math.min(97.6, point.distancePercent)),
    y: 100 - point.heightPercent,
  };
}

function hoverPayloadForFraction(profile, fraction) {
  const x = elevationCursorX(fraction);
  if (x === null || !profile?.elevationData) return null;
  return buildElevationHoverPayload(findClosestElevationPoint(profile.elevationData, x));
}

function elevationProgressPath(elevationData, xPercent) {
  if (!Array.isArray(elevationData) || elevationData.length === 0) return "";
  const x = Math.max(0, Math.min(100, Number(xPercent)));
  if (!Number.isFinite(x)) return "";
  const points = elevationData.filter((point) => point.distancePercent <= x);
  const marker = findClosestElevationPoint(elevationData, x);
  if (marker && points.at(-1)?.distancePercent !== marker.distancePercent) {
    points.push(marker);
  }
  if (points.length === 0) return "";
  return points
    .map((point, index) => {
      const y = 100 - point.heightPercent;
      return `${index === 0 ? "M" : "L"} ${point.distancePercent} ${y}`;
    })
    .join(" ");
}
