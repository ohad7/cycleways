const token = new URLSearchParams(location.search).get("token");
const authUrl = (path) => `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
const $ = (selector) => document.querySelector(selector);

let state;
let draftShowcases = [];
let activeShowcaseId = null;
let draftChanged = false;
let mediaDurationMs = 0;
let selectedAttempt = null;
let seekToShowcaseOnLoad = true;
let localShowcaseNumber = 100;
let syncingVideos = false;
let trimShowcaseId = null;
let trimAllowedBounds = null;
let trimDraft = null;
let activeSourceId = null;
let pendingGlobalSeekMs = null;
let restoringRevision = null;
let statePoll = null;

function sourceClips() {
  return (state?.media?.sources || []).map((clip, index) => {
    const timeline = clip.timeline || state?.artifacts?.mediaTimeline?.clips?.find((item) => item.id === clip.id)?.timeline;
    return {
      ...clip,
      timeline: timeline || {
        inMs: index === 0 ? 0 : Number.MAX_SAFE_INTEGER,
        outMs: index === 0 ? mediaDurationMs : Number.MAX_SAFE_INTEGER,
        sourceInMs: 0,
        sourceOutMs: index === 0 ? mediaDurationMs : 0,
        durationMs: index === 0 ? mediaDurationMs : 0,
      },
    };
  });
}

function activeSource() {
  return sourceClips().find((clip) => clip.id === activeSourceId) || sourceClips()[0] || null;
}

function globalSourceTime() {
  const clip = activeSource();
  if (!clip) return Math.round($("#source-video").currentTime * 1000);
  return Math.round(clip.timeline.inMs + $("#source-video").currentTime * 1000 - clip.timeline.sourceInMs);
}

function clipForGlobalTime(value) {
  const ms = Number(value);
  const clips = sourceClips();
  return clips.find((clip, index) =>
    ms >= clip.timeline.inMs &&
    (ms < clip.timeline.outMs || (index === clips.length - 1 && ms <= clip.timeline.outMs))
  ) || clips[0] || null;
}

function loadSourceClip(clip, globalMs, { play = false } = {}) {
  if (!clip) return;
  const video = $("#source-video");
  const desired = new URL(clip.url, location.href).href;
  pendingGlobalSeekMs = Number(globalMs);
  const wasPlaying = play || !video.paused;
  const sourceChanged = activeSourceId !== clip.id;
  activeSourceId = clip.id;
  if (video.src !== desired) {
    video.src = clip.url;
    video.dataset.resumePlay = wasPlaying ? "true" : "false";
  } else {
    const localMs = clip.timeline.sourceInMs + Number(globalMs) - clip.timeline.inMs;
    video.currentTime = Math.max(0, localMs) / 1000;
    pendingGlobalSeekMs = null;
    if (wasPlaying) video.play().catch(() => {});
  }
  if (sourceChanged && state && $("#route-map")) {
    drawMap();
    syncMap(globalMs);
  }
}

function seekSourceGlobal(value, options = {}) {
  const clip = clipForGlobalTime(value);
  loadSourceClip(clip, value, options);
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2400);
}

function time(value, { milliseconds = true } = {}) {
  const ms = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const prefix = hours ? `${String(hours).padStart(2, "0")}:` : "";
  return `${prefix}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${milliseconds ? `.${String(ms % 1000).padStart(3, "0")}` : ""}`;
}

function durationText(value) {
  const seconds = Math.max(0, Math.round(Number(value) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function parseTime(value) {
  const parts = String(value).trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => part === "" || !Number.isFinite(Number(part)))) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + Number(part);
  return seconds >= 0 ? Math.round(seconds * 1000) : null;
}

async function request(path, options = {}) {
  const response = await fetch(authUrl(path), { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function sortedShowcases() {
  return [...draftShowcases].sort((left, right) => left.inMs - right.inMs);
}

function activeShowcase() {
  return draftShowcases.find((showcase) => showcase.id === activeShowcaseId) || sortedShowcases()[0] || null;
}

function hasOverlap() {
  const ordered = sortedShowcases();
  return ordered.some((showcase, index) => index > 0 && showcase.inMs < ordered[index - 1].outMs);
}

function blockingTelemetryRanges() {
  return [
    ...(state?.artifacts?.track?.warnings || []).filter((warning) => warning.code === "gps-unavailable"),
    ...(state?.artifacts?.rideValidation?.eligibility?.warnings || []).filter((warning) => warning.code === "route-mismatch"),
  ].filter((warning) =>
    Number.isFinite(Number(warning.fromMs)) &&
    Number.isFinite(Number(warning.toMs))
  );
}

function telemetryBlockAt(ms) {
  return blockingTelemetryRanges().find((range) => ms >= Number(range.fromMs) && ms <= Number(range.toMs)) || null;
}

function telemetryBlockForSegment(segment) {
  return blockingTelemetryRanges().find((range) =>
    Number(range.toMs) > Number(segment.inMs) &&
    Number(range.fromMs) < Number(segment.outMs)
  ) || null;
}

function pointsToPath(points, bounds) {
  return (points || []).map((point, index) => {
    const x = 40 + ((point.lng - bounds.minLng) / Math.max(1e-9, bounds.maxLng - bounds.minLng)) * 720;
    const y = 560 - ((point.lat - bounds.minLat) / Math.max(1e-9, bounds.maxLat - bounds.minLat)) * 520;
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function splitTrackSegments(points, maxGapMs = 15_000) {
  const segments = [];
  let current = [];
  for (const point of points || []) {
    const previous = current.at(-1);
    if (previous && (
      point.sourceId !== previous.sourceId ||
      point.timestamp - previous.timestamp > maxGapMs
    )) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

function drawMap() {
  const route = state.artifacts.route?.geometry || [];
  const track = state.artifacts.track?.fixes || [];
  const clip = activeSource();
  const clipTrack = clip ? track.filter((point) => point.sourceId === clip.id) : track;
  const clipMismatch = clip && blockingTelemetryRanges().find((range) =>
    range.code === "route-mismatch" &&
    range.sourceId === clip.id &&
    range.fromMs <= clip.timeline.inMs &&
    range.toMs >= clip.timeline.outMs
  );
  const visibleTrack = clipMismatch && route.length ? [] : clipTrack;
  const all = [...route, ...visibleTrack];
  if (!all.length) {
    $("#route-map").innerHTML = '<text x="400" y="300" text-anchor="middle" fill="#95aa9f">Run inspect to see the GPS track</text>';
    return;
  }
  const bounds = {
    minLat: Math.min(...all.map((point) => point.lat)), maxLat: Math.max(...all.map((point) => point.lat)),
    minLng: Math.min(...all.map((point) => point.lng)), maxLng: Math.max(...all.map((point) => point.lng)),
  };
  const ordered = sortedShowcases();
  const preRollMs = Math.max(0, Number(state.project.inputs.story.proof?.preRollMs) || 0);
  const captureEnvelope = ordered.length ? { inMs: Math.max(0, ordered[0].inMs - preRollMs), outMs: ordered.at(-1).outMs } : null;
  const captureTrack = captureEnvelope
    ? visibleTrack.filter((point) => point.timestamp >= captureEnvelope.inMs && point.timestamp <= captureEnvelope.outMs)
    : visibleTrack;
  const routePath = route.length ? `<path d="${pointsToPath(route, bounds)}" fill="none" stroke="#365348" stroke-width="10" stroke-linecap="round"/>` : "";
  const trackPaths = splitTrackSegments(visibleTrack).map((segment) =>
    `<path d="${pointsToPath(segment, bounds)}" fill="none" stroke="#71837a" stroke-width="3" stroke-linecap="round" opacity=".65"/>`
  ).join("");
  const capturePaths = splitTrackSegments(captureTrack).map((segment) =>
    `<path d="${pointsToPath(segment, bounds)}" fill="none" stroke="#b8f34a" stroke-width="5" stroke-linecap="round"/>`
  ).join("");
  const mismatchNotice = clipMismatch
    ? `<text x="400" y="540" text-anchor="middle" fill="#ff9f91" font-size="22">Clip ${sourceClips().findIndex((item) => item.id === clip.id) + 1} GPS does not match this route</text>`
    : "";
  $("#route-map").innerHTML = `${routePath}${trackPaths}${capturePaths}<circle id="map-fix" r="9" fill="#fff" stroke="#08130f" stroke-width="4"/>${mismatchNotice}`;
  $("#route-map").dataset.bounds = JSON.stringify(bounds);
}

function renderSourceDiagnostics() {
  const node = $("#source-quality");
  const routeCodes = state.artifacts.rideValidation?.sourceDiagnostics?.nonBlockingGateCodes || [];
  const navigation = state.artifacts.navigation?.sourceDiagnostics;
  const notes = [];
  if (routeCodes.includes("route-fit-p95") || routeCodes.includes("route-fit-max")) notes.push("route mismatch");
  if (routeCodes.includes("gps-gaps")) notes.push("GPS gaps");
  if (navigation?.forbiddenStatusOutsideCaptureCount) notes.push(`${navigation.forbiddenStatusOutsideCaptureCount} navigation error event${navigation.forbiddenStatusOutsideCaptureCount === 1 ? "" : "s"}`);
  if (navigation?.offRouteOutsideCaptureCount) notes.push(`${navigation.offRouteOutsideCaptureCount} off-route event${navigation.offRouteOutsideCaptureCount === 1 ? "" : "s"}`);
  node.hidden = draftChanged || notes.length === 0;
  if (!node.hidden) node.textContent = `Source note: ${notes.join(", ")} occur outside the selected demo. They are shown by the muted track and do not block capture.`;
}

function syncMap(mediaMs) {
  const clip = activeSource();
  const fixes = (state.artifacts.track?.fixes || []).filter((fix) => !clip || fix.sourceId === clip.id);
  const marker = $("#map-fix");
  if (!fixes.length || !marker) return;
  if (telemetryBlockAt(mediaMs)?.code === "route-mismatch") {
    marker.setAttribute("visibility", "hidden");
    return;
  }
  marker.removeAttribute("visibility");
  const fix = fixes.reduce((best, item) => Math.abs(item.timestamp - mediaMs) < Math.abs(best.timestamp - mediaMs) ? item : best, fixes[0]);
  const bounds = JSON.parse($("#route-map").dataset.bounds);
  marker.setAttribute("cx", 40 + ((fix.lng - bounds.minLng) / Math.max(1e-9, bounds.maxLng - bounds.minLng)) * 720);
  marker.setAttribute("cy", 560 - ((fix.lat - bounds.minLat) / Math.max(1e-9, bounds.maxLat - bounds.minLat)) * 520);
}

function sourceBounds() {
  const trim = state.project.inputs.source.trim;
  const trackEnd = state.artifacts.track?.fixes?.at(-1)?.timestamp || 0;
  const selectedEnd = Math.max(0, ...draftShowcases.map((showcase) => showcase.outMs));
  return {
    min: Math.max(0, Math.round((Number(trim.inSeconds) || 0) * 1000)),
    max: Math.max(selectedEnd, Math.round((Number(trim.outSeconds) || 0) * 1000), mediaDurationMs, trackEnd),
  };
}

function renderShowcaseList() {
  const ordered = sortedShowcases();
  $("#showcase-list").innerHTML = ordered.map((showcase, index) => `
    <div class="showcase-item ${showcase.id === activeShowcaseId ? "active" : ""}" data-showcase-id="${showcase.id}">
      <button class="showcase-select" data-action="select" data-showcase-id="${showcase.id}">
        <span class="showcase-number">${index + 1}</span>
        <span class="showcase-time">${time(showcase.inMs, { milliseconds: false })} → ${time(showcase.outMs, { milliseconds: false })} · ${durationText(showcase.outMs - showcase.inMs)}</span>
      </button>
      <div class="showcase-actions">
        <button data-action="jump" data-showcase-id="${showcase.id}">View</button>
        <button data-action="remove" data-showcase-id="${showcase.id}" ${ordered.length === 1 ? "disabled" : ""}>Remove</button>
      </div>
    </div>`).join("");
}

function renderTimelineBands() {
  const span = Math.max(1, sourceBounds().max);
  const clips = sourceClips().map((clip, index) => {
    const left = Math.max(0, Math.min(100, Number(clip.timeline.inMs) / span * 100));
    const width = Math.max(0, Math.min(100 - left, (Number(clip.timeline.outMs) - Number(clip.timeline.inMs)) / span * 100));
    const shortName = String(clip.name || clip.id).replace(/\.[^.]+$/, "");
    return `<div class="clip-span" style="left:${left}%;width:${width}%" title="Clip ${index + 1}: ${clip.name || clip.id}"><span>${index + 1} · ${shortName}</span></div>`;
  });
  const unavailable = blockingTelemetryRanges().map((range) => {
    const left = Math.max(0, Math.min(100, Number(range.fromMs) / span * 100));
    const width = Math.max(0, Math.min(100 - left, (Number(range.toMs) - Number(range.fromMs)) / span * 100));
    const className = range.code === "route-mismatch" ? "route-mismatch-band" : "gps-unavailable-band";
    const title = range.code === "route-mismatch" ? "GPS does not match selected route" : "GPS unavailable";
    return `<div class="${className}" style="left:${left}%;width:${width}%" title="${title}"></div>`;
  });
  const selected = sortedShowcases().map((showcase) => {
    const left = Math.max(0, Math.min(100, showcase.inMs / span * 100));
    const width = Math.max(0, Math.min(100 - left, (showcase.outMs - showcase.inMs) / span * 100));
    return `<div class="selection-band ${showcase.id === activeShowcaseId ? "active" : ""}" style="left:${left}%;width:${width}%"></div>`;
  });
  $("#selection-bands").innerHTML = [...clips, ...unavailable, ...selected].join("");
}

function updateSelection() {
  const current = activeShowcase();
  if (!current) return;
  const ordered = sortedShowcases();
  const activeIndex = ordered.findIndex((showcase) => showcase.id === current.id);
  const length = current.outMs - current.inMs;
  const totalLength = ordered.reduce((sum, showcase) => sum + showcase.outMs - showcase.inMs, 0);
  $("#editing-label").textContent = `Editing showcase ${activeIndex + 1} of ${ordered.length}`;
  $("#start-value").textContent = time(current.inMs, { milliseconds: false });
  $("#end-value").textContent = time(current.outMs, { milliseconds: false });
  $("#duration-value").textContent = durationText(length);
  $("#selection-readout").textContent = `${ordered.length} showcase${ordered.length === 1 ? "" : "s"} · ${durationText(totalLength)} final`;
  renderShowcaseList();
  renderTimelineBands();

  const warnings = state.artifacts.track?.warnings;
  const gaps = Array.isArray(warnings) ? warnings.filter((warning) => warning.toMs > current.inMs && warning.fromMs < current.outMs) : null;
  const telemetryBlock = telemetryBlockForSegment(current);
  const quality = $("#selection-quality");
  quality.className = "quality";
  const notes = [];
  if (telemetryBlock) {
    notes.push(telemetryBlock.code === "route-mismatch"
      ? `This clip's GPS does not match the selected route. Move the showcase outside the orange striped timeline area.`
      : `GPS is unusable between ${time(telemetryBlock.fromMs, { milliseconds: false })} and ${time(telemetryBlock.toMs, { milliseconds: false })}. Move this showcase outside the striped timeline area.`);
    quality.classList.add("blocked");
  } else if (hasOverlap()) {
    notes.push("Two showcases overlap. Move a start or end before saving.");
    quality.classList.add("warning");
  } else if (gaps === null) notes.push("GPS quality will appear after inspection.");
  else if (gaps.length) {
    notes.push(`${gaps.length} GPS gap${gaps.length === 1 ? "" : "s"} overlap${gaps.length === 1 ? "s" : ""} this showcase. Watch the map while playing.`);
    quality.classList.add("warning");
  } else {
    notes.push("GPS looks continuous in this showcase.");
    quality.classList.add("good");
  }
  if (length < 15_000) {
    notes.push("This showcase may feel too short.");
    quality.classList.remove("good");
    quality.classList.add("warning");
  } else if (length > 240_000) {
    notes.push("Consider a shorter cut so the demo stays focused.");
    quality.classList.remove("good");
    quality.classList.add("warning");
  }
  quality.textContent = notes.join(" ");
  renderSourceDiagnostics();
  $("#add-showcase").disabled = ordered.length >= 6;
  $("#save-selection").disabled = !draftChanged || hasOverlap() || ordered.some((showcase) => showcase.outMs <= showcase.inMs || telemetryBlockForSegment(showcase));
  renderNextStep();
  drawMap();
  syncMap(globalSourceTime());
}

