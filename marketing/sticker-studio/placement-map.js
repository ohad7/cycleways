import {
  addVerification,
  assignDesign,
  createLocation,
  createPlacement,
  createReplacement,
  currentPlacement,
  dashboardStats,
  fieldPackCsv,
  placementGeoJson,
  transitionPlacement,
  updateLocation,
  upsertDesignVersion,
  validateRegistry,
  verificationState,
} from "./registry-core.mjs";
import { loadRegistry, saveRegistry, uploadPlacementPhoto } from "./registry-api.mjs";

const STATUS_LABELS = {
  planned: "Planned",
  assigned: "Assigned",
  placed: "Placed",
  unverified: "Needs verification",
  overdue: "Overdue",
  verified: "Verified",
  failed: "Needs attention",
  removed: "Removed",
};

export async function initPlacementStudio({ onContextChange }) {
  const elements = collectElements();
  let registry = null;
  let map = null;
  let mapReady = false;
  let activeLocationId = null;
  let activePlacementId = null;
  let locationDraft = null;
  let planningOnMap = false;

  bindStaticEvents();
  setRegistryStatus("Loading placement registry…");
  try {
    registry = validateRegistry(await loadRegistry());
    setRegistryStatus(`Registry revision ${registry.revision} loaded.`);
  } catch (error) {
    setRegistryStatus(`${error.message} Restart the Vite server after pulling registry changes.`, true);
    disableRegistryActions();
    return publicApi();
  }

  renderAll();
  initializeMap();

  function publicApi() {
    return {
      getActivePlacementContext() {
        if (!registry || !activePlacementId) return null;
        const placement = registry.placements.find((item) => item.id === activePlacementId);
        const location = placement && registry.locations.find((item) => item.id === placement.locationId);
        return placement && location ? { placement, location } : null;
      },
      async recordExport(configuration) {
        if (!registry || !activePlacementId) return null;
        const context = this.getActivePlacementContext();
        if (!context) return null;
        await mutateAndSave((draft) => {
          const version = upsertDesignVersion(draft, {
            ...configuration,
            placementId: activePlacementId,
            shortCode: context.placement.qr?.shortCode || null,
            targetUrl: context.placement.qr?.targetUrl || null,
          });
          assignDesign(draft, activePlacementId, version.id, new Date().toISOString(), "Sticker Studio export");
        }, "Sticker assigned to placement and redirect published.");
        return this.getActivePlacementContext();
      },
      clearActivePlacement() {
        activePlacementId = null;
        onContextChange?.(null);
      },
      showLocations,
    };
  }

  function collectElements() {
    return {
      createWorkspace: document.querySelector("#create-workspace"),
      locationsWorkspace: document.querySelector("#locations-workspace"),
      showCreate: document.querySelector("#show-create"),
      showLocations: document.querySelector("#show-locations"),
      locationCount: document.querySelector("#location-count-badge"),
      dashboard: document.querySelector("#placement-dashboard"),
      search: document.querySelector("#location-search"),
      campaignFilter: document.querySelector("#campaign-filter"),
      statusFilter: document.querySelector("#status-filter"),
      printQueue: document.querySelector("#print-queue-filter"),
      addLocation: document.querySelector("#add-location"),
      currentLocation: document.querySelector("#use-current-location"),
      locationList: document.querySelector("#location-list"),
      detail: document.querySelector("#location-detail"),
      mapMessage: document.querySelector("#map-message"),
      registryStatus: document.querySelector("#registry-status"),
      newCampaign: document.querySelector("#new-campaign"),
      campaignDialog: document.querySelector("#campaign-dialog"),
      campaignForm: document.querySelector("#campaign-form"),
      saveCampaign: document.querySelector("#save-campaign"),
      exportJson: document.querySelector("#export-registry-json"),
      exportGeoJson: document.querySelector("#export-registry-geojson"),
      exportFieldPack: document.querySelector("#export-field-pack"),
      exportRoute: document.querySelector("#export-verification-route"),
    };
  }

  function bindStaticEvents() {
    elements.showCreate.addEventListener("click", showCreate);
    elements.showLocations.addEventListener("click", showLocations);
    elements.search.addEventListener("input", renderLocationList);
    elements.campaignFilter.addEventListener("change", renderLocationList);
    elements.statusFilter.addEventListener("change", renderLocationList);
    elements.printQueue.addEventListener("click", () => {
      elements.statusFilter.value = "planned";
      renderLocationList();
    });
    elements.addLocation.addEventListener("click", () => {
      planningOnMap = true;
      locationDraft = null;
      elements.mapMessage.hidden = false;
      elements.mapMessage.textContent = mapReady ? "Click the map to plan a sticker location." : "Map unavailable; using the default map center.";
      if (!mapReady) openLocationDraft([35.61, 33.18]);
      showLocations();
    });
    elements.currentLocation.addEventListener("click", useCurrentLocation);
    elements.newCampaign.addEventListener("click", () => elements.campaignDialog.showModal());
    elements.campaignForm.addEventListener("submit", saveCampaign);
    elements.exportJson.addEventListener("click", () => downloadJson(registry, "cycleways-sticker-registry.json"));
    elements.exportGeoJson.addEventListener("click", () => downloadJson(placementGeoJson(registry), "cycleways-sticker-locations.geojson", "application/geo+json"));
    elements.exportFieldPack.addEventListener("click", () => downloadText(fieldPackCsv(registry), "cycleways-sticker-field-pack.csv", "text/csv"));
    elements.exportRoute.addEventListener("click", exportVerificationRoute);
  }

  function showCreate() {
    elements.createWorkspace.hidden = false;
    elements.locationsWorkspace.hidden = true;
    elements.showCreate.classList.add("active");
    elements.showLocations.classList.remove("active");
  }

  function showLocations() {
    elements.createWorkspace.hidden = true;
    elements.locationsWorkspace.hidden = false;
    elements.showCreate.classList.remove("active");
    elements.showLocations.classList.add("active");
    requestAnimationFrame(() => map?.resize());
  }

  function initializeMap() {
    try {
      if (!window.mapboxgl) throw new Error("Mapbox GL did not load.");
      const token = mapboxToken();
      window.mapboxgl.accessToken = token;
      map = new window.mapboxgl.Map({
        container: "placement-map",
        style: "mapbox://styles/mapbox/outdoors-v12",
        center: [35.61, 33.18],
        zoom: 9.2,
      });
      map.addControl(new window.mapboxgl.NavigationControl(), "top-right");
      map.on("load", () => {
        mapReady = true;
        elements.mapMessage.hidden = true;
        addMapLayers();
        updateMapSource(true);
      });
      map.on("click", (event) => {
        if (planningOnMap) {
          openLocationDraft([event.lngLat.lng, event.lngLat.lat]);
          return;
        }
        const features = map.queryRenderedFeatures(event.point, { layers: ["sticker-pins"] });
        const id = features[0]?.properties?.id;
        if (id) selectLocation(id);
      });
      map.on("mouseenter", "sticker-pins", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "sticker-pins", () => { map.getCanvas().style.cursor = planningOnMap ? "crosshair" : ""; });
    } catch (error) {
      elements.mapMessage.hidden = false;
      elements.mapMessage.textContent = `Map unavailable: ${error.message}. The location list still works.`;
    }
  }

  function addMapLayers() {
    map.addSource("sticker-locations", { type: "geojson", data: placementGeoJson(registry), cluster: true, clusterRadius: 44, clusterMaxZoom: 13 });
    map.addLayer({ id: "sticker-clusters", type: "circle", source: "sticker-locations", filter: ["has", "point_count"], paint: { "circle-color": "#29473b", "circle-radius": ["step", ["get", "point_count"], 17, 10, 22, 30, 28], "circle-stroke-width": 3, "circle-stroke-color": "#fff" } });
    map.addLayer({ id: "sticker-cluster-count", type: "symbol", source: "sticker-locations", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#fff" } });
    map.addLayer({
      id: "sticker-pins", type: "circle", source: "sticker-locations", filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 7, 15, 11],
        "circle-color": ["match", ["get", "verificationState"], "assigned", "#3b82c4", "unverified", "#d99a29", "overdue", "#d99a29", "verified", "#3b8a5a", "failed", "#bd4b3d", "removed", "#929b96", "#929b96"],
        "circle-stroke-width": 3, "circle-stroke-color": "#fff",
      },
    });
    map.on("click", "sticker-clusters", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      map.getSource("sticker-locations").getClusterExpansionZoom(feature.properties.cluster_id, (error, zoom) => {
        if (!error) map.easeTo({ center: feature.geometry.coordinates, zoom });
      });
    });
  }

  function mapboxToken() {
    const global = window.CYCLEWAYS_MAPBOX_TOKEN;
    if (typeof global === "string" && global.trim()) return global.trim();
    const stored = localStorage.getItem("cycleways.mapboxToken");
    if (stored?.trim()) return stored.trim();
    throw new Error("Mapbox token is not configured");
  }

  function renderAll() {
    elements.locationCount.textContent = registry.locations.length;
    renderDashboard();
    renderCampaignOptions();
    renderLocationList();
    renderDetail();
    updateMapSource();
  }

  function renderDashboard() {
    const stats = dashboardStats(registry);
    const metrics = [
      [stats.locations, "Locations"], [stats.planned, "Planned"], [stats.assigned, "Assigned"],
      [stats.placed, "Placed"], [stats.verified, "Verified"], [stats.attention + stats.overdue, "Attention"], [stats.scans, "Recorded scans"],
    ];
    elements.dashboard.innerHTML = metrics.map(([value, label]) => `<div class="metric-card"><strong>${value}</strong><span>${label}</span></div>`).join("");
  }

  function renderCampaignOptions() {
    const selected = elements.campaignFilter.value;
    elements.campaignFilter.innerHTML = `<option value="">All campaigns</option>${registry.campaigns.map((campaign) => `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)}</option>`).join("")}`;
    if ([...elements.campaignFilter.options].some((option) => option.value === selected)) elements.campaignFilter.value = selected;
  }

  function filteredLocations() {
    const query = elements.search.value.trim().toLowerCase();
    const campaignId = elements.campaignFilter.value;
    const state = elements.statusFilter.value;
    return registry.locations.filter((location) => {
      if (campaignId && location.campaignId !== campaignId) return false;
      const placement = currentPlacement(registry.placements.filter((item) => item.locationId === location.id));
      const check = placement ? verificationState(registry, placement) : "planned";
      if (state) {
        const match = state === "planned" ? !placement || placement.status === "planned" : state === check || state === placement?.status;
        if (!match) return false;
      }
      if (!query) return true;
      const haystack = [location.name, location.landmark, location.notes, placement?.qr?.shortCode, placement?.designVersionId].join(" ").toLowerCase();
      return haystack.includes(query);
    }).sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || a.name.localeCompare(b.name));
  }

  function renderLocationList() {
    if (!registry) return;
    const locations = filteredLocations();
    elements.locationList.innerHTML = locations.length ? locations.map((location) => {
      const placement = currentPlacement(registry.placements.filter((item) => item.locationId === location.id));
      const state = placement ? verificationState(registry, placement) : "planned";
      return `<button class="location-card ${location.id === activeLocationId ? "active" : ""}" type="button" data-location-id="${escapeHtml(location.id)}"><strong><i class="status-dot ${state}"></i>${escapeHtml(location.name)}</strong><small>${escapeHtml(STATUS_LABELS[state] || state)} · score ${candidateScore(location)}</small></button>`;
    }).join("") : `<div class="location-list-empty">No locations match these filters.</div>`;
    elements.locationList.querySelectorAll("[data-location-id]").forEach((button) => button.addEventListener("click", () => selectLocation(button.dataset.locationId)));
  }

  function selectLocation(locationId) {
    activeLocationId = locationId;
    locationDraft = null;
    planningOnMap = false;
    const location = registry.locations.find((item) => item.id === locationId);
    const placement = currentPlacement(registry.placements.filter((item) => item.locationId === locationId));
    activePlacementId = placement?.id || null;
    renderLocationList();
    renderDetail();
    if (mapReady && location) map.easeTo({ center: location.coordinates, zoom: Math.max(map.getZoom(), 14) });
  }

  function openLocationDraft(coordinates) {
    planningOnMap = false;
    locationDraft = { coordinates };
    activeLocationId = null;
    elements.mapMessage.hidden = true;
    renderDetail();
  }

  function renderDetail() {
    if (!registry) return;
    if (locationDraft) {
      elements.detail.innerHTML = locationFormMarkup(null, locationDraft.coordinates);
      bindLocationForm(null);
      return;
    }
    const location = registry.locations.find((item) => item.id === activeLocationId);
    if (!location) {
      elements.detail.innerHTML = `<div class="empty-detail"><strong>Select a location</strong><p>Click a pin or plan a new location to manage its sticker history.</p></div>`;
      return;
    }
    const placements = registry.placements.filter((item) => item.locationId === location.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const placement = currentPlacement(placements);
    const state = placement ? verificationState(registry, placement) : "planned";
    activePlacementId = placement?.id || null;
    elements.detail.innerHTML = `<div class="detail-shell">
      <div class="detail-header detail-header--location"><div><span class="detail-kicker">${escapeHtml(location.type)}</span><h2>${escapeHtml(location.name)}</h2><div class="detail-badges"><span class="state-badge ${state}"><i class="status-dot ${state}"></i>${escapeHtml(STATUS_LABELS[state] || state)}</span><span class="score-badge">Fit ${candidateScore(location)}/100</span></div></div><button id="close-detail" type="button" aria-label="Close location">×</button></div>
      <section class="detail-section detail-section--primary"><h3>Sticker</h3>${placementMarkup(location, placement)}</section>
      ${placement ? verificationMarkup(placement) : ""}
      ${locationFormMarkup(location, location.coordinates)}
      ${placement ? photosMarkup(placement) : ""}
      <details class="disclosure detail-section"><summary>Activity history <span>${placements.reduce((count, item) => count + (item.history?.length || 0), 0)}</span></summary>${historyMarkup(placements)}</details>
    </div>`;
    bindLocationForm(location);
    elements.detail.querySelector("#close-detail").addEventListener("click", () => { activeLocationId = null; activePlacementId = null; renderAll(); });
    bindPlacementActions(location, placement);
  }

  function locationFormMarkup(location, coordinates) {
    const campaignId = location?.campaignId || registry.campaigns[0]?.id || "";
    const fields = `<div class="detail-grid">
        <label class="field full"><span>Name</span><input id="detail-name" required value="${escapeHtml(location?.name || "")}" placeholder="e.g. Beit Hillel trailhead" /></label>
        <label class="field"><span>Place type</span><select id="detail-type">${["trailhead","junction","business","school","transit","park","community-board","event","other"].map((type) => `<option value="${type}" ${type === (location?.type || "trailhead") ? "selected" : ""}>${friendlyLabel(type)}</option>`).join("")}</select></label>
        <label class="field"><span>Permission</span><select id="detail-permission">${["unknown","needed","approved","not-required","denied"].map((value) => `<option value="${value}" ${value === (location?.permissionStatus || "unknown") ? "selected" : ""}>${friendlyLabel(value)}</option>`).join("")}</select></label>
      </div>`;
    const advanced = `<div class="detail-grid advanced-fields">
        <label class="field full"><span>Campaign</span><select id="detail-campaign">${registry.campaigns.map((campaign) => `<option value="${escapeHtml(campaign.id)}" ${campaign.id === campaignId ? "selected" : ""}>${escapeHtml(campaign.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Priority</span><select id="detail-priority">${["low","normal","high"].map((value) => `<option value="${value}" ${value === (location?.priority || "normal") ? "selected" : ""}>${friendlyLabel(value)}</option>`).join("")}</select></label>
        <div class="coordinate-note">Pin · ${Number(coordinates[1]).toFixed(5)}, ${Number(coordinates[0]).toFixed(5)}</div>
        <input id="detail-lng" type="hidden" value="${Number(coordinates[0]).toFixed(6)}" />
        <input id="detail-lat" type="hidden" value="${Number(coordinates[1]).toFixed(6)}" />
        <label class="field full"><span>How to recognize it</span><input id="detail-landmark" value="${escapeHtml(location?.landmark || "")}" placeholder="Near the gate, beside the bike rack…" /></label>
        <label class="field full"><span>Placement instructions</span><textarea id="detail-instructions" placeholder="Exact surface or side to use">${escapeHtml(location?.instructions || "")}</textarea></label>
        <label class="field full"><span>Private notes</span><textarea id="detail-notes">${escapeHtml(location?.notes || "")}</textarea></label>
      </div>`;
    if (!location) {
      return `<form id="location-form" class="quick-plan-card">
        <div class="quick-plan-intro"><span class="step-icon">1</span><div><h3>Plan this spot</h3><p>Just name it. The map pin and sensible defaults are already saved with it.</p></div></div>
        ${fields}
        <details class="disclosure compact-disclosure"><summary>More details <span>optional</span></summary>${advanced}</details>
        <div class="detail-actions detail-actions--sticky"><button class="primary-inline" type="submit">Save planned spot</button><button id="cancel-new-location" type="button">Cancel</button></div>
      </form>`;
    }
    return `<details class="disclosure detail-section location-settings">
      <summary>Location details <span>${escapeHtml(friendlyLabel(location.permissionStatus))}</span></summary>
      <div class="location-glance"><span>${escapeHtml(friendlyLabel(location.type))}</span><span>${escapeHtml(friendlyLabel(location.permissionStatus))}</span><span>${Number(coordinates[1]).toFixed(4)}, ${Number(coordinates[0]).toFixed(4)}</span></div>
      <form id="location-form">
        ${fields}${advanced}
        <div class="detail-actions"><button class="primary-inline" type="submit">Save changes</button></div>
      </form>
    </details>`;
  }

  function bindLocationForm(location) {
    const form = elements.detail.querySelector("#location-form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fields = {
        name: form.querySelector("#detail-name").value,
        campaignId: form.querySelector("#detail-campaign").value,
        type: form.querySelector("#detail-type").value,
        permissionStatus: form.querySelector("#detail-permission").value,
        priority: form.querySelector("#detail-priority").value,
        coordinates: [Number(form.querySelector("#detail-lng").value), Number(form.querySelector("#detail-lat").value)],
        landmark: form.querySelector("#detail-landmark").value,
        instructions: form.querySelector("#detail-instructions").value,
        notes: form.querySelector("#detail-notes").value,
      };
      await mutateAndSave((draft) => {
        if (location) updateLocation(draft, location.id, fields);
        else activeLocationId = createLocation(draft, fields).id;
      }, location ? "Location updated." : "Location planned.");
      locationDraft = null;
      renderAll();
    });
    elements.detail.querySelector("#cancel-new-location")?.addEventListener("click", () => { locationDraft = null; renderDetail(); });
  }

  function placementMarkup(location, placement) {
    if (!placement) {
      return `<div class="next-step-card"><span class="step-icon">2</span><div><strong>Choose where it should lead</strong><p>A unique tracking code is created automatically.</p></div></div>
        <form id="create-placement-form" class="quick-placement-form">
          <label class="field"><span>Sticker destination</span><input id="new-placement-target" type="url" value="https://cycleways.app/" required /></label>
          <details class="disclosure compact-disclosure"><summary>Sticker options <span>optional</span></summary><div class="detail-grid advanced-fields">
            <label class="field"><span>QR mode</span><select id="new-placement-qr-mode"><option value="placement">Unique location code</option><option value="shared">Shared URL</option><option value="none">No QR</option></select></label>
            <label class="field"><span>Surface</span><select id="new-placement-surface"><option>unknown</option><option>metal</option><option>glass</option><option>wood</option><option>plastic</option><option>painted-wall</option><option>board</option></select></label>
          </div></details>
          <button class="primary-inline full-width-action" type="submit" ${location.permissionStatus === "denied" ? "disabled" : ""}>Create tracked sticker</button>
        </form>`;
    }
    const check = verificationState(registry, placement);
    const design = registry.designVersions.find((item) => item.id === placement.designVersionId);
    const nextMessage = placement.status === "planned" ? "Design and print this sticker next." : placement.status === "assigned" ? "Take it to the spot, then confirm placement." : check === "unverified" ? "Scan the printed QR to finish validation." : check === "verified" ? "Everything looks good." : "This sticker needs a field check.";
    const needsOperator = placement.status === "assigned";
    const needsReason = ["placed", "needs-attention", "missing"].includes(placement.status);
    return `<div class="sticker-state-card ${check}">
      <div class="state-card-top"><span class="state-badge ${check}"><i class="status-dot ${check}"></i>${escapeHtml(STATUS_LABELS[check] || check)}</span>${placement.qr?.shortCode ? `<code class="short-code">${escapeHtml(placement.qr.shortCode)}</code>` : ""}</div>
      <strong>${escapeHtml(nextMessage)}</strong>
      <div class="mini-stats"><span>${placement.scanCount || 0} scans</span><span>${placement.designVersionId ? "Design saved" : "No design yet"}</span><span>${placement.placedAt ? formatDate(placement.placedAt) : "Not placed"}</span></div>
      <details class="disclosure compact-disclosure"><summary>QR & version details</summary><div class="metadata-list">
        <span>Physical status <b>${escapeHtml(placement.status)}</b></span>
        <span>Encoded URL <code>${escapeHtml(placement.qr?.encodedUrl || "No QR")}</code></span>
        <span>Destination <code>${escapeHtml(placement.qr?.targetUrl || "No QR")}</code></span>
        <span>Design <b>${escapeHtml(design?.id || "not assigned")}</b></span>
        <span>Last scan <b>${formatDate(placement.lastScanAt)}</b></span>
      </div></details>
    </div>
    ${needsOperator ? `<label class="field compact-action-field"><span>Placed by</span><input id="placement-installer" value="${escapeHtml(placement.installer || "Field operator")}" /></label>` : ""}
    ${needsReason ? `<label class="field compact-action-field"><span>Reason <small>only for problems/removal</small></span><input id="placement-action-reason" placeholder="What happened?" /></label>` : ""}
    <div class="detail-actions detail-actions--prominent">${placementActionButtons(placement)}</div>`;
  }

  function placementActionButtons(placement) {
    const buttons = [];
    if (placement.status === "planned") buttons.push('<button id="design-placement" class="primary-inline" type="button">Design & assign</button>');
    if (placement.status === "assigned") buttons.push('<button id="mark-placed" class="primary-inline" type="button">I placed it here</button>');
    if (placement.status === "placed") {
      buttons.push('<button id="mark-attention" type="button">Needs attention</button>', '<button id="mark-missing" class="danger-button" type="button">Missing</button>', '<button id="mark-removed" class="danger-button" type="button">Removed</button>');
    }
    if (placement.status === "needs-attention") buttons.push('<button id="mark-missing" class="danger-button" type="button">Missing</button>', '<button id="mark-removed" class="danger-button" type="button">Removed</button>');
    if (placement.status === "missing") buttons.push('<button id="mark-removed" class="danger-button" type="button">Confirm removed</button>');
    if (placement.placedAt && !placement.replacedByPlacementId) buttons.push('<button id="create-replacement" type="button">Create replacement</button>');
    return buttons.join("");
  }

  function verificationMarkup(placement) {
    const allowed = ["placed", "needs-attention"].includes(placement.status);
    const records = [...(placement.verifications || [])].reverse();
    return `<section class="detail-section verification-card"><div class="section-heading"><div><span class="detail-kicker">Field check</span><h3>${records.length ? "Verify again" : "Validate this sticker"}</h3></div>${records.length ? `<span class="check-count">${records.length} checks</span>` : ""}</div>
      ${allowed ? `<form id="verification-form" class="detail-grid verification-form">
        <label class="field"><span>Condition</span><select id="verify-condition"><option>good</option><option>faded</option><option>damaged</option><option>obstructed</option><option>missing</option></select></label>
        <label class="field"><span>QR result</span><select id="verify-qr"><option value="passed">passed</option><option value="failed">failed</option><option value="not-applicable">not applicable</option></select></label>
        <input id="verify-destination" type="hidden" value="${escapeHtml(placement.qr?.targetUrl || "")}" />
        <label class="field full"><span>Quick note <small>optional</small></span><input id="verify-note" placeholder="Anything worth remembering?" /></label>
        <button class="primary-inline full-width-action" type="submit">Record verification</button>
      </form>` : ""}
      ${records.length ? `<details class="disclosure compact-disclosure"><summary>Previous checks</summary><ul class="verification-list">${records.map((record) => `<li><strong>${escapeHtml(record.condition)} · ${escapeHtml(record.qrResult)}</strong><br>${formatDate(record.checkedAt)} · ${escapeHtml(record.checker)} ${record.note ? `· ${escapeHtml(record.note)}` : ""}</li>`).join("")}</ul></details>` : ""}
    </section>`;
  }

  function photosMarkup(placement) {
    return `<details class="disclosure detail-section"><summary>Field photos <span>${placement.photos?.length || 0}</span></summary><div class="disclosure-body"><input id="placement-photo" type="file" accept="image/jpeg,image/png,image/webp" /><ul class="photo-list">${(placement.photos || []).map((photo) => `<li><a href="${escapeHtml(photo.full)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(photo.thumbnail)}" alt="Sticker field record" /></a></li>`).join("")}</ul></div></details>`;
  }

  function historyMarkup(placements) {
    const rows = placements.flatMap((placement) => (placement.history || []).map((entry) => ({ ...entry, placementId: placement.id }))).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return `<ul class="history-list">${rows.map((entry) => `<li><strong>${escapeHtml(entry.type)}</strong> · ${formatDate(entry.timestamp)}<br><small>${escapeHtml(entry.placementId)} ${entry.note ? `· ${escapeHtml(entry.note)}` : ""}</small></li>`).join("") || "<li>No placement history yet.</li>"}</ul>`;
  }

  function bindPlacementActions(location, placement) {
    elements.detail.querySelector("#create-placement-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const mode = form.querySelector("#new-placement-qr-mode").value;
      const targetUrl = mode === "none" ? null : form.querySelector("#new-placement-target").value;
      const surfaceType = form.querySelector("#new-placement-surface").value;
      await mutateAndSave((draft) => { activePlacementId = createPlacement(draft, { locationId: location.id, qrMode: mode, targetUrl, surfaceType }).id; }, "Tracked placement created with a unique short code.");
    });
    elements.detail.querySelector("#design-placement")?.addEventListener("click", () => {
      activePlacementId = placement.id;
      onContextChange?.({ placement, location });
      showCreate();
    });
    elements.detail.querySelector("#mark-placed")?.addEventListener("click", async () => {
      const installer = elements.detail.querySelector("#placement-installer")?.value || "Field operator";
      await mutateAndSave((draft) => transitionPlacement(draft, placement.id, "placed", { actualCoordinates: location.coordinates, installer }), "Sticker marked placed. Verify it after scanning the printed QR.");
    });
    for (const [id, status] of [["mark-attention", "needs-attention"], ["mark-missing", "missing"], ["mark-removed", "removed"]]) {
      elements.detail.querySelector(`#${id}`)?.addEventListener("click", async () => {
        const reason = elements.detail.querySelector("#placement-action-reason")?.value.trim();
        if (!reason) { setRegistryStatus(`Enter a status reason before marking the placement ${status}.`, true); return; }
        await mutateAndSave((draft) => transitionPlacement(draft, placement.id, status, { reason }), `Placement marked ${status}.`);
      });
    }
    elements.detail.querySelector("#create-replacement")?.addEventListener("click", async () => {
      await mutateAndSave((draft) => { activePlacementId = createReplacement(draft, placement.id, { reason: "Replaced from Sticker Studio" }).id; }, "Replacement planned with a new short code.");
    });
    elements.detail.querySelector("#verification-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await mutateAndSave((draft) => addVerification(draft, placement.id, {
        checker: "Field operator",
        condition: form.querySelector("#verify-condition").value,
        adhesion: "pass",
        qrResult: form.querySelector("#verify-qr").value,
        observedDestination: form.querySelector("#verify-destination").value || null,
        note: form.querySelector("#verify-note").value,
      }), "Verification recorded.");
    });
    elements.detail.querySelector("#placement-photo")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        setRegistryStatus("Optimizing field photo…");
        const photo = await uploadPlacementPhoto(placement.id, file);
        await mutateAndSave((draft) => {
          const target = draft.placements.find((item) => item.id === placement.id);
          target.photos.push({ ...photo, createdAt: new Date().toISOString() });
        }, "Field photo saved.");
      } catch (error) { setRegistryStatus(error.message, true); }
    });
  }

  async function mutateAndSave(mutator, successMessage) {
    const backup = structuredClone(registry);
    const expectedRevision = registry.revision;
    try {
      mutator(registry);
      validateRegistry(registry);
      setRegistryStatus("Saving…");
      registry = validateRegistry(await saveRegistry(registry, expectedRevision));
      setRegistryStatus(successMessage || `Saved revision ${registry.revision}.`);
      renderAll();
      onContextChange?.(publicApi().getActivePlacementContext());
    } catch (error) {
      registry = backup;
      if (error.status === 409) {
        try { registry = validateRegistry(await loadRegistry()); } catch {}
      }
      renderAll();
      setRegistryStatus(error.message, true);
      throw error;
    }
  }

  function updateMapSource(fit = false) {
    if (!mapReady || !map.getSource("sticker-locations")) return;
    const geojson = placementGeoJson(registry);
    map.getSource("sticker-locations").setData(geojson);
    if (fit && geojson.features.length) {
      const bounds = new window.mapboxgl.LngLatBounds();
      geojson.features.forEach((feature) => bounds.extend(feature.geometry.coordinates));
      map.fitBounds(bounds, { padding: 70, maxZoom: 14 });
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) { setRegistryStatus("This browser does not provide location.", true); return; }
    setRegistryStatus("Reading current location…");
    navigator.geolocation.getCurrentPosition((position) => {
      const coordinates = [position.coords.longitude, position.coords.latitude];
      openLocationDraft(coordinates);
      map?.easeTo({ center: coordinates, zoom: 16 });
      setRegistryStatus(`Location captured within approximately ${Math.round(position.coords.accuracy)} m.`);
    }, (error) => setRegistryStatus(`Location unavailable: ${error.message}`, true), { enableHighAccuracy: true, timeout: 12000 });
  }

  async function saveCampaign(event) {
    event.preventDefault();
    const name = document.querySelector("#campaign-name").value.trim();
    if (!name) return;
    await mutateAndSave((draft) => {
      const now = new Date().toISOString();
      draft.campaigns.push({ id: `campaign-${Date.now().toString(36)}`, name, objective: document.querySelector("#campaign-objective").value.trim(), status: "active", recheckDays: Number(document.querySelector("#campaign-recheck-days").value) || 90, createdAt: now, updatedAt: now });
    }, "Campaign created.");
    elements.campaignDialog.close();
    elements.campaignForm.reset();
  }

  function exportVerificationRoute() {
    const due = registry.locations.map((location) => {
      const placement = currentPlacement(registry.placements.filter((item) => item.locationId === location.id));
      return { location, placement, state: placement ? verificationState(registry, placement) : "planned" };
    }).filter((item) => ["unverified", "overdue", "failed"].includes(item.state));
    if (!due.length) { setRegistryStatus("No placed stickers are due for verification."); return; }
    const ordered = nearestNeighbor(due.map((item) => item.location));
    downloadJson({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Sticker verification route", count: ordered.length }, geometry: { type: "LineString", coordinates: ordered.map((location) => location.coordinates) } }, ...ordered.map((location, index) => ({ type: "Feature", properties: { order: index + 1, id: location.id, name: location.name }, geometry: { type: "Point", coordinates: location.coordinates } }))] }, "cycleways-sticker-verification-route.geojson", "application/geo+json");
  }

  function setRegistryStatus(message, isError = false) {
    elements.registryStatus.textContent = message;
    elements.registryStatus.classList.toggle("error", isError);
  }

  function disableRegistryActions() {
    elements.locationsWorkspace.querySelectorAll("button, input, select").forEach((control) => { control.disabled = true; });
  }

  return publicApi();
}

function priorityWeight(value) { return value === "high" ? 3 : value === "normal" ? 2 : 1; }
function candidateScore(location) {
  let score = location.priority === "high" ? 35 : location.priority === "normal" ? 22 : 10;
  score += location.permissionStatus === "approved" || location.permissionStatus === "not-required" ? 35 : location.permissionStatus === "needed" ? 10 : location.permissionStatus === "denied" ? 0 : 15;
  score += ["trailhead", "transit", "school", "business"].includes(location.type) ? 25 : 16;
  if (location.instructions || location.landmark) score += 5;
  return Math.min(100, score);
}
function nearestNeighbor(locations) {
  if (!locations.length) return [];
  const remaining = locations.slice(1);
  const ordered = [locations[0]];
  while (remaining.length) {
    const current = ordered[ordered.length - 1];
    let best = 0;
    let bestDistance = Infinity;
    remaining.forEach((candidate, index) => {
      const distance = (candidate.coordinates[0] - current.coordinates[0]) ** 2 + (candidate.coordinates[1] - current.coordinates[1]) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    });
    ordered.push(remaining.splice(best, 1)[0]);
  }
  return ordered;
}
function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function friendlyLabel(value) {
  const labels = { "not-required": "Not required", "community-board": "Community board", "bike-parking": "Bike parking", "route-page": "Route page", "campaign-page": "Campaign page" };
  return labels[value] || String(value || "—").replace(/-/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function downloadJson(value, filename, type = "application/json") { downloadText(`${JSON.stringify(value, null, 2)}\n`, filename, type); }
function downloadText(value, filename, type) { const url = URL.createObjectURL(new Blob([value], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
