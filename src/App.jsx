import React, { useMemo, useState } from "react";
import ContentSections from "./components/ContentSections.jsx";
import DataMarkerCard from "./components/DataMarkerCard.jsx";
import DownloadModal from "./components/DownloadModal.jsx";
import ElevationProfile, { formatLegacyDistance } from "./components/ElevationProfile.jsx";
import PageShell from "./components/PageShell.jsx";
import { getRouteMessage } from "./components/RoutePanel.jsx";
import Tutorial from "./components/Tutorial.jsx";
import WelcomeWizard from "./components/WelcomeWizard.jsx";
import { POI_EMOJIS as WARNING_EMOJIS } from "@cycleways/core/data/poiTypes.js";
import { getRouteWarningPresentation } from "@cycleways/core/ui/routePlannerPresentation.js";
import MapView from "./map/MapView.jsx";
import { useCyclewaysApp } from "@cycleways/core/app/useCyclewaysApp.js";
import "./react-app.css";

function App() {
  const {
    welcomeWizardOpen,
    setWelcomeWizardOpen,
    state,
    mapUi,
    routeState,
    osmDebug,
    osmDebugLayerMode,
    selectedCwReviewSegmentId,
    selectedCwReviewFeature,
    canUndo,
    canRedo,
    canDownload,
    hasBrokenRoute,
    activeDataPointIds,
    dataMarkerFeatures,
    routePointDragPreview,
    displayedRoutePoints,
    inspectedSegmentDetails,
    inspectedSegment,
    inspectedOsmFeature,
    shareUrl,
    shareInfo,
    featureFlags,
    directionAnimatorRef,
    handleOpenTutorial,
    handleCloseTutorial,
    handleSearchSubmit,
    handleSearchQueryChange,
    handleUndo,
    handleRedo,
    handleRouteClear,
    handleOpenDownload,
    handleCloseDownload,
    handleDownloadGpx,
    handleOsmDebugLayerModeChange,
    handleCwReviewSegmentSelect,
    handleDataMarkerClick,
    handleDataPointFocus,
    handleSelectedDataMarkerClear,
    handleAddDataMarkerToRoute,
    handleMapClick,
    handleRoutePointDrag,
    handleRoutePointDragEnd,
    handleRoutePointDragStart,
    handleRoutePointRemove,
    handleRoutePointSelect,
    handleRouteLineDrag,
    handleRouteLineDragStart,
    handleSegmentFocus,
    handleSegmentHover,
    handleViewportIdle,
    handleOsmDebugHover,
    handleOsmGraphEdgeHover,
    handleCwOsmMatchHover,
    handleElevationHover,
  } = useCyclewaysApp();

  // Fly to a focused data point (warning click). Memoised on the focus request
  // so MapSurface only flies when the token changes, not on every render.
  const focusedMarker = useMemo(
    () =>
      mapUi.dataMarkerFocus
        ? {
            coord: {
              lng: mapUi.dataMarkerFocus.lng,
              lat: mapUi.dataMarkerFocus.lat,
            },
          }
        : null,
    [mapUi.dataMarkerFocus],
  );

  return (
    <>
      <WelcomeWizard
        visible={featureFlags.routeDiscovery && welcomeWizardOpen}
        onDismiss={() => setWelcomeWizardOpen(false)}
      />
      <PageShell
        onOpenTutorial={handleOpenTutorial}
        onOpenWizard={
          featureFlags.routeDiscovery
            ? () => setWelcomeWizardOpen(true)
            : undefined
        }
      >
        <div
          id="error-message"
          className={state.status === "error" ? "show" : ""}
          role={state.status === "error" ? "alert" : undefined}
        >
          {state.status === "error" ? (
            <ErrorState error={state.error} />
          ) : null}
        </div>

        <div className="container">
          <div className="map-container">
            {state.status === "loading" && <LoadingState />}
            {state.status === "ready" && (
              <>
                <div className="search-container">
                  <form
                    className="search-input-group"
                    onSubmit={handleSearchSubmit}
                  >
                    <button
                      id="search-btn"
                      type="submit"
                      disabled={mapUi.searchStatus === "searching"}
                      title="חיפוש מיקום"
                      aria-label="חיפוש"
                    >
                      <ion-icon name="search-outline" />
                    </button>
                    <input
                      id="location-search"
                      type="text"
                      placeholder="ישוב/עיר, לדוגמא: דפנה"
                      value={mapUi.searchQuery}
                      onChange={(event) =>
                        handleSearchQueryChange(event.target.value)
                      }
                    />
                  </form>
                  <div className="top-controls">
                    <div className="control-buttons">
                      <button
                        id="undo-btn"
                        className="control-btn"
                        disabled={!canUndo}
                        type="button"
                        title="ביטול (Ctrl+Z)"
                        aria-label="ביטול"
                        onClick={handleUndo}
                      >
                        <ion-icon name="arrow-undo-outline" />
                      </button>
                      <button
                        id="redo-btn"
                        className="control-btn"
                        disabled={!canRedo}
                        type="button"
                        title="חזרה (Ctrl+Shift+Z)"
                        aria-label="חזרה"
                        onClick={handleRedo}
                      >
                        <ion-icon name="arrow-redo-outline" />
                      </button>
                      <button
                        id="reset-btn"
                        className="control-btn"
                        disabled={routeState.points.length === 0}
                        type="button"
                        title="איפוס מסלול"
                        aria-label="איפוס מסלול"
                        onClick={handleRouteClear}
                      >
                        <ion-icon name="trash-outline" />
                      </button>
                      <button
                        id="download-gpx"
                        className="control-btn gpx-download-button"
                        disabled={!canDownload}
                        type="button"
                        title="סיכום, GPX, ושיתוף המסלול"
                        onClick={handleOpenDownload}
                      >
                        סיכום
                      </button>
                    </div>
                  </div>
                </div>

                <MapLegend
                  activeDataPoints={routeState.activeDataPoints}
                  hasBrokenRoute={hasBrokenRoute}
                  onWarningFocus={handleDataPointFocus}
                />

                <DataMarkerCard
                  marker={mapUi.selectedDataMarker}
                  onAddToRoute={handleAddDataMarkerToRoute}
                  onClose={handleSelectedDataMarkerClear}
                />

                {mapUi.searchError && (
                  <div id="search-error" className="react-search-error">
                    {mapUi.searchError}
                  </div>
                )}

                {osmDebug.enabled && (
                  <OsmDebugLayerToggle
                    mode={osmDebugLayerMode}
                    status={osmDebug.status}
                    onChange={handleOsmDebugLayerModeChange}
                  />
                )}

                {osmDebug.enabled && (
                  <OsmMatchReviewPanel
                    mode={osmDebugLayerMode}
                    selectedSegmentId={selectedCwReviewSegmentId}
                    summary={osmDebug.cwMatchSummary}
                    onOpenGraph={() => handleOsmDebugLayerModeChange("graph")}
                    onSelectSegment={handleCwReviewSegmentSelect}
                  />
                )}

                <MapView
                  activeDataPointIds={activeDataPointIds}
                  animator={directionAnimatorRef.current}
                  dataMarkerFeatures={dataMarkerFeatures}
                  focusedMarker={focusedMarker}
                  elevationHover={mapUi.elevationHover}
                  focusedSegment={routeState.focusedSegment}
                  geoJsonData={state.assets.geoJsonData}
                  hoveredSegment={routeState.hoveredSegment}
                  onDataMarkerClick={handleDataMarkerClick}
                  onMapClick={handleMapClick}
                  onRoutePointDrag={handleRoutePointDrag}
                  onRoutePointDragEnd={handleRoutePointDragEnd}
                  onRoutePointDragStart={handleRoutePointDragStart}
                  onRoutePointRemove={handleRoutePointRemove}
                  onRoutePointSelect={handleRoutePointSelect}
                  onRouteLineDrag={handleRouteLineDrag}
                  onRouteLineDragEnd={handleRoutePointDragEnd}
                  onRouteLineDragStart={handleRouteLineDragStart}
                  onSegmentFocus={handleSegmentFocus}
                  onSegmentHover={handleSegmentHover}
                  onViewportIdle={handleViewportIdle}
                  onOsmDebugHover={handleOsmDebugHover}
                  onOsmGraphEdgeHover={handleOsmGraphEdgeHover}
                  onCwOsmMatchHover={handleCwOsmMatchHover}
                  osmDebugGeoJson={osmDebug.geoJson}
                  osmGraphEdgesGeoJson={osmDebug.graphEdgesGeoJson}
                  osmGraphNodesGeoJson={osmDebug.graphNodesGeoJson}
                  cwOsmMatchGeoJson={osmDebug.cwMatchGeoJson}
                  osmIntersectionsGeoJson={osmDebug.intersectionsGeoJson}
                  osmDebugMode={osmDebug.enabled}
                  osmDebugLayerMode={osmDebugLayerMode}
                  routeFitRequest={mapUi.routeFitRequest}
                  routeGeometry={routeState.geometry}
                  routePointDragPreview={routePointDragPreview}
                  routePoints={displayedRoutePoints}
                  searchHighlight={mapUi.searchHighlight}
                  selectedCwOsmReviewFeature={selectedCwReviewFeature}
                  selectedCwOsmReviewSegmentId={selectedCwReviewSegmentId}
                  selectedRoutePointIndex={mapUi.selectedRoutePointIndex}
                />

                <RouteDescription
                  animator={directionAnimatorRef.current}
                  error={routeState.error}
                  hasBrokenRoute={hasBrokenRoute}
                  routeState={routeState}
                  selectedRoutePointIndex={mapUi.selectedRoutePointIndex}
                  onElevationHover={handleElevationHover}
                  onRemoveRoutePoint={handleRoutePointRemove}
                  onSelectRoutePoint={handleRoutePointSelect}
                />

                <SegmentNameDisplay
                  details={inspectedSegmentDetails}
                  inspectedSegment={inspectedSegment}
                  osmFeature={inspectedOsmFeature}
                />
              </>
            )}
          </div>
        </div>

        <ContentSections onFocusSegment={handleSegmentFocus} />
      </PageShell>

      {state.status === "ready" && mapUi.downloadModalOpen && (
        <DownloadModal
          activeDataPoints={routeState.activeDataPoints}
          featureFlags={featureFlags}
          routeState={routeState}
          segmentsData={state.assets.segmentsData}
          shareUrl={shareUrl}
          shareStatus={shareInfo.status}
          shareUrlLength={shareInfo.length}
          onClose={handleCloseDownload}
          onDownload={handleDownloadGpx}
        />
      )}
      <Tutorial open={mapUi.tutorialOpen} onClose={handleCloseTutorial} />
    </>
  );
}