function renderNextStep() {
  const next = String(state.status.next || "");
  const navigationReady = state.project.stages.navigation.state === "ready";
  const inputsAccepted = state.project.stages.inputs.state === "accepted";
  $("#approve-inputs").hidden = !navigationReady || inputsAccepted;
  if (next.includes("validate")) {
    $("#next-step").textContent = draftChanged
      ? "Save these showcases, then start validation from the workflow above."
      : "Next: start validation from the workflow above, then approve the reviewed inputs here.";
  } else if (navigationReady && !inputsAccepted) {
    $("#next-step").textContent = "Navigation is ready. Approve these showcases to continue to capture.";
  } else if (inputsAccepted && next.includes("capture")) {
    $("#next-step").textContent = "Showcases approved. Start app capture from the workflow above.";
  } else $("#next-step").textContent = `Next: ${next.replace("demo:studio ", "")} from the workflow above.`;
}

function selectedAttemptDetails() {
  const attempt = Object.values(state.project.attempts).flat().find((item) => item.id === selectedAttempt);
  return { attempt, meta: state.attemptMeta?.[selectedAttempt] };
}

function trimCaptureDetails() {
  const selected = selectedAttemptDetails();
  if (selected.meta?.kind === "capture" && selected.meta.canTrim) {
    return { attemptId: selectedAttempt, meta: selected.meta };
  }
  const captureAttemptId = state.project.accepted?.capture || state.project.stages.capture?.attemptId;
  const meta = state.attemptMeta?.[captureAttemptId];
  return meta?.canTrim ? { attemptId: captureAttemptId, meta } : null;
}

