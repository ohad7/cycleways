export const REGISTRY_SCHEMA_VERSION = 1;
export const PLACEMENT_STATUSES = [
  "planned",
  "assigned",
  "placed",
  "needs-attention",
  "missing",
  "removed",
];
export const LOCATION_TYPES = [
  "trailhead",
  "junction",
  "business",
  "school",
  "transit",
  "park",
  "community-board",
  "event",
  "other",
];
export const PERMISSION_STATUSES = [
  "unknown",
  "needed",
  "approved",
  "not-required",
  "denied",
];
export const QR_MODES = ["placement", "campaign", "shared", "none"];

const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ALLOWED_TRANSITIONS = {
  planned: new Set(["assigned", "removed"]),
  assigned: new Set(["placed", "removed"]),
  placed: new Set(["needs-attention", "missing", "removed"]),
  "needs-attention": new Set(["placed", "missing", "removed"]),
  missing: new Set(["removed"]),
  removed: new Set(),
};

export function emptyRegistry(now = new Date().toISOString()) {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    revision: 0,
    updatedAt: now,
    settings: {
      publicBaseUrl: "https://cycleways.app",
      defaultRecheckDays: 90,
    },
    campaigns: [
      {
        id: "campaign-general",
        name: "General placements",
        objective: "Cycleways awareness and route discovery",
        status: "active",
        recheckDays: 90,
        createdAt: now,
        updatedAt: now,
      },
    ],
    locations: [],
    designVersions: [],
    placements: [],
    scanEvents: [],
  };
}