function LoadingState() {
  return (
    <div className="react-shell__state react-map-loading" aria-live="polite">
      <span className="react-shell__spinner" aria-hidden="true" />
      <div>
        <h2>טוען את המפה</h2>
        <p>טוען מקטעים, נתוני דרך ושכבות מפה.</p>
      </div>
    </div>
  );
}

function ErrorState({ error }) {
  return (
    <div className="react-shell__state react-shell__state--error">
      <div>
        <h2>טעינת המפה נכשלה</h2>
        <p>{error?.message || "שגיאה לא ידועה"}</p>
      </div>
    </div>
  );
}

function MapLegend({ activeDataPoints, hasBrokenRoute, onWarningFocus }) {
  const [warningsOpen, setWarningsOpen] = useState(false);
  const warningPresentation = useMemo(
    () => getRouteWarningPresentation(activeDataPoints),
    [activeDataPoints],
  );
  const warnings = warningPresentation.warnings;

  return (
    <div className="legend-container">
      <div className="legend-box open" id="legend-box">
        <div className="legend-title">סוגי דרכים</div>
        <div className="legend-item">
          <div className="legend-color paved-trail" />
          <div className="legend-label">שביל סלול</div>
        </div>
        <div className="legend-item">
          <div className="legend-color dirt-trail" />
          <div className="legend-label">שביל עפר</div>
        </div>
        <div className="legend-item">
          <div className="legend-color road" />
          <div className="legend-label">כביש</div>
        </div>
      </div>
      {hasBrokenRoute && (
        <div className="route-warning issue-warning" id="route-warning">
          ⚠️ מסלול שבור
        </div>
      )}
      {warnings.length > 0 && (
        <>
          <button
            className="segment-warning issue-warning react-warning-toggle"
            id="segment-warning"
            type="button"
            onClick={() => setWarningsOpen((current) => !current)}
          >
            {warningPresentation.toggleLabel}
          </button>
          <div
            className="individual-warnings-container"
            id="individual-warnings-container"
            style={{ display: warningsOpen ? "block" : "none" }}
          >
            {warningPresentation.groups.map((warningGroup) => (
              <button
                className="individual-warning-item react-individual-warning-item"
                key={warningGroup.segmentName}
                type="button"
                onClick={() => onWarningFocus?.(warningGroup.warnings?.[0])}
                style={{
                  backgroundColor: warningGroup.backgroundColor,
                }}
              >
                <span className="warning-text">
                  {warningGroup.label}
                </span>
                <span className="warning-icons" aria-hidden="true">
                  {warningGroup.icons.map((icon, index) => (
                    <span
                      className="warning-icon react-warning-icon"
                      key={`${warningGroup.segmentName}-${warningGroup.types[index] || index}`}
                    >
                      {icon}
                    </span>
                  ))}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RouteDescription({
  animator,
  error,
  hasBrokenRoute,
  onElevationHover,
  onRemoveRoutePoint,
  onSelectRoutePoint,
  routeState,
  selectedRoutePointIndex,
}) {
  return (
    <div
      className={`route-description-panel${
        routeState.points.length === 0 &&
        routeState.pendingPoints.length === 0 &&
        !error
          ? " empty"
          : ""
      }`}
      id="route-description-panel"
    >
      <div id="route-description" className="react-route-description-content">
        {error && (
          <span className="route-inline-warning">
            {error.message || "לא הצלחנו לעדכן את המסלול"}
          </span>
        )}
        {!error && (
          <>
            <div className="react-route-description-main">
              <RouteDescriptionText routeState={routeState} />
            </div>
            {hasBrokenRoute && (
              <div className="react-route-panel__warnings">מסלול שבור בין הנקודות שנבחרו.</div>
            )}
            {routeState.geometry.length >= 2 && (
              <ElevationProfile
                animator={animator}
                distance={routeState.distance}
                geometry={routeState.geometry}
                onElevationHover={onElevationHover}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RouteDescriptionText({ routeState }) {
  if (routeState.pendingPoints.length > 0) {
    const pendingCount = routeState.pendingPoints.length;
    return (
      <span className="react-route-loading">
        <span className="react-route-loading__spinner" aria-hidden="true" />
        {pendingCount === 1
          ? "בודק את נקודת המסלול על רשת הדרכים..."
          : `בודק ${pendingCount} נקודות מסלול על רשת הדרכים...`}
      </span>
    );
  }

  if (routeState.geometry.length < 2) {
    return getRouteMessage(routeState);
  }

  return (
    <>
      <strong>מרחק:</strong> {formatLegacyDistance(routeState.distance)} •{" "}
      <strong>⬆️</strong> {Math.round(routeState.elevationGain || 0)} מ' •{" "}
      <strong>⬇️</strong> {Math.round(routeState.elevationLoss || 0)} מ'
    </>
  );
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "";
}

function formatMeters(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} m` : "";
}

function failureClassLabel(value) {
  const labels = {
    accepted: "accepted",
    partial_gap: "partial gap",
    osm_missing: "OSM missing",
    matcher_failed: "matcher failed",
    source_geometry_mismatch: "source mismatch",
    ambiguous_parallel: "ambiguous",
    outside_base_area: "outside area",
    needs_split: "needs split",
    manual_review: "manual review",
  };
  return labels[value] || value || "review";
}

function OsmDebugLayerToggle({ mode, status, onChange }) {
  const isLoading = status === "loading";
  const options = [
    ["ways", "OSM ways"],
    ["graph", "Graph edges"],
  ];

  return (
    <div
      className="react-osm-layer-toggle"
      role="group"
      aria-label="OSM debug layer"
    >
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={
            value === mode
              ? "react-osm-layer-toggle__button react-osm-layer-toggle__button--active"
              : "react-osm-layer-toggle__button"
          }
          aria-pressed={value === mode}
          disabled={isLoading}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function OsmMatchReviewPanel({
  mode,
  selectedSegmentId,
  summary,
  onOpenGraph,
  onSelectSegment,
}) {
  const [filter, setFilter] = useState("issues");
  const segments = Array.isArray(summary?.segments) ? summary.segments : [];
  if (!summary || segments.length === 0) return null;

  const issueSegments = segments.filter(
    (segment) => segment.failureClass !== "accepted",
  );
  const visibleSegments = filter === "all" ? segments : issueSegments;
  const selectedSegment = segments.find(
    (segment) => segment.segmentId === selectedSegmentId,
  );

  return (
    <section className="react-osm-review-panel" aria-label="CW OSM match review">
      <div className="react-osm-review-panel__header">
        <div>
          <strong>Match review</strong>
          <span>
            {formatPercent(Number(summary.coverageRatio))} coverage,{" "}
            {issueSegments.length} issues
          </span>
        </div>
        {mode !== "graph" && (
          <button type="button" onClick={onOpenGraph}>
            Graph
          </button>
        )}
      </div>

      {mode !== "graph" && (
        <p className="react-osm-review-panel__hint">
          Switch to graph mode to inspect matched edges and gaps.
        </p>
      )}

      <div className="react-osm-review-panel__filters" role="group" aria-label="Review filter">
        <button
          type="button"
          className={filter === "issues" ? "is-active" : ""}
          onClick={() => setFilter("issues")}
        >
          Issues {issueSegments.length}
        </button>
        <button
          type="button"
          className={filter === "all" ? "is-active" : ""}
          onClick={() => setFilter("all")}
        >
          All {segments.length}
        </button>
      </div>

      {selectedSegment && (
        <div className="react-osm-review-panel__selected">
          <strong>{selectedSegment.segmentName}</strong>
          <div>
            {failureClassLabel(selectedSegment.failureClass)} ·{" "}
            {formatPercent(Number(selectedSegment.coverageRatio))} · gaps{" "}
            {selectedSegment.gapCount}
          </div>
          <p>{selectedSegment.reviewReason}</p>
        </div>
      )}

      <div className="react-osm-review-list">
        {visibleSegments.map((segment) => (
          <button
            key={segment.segmentId}
            type="button"
            className={
              segment.segmentId === selectedSegmentId
                ? "react-osm-review-item react-osm-review-item--selected"
                : "react-osm-review-item"
            }
            onClick={() => onSelectSegment(segment.segmentId)}
          >
            <span className="react-osm-review-item__title">
              {segment.segmentName || `Segment ${segment.segmentId}`}
            </span>
            <span className="react-osm-review-item__meta">
              <span className={`react-osm-review-chip react-osm-review-chip--${segment.failureClass}`}>
                {failureClassLabel(segment.failureClass)}
              </span>
              <span>{formatPercent(Number(segment.coverageRatio))}</span>
              <span>{segment.confidence}</span>
              <span>{segment.gapCount} gaps</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SegmentNameDisplay({
  details,
  inspectedSegment,
  osmFeature,
}) {
  if (osmFeature) {
    const isGraphEdge = osmFeature.debugType === "graphEdge";
    const isCwMatch =
      osmFeature.debugType === "cwMatchEdge" || osmFeature.debugType === "cwMatchGap";
    const title = isCwMatch
      ? osmFeature.segmentName || "CycleWays match"
      : isGraphEdge
      ? osmFeature.edgeId
        ? `Graph edge ${osmFeature.edgeId}`
        : "Graph edge"
      : osmFeature.name ||
        osmFeature.ref ||
        (osmFeature.osmId ? `OSM way ${osmFeature.osmId}` : "OSM way");
    const rows = (isCwMatch
      ? [
          ["kind", osmFeature.kind],
          ["segmentId", osmFeature.segmentId],
          ["confidence", osmFeature.confidence],
          ["coverage", formatPercent(Number(osmFeature.coverageRatio))],
          ["edge", osmFeature.edgeId],
          ["osmWay", osmFeature.osmWayId],
          ["direction", osmFeature.direction],
          ["avgDistance", formatMeters(Number(osmFeature.avgDistanceMeters))],
          ["gapDistance", formatMeters(Number(osmFeature.distanceMeters))],
          ["highway", osmFeature.graphHighway],
          ["class", osmFeature.graphClass],
          ["status", osmFeature.graphAccessStatus],
        ]
      : isGraphEdge
      ? [
          ["osmWay", osmFeature.osmWayId],
          ["slice", osmFeature.sliceIndex],
          ["from", osmFeature.fromNodeId],
          ["to", osmFeature.toNodeId],
          ["highway", osmFeature.highway],
          ["surface", osmFeature.surface],
          ["tracktype", osmFeature.tracktype],
          ["bicycle", osmFeature.bicycle],
          ["access", osmFeature.access],
          ["class", osmFeature.osmRouteClass],
          ["status", osmFeature.accessStatus],
        ]
      : [
          ["highway", osmFeature.highway],
          ["surface", osmFeature.surface],
          ["tracktype", osmFeature.tracktype],
          ["bicycle", osmFeature.bicycle],
          ["access", osmFeature.access],
          ["class", osmFeature.osmRouteClass],
          ["status", osmFeature.accessStatus],
        ]
    ).filter(([, value]) => value !== undefined && value !== null && value !== "");

    return (
      <div className="segment-name-display react-segment-name-display--active react-segment-name-display--osm" id="segment-name-display">
        <strong>{title}</strong>
        <br />
        {osmFeature.distanceMeters && (
          <>
            📏 {formatLegacyDistance(Number(osmFeature.distanceMeters))}
            <br />
          </>
        )}
        <div className="react-segment-data-list react-osm-data-list">
          {rows.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>: {value}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!inspectedSegment) {
    return (
      <div className="segment-name-display" id="segment-name-display">
        No segment selected
      </div>
    );
  }

  return (
    <div className="segment-name-display react-segment-name-display--active" id="segment-name-display">
      <strong>{inspectedSegment}</strong>
      <br />
      📏 {details?.distanceKm || "0.0"} ק"מ • ⬆️{" "}
      {details?.elevationGain || 0} מ' • ⬇️ {details?.elevationLoss || 0} מ'
      {details?.dataPoints?.length > 0 && (
        <div className="react-segment-data-list">
          {details.dataPoints.map((dataPoint, index) => (
            <div key={`${dataPoint.type}-${index}`}>
              {dataPoint.emoji || WARNING_EMOJIS[dataPoint.type] || "⚠️"}{" "}
              {dataPoint.information}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
