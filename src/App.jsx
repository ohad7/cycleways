import React, { lazy, Suspense, useMemo, useState } from "react";
import ContentSections from "./components/ContentSections.jsx";
import Icon from "./components/Icon.jsx";
import DataMarkerCard from "./components/DataMarkerCard.jsx";
import ElevationProfile, { formatLegacyDistance } from "./components/ElevationProfile.jsx";
import PageShell from "./components/PageShell.jsx";
import { getRouteMessage } from "./components/RoutePanel.jsx";
import Tutorial from "./components/Tutorial.jsx";
import { POI_EMOJIS as WARNING_EMOJIS } from "@cycleways/core/data/poiTypes.js";
import { getRouteWarningPresentation } from "@cycleways/core/ui/routePlannerPresentation.js";
import MapView from "./map/MapView.jsx";
import { useCyclewaysApp } from "@cycleways/core/app/useCyclewaysApp.js";
import "./react-app.css";

// Code-split non-critical UI so it stays out of the initial bundle: the
// download/share modal only loads when opened, and the route-discovery wizard
// only loads when its feature flag is on (off by default).
const DownloadModal = lazy(() => import("./components/DownloadModal.jsx"));
const WelcomeWizard = lazy(() => import("./components/WelcomeWizard.jsx"));

function App() {
  const {
    welcomeWizardOpen,
    setWelcomeWizardOpen,
    state,
    mapUi,
    routeState,
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
      {featureFlags.routeDiscovery && (
        <Suspense fallback={null}>
          <WelcomeWizard
            visible={welcomeWizardOpen}
            onDismiss={() => setWelcomeWizardOpen(false)}
          />
        </Suspense>
      )}
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
                      <Icon name="search-outline" />
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
                        <Icon name="arrow-undo-outline" />
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
                        <Icon name="arrow-redo-outline" />
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
                        <Icon name="trash-outline" />
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
                  routeFitRequest={mapUi.routeFitRequest}
                  routeGeometry={routeState.geometry}
                  routePointDragPreview={routePointDragPreview}
                  routePoints={displayedRoutePoints}
                  searchHighlight={mapUi.searchHighlight}
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
                />
              </>
            )}
          </div>
        </div>

        <ContentSections />
      </PageShell>

      {state.status === "ready" && mapUi.downloadModalOpen && (
        <Suspense fallback={null}>
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
        </Suspense>
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

function SegmentNameDisplay({
  details,
  inspectedSegment,
}) {
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