function setMapVisible(visible) {
  $("#route-map").toggleAttribute("hidden", !visible);
  $("#attempt-video").hidden = visible;
}

function captureOriginMs(meta) {
  const value = Number(meta?.captureWindow?.inMs);
  return Number.isFinite(value) ? value : Number(state.project.inputs.story.proof.inMs);
}

function roadTimeForAttemptMs(attemptMs, meta) {
  if (meta?.kind === "render") {
    let remainingMs = attemptMs;
    for (const showcase of sortedShowcases()) {
      const duration = showcase.outMs - showcase.inMs;
      if (remainingMs <= duration) return showcase.inMs + remainingMs;
      remainingMs -= duration;
    }
    return sortedShowcases().at(-1)?.outMs;
  }
  if (meta?.sync) return captureOriginMs(meta) + Math.max(0, attemptMs - meta.sync.endMs);
  return null;
}

function attemptTimeForRoadMs(roadMs, meta) {
  if (meta?.kind === "render") {
    let outputMs = 0;
    for (const showcase of sortedShowcases()) {
      if (roadMs >= showcase.inMs && roadMs <= showcase.outMs) return outputMs + roadMs - showcase.inMs;
      outputMs += showcase.outMs - showcase.inMs;
    }
    return null;
  }
  if (meta?.sync) return meta.sync.endMs + roadMs - captureOriginMs(meta);
  return null;
}

