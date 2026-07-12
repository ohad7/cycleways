import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ContentSections from "./components/ContentSections.jsx";
import Icon from "./components/Icon.jsx";
import DataMarkerCard from "./components/DataMarkerCard.jsx";
import { segmentPreviewImage } from "./components/segmentPreviewImage.js";
import { segmentRoadTypeIcon } from "./components/segmentCardHelpers.js";
import PageShell from "./components/PageShell.jsx";
import SiteLegalLinks from "./components/SiteLegalLinks.jsx";
import RoutePlaybackControls from "./components/featured/RoutePlaybackControls.jsx";
import {
  nearestPreviewForCursor,
  routeVideoCueSlides,
} from "./components/featured/routePoiStoryData.js";
import RoutePoiPlaybackPreview from "./components/routePlayback/RoutePoiPlaybackPreview.jsx";
import RoutePointActions from "./components/RoutePointActions.jsx";
import {
  MAP_PLAYBACK_PREVIEW_MAX_FRACTION,
  MAP_PLAYBACK_PREVIEW_MAX_METERS,
  useSyntheticRoutePlayback,
} from "./components/routePlayback/useRoutePlayback.js";
import { useFitRouteOnPlay } from "./components/routePlayback/useFitRouteOnPlay.js";
import {
  buildRouteFitRequest,
  combineRouteGeometries,
  computeOverlayFitPadding,
} from "./map/routeFitPadding.js";
import { discoverRouteColor } from "@cycleways/core/map/discoverRouteColors.js";
import PlannerHints from "./components/PlannerHints.jsx";
import DraftRestoreBanner from "./components/DraftRestoreBanner.jsx";
import { emptyFilters } from "./components/WelcomeDiscover.jsx";
import FrontPanel from "./components/frontPanel/FrontPanel.jsx";
import BottomSheet from "./components/frontPanel/BottomSheet.jsx";
import { INITIAL_PANEL_STATE, resolvePanelState } from "./components/frontPanel/panelState.js";
import DiscoverPanel from "./components/frontPanel/DiscoverPanel.jsx";
import DiscoverPeekPreview from "./components/frontPanel/DiscoverPeekPreview.jsx";
import { selectDiscoverRoutes } from "./components/frontPanel/discoverRouteList.js";
import BuildPanel from "./components/frontPanel/BuildPanel.jsx";
import BuildEmptyActions from "./components/frontPanel/BuildEmptyActions.jsx";
import PanelElevationGraph from "./components/frontPanel/PanelElevationGraph.jsx";
import { useCatalogData } from "./components/frontPanel/useCatalogData.js";
import { formatLegacyDistance } from "./components/ElevationProfile.jsx";
import MapView from "./map/MapView.jsx";
import { loadFeaturedRouteSnapshot } from "@cycleways/core/data/featuredRouteSnapshots.js";
import { useCyclewaysApp } from "@cycleways/core/app/useCyclewaysApp.js";
import { getQueryParam, hasQueryParam } from "@cycleways/core/platform/location.js";
import { shouldShowFloatingDraftBanner } from "@cycleways/core/ui/draftBannerVisibility.js";
import { ROUTE_SEARCH_PLACEHOLDER } from "@cycleways/core/ui/routePlannerPresentation.js";
import { getDistance } from "@cycleways/core/utils/distance.js";
import { dataPointId } from "@cycleways/core/data/dataMarkers.js";
import { sortByDistanceFromUser } from "@cycleways/core/data/nearMe.js";
import { routeSliceForRange } from "./components/frontPanel/routeSlice.js";
import {
  ROUTE_NETWORK_BUCKETS,
  routeNetworkPresentation,
} from "@cycleways/core/map/networkPresentation.js";
import "./react-app.css";

// Code-split non-critical UI so it stays out of the initial bundle: the
// download/share modal only loads when opened, and the route-discovery wizard
// only loads when its feature flag is on (off by default).
const DownloadModal = lazy(() => import("./components/DownloadModal.jsx"));
const SendToPhone = lazy(() => import("./components/SendToPhone.jsx"));

// When true, hovering a Discover route also flies the camera to it (and restores
// the visible-set fit on mouse-out). Disabled by default: the constant zoom in/
// out on hover was disorienting. Hover still bolds the line either way (the
// `hovered` tier in recommendedRoutes). Flip to true to restore the old behavior.
const DISCOVER_HOVER_FITS_CAMERA = false;
const SHOW_DRAFT_RESTORE_BANNER = true;
const SHOW_MAP_PRESENTATION_EXPERIMENT_CONTROL = false;

const NETWORK_STYLE_OPTIONS = [
  { label: "Current", value: "current" },
  { label: "Typed bold", value: "typed-bold" },
  { label: "Typed cased", value: "typed-cased" },
  { label: "Build focus", value: "build-focus" },
  { label: "Single blue", value: "single-blue" },
];

const ROUTE_STYLE_OPTIONS = [
  { label: "Current", value: "current" },
  { label: "Cased teal", value: "cased" },
  { label: "Bright blue", value: "bright-blue" },
  { label: "Orange", value: "orange" },
  { label: "Dark", value: "dark" },
  { label: "Magenta", value: "magenta" },
];

const NETWORK_SCHEME_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Current muted", value: "current-muted" },
  { label: "Outdoors balanced", value: "outdoors-balanced" },
  { label: "Topo contrast", value: "topo-high-contrast" },
  { label: "Gray saturated", value: "gray-map-saturated" },
  { label: "Aerial bright", value: "aerial-bright" },
];

const BASE_MAP_PROFILE_OPTIONS = [
  { label: "Mapbox outdoors", value: "mapbox-outdoors" },
  { label: "Topo", value: "topo" },
  { label: "Gray", value: "gray" },
  { label: "Aerial", value: "aerial" },
];

