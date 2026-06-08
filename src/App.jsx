import React, { lazy, Suspense, useCallback, useMemo, useState } from "react";
import ContentSections from "./components/ContentSections.jsx";
import Icon from "./components/Icon.jsx";
import DataMarkerCard from "./components/DataMarkerCard.jsx";
import ElevationProfile, { formatLegacyDistance } from "./components/ElevationProfile.jsx";
import PageShell from "./components/PageShell.jsx";
import { getRouteMessage } from "./components/RoutePanel.jsx";
import RoutePlaybackControls from "./components/featured/RoutePlaybackControls.jsx";
import {
  nearestPreviewForCursor,
  routeVideoCueSlides,
} from "./components/featured/routePoiStoryData.js";
import RoutePoiPlaybackPreview from "./components/routePlayback/RoutePoiPlaybackPreview.jsx";
import {
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
  useSyntheticRoutePlayback,
} from "./components/routePlayback/useRoutePlayback.js";
import Tutorial from "./components/Tutorial.jsx";
import FrontPanel from "./components/frontPanel/FrontPanel.jsx";
import { INITIAL_PANEL_STATE, resolvePanelState } from "./components/frontPanel/panelState.js";
import DiscoverPanel from "./components/frontPanel/DiscoverPanel.jsx";
import BuildPanel from "./components/frontPanel/BuildPanel.jsx";
import { useCatalogData } from "./components/frontPanel/useCatalogData.js";
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
  } = useCyclewaysApp({ enableRouteDirectionAnimation: false });

  const [panel, setPanel] = useState(INITIAL_PANEL_STATE);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const routePointCount = routeState.points.length;
  const { catalog, places } = useCatalogData();
  const handleSelectRecommended = useCallback((entry) => {
    if (entry?.route) {
      window.location.assign(`/?route=${encodeURIComponent(entry.route)}`);
    }
  }, []);

  React.useEffect(() => {
    setPanel((prev) =>
      resolvePanelState(prev, { type: "route-points-changed", pointCount: routePointCount }),
    );
  }, [routePointCount]);

  const handlePanelStateChange = useCallback((to) => {
    setPanel((prev) => resolvePanelState(prev, { type: "toggle", to }));
  }, []);

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
  const routeWarningPresentation = useMemo(
    () => getRouteWarningPresentation(routeState.activeDataPoints),
    [routeState.activeDataPoints],
  );

  const buildPois = useMemo(
    () => plannerCueSlides
      .filter((s) => s.kind !== "start" && s.kind !== "end")
      .map((s) => ({
        id: s.poiId,
        name: s.name,
        type: s.type,
        distanceMeters: s.routeProgressMeters,
      })),
    [plannerCueSlides],
  );

  const plannerRouteReady = routeState.geometry.length >= 2;
  const plannerCueSlides = useMemo(
    () => routeVideoCueSlides(null, routeState),
    [
      routeState.activeDataPoints,
      routeState.distance,
      routeState.geometry,
    ],
  );
  const plannerPlayback = useSyntheticRoutePlayback({
    enabled: plannerRouteReady,
    routeState,
    cueSlides: plannerCueSlides,
  });
  const plannerPoiPreview = useMemo(
    () => nearestPreviewForCursor(
      plannerCueSlides,
      plannerPlayback.cursor?.fraction,
      routeState.distance,
      {
        maxFraction: MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
        maxMeters: MAP_PLAYBACK_PREVIEW_MAX_METERS,
      },
    ),
    [
      plannerCueSlides,
      plannerPlayback.cursor?.fraction,
      routeState.distance,
    ],
  );
  const plannerPoiPreviewVisible =
    plannerRouteReady &&
    !mapUi.selectedDataMarker &&
    Boolean(plannerPoiPreview.slide && plannerPoiPreview.near);
  const pausePlannerPlayback = plannerPlayback.pause;
  const handlePlannerElevationHover = useCallback((payload) => {
    handleElevationHover(payload);
    if (!payload || !Number.isFinite(payload.t)) return;
    if (plannerPlayback.isPlaying) pausePlannerPlayback();
    plannerPlayback.seekToFraction(payload.t);
  }, [
    handleElevationHover,
    plannerPlayback.isPlaying,
    pausePlannerPlayback,
    plannerPlayback.seekToFraction,
  ]);
  const handlePlannerElevationSelect = useCallback((payload) => {
    handleElevationHover(payload);
    if (payload && Number.isFinite(payload.t)) {
      plannerPlayback.seekToFraction(payload.t);
    }
    plannerPlayback.togglePlayback();
  }, [
    handleElevationHover,
    plannerPlayback.seekToFraction,
    plannerPlayback.togglePlayback,
  ]);
  const handlePlannerCueClick = useCallback(({ slide, poiId }) => {
    pausePlannerPlayback();
    const matchingPoint = routeState.activeDataPoints.find((point) => {
      const pointId = point.id || `${point.type}-${point.location?.join(",")}`;
      return String(pointId) === String(poiId);
    });
    if (matchingPoint) {
      handleDataPointFocus(matchingPoint);
      return;
    }
    if (Array.isArray(slide?.location) && slide.location.length >= 2) {
      const [lat, lng] = slide.location;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        handleDataPointFocus({
          id: poiId,
          type: slide.type || "route-point",
          emoji: slide.kind === "start" ? "🚩" : slide.kind === "end" ? "🏁" : "📍",
          information: slide.name || "",
          location: [lat, lng],
        });
      }
    }
  }, [handleDataPointFocus, pausePlannerPlayback, routeState.activeDataPoints]);
  const handlePlaybackAwareUndo = useCallback(() => {
    pausePlannerPlayback();
    handleUndo();
  }, [handleUndo, pausePlannerPlayback]);
  const handlePlaybackAwareRedo = useCallback(() => {
    pausePlannerPlayback();
    handleRedo();
  }, [handleRedo, pausePlannerPlayback]);
  const handlePlaybackAwareRouteClear = useCallback(() => {
    pausePlannerPlayback();
    handleRouteClear();
  }, [handleRouteClear, pausePlannerPlayback]);
  const handlePlaybackAwareMapClick = useCallback((event) => {
    pausePlannerPlayback();
    handleMapClick(event);
  }, [handleMapClick, pausePlannerPlayback]);
  const handlePlaybackAwareRoutePointDragStart = useCallback((...args) => {
    pausePlannerPlayback();
    handleRoutePointDragStart(...args);
  }, [handleRoutePointDragStart, pausePlannerPlayback]);
  const handlePlaybackAwareRoutePointRemove = useCallback((...args) => {
    pausePlannerPlayback();
    handleRoutePointRemove(...args);
  }, [handleRoutePointRemove, pausePlannerPlayback]);
  const handlePlaybackAwareRouteLineDragStart = useCallback((...args) => {
    pausePlannerPlayback();
    handleRouteLineDragStart(...args);
  }, [handleRouteLineDragStart, pausePlannerPlayback]);
  const handlePlaybackAwareAddDataMarkerToRoute = useCallback((...args) => {
    pausePlannerPlayback();
    handleAddDataMarkerToRoute(...args);
  }, [handleAddDataMarkerToRoute, pausePlannerPlayback]);

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
          <div className={["front-shell", panelCollapsed ? "front-shell--collapsed" : ""].filter(Boolean).join(" ")}>
            <div
              className={[
                "map-container",
                plannerRouteReady ? "map-container--route-ready" : "",
                plannerPoiPreviewVisible ? "map-container--has-planner-poi" : "",
                plannerPlayback.isPlaying ? "map-container--planner-playing" : "",
              ].filter(Boolean).join(" ")}
            >
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
                        onClick={handlePlaybackAwareUndo}
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
                        onClick={handlePlaybackAwareRedo}
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
                        onClick={handlePlaybackAwareRouteClear}
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
                  onAddToRoute={handlePlaybackAwareAddDataMarkerToRoute}
                  onClose={handleSelectedDataMarkerClear}
                />

                {mapUi.searchError && (
                  <div id="search-error" className="react-search-error">
                    {mapUi.searchError}
                  </div>
                )}

                <MapView
                  activeDataPointIds={activeDataPointIds}
                  animator={null}
                  dataMarkerFeatures={dataMarkerFeatures}
                  focusedMarker={focusedMarker}
                  elevationHover={mapUi.elevationHover}
                  focusedSegment={routeState.focusedSegment}
                  geoJsonData={state.assets.geoJsonData}
                  hoveredSegment={routeState.hoveredSegment}
                  onDataMarkerClick={handleDataMarkerClick}
                  onMapClick={handlePlaybackAwareMapClick}
                  onRoutePointDrag={handleRoutePointDrag}
                  onRoutePointDragEnd={handleRoutePointDragEnd}
                  onRoutePointDragStart={handlePlaybackAwareRoutePointDragStart}
                  onRoutePointRemove={handlePlaybackAwareRoutePointRemove}
                  onRoutePointSelect={handleRoutePointSelect}
                  onRouteLineDrag={handleRouteLineDrag}
                  onRouteLineDragEnd={handleRoutePointDragEnd}
                  onRouteLineDragStart={handlePlaybackAwareRouteLineDragStart}
                  onSegmentFocus={handleSegmentFocus}
                  onSegmentHover={handleSegmentHover}
                  onViewportIdle={handleViewportIdle}
                  routeFitRequest={mapUi.routeFitRequest}
                  routeGeometry={routeState.geometry}
                  routePointDragPreview={routePointDragPreview}
                  routePoints={displayedRoutePoints}
                  searchHighlight={mapUi.searchHighlight}
                  selectedRoutePointIndex={mapUi.selectedRoutePointIndex}
                  videoCursor={plannerRouteReady ? plannerPlayback.cursor : null}
                  videoCursorVariant="progress-head-pulse"
                  videoPlaying={plannerPlayback.isPlaying}
                />

                {plannerRouteReady && (
                  <RoutePlaybackControls
                    className="planner-route-playback"
                    readoutMode="distance"
                    isPlaying={plannerPlayback.isPlaying}
                    isReady={plannerPlayback.isReady}
                    isScrubbing={plannerPlayback.isScrubbing}
                    currentTime={plannerPlayback.currentTime}
                    duration={plannerPlayback.duration}
                    progressFraction={plannerPlayback.cursor?.fraction}
                    routeDistanceMeters={routeState.distance}
                    onTogglePlayback={plannerPlayback.togglePlayback}
                    onScrubStart={plannerPlayback.onScrubStart}
                    onScrubChange={plannerPlayback.onScrubChange}
                    onScrubEnd={plannerPlayback.onScrubEnd}
                    playLabel="נגן מסלול על המפה"
                    pauseLabel="השהה מסלול על המפה"
                    scrubberLabel="מעבר לאורך המסלול"
                  />
                )}

                {plannerPoiPreviewVisible && (
                  <RoutePoiPlaybackPreview
                    className="planner-route-poi-preview"
                    slides={plannerCueSlides}
                    cursorFraction={plannerPlayback.cursor?.fraction}
                    routeDistanceMeters={routeState.distance}
                    previewMaxFraction={MAP_PLAYBACK_PREVIEW_MAX_FRACTION}
                    previewMaxMeters={MAP_PLAYBACK_PREVIEW_MAX_METERS}
                    onCueClick={handlePlannerCueClick}
                  />
                )}

                <RouteDescription
                  error={routeState.error}
                  hasBrokenRoute={hasBrokenRoute}
                  playback={plannerPlayback}
                  routeState={routeState}
                  selectedRoutePointIndex={mapUi.selectedRoutePointIndex}
                  onElevationHover={handlePlannerElevationHover}
                  onElevationSelect={handlePlannerElevationSelect}
                  onRemoveRoutePoint={handlePlaybackAwareRoutePointRemove}
                  onSelectRoutePoint={handleRoutePointSelect}
                />

                <SegmentNameDisplay
                  details={inspectedSegmentDetails}
                  inspectedSegment={inspectedSegment}
                />
              </>
            )}
            </div>
            {state.status === "ready" && (
              <FrontPanel
                panelState={panel.state}
                onPanelStateChange={handlePanelStateChange}
                collapsed={panelCollapsed}
                onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
                discover={
                  <DiscoverPanel
                    catalog={catalog}
                    places={places}
                    onSelectRoute={handleSelectRecommended}
                    onBuild={() => handlePanelStateChange("build")}
                  />
                }
                build={
                  <BuildPanel
                    routeState={routeState}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onUndo={handlePlaybackAwareUndo}
                    onRedo={handlePlaybackAwareRedo}
                    onClear={handlePlaybackAwareRouteClear}
                    canDownload={canDownload}
                    onOpenDownload={handleOpenDownload}
                    warningPresentation={routeWarningPresentation}
                    onWarningFocus={handleDataPointFocus}
                    pois={buildPois}
                    onPoiClick={(p) => handlePlannerCueClick({ slide: p, poiId: p.id })}
                  />
                }
              />
            )}
            {state.status === "ready" && panelCollapsed && (
              <button
                type="button"
                className="front-shell__reopen"
                aria-label="הצג פאנל"
                onClick={() => setPanelCollapsed(false)}
              >
                <Icon name="chevron-back-outline" />
              </button>
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
  error,
  hasBrokenRoute,
  onElevationHover,
  onElevationSelect,
  onRemoveRoutePoint,
  onSelectRoutePoint,
  playback,
  routeState,
  selectedRoutePointIndex,
}) {
  const playbackActive = Boolean(
    playback?.hasCursor ||
    playback?.isPlaying ||
    playback?.isScrubbing,
  );

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
                cursorFraction={playback?.cursor?.fraction ?? null}
                cursorPlaying={playback?.isPlaying}
                distance={routeState.distance}
                externalCursorActive={playbackActive}
                geometry={routeState.geometry}
                onElevationHover={onElevationHover}
                onElevationSelect={onElevationSelect}
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