function syncAttemptToRoad(roadMs) {
  if (syncingVideos || $("#attempt-video").hidden) return;
  const { meta } = selectedAttemptDetails();
  const attemptMs = attemptTimeForRoadMs(roadMs, meta);
  if (!Number.isFinite(attemptMs) || attemptMs < 0) return;
  const video = $("#attempt-video");
  if (video.readyState && Math.abs(video.currentTime * 1000 - attemptMs) > 120) {
    syncingVideos = true;
    video.currentTime = Math.min(attemptMs / 1000, Number.isFinite(video.duration) ? video.duration : attemptMs / 1000);
    syncingVideos = false;
  }
}

function renderReviewShowcases() {
  const canTrim = Boolean(trimCaptureDetails());
  $("#review-showcases").innerHTML = sortedShowcases().map((showcase, index) => `
    <div class="review-showcase ${showcase.id === activeShowcaseId ? "active" : ""}">
      <button class="review-showcase-jump" data-review-showcase="${showcase.id}">
        <span class="showcase-number">${index + 1}</span>
        <span>${time(showcase.inMs, { milliseconds: false })} · ${durationText(showcase.outMs - showcase.inMs)}</span>
      </button>
      ${canTrim ? `<button class="review-showcase-edit" data-edit-showcase="${showcase.id}">Edit</button>` : ""}
    </div>`).join("");
}

function trimValidation() {
  const startMs = parseTime($("#trim-start-text").value);
  const endMs = parseTime($("#trim-end-text").value);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return { error: "Use a time such as 02:33.500." };
  if (
    startMs < trimAllowedBounds.min ||
    startMs > trimAllowedBounds.max ||
    endMs < trimAllowedBounds.min ||
    endMs > trimAllowedBounds.max
  ) {
    return { error: `Keep this showcase between ${time(trimAllowedBounds.min)} and ${time(trimAllowedBounds.max)}.` };
  }
  if (endMs - startMs < 1000) return { error: "A showcase must be at least one second long." };
  return { startMs, endMs };
}

function updateTrimUi({ seekTo = null, normalize = true } = {}) {
  const result = trimValidation();
  const error = $("#trim-error");
  error.hidden = !result.error;
  error.textContent = result.error || "";
  $("#trim-save").disabled = Boolean(result.error);
  if (result.error) return;
  trimDraft = { inMs: result.startMs, outMs: result.endMs };
  if (normalize) {
    $("#trim-start-text").value = time(result.startMs);
    $("#trim-end-text").value = time(result.endMs);
  }
  $("#trim-start-range").max = Math.max(trimAllowedBounds.min, result.endMs - 1000);
  $("#trim-end-range").min = Math.min(trimAllowedBounds.max, result.startMs + 1000);
  $("#trim-start-range").value = result.startMs;
  $("#trim-end-range").value = result.endMs;
  $("#trim-duration").textContent = `${durationText(result.endMs - result.startMs)} selected`;
  if (Number.isFinite(seekTo)) {
    seekSourceGlobal(seekTo);
    syncAttemptToRoad(seekTo);
  }
}

function openTrimModal(showcaseId) {
  const capture = trimCaptureDetails();
  const ordered = sortedShowcases();
  const index = ordered.findIndex((showcase) => showcase.id === showcaseId);
  if (!capture || index < 0) return toast("This capture cannot be trimmed");
  const showcase = ordered[index];
  const captureWindow = capture.meta.captureWindow;
  trimShowcaseId = showcase.id;
  trimAllowedBounds = {
    min: Math.max(Number(captureWindow.inMs), Number(ordered[index - 1]?.outMs) || -Infinity),
    max: Math.min(Number(captureWindow.outMs), Number(ordered[index + 1]?.inMs) || Infinity),
    captureAttemptId: capture.attemptId,
  };
  trimDraft = { inMs: showcase.inMs, outMs: showcase.outMs };
  $("#trim-title").textContent = `Trim showcase ${index + 1}`;
  $("#trim-intro").textContent = `Adjust this cut inside ${capture.attemptId}. Saving reuses the app recording—no recapture.`;
  $("#trim-bounds").textContent = `Allowed ${time(trimAllowedBounds.min)} → ${time(trimAllowedBounds.max)}`;
  $("#trim-start-range").min = trimAllowedBounds.min;
  $("#trim-end-range").max = trimAllowedBounds.max;
  $("#trim-start-text").value = time(showcase.inMs);
  $("#trim-end-text").value = time(showcase.outMs);
  updateTrimUi();
  $("#source-video").pause();
  $("#trim-modal").showModal();
}

function closeTrimModal() {
  if ($("#trim-modal").open) $("#trim-modal").close();
  trimShowcaseId = null;
  trimAllowedBounds = null;
  trimDraft = null;
}

function renderReviewMode(meta) {
  const mode = meta?.kind || "selection";
  document.body.dataset.reviewMode = mode;
  $(".selection-panel").hidden = mode !== "selection";
  $("#page-step").textContent = mode === "selection" ? "CycleWays Demo Studio" : mode === "render" ? "FINAL REVIEW" : "SYNC REVIEW";
  $("#page-title").textContent = mode === "selection" ? "Choose your showcases" : mode === "render" ? "Review the finished demo" : "Check the ride and app sync";
  document.title = mode === "selection" ? "Choose your CycleWays showcases" : mode === "render" ? "Review the CycleWays demo" : "Review CycleWays synchronization";
}