export function validateRegistry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Sticker registry must be an object.");
  }
  if (input.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported sticker registry schema: ${input.schemaVersion}.`);
  }
  if (!Number.isInteger(input.revision) || input.revision < 0) {
    throw new Error("Sticker registry revision must be a non-negative integer.");
  }
  for (const key of ["campaigns", "locations", "designVersions", "placements", "scanEvents"]) {
    if (!Array.isArray(input[key])) throw new Error(`Sticker registry ${key} must be an array.`);
    assertUniqueIds(input[key], key);
  }

  const campaignIds = new Set(input.campaigns.map((item) => item.id));
  const locationIds = new Set(input.locations.map((item) => item.id));
  const designIds = new Set(input.designVersions.map((item) => item.id));
  const placementIds = new Set(input.placements.map((item) => item.id));
  const shortCodes = new Set();

  for (const location of input.locations) {
    assertId(location.id, "location");
    if (!campaignIds.has(location.campaignId)) throw new Error(`Location ${location.id} has an unknown campaign.`);
    if (!LOCATION_TYPES.includes(location.type)) throw new Error(`Location ${location.id} has an invalid type.`);
    if (!PERMISSION_STATUSES.includes(location.permissionStatus)) throw new Error(`Location ${location.id} has an invalid permission state.`);
    validateCoordinates(location.coordinates, `Location ${location.id}`);
  }

  for (const placement of input.placements) {
    assertId(placement.id, "placement");
    if (!locationIds.has(placement.locationId)) throw new Error(`Placement ${placement.id} has an unknown location.`);
    if (!PLACEMENT_STATUSES.includes(placement.status)) throw new Error(`Placement ${placement.id} has an invalid status.`);
    if (placement.designVersionId && !designIds.has(placement.designVersionId)) {
      throw new Error(`Placement ${placement.id} has an unknown design version.`);
    }
    if (!QR_MODES.includes(placement.qr?.mode || "none")) throw new Error(`Placement ${placement.id} has an invalid QR mode.`);
    if (placement.qr?.shortCode) {
      if (!/^[A-Z2-9]{5,10}$/.test(placement.qr.shortCode)) throw new Error(`Placement ${placement.id} has an invalid short code.`);
      if (shortCodes.has(placement.qr.shortCode)) throw new Error(`Duplicate short code ${placement.qr.shortCode}.`);
      shortCodes.add(placement.qr.shortCode);
    }
    if (["placed", "needs-attention", "missing"].includes(placement.status) || (placement.status === "removed" && placement.placedAt)) {
      if (!placement.placedAt || !placement.actualCoordinates) {
        throw new Error(`Placement ${placement.id} must retain placement time and coordinates.`);
      }
      validateCoordinates(placement.actualCoordinates, `Placement ${placement.id}`);
    }
    if (placement.replacesPlacementId && !placementIds.has(placement.replacesPlacementId)) {
      throw new Error(`Placement ${placement.id} replaces an unknown placement.`);
    }
  }
  return input;
}

export function createLocation(registry, fields, options = {}) {
  const now = options.now || new Date().toISOString();
  const campaignId = fields.campaignId || registry.campaigns[0]?.id;
  if (!registry.campaigns.some((campaign) => campaign.id === campaignId)) throw new Error("Choose a valid campaign.");
  validateCoordinates(fields.coordinates, "Location");
  const location = {
    id: fields.id || makeId("loc", options),
    campaignId,
    name: requiredText(fields.name, "Location name"),
    type: LOCATION_TYPES.includes(fields.type) ? fields.type : "other",
    coordinates: fields.coordinates.map(Number),
    accuracyM: numberOrNull(fields.accuracyM),
    permissionStatus: PERMISSION_STATUSES.includes(fields.permissionStatus) ? fields.permissionStatus : "unknown",
    priority: ["low", "normal", "high"].includes(fields.priority) ? fields.priority : "normal",
    plannedDate: fields.plannedDate || null,
    landmark: cleanText(fields.landmark),
    instructions: cleanText(fields.instructions),
    notes: cleanText(fields.notes),
    createdAt: now,
    updatedAt: now,
  };
  registry.locations.push(location);
  return location;
}

export function updateLocation(registry, locationId, patch, now = new Date().toISOString()) {
  const location = findById(registry.locations, locationId, "location");
  if (patch.coordinates) validateCoordinates(patch.coordinates, "Location");
  if (patch.permissionStatus && !PERMISSION_STATUSES.includes(patch.permissionStatus)) throw new Error("Invalid permission state.");
  if (patch.type && !LOCATION_TYPES.includes(patch.type)) throw new Error("Invalid location type.");
  if (patch.permissionStatus === "denied") {
    const active = registry.placements.some((placement) => placement.locationId === locationId && placement.status !== "removed");
    if (active) throw new Error("Remove the active placement before denying this location.");
  }
  Object.assign(location, patch, { updatedAt: now });
  location.name = requiredText(location.name, "Location name");
  return location;
}

export function createPlacement(registry, fields, options = {}) {
  const now = options.now || new Date().toISOString();
  const location = findById(registry.locations, fields.locationId, "location");
  if (location.permissionStatus === "denied") throw new Error("Denied locations cannot receive placements.");
  const mode = QR_MODES.includes(fields.qrMode) ? fields.qrMode : "placement";
  const existingCodes = new Set(registry.placements.map((item) => item.qr?.shortCode).filter(Boolean));
  const shortCode = mode === "placement"
    ? (fields.shortCode || generateShortCode(existingCodes, options.random))
    : null;
  const targetUrl = mode === "none" ? null : validateHttpsUrl(fields.targetUrl || "https://cycleways.app/");
  const placement = {
    id: fields.id || makeId("plc", options),
    locationId: location.id,
    designVersionId: null,
    status: "planned",
    qr: {
      mode,
      shortCode,
      encodedUrl: shortCode ? shortUrlFor(shortCode, registry.settings.publicBaseUrl) : targetUrl,
      targetUrl,
    },
    plannedAt: now,
    assignedAt: null,
    placedAt: null,
    actualCoordinates: null,
    removedAt: null,
    surfaceType: fields.surfaceType || "unknown",
    exposure: fields.exposure || "unknown",
    installer: cleanText(fields.installer),
    notes: cleanText(fields.notes),
    photos: [],
    verifications: [],
    history: [event("planned", now, fields.actor, fields.note)],
    scanCount: 0,
    lastScanAt: null,
    replacesPlacementId: fields.replacesPlacementId || null,
    replacedByPlacementId: null,
    createdAt: now,
    updatedAt: now,
  };
  registry.placements.push(placement);
  return placement;
}

export function upsertDesignVersion(registry, configuration, now = new Date().toISOString()) {
  const normalized = JSON.parse(stableStringify(configuration));
  const hash = fnv1a(stableStringify(normalized));
  const existing = registry.designVersions.find((version) => version.configurationHash === hash);
  if (existing) return existing;
  const version = {
    id: `design-${hash}`,
    configurationHash: hash,
    configuration: normalized,
    assetFilename: configuration.assetFilename || null,
    printBatchId: configuration.printBatchId || null,
    createdAt: now,
  };
  registry.designVersions.push(version);
  return version;
}

export function assignDesign(registry, placementId, designVersionId, now = new Date().toISOString(), actor = "") {
  const placement = findById(registry.placements, placementId, "placement");
  findById(registry.designVersions, designVersionId, "design version");
  if (placement.status !== "planned" && placement.status !== "assigned") {
    throw new Error("Only planned or assigned placements can receive a design.");
  }
  placement.designVersionId = designVersionId;
  placement.assignedAt = placement.assignedAt || now;
  if (placement.status === "planned") placement.status = "assigned";
  placement.updatedAt = now;
  placement.history.push(event("assigned", now, actor, `Design ${designVersionId}`));
  return placement;
}

export function transitionPlacement(registry, placementId, nextStatus, fields = {}, options = {}) {
  const placement = findById(registry.placements, placementId, "placement");
  const now = options.now || new Date().toISOString();
  if (!ALLOWED_TRANSITIONS[placement.status]?.has(nextStatus)) {
    throw new Error(`Cannot move a placement from ${placement.status} to ${nextStatus}.`);
  }
  if (nextStatus === "assigned" && !placement.designVersionId) throw new Error("Assign a design before marking the placement assigned.");
  if (nextStatus === "placed") {
    const coordinates = fields.actualCoordinates || placement.actualCoordinates;
    validateCoordinates(coordinates, "Actual placement");
    placement.actualCoordinates = coordinates.map(Number);
    placement.placedAt = fields.placedAt || placement.placedAt || now;
    placement.installer = cleanText(fields.installer || placement.installer);
  }
  if (["needs-attention", "missing", "removed"].includes(nextStatus) && !cleanText(fields.reason)) {
    throw new Error(`A reason is required when marking a placement ${nextStatus}.`);
  }
  if (nextStatus === "removed") placement.removedAt = now;
  placement.status = nextStatus;
  placement.updatedAt = now;
  placement.history.push(event(nextStatus, now, fields.actor, fields.reason));
  return placement;
}

export function addVerification(registry, placementId, fields, options = {}) {
  const placement = findById(registry.placements, placementId, "placement");
  if (!['placed', 'needs-attention'].includes(placement.status)) throw new Error("Only placed stickers can be verified.");
  const now = options.now || new Date().toISOString();
  const verification = {
    id: fields.id || makeId("verify", options),
    checkedAt: fields.checkedAt || now,
    checker: requiredText(fields.checker || "Field operator", "Checker"),
    condition: ["good", "faded", "damaged", "obstructed", "missing"].includes(fields.condition) ? fields.condition : "good",
    adhesion: ["pass", "fail", "not-applicable"].includes(fields.adhesion) ? fields.adhesion : "pass",
    qrResult: ["passed", "failed", "not-applicable"].includes(fields.qrResult) ? fields.qrResult : "passed",
    expectedDestination: placement.qr?.targetUrl || null,
    observedDestination: fields.observedDestination ? validateHttpsUrl(fields.observedDestination) : null,
    note: cleanText(fields.note),
    photoRef: fields.photoRef || null,
  };
  placement.verifications.push(verification);
  const failed = verification.condition !== "good" || verification.adhesion === "fail" || verification.qrResult === "failed";
  if (failed && placement.status === "placed") {
    placement.status = verification.condition === "missing" ? "missing" : "needs-attention";
  } else if (!failed && placement.status === "needs-attention") {
    placement.status = "placed";
  }
  placement.updatedAt = now;
  placement.history.push(event(failed ? "verification-failed" : "verified", now, verification.checker, verification.note));
  return verification;
}

export function createReplacement(registry, placementId, fields = {}, options = {}) {
  const previous = findById(registry.placements, placementId, "placement");
  const now = options.now || new Date().toISOString();
  if (!previous.placedAt) throw new Error("Only a previously placed sticker can be replaced.");
  if (previous.status !== "removed") {
    if (!ALLOWED_TRANSITIONS[previous.status]?.has("removed")) throw new Error("This placement cannot be replaced.");
    transitionPlacement(registry, previous.id, "removed", { reason: fields.reason || "Replaced", actor: fields.actor }, { now });
  }
  const replacement = createPlacement(registry, {
    locationId: previous.locationId,
    qrMode: previous.qr?.mode || "placement",
    targetUrl: fields.targetUrl || previous.qr?.targetUrl,
    replacesPlacementId: previous.id,
    surfaceType: previous.surfaceType,
    exposure: previous.exposure,
    actor: fields.actor,
    note: `Replacement for ${previous.id}`,
  }, { ...options, now });
  previous.replacedByPlacementId = replacement.id;
  previous.updatedAt = now;
  return replacement;
}

export function verificationState(registry, placement, now = new Date()) {
  if (["planned", "assigned", "removed"].includes(placement.status)) return placement.status;
  if (["needs-attention", "missing"].includes(placement.status)) return "failed";
  const latest = [...(placement.verifications || [])].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  if (!latest) return "unverified";
  const location = registry.locations.find((item) => item.id === placement.locationId);
  const campaign = registry.campaigns.find((item) => item.id === location?.campaignId);
  const days = campaign?.recheckDays || registry.settings?.defaultRecheckDays || 90;
  const dueAt = new Date(latest.checkedAt).getTime() + days * 86400000;
  return now.getTime() > dueAt ? "overdue" : "verified";
}

export function placementGeoJson(registry) {
  return {
    type: "FeatureCollection",
    features: registry.locations.map((location) => {
      const placements = registry.placements.filter((item) => item.locationId === location.id);
      const current = currentPlacement(placements);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: location.coordinates },
        properties: {
          id: location.id,
          name: location.name,
          type: location.type,
          campaignId: location.campaignId,
          permissionStatus: location.permissionStatus,
          placementId: current?.id || "",
          placementStatus: current?.status || "planned",
          verificationState: current ? verificationState(registry, current) : "planned",
          priority: location.priority,
        },
      };
    }),
  };
}

export function dashboardStats(registry, now = new Date()) {
  const stats = { locations: registry.locations.length, planned: 0, assigned: 0, placed: 0, verified: 0, attention: 0, overdue: 0, scans: registry.placements.reduce((sum, placement) => sum + (placement.scanCount || 0), 0) };
  for (const location of registry.locations) {
    const placement = currentPlacement(registry.placements.filter((item) => item.locationId === location.id));
    if (!placement) { stats.planned += 1; continue; }
    if (placement.status === "planned") stats.planned += 1;
    if (placement.status === "assigned") stats.assigned += 1;
    if (placement.status === "placed") stats.placed += 1;
    if (["needs-attention", "missing"].includes(placement.status)) stats.attention += 1;
    const check = verificationState(registry, placement, now);
    if (check === "verified") stats.verified += 1;
    if (check === "overdue") stats.overdue += 1;
  }
  return stats;
}

export function publicRedirectsFromRegistry(registry, generatedAt = new Date().toISOString()) {
  const redirects = {};
  for (const placement of registry.placements) {
    const code = placement.qr?.shortCode;
    const targetUrl = placement.qr?.targetUrl;
    if (!code || !targetUrl) continue;
    redirects[code] = {
      targetUrl,
      active: placement.status !== "removed",
      designVersionId: placement.designVersionId || null,
    };
  }
  return { schemaVersion: 1, generatedAt, redirects };
}

export function resolveShortCode(publicRegistry, code) {
  const normalized = String(code || "").trim().toUpperCase();
  const entry = publicRegistry?.redirects?.[normalized];
  if (!entry?.targetUrl) return null;
  return { code: normalized, ...entry };
}

export function recordScan(registry, shortCode, now = new Date().toISOString()) {
  const placement = registry.placements.find((item) => item.qr?.shortCode === String(shortCode || "").toUpperCase());
  if (!placement) throw new Error("Unknown sticker short code.");
  placement.scanCount = (placement.scanCount || 0) + 1;
  placement.lastScanAt = now;
  placement.updatedAt = now;
  registry.scanEvents.push({ id: `scan-${placement.id}-${placement.scanCount}`, placementId: placement.id, scannedAt: now });
  return placement;
}

export function shortUrlFor(code, baseUrl = "https://cycleways.app") {
  return new URL(`/s/${String(code).toUpperCase()}`, baseUrl).href;
}

export function generateShortCode(existingCodes = new Set(), random = Math.random, length = 6) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let index = 0; index < length; index += 1) {
      code += SHORT_CODE_ALPHABET[Math.floor(random() * SHORT_CODE_ALPHABET.length) % SHORT_CODE_ALPHABET.length];
    }
    if (!existingCodes.has(code)) return code;
  }
  throw new Error("Could not allocate a unique sticker short code.");
}

export function fieldPackCsv(registry) {
  const rows = [["location_id", "location", "status", "placement_id", "short_code", "design_version", "planned_date", "latitude", "longitude", "instructions"]];
  for (const location of registry.locations) {
    const placement = currentPlacement(registry.placements.filter((item) => item.locationId === location.id));
    rows.push([
      location.id, location.name, placement?.status || "planned", placement?.id || "",
      placement?.qr?.shortCode || "", placement?.designVersionId || "", location.plannedDate || "",
      location.coordinates[1], location.coordinates[0], location.instructions || "",
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function currentPlacement(placements) {
  return [...placements].sort((a, b) => {
    const aActive = a.status === "removed" ? 0 : 1;
    const bActive = b.status === "removed" ? 0 : 1;
    return bActive - aActive || String(b.createdAt).localeCompare(String(a.createdAt));
  })[0] || null;
}

function event(type, timestamp, actor = "", note = "") {
  return { type, timestamp, actor: cleanText(actor), note: cleanText(note) };
}

function makeId(prefix, options = {}) {
  if (options.id) return options.id;
  const random = options.random || Math.random;
  const stamp = (options.now || new Date().toISOString()).replace(/\D/g, "").slice(0, 14);
  return `${prefix}-${stamp}-${Math.floor(random() * 0xffffff).toString(36).padStart(5, "0")}`;
}

function assertUniqueIds(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (!item?.id) throw new Error(`${label} contains an item without an ID.`);
    if (seen.has(item.id)) throw new Error(`${label} contains duplicate ID ${item.id}.`);
    seen.add(item.id);
  }
}

function assertId(value, label) {
  if (!new RegExp(`^${label === "location" ? "loc" : "plc"}-[a-z0-9-]+$`, "i").test(value)) throw new Error(`Invalid ${label} ID ${value}.`);
}

function findById(items, id, label) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown ${label}: ${id}.`);
  return item;
}

function validateCoordinates(value, label) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} coordinates must be [longitude, latitude].`);
  const [lng, lat] = value.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new Error(`${label} coordinates are invalid.`);
  }
}

function validateHttpsUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error("Enter a valid destination URL."); }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error("Sticker destinations must use HTTPS.");
  return url.href;
}

function requiredText(value, label) {
  const text = cleanText(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function cleanText(value) {
  return String(value || "").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