const MAP_PRESENTATION_CONTROL_CONFIG = {
  networkStyle: {
    queryParam: "networkStyle",
    options: NETWORK_STYLE_OPTIONS,
  },
  routeStyle: {
    queryParam: "routeStyle",
    options: ROUTE_STYLE_OPTIONS,
  },
  networkScheme: {
    queryParam: "networkScheme",
    options: NETWORK_SCHEME_OPTIONS,
  },
  baseMapProfile: {
    queryParam: "baseMapProfile",
    options: BASE_MAP_PROFILE_OPTIONS,
  },
};

function samePadding(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.left === b.left
  );
}

function optionIndexForValue(options, value) {
  const index = options.findIndex((option) => option.value === value);
  return index >= 0 ? index : 0;
}

function writeMapPresentationQueryValue(key, value) {
  if (typeof window === "undefined") return;
  const config = MAP_PRESENTATION_CONTROL_CONFIG[key];
  if (!config) return;
  const url = new URL(window.location.href);
  url.searchParams.set(config.queryParam, value);
  window.history.replaceState(null, "", url.toString());
}

function App() {
  const {
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
    handleSearchSubmit,
    handleSearchQueryChange,
    handleLocateMe,
    handleUndo,
    handleRedo,
    handleRouteClear,
    handleLoadRouteParam,
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
    plannerDraft,
    recentRoutes,
    handleRestoreDraft,
    handleDismissDraft,
  } = useCyclewaysApp({ enableRouteDirectionAnimation: false });

  const [panel, setPanel] = useState(INITIAL_PANEL_STATE);
  const [networkStyleIndex, setNetworkStyleIndex] = useState(() =>
    optionIndexForValue(NETWORK_STYLE_OPTIONS, featureFlags.routeNetworkPresentation),
  );
  const [routeStyleIndex, setRouteStyleIndex] = useState(() =>
    optionIndexForValue(ROUTE_STYLE_OPTIONS, featureFlags.routeGeometryPresentation),
  );
  const [networkSchemeIndex, setNetworkSchemeIndex] = useState(() =>
    optionIndexForValue(NETWORK_SCHEME_OPTIONS, featureFlags.routeNetworkColorScheme),
  );
  const [baseMapProfileIndex, setBaseMapProfileIndex] = useState(() =>
    optionIndexForValue(BASE_MAP_PROFILE_OPTIONS, featureFlags.routeNetworkBaseMapProfile),
  );
  const orientOnBuildRef = useRef(false);
  const [orientRequest, setOrientRequest] = useState(0);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [sheetSnap, setSheetSnap] = useState("peek");
  // Mobile map legend open/close (closed by default). On desktop the legend is
  // always shown, so this only gates the mobile bottom-left legend.
  const [legendOpen, setLegendOpen] = useState(false);
  const manualSheetSnapRef = useRef(false);
  const appliedRouteLoadFitIdRef = useRef(null);
  const [isMobileSheet, setIsMobileSheet] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 860px)").matches,
  );
  const [hoveredBand, setHoveredBand] = useState(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [sendToPhoneOpen, setSendToPhoneOpen] = useState(false);
  const [endedPoiPreviewDismissed, setEndedPoiPreviewDismissed] = useState(false);
  const [hoveredRouteSlug, setHoveredRouteSlug] = useState(null);
  const [hoveredPoiId, setHoveredPoiId] = useState(null);
  const [discoverFilters, setDiscoverFilters] = useState(emptyFilters);
  const [nearMeSort, setNearMeSort] = useState(false);
  const [discoverSlugs, setDiscoverSlugs] = useState([]);
  const [discoverViewport, setDiscoverViewport] = useState({
    visibleSlugs: [],
    ghostSlugs: [],
    prefetchSlugs: [],
  });
  const [recommendedGeoms, setRecommendedGeoms] = useState({});
  const recommendedGeomCacheRef = useRef(new Map());
  const routePointCount = routeState.points.length;
  const { catalog, places } = useCatalogData();
  const catalogEntries = useMemo(
    () => (Array.isArray(catalog?.entries) ? catalog.entries : []),
    [catalog],
  );
  // The catalog route currently loaded in the planner, tracked by slug. Set
  // when a catalog route is opened through a planner CTA or shared route param;
  // cleared on any route edit so the route-page CTA only shows while the map
  // matches the catalog route.
  const [selectedCatalogSlug, setSelectedCatalogSlug] = useState(null);
  const selectedCatalogEntry = useMemo(
    () =>
      catalogEntries.find((entry) => entry.slug === selectedCatalogSlug) ||
      null,
    [catalogEntries, selectedCatalogSlug],
  );
  const placeById = useMemo(() => {
    const map = new Map();
    for (const place of Array.isArray(places) ? places : []) map.set(place.id, place);
    return map;
  }, [places]);
  const discoverRouteEntries = useMemo(() => {
    const { routes } = selectDiscoverRoutes(catalogEntries, discoverFilters);
    return nearMeSort && mapUi.locationFix
      ? sortByDistanceFromUser(routes, placeById, mapUi.locationFix)
      : routes;
  }, [catalogEntries, discoverFilters, mapUi.locationFix, nearMeSort, placeById]);
  const discoverPeekRoutes = useMemo(
    () => discoverRouteEntries,
    [discoverRouteEntries],
  );
  const discoverPeekSlugs = useMemo(
    () => discoverPeekRoutes.map((route) => route.slug),
    [discoverPeekRoutes],
  );
  const isMobileDiscoverHome =
    state.status === "ready" &&
    isMobileSheet &&
    panel.state === "discover";
  const isMobilePlannerShell =
    state.status === "ready" &&
    isMobileSheet &&
    !isMobileDiscoverHome;

  const setAutoSheetSnap = useCallback((snap, { resetManual = false } = {}) => {
    if (resetManual) manualSheetSnapRef.current = false;
    if (!manualSheetSnapRef.current) setSheetSnap(snap);
  }, []);

  const handleSheetSnapChange = useCallback((snap) => {
    manualSheetSnapRef.current = true;
    setSheetSnap(snap);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const query = window.matchMedia("(max-width: 860px)");
    const update = () => setIsMobileSheet(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);

  React.useEffect(() => {
    if (panel.lastPointCount === 0 && routePointCount > 0) setAutoSheetSnap("half");
    setPanel((prev) =>
      resolvePanelState(prev, { type: "route-points-changed", pointCount: routePointCount }),
    );
  }, [routePointCount, panel.lastPointCount, setAutoSheetSnap]);

  useEffect(() => {
    const className = "body--mobile-planner";
    if (isMobilePlannerShell) {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }
    return () => document.body.classList.remove(className);
  }, [isMobilePlannerShell]);

  useEffect(() => {
    const prefetch = [
      ...new Set([
        ...discoverViewport.prefetchSlugs,
        ...(panel.state === "discover" && isMobileSheet && sheetSnap === "peek"
          ? discoverPeekSlugs
          : []),
      ]),
    ];
    if (panel.state !== "discover" || prefetch.length === 0) return;
    let cancelled = false;
    const slugsToLoad = prefetch.filter(
      (slug) => !recommendedGeomCacheRef.current.has(slug),
    );
    if (slugsToLoad.length === 0) return;
    Promise.all(
      slugsToLoad.map(async (slug) => {
        try {
          const snap = await loadFeaturedRouteSnapshot(slug);
          if (!cancelled && Array.isArray(snap?.route?.geometry)) {
            recommendedGeomCacheRef.current.set(slug, snap.route.geometry);
          }
        } catch {
          // ignore failures for individual routes
        }
      }),
    ).then(() => {
      if (cancelled) return;
      setRecommendedGeoms((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [slug, geom] of recommendedGeomCacheRef.current) {
          if (!prev[slug]) {
            next[slug] = geom;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [discoverPeekSlugs, discoverViewport.prefetchSlugs, isMobileSheet, panel.state, sheetSnap]);

  const handlePanelStateChange = useCallback((to) => {
    setPanel((prev) => resolvePanelState(prev, { type: "toggle", to }));
  }, []);

  // Back/forward re-syncs the planner with the ?route= URL state: a route
  // param loads that route (without pushing again); no param returns to an
  // empty planner with Discover open.
  useEffect(() => {
    const onPopState = async () => {
      const param = getQueryParam("route");
      setSelectedCatalogSlug(null);
      if (param) {
        manualSheetSnapRef.current = false;
        await handleLoadRouteParam(param);
      } else {
        manualSheetSnapRef.current = false;
        handleRouteClear();
        handlePanelStateChange("discover");
        setSheetSnap("half");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [handleLoadRouteParam, handleRouteClear, handlePanelStateChange]);

  const handlePeekDiscover = useCallback(() => {
    manualSheetSnapRef.current = false;
    handlePanelStateChange("discover");
    setSheetSnap("half");
  }, [handlePanelStateChange]);

  const handlePeekBuild = useCallback(() => {
    if (panel.state !== "build") {
      orientOnBuildRef.current = true;
    }
    manualSheetSnapRef.current = false;
    handlePanelStateChange("build");
    setSheetSnap("half");
  }, [handlePanelStateChange, panel.state]);

  const handleDraftRestore = useCallback(async () => {
    setSelectedCatalogSlug(null);
    const ok = await handleRestoreDraft();
    if (ok) handlePeekBuild();
  }, [handleRestoreDraft, handlePeekBuild]);

  const handlePanelShare = useCallback(async () => {
    if (!shareUrl) return;
    if (
      isMobileSheet &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share({
          title: selectedCatalogEntry?.name || "מסלול CycleWays",
          url: shareUrl,
        });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    } catch {}
  }, [isMobileSheet, selectedCatalogEntry?.name, shareUrl]);

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
  const plannerRouteReady = routeState.geometry.length >= 2;
  const routeBuildingActive =
    routePointCount > 0 ||
    (routeState.pendingPoints || []).length > 0 ||
    Boolean(routePointDragPreview);

  useEffect(() => {
    if (!isMobileSheet || !plannerRouteReady) return;
    const fitId = mapUi.routeFitRequest?.id;
    if (!fitId || appliedRouteLoadFitIdRef.current === fitId) return;
    appliedRouteLoadFitIdRef.current = fitId;
    if (fitId.startsWith("restore-") || fitId.startsWith("select-")) {
      handlePanelStateChange("build");
      setAutoSheetSnap("half", { resetManual: true });
    }
  }, [
    handlePanelStateChange,
    isMobileSheet,
    mapUi.routeFitRequest?.id,
    plannerRouteReady,
    setAutoSheetSnap,
  ]);
  const selectedNetworkStyle =
    NETWORK_STYLE_OPTIONS[networkStyleIndex]?.value ||
    NETWORK_STYLE_OPTIONS[0].value;
  const selectedRouteStyle =
    ROUTE_STYLE_OPTIONS[routeStyleIndex]?.value || ROUTE_STYLE_OPTIONS[0].value;
  const selectedNetworkScheme =
    NETWORK_SCHEME_OPTIONS[networkSchemeIndex]?.value ||
    NETWORK_SCHEME_OPTIONS[0].value;
  const selectedBaseMapProfile =
    BASE_MAP_PROFILE_OPTIONS[baseMapProfileIndex]?.value ||
    BASE_MAP_PROFILE_OPTIONS[0].value;
  const mapPresentationActive = panel.state === "build";
  const effectiveNetworkPresentationVariant = mapPresentationActive
    ? selectedNetworkStyle
    : "current";
  const effectiveRouteGeometryPresentation = mapPresentationActive
    ? selectedRouteStyle
    : "current";
  const effectiveNetworkColorScheme = mapPresentationActive
    ? selectedNetworkScheme
    : "auto";
  const effectiveNetworkBaseMapProfile = mapPresentationActive
    ? selectedBaseMapProfile
    : "mapbox-outdoors";
  const legendPresentation = useMemo(
    () => routeNetworkPresentation({
      baseMapProfile: effectiveNetworkBaseMapProfile,
      colorScheme: effectiveNetworkColorScheme,
      routeBuilding: routeBuildingActive,
      variant: effectiveNetworkPresentationVariant,
    }),
    [
      effectiveNetworkBaseMapProfile,
      effectiveNetworkColorScheme,
      effectiveNetworkPresentationVariant,
      routeBuildingActive,
    ],
  );
  const handleMapPresentationControlChange = useCallback((key, index) => {
    const config = MAP_PRESENTATION_CONTROL_CONFIG[key];
    if (!config) return;
    const nextIndex = Math.max(
      0,
      Math.min(config.options.length - 1, Number(index) || 0),
    );
    const option = config.options[nextIndex] || config.options[0];
    if (key === "networkStyle") setNetworkStyleIndex(nextIndex);
    if (key === "routeStyle") setRouteStyleIndex(nextIndex);
    if (key === "networkScheme") setNetworkSchemeIndex(nextIndex);
    if (key === "baseMapProfile") setBaseMapProfileIndex(nextIndex);
    writeMapPresentationQueryValue(key, option.value);
  }, []);
  const plannerCueSlides = useMemo(
    () => routeVideoCueSlides(null, routeState),
    [
      routeState.activeDataPoints,
      routeState.distance,
      routeState.geometry,
    ],
  );
  const buildPois = useMemo(
    () => (routeState.activeDataPoints || [])
      .filter(Boolean)
      .slice()
      .sort((a, b) => (a.routeFraction ?? 0) - (b.routeFraction ?? 0))
      .map((p) => ({
        poi: p,
        distanceLabel: Number.isFinite(p.routeFraction)
          ? formatLegacyDistance(p.routeFraction * routeState.distance)
          : null,
      })),
    [routeState.activeDataPoints, routeState.distance],
  );
  const plannerPlayback = useSyntheticRoutePlayback({
    enabled: plannerRouteReady,
    routeState,
    cueSlides: plannerCueSlides,
  });
  const mapContainerRef = useRef(null);
  const [fitRequest, setFitRequest] = useState(null);
  const [cameraPadding, setCameraPadding] = useState(null);
  const discoverFitGeometryRef = useRef([]);
  const plannerFitRegistry = useMemo(() => ([
    { selector: ".planner-route-playback", side: "bottom" },
    { selector: ".search-container", side: "top" },
    { selector: ".legend-container" },
    { selector: ".data-marker-card" },
    { selector: ".planner-route-poi-preview" },
    { selector: ".route-point-actions", side: "bottom" },
    { selector: ".front-sheet", side: "bottom" },
  ]), []);
  const getMapOverlayScope = useCallback(
    () => mapContainerRef.current?.parentElement ?? mapContainerRef.current,
    [],
  );
  const measureCameraPadding = useCallback(() => {
    const mapEl = mapContainerRef.current;
    if (!mapEl) return null;
    return computeOverlayFitPadding({
      mapEl,
      registry: plannerFitRegistry,
      scopeEl: getMapOverlayScope(),
    });
  }, [getMapOverlayScope, plannerFitRegistry]);
  const refreshCameraPadding = useCallback(() => {
    const next = measureCameraPadding();
    setCameraPadding((prev) => (samePadding(prev, next) ? prev : next));
  }, [measureCameraPadding]);
  const requestFit = useCallback((geometry) => {
    const req = buildRouteFitRequest(geometry, {
      mapEl: mapContainerRef.current,
      registry: plannerFitRegistry,
      scopeEl: getMapOverlayScope(),
    });
    if (req) setFitRequest(req);
  }, [getMapOverlayScope, plannerFitRegistry]);
  const handleFrontPanelStateChange = useCallback((to) => {
    if (to === "build" && panel.state !== "build") {
      orientOnBuildRef.current = true;
    }
    handlePanelStateChange(to);
  }, [handlePanelStateChange, panel.state]);

  // Entering Build from Discover: orient to the nearby network (gentle zoom-out
  // from the current view) rather than fitting the whole country. Skipped when a
  // route is already loaded — the route fit frames that instead. Deferred so the
  // planner panel has rendered and cameraPadding is re-measured before the move.
  useEffect(() => {
    if (panel.state !== "build" || !orientOnBuildRef.current) {
      return undefined;
    }
    orientOnBuildRef.current = false;
    if (routePointCount > 0) return undefined;
    const timer = window.setTimeout(() => setOrientRequest((n) => n + 1), 80);
    return () => window.clearTimeout(timer);
  }, [panel.state, routePointCount]);

  useFitRouteOnPlay({
    isPlaying: plannerPlayback.isPlaying,
    currentTime: plannerPlayback.currentTime,
    geometry: routeState.geometry,
    getMapEl: () => mapContainerRef.current,
    getScopeEl: getMapOverlayScope,
    registry: plannerFitRegistry,
    onRequestFit: setFitRequest,
  });

  // Restoring a route from the ?route= URL param: re-fit overlay-aware. Defer
  // one frame so the just-rendered play controls are in the DOM and measured.
  useEffect(() => {
    const geometry = mapUi.routeFitRequest?.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) return undefined;
    const raf = window.requestAnimationFrame(() => requestFit(geometry));
    return () => window.cancelAnimationFrame(raf);
  }, [mapUi.routeFitRequest, requestFit]);

  const recommendedRoutes = useMemo(() => {
    if (isMobileDiscoverHome) return null;
    if (panel.state !== "discover") return null;
    const peekMode = isMobileSheet && sheetSnap === "peek";
    const bright = new Set(discoverViewport.visibleSlugs);
    const drawSlugs = peekMode
      ? discoverPeekSlugs
      : [
          ...discoverViewport.visibleSlugs,
          ...discoverViewport.ghostSlugs,
        ];
    return drawSlugs
      .map((slug) => {
        const geometry = recommendedGeoms[slug];
        if (!Array.isArray(geometry) || geometry.length < 2) return null;
        // Color is keyed to the route's position in the full ordered list so it
        // stays stable regardless of which routes are currently drawn.
        const index = discoverSlugs.indexOf(slug);
        const colorIndex = index >= 0 ? index : discoverPeekSlugs.indexOf(slug);
        return {
          slug,
          geometry,
          hovered: !peekMode && slug === hoveredRouteSlug,
          tier: peekMode || bright.has(slug) ? "bright" : "ghost",
          color: discoverRouteColor(colorIndex),
        };
      })
      .filter(Boolean);
  }, [
    panel.state,
    discoverPeekSlugs,
    discoverViewport,
    discoverSlugs,
    recommendedGeoms,
    hoveredRouteSlug,
    isMobileSheet,
    isMobileDiscoverHome,
    sheetSnap,
  ]);

  // Fit only the bright (in-viewport) routes — ghosts are drawn but excluded so
  // the camera frames what the user is actually reading.
  const discoverFitRoutes = useMemo(() => {
    if (isMobileDiscoverHome) return null;
    if (panel.state !== "discover" || (isMobileSheet && sheetSnap === "peek")) return null;
    return discoverViewport.visibleSlugs
      .map((slug) => ({ geometry: recommendedGeoms[slug] }))
      .filter((r) => Array.isArray(r.geometry) && r.geometry.length >= 2);
  }, [isMobileSheet, isMobileDiscoverHome, panel.state, sheetSnap, discoverViewport.visibleSlugs, recommendedGeoms]);

  // Fit the map to all relevant Discover routes; re-fit when the filtered list
  // (or its loaded geometries) changes. Debounced so streaming loads converge.
  useEffect(() => {
    if (!discoverFitRoutes || discoverFitRoutes.length === 0) return undefined;
    const combined = combineRouteGeometries(discoverFitRoutes);
    if (combined.length < 2) return undefined;
    discoverFitGeometryRef.current = combined;
    const timer = window.setTimeout(() => requestFit(combined), 200);
    return () => window.clearTimeout(timer);
  }, [discoverFitRoutes, requestFit]);

  // Hovering a Discover route fits to it; leaving restores the all-routes fit.
  // Gated by DISCOVER_HOVER_FITS_CAMERA — off by default (hover only bolds the
  // line, no camera move). Kept intact so the old behavior is one flag flip away.
  useEffect(() => {
    if (!DISCOVER_HOVER_FITS_CAMERA) return undefined;
    if (panel.state !== "discover") return undefined;
    const hoveredGeometry = hoveredRouteSlug ? recommendedGeoms[hoveredRouteSlug] : null;
    const timer = window.setTimeout(() => {
      if (Array.isArray(hoveredGeometry) && hoveredGeometry.length >= 2) {
        requestFit(hoveredGeometry);
      } else if (discoverFitGeometryRef.current.length >= 2) {
        requestFit(discoverFitGeometryRef.current);
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [hoveredRouteSlug, recommendedGeoms, panel.state, requestFit]);

  const bandHighlight = useMemo(() => {
    if (!hoveredBand || routeState.geometry.length < 2) return null;
    const cum = cumulativeMeters(routeState.geometry);
    const total = routeState.distance; // meters
    const startM = ((hoveredBand.startPercent ?? 0) / 100) * total;
    const endM = ((hoveredBand.endPercent ?? 0) / 100) * total;
    return routeSliceForRange(routeState.geometry, cum, startM, endM);
  }, [hoveredBand, routeState.geometry, routeState.distance]);
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
  const plannerPlaybackEnded =
    plannerRouteReady &&
    Number.isFinite(plannerPlayback.duration) &&
    plannerPlayback.duration > 0 &&
    !plannerPlayback.isPlaying &&
    !plannerPlayback.isScrubbing &&
    plannerPlayback.currentTime >= plannerPlayback.duration - 0.05;

  useEffect(() => {
    if (!plannerPlaybackEnded) {
      setEndedPoiPreviewDismissed(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setEndedPoiPreviewDismissed(true), 3000);
    return () => window.clearTimeout(timer);
  }, [plannerPlaybackEnded, routeState.geometry]);

  const plannerPoiPreviewVisible =
    plannerRouteReady &&
    !mapUi.selectedDataMarker &&
    !endedPoiPreviewDismissed &&
    Boolean(plannerPoiPreview.slide && plannerPoiPreview.near);

  useEffect(() => {
    if (state.status !== "ready") {
      setCameraPadding(null);
      return undefined;
    }
    const raf = window.requestAnimationFrame(refreshCameraPadding);
    const timer = window.setTimeout(refreshCameraPadding, 280);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [
    state.status,
    sheetSnap,
    panel.state,
    plannerRouteReady,
    plannerPoiPreviewVisible,
    panelCollapsed,
    refreshCameraPadding,
  ]);

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
    setSelectedCatalogSlug(null);
    handleUndo();
  }, [handleUndo, pausePlannerPlayback]);
  const handlePlaybackAwareRedo = useCallback(() => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleRedo();
  }, [handleRedo, pausePlannerPlayback]);
  const handlePlaybackAwareRouteClear = useCallback(() => {
    plannerPlayback.reset();
    setHoveredBand(null);
    setSelectedCatalogSlug(null);
    handleRouteClear();
  }, [handleRouteClear, plannerPlayback.reset]);
  const handlePlaybackAwareMapClick = useCallback((event) => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleMapClick(event);
  }, [handleMapClick, pausePlannerPlayback]);
  const handlePlaybackAwareRoutePointDragStart = useCallback((...args) => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleRoutePointDragStart(...args);
  }, [handleRoutePointDragStart, pausePlannerPlayback]);
  const handlePlaybackAwareRoutePointRemove = useCallback((...args) => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleRoutePointRemove(...args);
  }, [handleRoutePointRemove, pausePlannerPlayback]);
  const handlePlaybackAwareRouteLineDragStart = useCallback((...args) => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleRouteLineDragStart(...args);
  }, [handleRouteLineDragStart, pausePlannerPlayback]);
  const handlePlaybackAwareAddDataMarkerToRoute = useCallback((...args) => {
    pausePlannerPlayback();
    setSelectedCatalogSlug(null);
    handleAddDataMarkerToRoute(...args);
  }, [handleAddDataMarkerToRoute, pausePlannerPlayback]);

  const renderPlannerPlaybackControls = (className) => (
    plannerRouteReady ? (
      <RoutePlaybackControls
        className={className}
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
    ) : null
  );

  const discoverPanel = (
    <DiscoverPanel
      catalog={catalog}
      places={places}
      onBuild={handlePeekBuild}
      onSlugsChange={setDiscoverSlugs}
      onRouteViewport={setDiscoverViewport}
      onHoverRoute={setHoveredRouteSlug}
      viewportKey={`${isMobileSheet ? "mobile" : "desktop"}:${sheetSnap}:${panel.state}`}
      locationFix={mapUi.locationFix}
      locationError={mapUi.searchError}
      filters={discoverFilters}
      onFiltersChange={setDiscoverFilters}
      nearMeSort={nearMeSort}
      onNearMeSortChange={setNearMeSort}
      onRequestLocation={handleLocateMe}
      recentRoutes={recentRoutes}
      legalLinks={isMobileSheet ? <SiteLegalLinks compact /> : null}
    />
  );
  const buildPanel = (
    <BuildPanel
      routeState={routeState}
      catalogEntry={selectedCatalogEntry}
      canUndo={canUndo}
      canRedo={canRedo}
      onUndo={handlePlaybackAwareUndo}
      onRedo={handlePlaybackAwareRedo}
      onClear={handlePlaybackAwareRouteClear}
      canDownload={canDownload}
      onDownloadGpx={handleDownloadGpx}
      canShare={Boolean(shareUrl)}
      onShare={handlePanelShare}
      shareCopied={shareCopied}
      onSendToPhone={() => setSendToPhoneOpen(true)}
      error={routeState.error}
      emptyState={
        <BuildEmptyActions
          searchQuery={mapUi.searchQuery}
          searchStatus={mapUi.searchStatus}
          searchError={mapUi.searchError}
          onSearchQueryChange={handleSearchQueryChange}
          onSearchSubmit={handleSearchSubmit}
          locateStatus={mapUi.locateStatus}
          onLocateMe={handleLocateMe}
          draft={plannerDraft && !hasQueryParam("route") ? plannerDraft : null}
          onRestoreDraft={handleDraftRestore}
        />
      }
      pois={buildPois}
      onPoiClick={(poi) => handleDataPointFocus(poi)}
      showSendToPhone={!isMobileSheet}
      legalLinks={isMobileSheet ? <SiteLegalLinks compact /> : null}
      playback={
        isMobileSheet
          ? null
          : renderPlannerPlaybackControls(
              "planner-route-playback planner-route-playback--panel",
            )
      }
      elevation={
        <PanelElevationGraph
          geometry={routeState.geometry}
          distance={routeState.distance}
          cursorFraction={plannerPlayback.cursor?.fraction ?? null}
          cursorPlaying={plannerPlayback.isPlaying}
          cursorInfoVisible={plannerPlayback.hasCursor}
          externalCursorActive={Boolean(
            plannerPlayback.hasCursor || plannerPlayback.isPlaying || plannerPlayback.isScrubbing,
          )}
          onElevationHover={handlePlannerElevationHover}
          onElevationSelect={handlePlannerElevationSelect}
          onBandHover={setHoveredBand}
          onBandSelect={(band) => {
            const start = band.startPercent ?? 0;
            const end = band.endPercent ?? 0;
            plannerPlayback.seekToFraction(((start + end) / 2) / 100);
          }}
        />
      }
    />
  );
  const buildPeekSummary = (
    <div className="front-sheet__build-peek-row">
      <button
        type="button"
        className="front-sheet__build-peek"
        onClick={handlePeekBuild}
      >
        <span className="front-sheet__build-peek-title">
          {selectedCatalogEntry?.name || "מסלול חדש"}
        </span>
        <span className="front-sheet__build-peek-meta">
          {plannerRouteReady
            ? `${formatLegacyDistance(routeState.distance)} · ↑ ${Math.round(routeState.elevationGain || 0)} מ׳`
            : routePointCount > 0
              ? `${formatPointCountHebrew(routePointCount)} · ${formatLegacyDistance(routeState.distance)}`
              : "0 נקודות"}
        </span>
        <Icon name="chevron-back-outline" />
      </button>
      {isMobileSheet && plannerRouteReady && shareUrl && (
        <button
          type="button"
          className="front-sheet__build-peek-share"
          onClick={handlePanelShare}
          aria-label="שיתוף המסלול"
        >
          <Icon name="share-social-outline" />
          <span>{shareCopied ? "הועתק" : "שיתוף"}</span>
        </button>
      )}
      {selectedCatalogEntry && (
        <a
          className="front-sheet__build-peek-link"
          href={`/routes/${selectedCatalogEntry.slug}`}
          aria-label="לעמוד המסלול"
        >
          לעמוד המסלול ←
        </a>
      )}
    </div>
  );
  const sheetPeekContent = isMobileSheet ? (
    <div className="front-sheet__peek-stack">{buildPeekSummary}</div>
  ) : (
    <div className="front-sheet__peek-stack">
      <div className="front-sheet__mode-switch" role="tablist" aria-label="מצב עבודה">
        <button
          type="button"
          role="tab"
          aria-selected={panel.state === "discover"}
          className={panel.state === "discover" ? "is-active" : ""}
          onClick={handlePeekDiscover}
        >
          חפש מסלול
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel.state === "build"}
          className={panel.state === "build" ? "is-active" : ""}
          onClick={handlePeekBuild}
        >
          בניית מסלול
        </button>
      </div>
      {panel.state === "discover" ? (
        <DiscoverPeekPreview
          routes={discoverPeekRoutes}
          onOpen={handlePeekDiscover}
        />
      ) : (
        buildPeekSummary
      )}
    </div>
  );

  return (
    <>
      <PageShell showFooter={!isMobileDiscoverHome && !isMobilePlannerShell}>
        <div
          id="error-message"
          className={state.status === "error" ? "show" : ""}
          role={state.status === "error" ? "alert" : undefined}
        >
          {state.status === "error" ? (
            <ErrorState error={state.error} />
          ) : null}
        </div>

        <div
          className={[
            "container",
            isMobileDiscoverHome ? "container--mobile-discover-home" : "",
          ].filter(Boolean).join(" ")}
        >
          {isMobileDiscoverHome ? (
            <div className="mobile-discover-home" data-testid="mobile-discover-home">
              {discoverPanel}
            </div>
          ) : (
            <div
              className={[
                "front-shell",
                `front-shell--sheet-${sheetSnap}`,
                plannerRouteReady ? "front-shell--route-ready" : "",
                panelCollapsed ? "front-shell--collapsed" : "",
              ].filter(Boolean).join(" ")}
            >
            <div
              ref={mapContainerRef}
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
                  {/* Search moved into the sheet (BuildEmptyActions) on mobile;
                      the map keeps only two controls there — locate + legend. */}
                  {!isMobileSheet && (
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
                        placeholder={ROUTE_SEARCH_PLACEHOLDER}
                        value={mapUi.searchQuery}
                        onChange={(event) =>
                          handleSearchQueryChange(event.target.value)
                        }
                      />
                    </form>
                  )}
                  {isMobileSheet && (
                    <button
                      type="button"
                      className={`locate-btn${legendOpen ? " is-active" : ""}`}
                      title="מקרא סוגי דרכים"
                      aria-label="מקרא סוגי דרכים"
                      aria-pressed={legendOpen}
                      onClick={() => setLegendOpen((open) => !open)}
                    >
                      <Icon name="layers-outline" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="locate-btn"
                    title="מצא את המיקום שלי"
                    aria-label="מצא את המיקום שלי"
                    disabled={mapUi.locateStatus === "locating"}
                    onClick={handleLocateMe}
                  >
                    <Icon name="locate-outline" />
                  </button>
                </div>

                {SHOW_DRAFT_RESTORE_BANNER &&
                  shouldShowFloatingDraftBanner({
                    hasDraft: Boolean(plannerDraft),
                    hasRouteParam: hasQueryParam("route"),
                    pointCount: routePointCount,
                    panelState: panel.state,
                    isMobileSheet,
                    sheetSnap,
                  }) && (
                    <DraftRestoreBanner
                      draft={plannerDraft}
                      onRestore={handleDraftRestore}
                      onDismiss={handleDismissDraft}
                    />
                  )}

                {(!isMobileSheet || legendOpen) && (
                  <MapLegend
                    hasBrokenRoute={hasBrokenRoute}
                    presentation={legendPresentation}
                  />
                )}
                {SHOW_MAP_PRESENTATION_EXPERIMENT_CONTROL && (
                  <MapPresentationExperimentControl
                    active={mapPresentationActive}
                    controls={[
                      {
                        key: "networkStyle",
                        label: "Network style",
                        index: networkStyleIndex,
                        options: NETWORK_STYLE_OPTIONS,
                      },
                      {
                        key: "routeStyle",
                        label: "Built route",
                        index: routeStyleIndex,
                        options: ROUTE_STYLE_OPTIONS,
                      },
                      {
                        key: "networkScheme",
                        label: "Network colors",
                        index: networkSchemeIndex,
                        options: NETWORK_SCHEME_OPTIONS,
                      },
                      {
                        key: "baseMapProfile",
                        label: "Map profile",
                        index: baseMapProfileIndex,
                        options: BASE_MAP_PROFILE_OPTIONS,
                      },
                    ]}
                    onChange={handleMapPresentationControlChange}
                  />
                )}

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
                  cameraPadding={cameraPadding}
                  focusedMarker={focusedMarker}
                  elevationHover={mapUi.elevationHover}
                  focusedSegment={routeState.focusedSegment}
                  geoJsonData={state.assets.geoJsonData}
                  hideBuiltRoute={panel.state === "discover" && Boolean(hoveredRouteSlug)}
                  hoveredSegment={routeState.hoveredSegment}
                  onDataMarkerClick={handleDataMarkerClick}
                  onDataMarkerHover={setHoveredPoiId}
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
                  orientRequest={orientRequest}
                  routeFitRequest={fitRequest ?? mapUi.routeFitRequest}
                  routeGeometry={routeState.geometry}
                  routePointDragPreview={routePointDragPreview}
                  routePoints={displayedRoutePoints}
                  routeBuilding={routeBuildingActive}
                  networkBaseMapProfile={effectiveNetworkBaseMapProfile}
                  networkColorScheme={effectiveNetworkColorScheme}
                  networkPresentationVariant={effectiveNetworkPresentationVariant}
                  locationFix={mapUi.locationFix}
                  searchHighlight={mapUi.searchHighlight}
                  selectedRoutePointIndex={mapUi.selectedRoutePointIndex}
                  routeGeometryPresentation={effectiveRouteGeometryPresentation}
                  videoCursor={plannerRouteReady ? plannerPlayback.cursor : null}
                  videoCursorVariant="progress-head-pulse"
                  videoPlaying={plannerPlayback.isPlaying}
                  segmentHighlight={bandHighlight}
                  recommendedRoutes={recommendedRoutes}
                />

                {!isMobileSheet &&
                  renderPlannerPlaybackControls("planner-route-playback planner-route-playback--map")}

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


                <SegmentNameDisplay
                  details={inspectedSegmentDetails}
                  inspectedSegment={inspectedSegment}
                  hoveredPoiId={hoveredPoiId}
                />
                <PlannerHints
                  panelState={panel.state}
                  pointCount={routePointCount}
                  routeReady={plannerRouteReady}
                />
                <RoutePointActions
                  selectedIndex={mapUi.selectedRoutePointIndex}
                  pointCount={routeState.points.length}
                  onRemove={() => {
                    handlePlaybackAwareRoutePointRemove(mapUi.selectedRoutePointIndex);
                    handleRoutePointSelect(null);
                  }}
                  onDismiss={() => handleRoutePointSelect(null)}
                />
              </>
            )}
            </div>
            {state.status === "ready" && isMobileSheet && sheetSnap !== "full" &&
              renderPlannerPlaybackControls("planner-route-playback planner-route-playback--map")}
            {state.status === "ready" && (
              <BottomSheet
                snap={sheetSnap}
                onSnapChange={handleSheetSnapChange}
                peekContent={sheetPeekContent}
              >
                <FrontPanel
                  panelState={panel.state}
                  onPanelStateChange={handleFrontPanelStateChange}
                  routeStatus={routeState.status}
                  collapsed={panelCollapsed}
                  onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
                  showModeToggle={!isMobileSheet}
                  discover={discoverPanel}
                  build={buildPanel}
                />
              </BottomSheet>
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
          )}
        </div>

        {!isMobileDiscoverHome && !isMobilePlannerShell && <ContentSections />}
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
      {state.status === "ready" && sendToPhoneOpen && (
        <Suspense fallback={null}>
          <SendToPhone shareUrl={shareUrl} onClose={() => setSendToPhoneOpen(false)} />
        </Suspense>
      )}
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

function MapPresentationExperimentControl({ active, controls, onChange }) {
  return (
    <div className="map-presentation-control" dir="ltr">
      <div className="map-presentation-control__top">
        <span className="map-presentation-control__label">Map style test</span>
        <strong className="map-presentation-control__value">
          {active ? "Active in Build" : "Switch to Build"}
        </strong>
      </div>
      {controls.map((control) => {
        const option = control.options[control.index] || control.options[0];
        const queryParam =
          MAP_PRESENTATION_CONTROL_CONFIG[control.key]?.queryParam ||
          control.key;
        return (
          <label className="map-presentation-control__row" key={control.key}>
            <span className="map-presentation-control__row-head">
              <span className="map-presentation-control__label">
                {control.label}
              </span>
              <strong className="map-presentation-control__value">
                {option.label}
              </strong>
            </span>
            <input
              aria-label={`${control.label} option`}
              className="map-presentation-control__range"
              type="range"
              min="0"
              max={Math.max(0, control.options.length - 1)}
              step="1"
              value={control.index}
              onChange={(event) => onChange(control.key, event.target.value)}
            />
            <code className="map-presentation-control__query">
              {queryParam}={option.value}
            </code>
          </label>
        );
      })}
    </div>
  );
}

function MapLegend({ hasBrokenRoute, presentation }) {
  const colors = presentation?.colors || {};
  return (
    <div className="legend-container">
      <div className="legend-box open" id="legend-box">
        <div className="legend-title">סוגי דרכים</div>
        <div className="legend-item">
          <div
            className="legend-color paved-trail"
            style={{ backgroundColor: colors[ROUTE_NETWORK_BUCKETS.PRIMARY] }}
          />
          <div className="legend-label">שביל סלול</div>
        </div>
        <div className="legend-item">
          <div
            className="legend-color dirt-trail"
            style={{ backgroundColor: colors[ROUTE_NETWORK_BUCKETS.TRAIL] }}
          />
          <div className="legend-label">שביל עפר</div>
        </div>
        <div className="legend-item">
          <div
            className="legend-color road"
            style={{ backgroundColor: colors[ROUTE_NETWORK_BUCKETS.ROAD] }}
          />
          <div className="legend-label">כביש</div>
        </div>
      </div>
      {hasBrokenRoute && (
        <div className="route-warning issue-warning" id="route-warning">
          ⚠️ מסלול שבור
        </div>
      )}
    </div>
  );
}


const SEGMENT_CHIP_CAP = 3;

function SegmentNameDisplay({
  details,
  inspectedSegment,
  hoveredPoiId = null,
}) {
  if (!inspectedSegment) {
    return <div className="segment-name-display" id="segment-name-display" />;
  }

  const dataPoints = details?.dataPoints || [];
  const imageUrl = segmentPreviewImage(details);
  const shownChips = dataPoints.slice(0, SEGMENT_CHIP_CAP);
  const extraChips = dataPoints.length - shownChips.length;

  return (
    <div
      className="segment-name-display react-segment-name-display--active"
      id="segment-name-display"
    >
      {imageUrl ? (
        <img className="segment-card__media" src={imageUrl} alt="" />
      ) : (
        <span className="segment-card__icon" aria-hidden="true">
          <Icon name={segmentRoadTypeIcon(details?.roadType)} />
        </span>
      )}
      <div className="segment-card__body">
        <span className="segment-card__eyebrow">מקטע</span>
        <strong className="segment-card__name">{inspectedSegment}</strong>
        <div className="segment-card__stats">
          <span>📏 {details?.distanceKm || "0.0"} ק"מ</span>
          <span>⬆️ {details?.elevationGain || 0} מ'</span>
          <span>⬇️ {details?.elevationLoss || 0} מ'</span>
        </div>
        {shownChips.length > 0 && (
          <div className="segment-card__chips">
            {shownChips.map((dataPoint, index) => {
              const highlighted =
                hoveredPoiId != null &&
                dataPointId(inspectedSegment, dataPoint, index) === hoveredPoiId;
              return (
                <span
                  className={[
                    "segment-card__chip",
                    highlighted ? "segment-card__chip--highlight" : "",
                  ].filter(Boolean).join(" ")}
                  key={`${dataPoint.type}-${index}`}
                >
                  {dataPoint.emoji || "⚠️"}{" "}
                  {dataPoint.information}
                </span>
              );
            })}
            {extraChips > 0 && (
              <span className="segment-card__chip segment-card__chip--more">
                +{extraChips} נוספים
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function cumulativeMeters(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) {
    cum[i] = cum[i - 1] + getDistance(points[i - 1], points[i]);
  }
  return cum;
}

function formatPointCountHebrew(count) {
  if (count === 1) return "נקודה אחת";
  return `${count} נקודות`;
}

export default App;