function renderAttempt() {
  const video = $("#attempt-video");
  const { attempt, meta } = selectedAttemptDetails();
  renderReviewMode(attempt ? meta : null);
  if (!attempt || !state.media.attempts[selectedAttempt]) {
    setMapVisible(true);
    $("#secondary-label").textContent = "GPS TRACK";
    return;
  }
  setMapVisible(false);
  if (video.src !== new URL(state.media.attempts[selectedAttempt], location.href).href) video.src = state.media.attempts[selectedAttempt];
  $("#secondary-label").textContent = meta?.kind === "render" ? "FINAL VIDEO" : "APP RECORDING";
  $("#attempt-step").textContent = meta?.kind === "render" ? "FINAL REVIEW" : "SYNC CHECK";
  $("#attempt-title").textContent = meta?.kind === "render" ? "Review the finished demo" : "Review ride and app together";
  $("#attempt-intro").textContent = meta?.kind === "render"
    ? "Play the finished edit beside the ride source and check every selected showcase."
    : "Play or scrub either video. Their playheads stay linked so you can check that navigation matches the ride.";
  $("#sync-detail").textContent = meta?.kind === "render" && draftShowcases.length > 1
    ? "The selected showcases are joined with visible transitions."
    : meta?.sync ? "The ride and app playheads are linked." : "Playback is ready for a visual check.";
  const accepted = state.project.accepted?.[meta?.kind]?.attemptId === attempt.id || state.project.accepted?.[meta?.kind] === attempt.id;
  $("#accept-attempt").disabled = accepted || attempt.state !== "completed" || Boolean(attempt.staleAtRevision);
  $("#accept-attempt").textContent = accepted ? "Accepted" : meta?.kind === "render" ? "Accept final video" : "Accept sync";
  $("#reject-attempt").disabled = attempt.state !== "completed";
  const activeJob = state.jobs?.find((job) => ["running", "cancelling"].includes(job.state));
  const canRetryCapture = meta?.kind === "capture" &&
    attempt.state === "completed" &&
    !attempt.staleAtRevision &&
    state.project.stages.inputs.state === "accepted";
  $("#retry-capture").hidden = meta?.kind !== "capture";
  $("#retry-capture").disabled = !canRetryCapture || Boolean(activeJob);
  $("#retry-capture").dataset.attemptId = canRetryCapture ? attempt.id : "";
  $("#retry-capture").textContent = activeJob?.kind === "capture" ? "Another take is running…" : "Capture another take";
  renderReviewShowcases();
  $("#attempt-next").textContent = accepted
    ? `Accepted. Continue with ${String(state.status.next || "").replace("demo:studio ", "")} from the workflow above.`
    : "Watch both showcases, then accept when the navigation timing looks right.";
  syncAttemptToRoad(globalSourceTime());
}

function renderAttempts() {
  const attempts = Object.values(state.project.attempts).flat().filter((attempt) => state.media.attempts[attempt.id]);
  $("#attempt-panel").hidden = attempts.length === 0;
  if (!attempts.length) {
    selectedAttempt = null;
    renderAttempt();
    return;
  }
  selectedAttempt = attempts.some((attempt) => attempt.id === selectedAttempt) ? selectedAttempt : state.selectedRun || attempts.at(-1).id;
  $("#attempt-select").innerHTML = attempts.map((attempt) => `<option value="${attempt.id}">${attempt.id}${attempt.staleAtRevision ? " · older selection" : ""}</option>`).join("");
  $("#attempt-select").value = selectedAttempt;
  renderAttempt();
}

function resetDraft() {
  if (!state?.project) {
    draftShowcases = [];
    activeShowcaseId = null;
    draftChanged = false;
    return;
  }
  const story = state.project.inputs.story;
  const saved = story.showcases?.length ? story.showcases : story.proof?.outMs > story.proof?.inMs ? [{ id: "showcase-1", inMs: story.proof.inMs, outMs: story.proof.outMs }] : [];
  draftShowcases = saved.map((showcase, index) => ({ id: showcase.id || `showcase-${index + 1}`, inMs: Number(showcase.inMs), outMs: Number(showcase.outMs) }));
  activeShowcaseId = draftShowcases.some((showcase) => showcase.id === activeShowcaseId) ? activeShowcaseId : draftShowcases[0]?.id || null;
  draftChanged = false;
}

const WORKFLOW_STEPS = [
  { id: "source", label: "1 · Footage", job: "inspect" },
  { id: "navigation", label: "2 · Route & map", job: "validate" },
  { id: "inputs", label: "3 · Showcases", review: true },
  { id: "capture", label: "4 · App capture", job: "capture" },
  { id: "render", label: "5 · Final edit", job: "render" },
  { id: "publish", label: "6 · Publish", job: "publish" },
];

function actionLabel(step, stage) {
  if (step.review) return stage?.state === "accepted" ? "Review" : "Open review";
  if (stage?.state === "needs-review" && stage?.attemptId) return "Review attempt";
  if (step.id === "source") return stage?.state === "ready" ? "Inspect again" : "Inspect footage";
  if (step.id === "navigation") return ["ready", "accepted"].includes(stage?.state) ? "Validate again" : "Validate";
  if (step.id === "capture") return stage?.state === "accepted" ? "Capture again" : "Run capture";
  if (step.id === "render") return stage?.state === "accepted" ? "Render again" : "Render proof";
  if (step.id === "publish") return stage?.state === "completed" ? "Publish again" : "Publish";
  return "Continue";
}

function canRunStep(step) {
  const stages = state.project.stages;
  if (step.id === "source") return true;
  if (step.id === "navigation") return stages.source.state === "ready";
  if (step.id === "inputs") return ["ready", "needs-review", "accepted"].includes(stages.navigation.state);
  if (step.id === "capture") return stages.inputs.state === "accepted";
  if (step.id === "render") return stages.capture.state === "accepted";
  if (step.id === "publish") return stages.render.state === "accepted";
  return false;
}

function currentWorkflowStep() {
  const next = String(state.status?.next || "");
  if (next.includes("--run render-")) return WORKFLOW_STEPS.find((step) => step.id === "render");
  if (next.includes("--run capture-")) return WORKFLOW_STEPS.find((step) => step.id === "capture");
  if (next.trim() === "demo:studio review") return WORKFLOW_STEPS.find((step) => step.id === "inputs");
  return WORKFLOW_STEPS.find((step) => step.job && next.includes(` ${step.job}`)) || WORKFLOW_STEPS[0];
}

function activateWorkflowStep(step) {
  if (!step) return;
  const stage = state.project.stages[step.id];
  if (step.review || (stage?.state === "needs-review" && stage?.attemptId)) {
    if (stage?.attemptId && state.media.attempts[stage.attemptId]) {
      selectedAttempt = stage.attemptId;
      renderAttempts();
    }
    $("#review-workspace").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (step.job) startJob(step.job);
}

function renderHistory() {
  const current = state.project?.revision;
  $("#history-list").innerHTML = [...(state.revisions || [])].reverse().map((item) => {
    const event = item.event;
    const title = item.revision === 0 ? "Project created" : event?.reason || event?.type || "Saved project state";
    const detail = `${item.sourceCount} clip${item.sourceCount === 1 ? "" : "s"} · ${event?.at ? new Date(event.at).toLocaleString() : "snapshot"}`;
    return `<div class="history-item">
      <span class="history-revision">r${item.revision}</span>
      <span class="history-detail"><strong>${title}</strong><span>${detail}</span></span>
      <button class="secondary" data-restore-revision="${item.revision}" ${item.revision === current ? "disabled" : ""}>${item.revision === current ? "Current" : "Restore"}</button>
    </div>`;
  }).join("") || '<div class="quality">No restorable snapshots yet.</div>';
}

function renderStudioDashboard() {
  const hasProject = Boolean(state?.project);
  $("#empty-workspace").hidden = hasProject;
  $("#studio-dashboard").hidden = !hasProject;
  $("#review-workspace").hidden = !hasProject;
  const projects = state?.projects || [];
  $("#project-picker").innerHTML = [
    '<option value="">Open a project…</option>',
    ...projects.slice(0, 20).map((project) => `<option value="${project.id}">${project.id} · r${project.revision}</option>`),
  ].join("");
  $("#project-picker").value = state?.project?.id || "";
  if (!hasProject) {
    $("#page-step").textContent = "CycleWays Demo Studio";
    $("#page-title").textContent = "Production workspace";
    $("#project-meta").textContent = projects.length ? `${projects.length} recent project${projects.length === 1 ? "" : "s"}` : "No projects yet";
    return;
  }
  const currentStep = currentWorkflowStep();
  const currentStage = state.project.stages[currentStep.id] || { state: "pending" };
  $("#dashboard-title").textContent = `${state.project.id} production`;
  $("#dashboard-next").textContent = `Continue with ${currentStep.label.replace(/^\d+\s*·\s*/, "").toLowerCase()}. Every save is reversible.`;
  $("#continue-action").textContent = actionLabel(currentStep, currentStage);
  $("#continue-action").dataset.workflowStep = currentStep.id;
  $("#continue-action").disabled = !canRunStep(currentStep);
  $("#stage-cards").innerHTML = WORKFLOW_STEPS.map((step, index) => {
    const stage = state.project.stages[step.id] || { state: "pending" };
    const current = currentStep.id === step.id;
    const complete = ["ready", "accepted", "completed"].includes(stage.state);
    return `<button class="stage-card ${current ? "current" : ""}" data-state="${stage.state}" data-workflow-step="${step.id}" ${canRunStep(step) ? "" : "disabled"}>
      <span class="stage-index">${complete ? "✓" : index + 1}</span>
      <span class="stage-copy">
        <span class="stage-name">${step.label.replace(/^\d+\s*·\s*/, "")}</span>
        <span class="stage-state">${String(stage.state).replaceAll("-", " ")}</span>
      </span>
    </button>`;
  }).join("");
  const latestJob = state.jobs?.at(-1);
  const failedJobStillBlocksCurrentStep = latestJob?.state === "failed" && latestJob.kind === currentStep.job;
  const showJob = latestJob && (
    ["running", "interrupted"].includes(latestJob.state) ||
    failedJobStillBlocksCurrentStep
  );
  $("#job-panel").hidden = !showJob;
  if (latestJob) {
    $("#job-title").textContent = `${latestJob.kind} · ${latestJob.id}`;
    $("#job-state").textContent = latestJob.state;
    $("#job-log").textContent = latestJob.log || "Waiting for output…";
    $("#job-log").scrollTop = $("#job-log").scrollHeight;
    $("#cancel-job").hidden = latestJob.state !== "running";
    $("#cancel-job").dataset.jobId = latestJob.id;
  }
  renderHistory();
}

async function refreshState({ reset = false } = {}) {
  const previousRevision = state?.project?.revision;
  const loaded = await request("/api/state");
  state = loaded;
  if (reset || previousRevision !== state.project?.revision) resetDraft();
  render();
}

async function startJob(kind, options = {}) {
  try {
    await request("/api/jobs", { method: "POST", body: JSON.stringify({ kind, ...options }) });
    await refreshState();
    toast(options.retryFrom
      ? `New take started from ${options.retryFrom}. The earlier take is preserved.`
      : `${kind} started. You may close this tab and return later.`);
  } catch (error) {
    toast(error.message);
  }
}

function render() {
  renderStudioDashboard();
  if (!state.project) return;
  $("#project-meta").textContent = `${state.project.id} · r${state.project.revision}`;
  const clip = activeSource() || sourceClips()[0];
  if (clip) {
    const sourceUrl = new URL(clip.url, location.href).href;
    if ($("#source-video").src !== sourceUrl) {
      activeSourceId = clip.id;
      $("#source-video").src = clip.url;
    }
  }
  renderAttempts();
  updateSelection();
}

async function decide(body) {
  try {
    const result = await request("/api/decision", { method: "POST", body: JSON.stringify(body) });
    state = result.state;
    resetDraft();
    render();
    toast("Saved");
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

async function saveSelection() {
  if (!draftChanged) return true;
  const blocked = sortedShowcases().find(telemetryBlockForSegment);
  if (blocked) {
    toast("Move every showcase outside the striped telemetry exclusion areas before saving.");
    return false;
  }
  const showcases = sortedShowcases().map(({ inMs, outMs }) => ({ inMs, outMs }));
  return decide({ type: "select-showcases", showcases });
}

function setStart() {
  const currentShowcase = activeShowcase();
  const currentTime = globalSourceTime();
  const bounds = sourceBounds();
  const priorLength = Math.max(15_000, currentShowcase.outMs - currentShowcase.inMs);
  if (currentTime >= bounds.max) return toast("Choose a point before the end of the video");
  currentShowcase.inMs = Math.max(bounds.min, currentTime);
  if (currentShowcase.outMs <= currentShowcase.inMs) currentShowcase.outMs = Math.min(bounds.max, currentShowcase.inMs + priorLength);
  draftChanged = true;
  updateSelection();
}

function setEnd() {
  const currentShowcase = activeShowcase();
  const currentTime = globalSourceTime();
  const bounds = sourceBounds();
  const priorLength = Math.max(15_000, currentShowcase.outMs - currentShowcase.inMs);
  if (currentTime <= bounds.min) return toast("Play a little farther before setting the end");
  currentShowcase.outMs = Math.min(bounds.max, currentTime);
  if (currentShowcase.inMs >= currentShowcase.outMs) currentShowcase.inMs = Math.max(bounds.min, currentShowcase.outMs - priorLength);
  draftChanged = true;
  updateSelection();
}

function addShowcase() {
  if (draftShowcases.length >= 6) return toast("Six showcases is the current limit");
  const currentTime = globalSourceTime();
  if (telemetryBlockAt(currentTime)) return toast("Telemetry cannot support a showcase here. Choose a clear part of the timeline.");
  const bounds = sourceBounds();
  const ordered = sortedShowcases();
  if (ordered.some((showcase) => currentTime >= showcase.inMs && currentTime < showcase.outMs)) return toast("Scrub to the start of another interesting part first");
  const next = ordered.find((showcase) => showcase.inMs > currentTime);
  const endLimit = next ? next.inMs : bounds.max;
  const end = Math.min(endLimit, currentTime + 60_000);
  if (end - currentTime < 5000) return toast("There is not enough room for another showcase here");
  const added = { id: `draft-showcase-${localShowcaseNumber++}`, inMs: Math.max(bounds.min, currentTime), outMs: end };
  draftShowcases.push(added);
  activeShowcaseId = added.id;
  draftChanged = true;
  updateSelection();
}

$("#set-start").addEventListener("click", setStart);
$("#set-end").addEventListener("click", setEnd);
$("#jump-start").addEventListener("click", () => seekSourceGlobal(activeShowcase().inMs));
$("#jump-end").addEventListener("click", () => seekSourceGlobal(activeShowcase().outMs));
$("#add-showcase").addEventListener("click", addShowcase);
$("#showcase-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const showcase = draftShowcases.find((candidate) => candidate.id === button.dataset.showcaseId);
  if (!showcase) return;
  if (button.dataset.action === "remove") {
    if (draftShowcases.length === 1) return;
    draftShowcases = draftShowcases.filter((candidate) => candidate.id !== showcase.id);
    activeShowcaseId = sortedShowcases()[0].id;
    draftChanged = true;
    updateSelection();
    return;
  }
  activeShowcaseId = showcase.id;
  seekSourceGlobal(showcase.inMs);
  updateSelection();
});
$("#save-selection").addEventListener("click", saveSelection);
$("#approve-inputs").addEventListener("click", async () => {
  if (!(await saveSelection())) return;
  await decide({ type: "accept-inputs", note: "Showcases visually approved" });
});
$("#attempt-select").addEventListener("change", () => { selectedAttempt = $("#attempt-select").value; renderAttempt(); });
$("#accept-attempt").addEventListener("click", () => decide({ type: "accept", attemptId: selectedAttempt, note: "Generated video visually approved" }));
$("#reject-attempt").addEventListener("click", () => decide({ type: "reject", attemptId: selectedAttempt, note: "Generated video needs another pass" }));
$("#retry-capture").addEventListener("click", () => {
  const retryFrom = $("#retry-capture").dataset.attemptId;
  if (retryFrom) startJob("capture", { retryFrom });
});

function openProjectModal() {
  $("#project-error").hidden = true;
  $("#project-modal").showModal();
}

$("#new-project").addEventListener("click", openProjectModal);
$("#empty-new-project").addEventListener("click", openProjectModal);
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog)?.close());
});
$("#project-picker").addEventListener("change", async () => {
  if (!$("#project-picker").value) return;
  try {
    const result = await request("/api/project/open", {
      method: "POST",
      body: JSON.stringify({ id: $("#project-picker").value }),
    });
    state = result.state;
    activeSourceId = null;
    seekToShowcaseOnLoad = true;
    resetDraft();
    render();
  } catch (error) {
    toast(error.message);
  }
});
$("#project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorNode = $("#project-error");
  errorNode.hidden = true;
  const sources = $("#project-sources").value.split("\n").map((value) => value.trim()).filter(Boolean);
  try {
    const result = await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        id: $("#project-name").value.trim(),
        route: $("#project-route").value.trim(),
        routeKind: $("#project-route-kind").value,
        sources,
      }),
    });
    state = result.state;
    activeSourceId = null;
    seekToShowcaseOnLoad = true;
    resetDraft();
    $("#project-modal").close();
    render();
    toast("Project created. Start by inspecting the footage.");
  } catch (error) {
    errorNode.hidden = false;
    errorNode.textContent = error.message;
  }
});
$("#edit-sources").addEventListener("click", () => {
  $("#sources-paths").value = sourceClips().map((clip) => clip.path).join("\n");
  $("#sources-modal").showModal();
});
$("#edit-route").addEventListener("click", () => {
  $("#route-kind").value = state.project.inputs.route.kind || "catalog-slug";
  $("#route-value").value = state.project.inputs.route.value || "";
  $("#route-modal").showModal();
});
$("#route-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if ($("#route-kind").value !== state.project.inputs.route.kind) {
      const kindResult = await request("/api/decision", {
        method: "POST",
        body: JSON.stringify({
          type: "configure",
          field: "route.kind",
          value: $("#route-kind").value,
          reason: "Route source changed by operator in Studio",
        }),
      });
      state = kindResult.state;
    }
    const result = await request("/api/decision", {
      method: "POST",
      body: JSON.stringify({
        type: "configure",
        field: "route.value",
        value: $("#route-value").value.trim(),
        reason: "Route changed by operator in Studio",
      }),
    });
    state = result.state;
    resetDraft();
    $("#route-modal").close();
    render();
    toast("Route saved. Footage and history were preserved.");
  } catch (error) {
    toast(error.message);
  }
});
$("#sources-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const sources = $("#sources-paths").value.split("\n").map((value) => value.trim()).filter(Boolean);
  try {
    const result = await request("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        sources,
        reason: "Footage timeline edited by operator",
      }),
    });
    state = result.state;
    activeSourceId = null;
    seekToShowcaseOnLoad = true;
    resetDraft();
    $("#sources-modal").close();
    render();
    toast("Footage saved as a new revision. Earlier work was preserved.");
  } catch (error) {
    toast(error.message);
  }
});
$("#open-history").addEventListener("click", () => {
  renderHistory();
  $("#history-modal").showModal();
});
$("#history-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-restore-revision]");
  if (!button) return;
  restoringRevision = Number(button.dataset.restoreRevision);
  $("#impact-copy").textContent = `The project will return to the decisions from revision ${restoringRevision}. A new revision will be created, and all later captures and renders will remain available in history.`;
  $("#impact-modal").showModal();
});
$("#impact-cancel").addEventListener("click", () => {
  restoringRevision = null;
  $("#impact-modal").close();
});
$("#impact-confirm").addEventListener("click", async () => {
  if (!Number.isInteger(restoringRevision)) return;
  try {
    const result = await request("/api/restore", {
      method: "POST",
      body: JSON.stringify({ revision: restoringRevision }),
    });
    state = result.state;
    resetDraft();
    restoringRevision = null;
    $("#impact-modal").close();
    $("#history-modal").close();
    render();
    toast("Revision restored; later attempts were kept.");
  } catch (error) {
    toast(error.message);
  }
});
$("#stage-cards").addEventListener("click", (event) => {
  const button = event.target.closest("[data-workflow-step]");
  if (!button) return;
  const step = WORKFLOW_STEPS.find((item) => item.id === button.dataset.workflowStep);
  activateWorkflowStep(step);
});
$("#continue-action").addEventListener("click", () => {
  activateWorkflowStep(WORKFLOW_STEPS.find((step) => step.id === $("#continue-action").dataset.workflowStep));
});
$("#cancel-job").addEventListener("click", async () => {
  const id = $("#cancel-job").dataset.jobId;
  if (!id) return;
  try {
    await request(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
    await refreshState();
  } catch (error) {
    toast(error.message);
  }
});

const sourceVideo = $("#source-video");
const playhead = $("#playhead");
sourceVideo.addEventListener("loadedmetadata", () => {
  const clips = sourceClips();
  mediaDurationMs = state?.artifacts?.mediaTimeline?.durationMs || clips.at(-1)?.timeline?.outMs || Math.round(sourceVideo.duration * 1000);
  playhead.max = mediaDurationMs;
  if (Number.isFinite(pendingGlobalSeekMs)) {
    const clip = activeSource();
    sourceVideo.currentTime = Math.max(0, clip.timeline.sourceInMs + pendingGlobalSeekMs - clip.timeline.inMs) / 1000;
    pendingGlobalSeekMs = null;
  } else if (seekToShowcaseOnLoad && activeShowcase()) {
    seekSourceGlobal(activeShowcase().inMs);
    seekToShowcaseOnLoad = false;
  }
  if (sourceVideo.dataset.resumePlay === "true") sourceVideo.play().catch(() => {});
  delete sourceVideo.dataset.resumePlay;
  updateSelection();
});
sourceVideo.addEventListener("timeupdate", () => {
  const ms = globalSourceTime();
  playhead.value = ms;
  $("#time-readout").textContent = time(ms);
  syncMap(ms);
  syncAttemptToRoad(ms);
  $("#add-showcase").title = telemetryBlockAt(ms) ? "Telemetry cannot support a showcase at this point" : "";
});
sourceVideo.addEventListener("play", () => {
  if (!attemptVideo.hidden) {
    syncAttemptToRoad(globalSourceTime());
    attemptVideo.play().catch(() => {});
  }
});
sourceVideo.addEventListener("pause", () => {
  if (!attemptVideo.hidden) attemptVideo.pause();
});
sourceVideo.addEventListener("ended", () => {
  const clips = sourceClips();
  const index = clips.findIndex((clip) => clip.id === activeSourceId);
  if (index >= 0 && clips[index + 1]) loadSourceClip(clips[index + 1], clips[index + 1].timeline.inMs, { play: true });
});
playhead.addEventListener("input", () => seekSourceGlobal(Number(playhead.value)));

const attemptVideo = $("#attempt-video");
attemptVideo.addEventListener("loadedmetadata", () => syncAttemptToRoad(globalSourceTime()));
attemptVideo.addEventListener("play", () => sourceVideo.play().catch(() => {}));
attemptVideo.addEventListener("pause", () => sourceVideo.pause());
attemptVideo.addEventListener("timeupdate", () => {
  if (syncingVideos) return;
  const { meta } = selectedAttemptDetails();
  const roadTimeMs = roadTimeForAttemptMs(attemptVideo.currentTime * 1000, meta);
  if (Number.isFinite(roadTimeMs) && Math.abs(globalSourceTime() - roadTimeMs) > 120) {
    syncingVideos = true;
    seekSourceGlobal(roadTimeMs);
    syncingVideos = false;
  }
});
attemptVideo.addEventListener("seeked", () => attemptVideo.dispatchEvent(new Event("timeupdate")));
$("#review-showcases").addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-showcase]");
  if (editButton) {
    openTrimModal(editButton.dataset.editShowcase);
    return;
  }
  const button = event.target.closest("[data-review-showcase]");
  if (!button) return;
  const showcase = draftShowcases.find((candidate) => candidate.id === button.dataset.reviewShowcase);
  if (!showcase) return;
  activeShowcaseId = showcase.id;
  seekSourceGlobal(showcase.inMs);
  renderReviewShowcases();
  syncAttemptToRoad(showcase.inMs);
});
$("#trim-close").addEventListener("click", closeTrimModal);
$("#trim-cancel").addEventListener("click", closeTrimModal);
$("#trim-modal").addEventListener("click", (event) => {
  if (event.target === $("#trim-modal")) closeTrimModal();
});
$("#trim-modal").addEventListener("close", () => {
  trimShowcaseId = null;
  trimAllowedBounds = null;
  trimDraft = null;
});
$("#trim-start-range").addEventListener("input", () => {
  $("#trim-start-text").value = time(Number($("#trim-start-range").value));
  updateTrimUi({ seekTo: Number($("#trim-start-range").value) });
});
$("#trim-end-range").addEventListener("input", () => {
  $("#trim-end-text").value = time(Number($("#trim-end-range").value));
  updateTrimUi({ seekTo: Number($("#trim-end-range").value) });
});
$("#trim-start-text").addEventListener("input", () => updateTrimUi({ normalize: false }));
$("#trim-end-text").addEventListener("input", () => updateTrimUi({ normalize: false }));
$("#trim-start-text").addEventListener("change", () => updateTrimUi({ seekTo: parseTime($("#trim-start-text").value) }));
$("#trim-end-text").addEventListener("change", () => updateTrimUi({ seekTo: parseTime($("#trim-end-text").value) }));
$("#trim-start-playhead").addEventListener("click", () => {
  $("#trim-start-text").value = time(globalSourceTime());
  updateTrimUi();
});
$("#trim-end-playhead").addEventListener("click", () => {
  $("#trim-end-text").value = time(globalSourceTime());
  updateTrimUi();
});
$("#trim-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  updateTrimUi();
  if (!trimDraft || !trimShowcaseId || !trimAllowedBounds) return;
  const showcases = sortedShowcases().map((showcase) => showcase.id === trimShowcaseId
    ? { inMs: trimDraft.inMs, outMs: trimDraft.outMs }
    : { inMs: showcase.inMs, outMs: showcase.outMs });
  const saved = await decide({
    type: "trim-showcases",
    attemptId: trimAllowedBounds.captureAttemptId,
    showcases,
  });
  if (saved) {
    closeTrimModal();
    toast("Trim saved; capture kept");
  }
});

request("/api/state").then((loaded) => {
  state = loaded;
  resetDraft();
  render();
  statePoll = setInterval(() => {
    if (document.hidden) return;
    refreshState().catch(() => {});
  }, 2000);
}).catch((error) => toast(error.message));
