const token = new URLSearchParams(location.search).get("token");
const authUrl = (path) => `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
const $ = (selector) => document.querySelector(selector);
let state;
let selectedAttempt = null;

function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); setTimeout(() => node.classList.remove("show"), 2400); }
function html(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function time(value) { const ms = Math.max(0, Number(value) || 0); const minutes = Math.floor(ms / 60000); const seconds = Math.floor((ms % 60000) / 1000); return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`; }
async function request(path, options = {}) { const response = await fetch(authUrl(path), { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } }); const body = await response.json(); if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`); return body; }

function pointsToPath(points, bounds) { return (points || []).map((point, index) => { const x = 40 + ((point.lng - bounds.minLng) / Math.max(1e-9, bounds.maxLng - bounds.minLng)) * 720; const y = 560 - ((point.lat - bounds.minLat) / Math.max(1e-9, bounds.maxLat - bounds.minLat)) * 520; return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" "); }
function drawMap() {
  const route = state.artifacts.route?.geometry || [];
  const track = state.artifacts.track?.fixes || [];
  const all = [...route, ...track];
  if (!all.length) { $("#route-map").innerHTML = '<text x="400" y="300" text-anchor="middle" fill="#95aa9f">Run inspect and validate to see route alignment</text>'; return; }
  const bounds = { minLat: Math.min(...all.map(p => p.lat)), maxLat: Math.max(...all.map(p => p.lat)), minLng: Math.min(...all.map(p => p.lng)), maxLng: Math.max(...all.map(p => p.lng)) };
  $("#route-map").innerHTML = `<path d="${pointsToPath(route, bounds)}" fill="none" stroke="#557369" stroke-width="10" stroke-linecap="round"/><path d="${pointsToPath(track, bounds)}" fill="none" stroke="#b8f34a" stroke-width="4" stroke-linecap="round"/><circle id="map-fix" r="9" fill="#fff" stroke="#08130f" stroke-width="4"/>`;
  $("#route-map").dataset.bounds = JSON.stringify(bounds);
}
function syncMap(mediaMs) { const fixes = state.artifacts.track?.fixes || []; if (!fixes.length || !$("#map-fix")) return; const fix = fixes.reduce((best, item) => Math.abs(item.timestamp - mediaMs) < Math.abs(best.timestamp - mediaMs) ? item : best, fixes[0]); const b = JSON.parse($("#route-map").dataset.bounds); const x = 40 + ((fix.lng - b.minLng) / Math.max(1e-9, b.maxLng - b.minLng)) * 720; const y = 560 - ((fix.lat - b.minLat) / Math.max(1e-9, b.maxLat - b.minLat)) * 520; $("#map-fix").setAttribute("cx", x); $("#map-fix").setAttribute("cy", y); }
function render() {
  const project = state.project;
  $("#project-meta").textContent = `${project.id} · revision ${project.revision}`;
  $("#status-list").innerHTML = state.status.stages.map(stage => `<div class="stage"><span>${stage.name}</span><span class="stage-state ${stage.state}">${stage.state}${stage.reason ? ` · ${stage.reason}` : ""}</span></div>`).join("");
  $("#next-action").textContent = `Next: ${state.status.next.replace("demo:studio ", "./studio ")}`;
  const source = project.inputs.source; $("#offset").value = source.gpsOffsetSeconds || 0; $("#offset-value").textContent = `${Number(source.gpsOffsetSeconds || 0).toFixed(1)} s`;
  const proof = project.inputs.story.proof; $("#proof-in").value = Number(proof.inMs || 0) / 1000; $("#proof-out").value = Number(proof.outMs || 0) / 1000;
  const metrics = state.artifacts.rideValidation?.metrics; $("#diagnostics").innerHTML = metrics ? Object.entries(metrics).filter(([, value]) => !Array.isArray(value)).map(([key, value]) => `<div class="metric"><span>${key}</span><span>${typeof value === "number" ? value.toFixed(1) : value}</span></div>`).join("") : '<div class="metric"><span>No validation report yet</span></div>';
  const attempts = Object.values(project.attempts).flat(); $("#attempts").innerHTML = attempts.length ? attempts.map(a => { const accepted = Object.values(project.accepted).includes(a.id); const canAccept = a.state === "completed" && !a.staleAtRevision; return `<div class="attempt"><strong>${a.id}</strong> · ${a.staleAtRevision ? "stale" : a.state}${accepted ? " · accepted" : ""}<div class="attempt-actions"><button data-decision="accept" data-attempt="${a.id}" ${canAccept ? "" : "disabled"}>Accept</button><button class="secondary" data-decision="reject" data-attempt="${a.id}" ${a.state === "completed" ? "" : "disabled"}>Reject</button></div></div>`; }).join("") : '<div class="metric"><span>No attempts yet</span></div>';
  selectedAttempt ??= state.selectedRun;
  $("#attempt-select").innerHTML = '<option value="">Inputs: route and GPS</option>' + attempts.filter(a => state.media.attempts[a.id]).map(a => `<option value="${a.id}">${a.id} · ${a.state}</option>`).join("");
  $("#attempt-select").value = selectedAttempt || "";
  renderAttempt();
  const edit = project.inputs.proofEdit; $("#road-fraction").value = edit.layout.roadFraction; $("#split-value").textContent = `${Math.round(edit.layout.roadFraction * 100)}%`; $("#ambience-gain").value = edit.audio.ambienceGainDb; $("#voice-gain").value = edit.audio.voiceGainDb; $("#caption-language").value = edit.captions.language;
  $("#source-video").src = state.media.source;
  drawMap();
}
function renderAttempt() {
  const video = $("#attempt-video"); const map = $("#route-map"); const meta = state.attemptMeta?.[selectedAttempt];
  if (!selectedAttempt || !state.media.attempts[selectedAttempt]) { video.hidden = true; map.hidden = false; $("#secondary-label").textContent = "ROUTE / GPS"; $("#sync-detail").textContent = "Pre-capture input review"; $("#translations").innerHTML = ""; return; }
  map.hidden = true; video.hidden = false; if (video.src !== new URL(state.media.attempts[selectedAttempt], location.href).href) video.src = state.media.attempts[selectedAttempt]; $("#secondary-label").textContent = meta.kind === "render" ? "PROOF RENDER" : "APP CAPTURE";
  $("#sync-detail").textContent = meta.sync ? `Sync flash ends at ${time(meta.sync.endMs)}; road and app playheads are linked.` : "Sync marker has not been measured yet.";
  const translations = state.project.inputs.proofEdit.captions.translations || {}; $("#translations").innerHTML = (meta.speech || []).map(item => `<div class="translation"><div class="translation-source">${html(item.text)}</div><input data-translation="${html(item.key)}" value="${html(translations[item.key] || translations[item.id] || "")}" placeholder="Reviewed English caption"></div>`).join("");
}
async function reload() { state = await request("/api/state"); render(); }
function impact() { const changed = []; if (Number($("#offset").value) !== Number(state.project.inputs.source.gpsOffsetSeconds || 0)) changed.push("GPS offset → revalidate + recapture"); const proof = state.project.inputs.story.proof; if (Number($("#proof-in").value) * 1000 !== Number(proof.inMs) || Number($("#proof-out").value) * 1000 !== Number(proof.outMs)) changed.push("Proof window → revalidate + recapture"); $("#impact").textContent = changed.join("; ") || "No unsaved changes"; }
async function decide(body) { try { const result = await request("/api/decision", { method: "POST", body: JSON.stringify(body) }); state = result.state; render(); toast(`Saved revision ${result.revision}`); return true; } catch (error) { toast(error.message); return false; } }

$("#offset").addEventListener("input", () => { $("#offset-value").textContent = `${Number($("#offset").value).toFixed(1)} s`; impact(); }); $("#proof-in").addEventListener("input", impact); $("#proof-out").addEventListener("input", impact);
$("#road-fraction").addEventListener("input", () => { $("#split-value").textContent = `${Math.round(Number($("#road-fraction").value) * 100)}%`; $("#impact").textContent = "Proof layout changed → rerender only"; });
$("#attempt-select").addEventListener("change", () => { selectedAttempt = $("#attempt-select").value || null; renderAttempt(); });
$("#save").addEventListener("click", async () => { const reason = $("#reason").value.trim(); if (!reason) return toast("Add a landmark or edit reason first"); const offset = Number($("#offset").value); const proof = { ...state.project.inputs.story.proof, inMs: Math.round(Number($("#proof-in").value) * 1000), outMs: Math.round(Number($("#proof-out").value) * 1000) }; if (!Number.isFinite(proof.inMs) || !Number.isFinite(proof.outMs) || proof.outMs <= proof.inMs) return toast("Proof out must be later than proof in"); if (offset !== Number(state.project.inputs.source.gpsOffsetSeconds || 0) && !(await decide({ type: "configure", field: "source.gpsOffsetSeconds", value: offset, reason }))) return; if (JSON.stringify(proof) !== JSON.stringify(state.project.inputs.story.proof)) await decide({ type: "configure", field: "story.proof", value: proof, reason }); });
$("#accept-inputs").addEventListener("click", () => decide({ type: "accept-inputs", note: $("#reason").value.trim() || "Visual route/GPS review passed" }));
$("#save-edit").addEventListener("click", async () => { const reason = $("#reason").value.trim(); if (!reason) return toast("Add an edit reason first"); const edits = [["proofEdit.layout.roadFraction", Number($("#road-fraction").value)], ["proofEdit.audio.ambienceGainDb", Number($("#ambience-gain").value)], ["proofEdit.audio.voiceGainDb", Number($("#voice-gain").value)], ["proofEdit.captions.language", $("#caption-language").value]]; for (const input of document.querySelectorAll("[data-translation]")) edits.push([`proofEdit.captions.translations.${input.dataset.translation}`, input.value]); for (const [field, value] of edits) { const current = field.split(".").reduce((object, key) => object?.[key], state.project.inputs); if (current !== value) await decide({ type: "configure", field, value, reason }); } toast("Proof edit saved; capture remains reusable"); });
$("#attempts").addEventListener("click", event => { const button = event.target.closest("button[data-decision]"); if (button) decide({ type: button.dataset.decision, attemptId: button.dataset.attempt, note: $("#reason").value.trim() || null }); });
const video = $("#source-video"); const playhead = $("#playhead"); video.addEventListener("loadedmetadata", () => { playhead.max = Math.round(video.duration * 1000); }); video.addEventListener("timeupdate", () => { const ms = Math.round(video.currentTime * 1000); playhead.value = ms; $("#time-readout").textContent = time(ms); syncMap(ms); }); playhead.addEventListener("input", () => { video.currentTime = Number(playhead.value) / 1000; });
const attemptVideo = $("#attempt-video"); attemptVideo.addEventListener("play", () => video.play().catch(() => {})); attemptVideo.addEventListener("pause", () => video.pause()); attemptVideo.addEventListener("timeupdate", () => { const sync = state.attemptMeta?.[selectedAttempt]?.sync; if (!sync) return; const roadTime = Number(state.project.inputs.story.proof.inMs) / 1000 + Math.max(0, attemptVideo.currentTime - sync.endMs / 1000); if (Math.abs(video.currentTime - roadTime) > 0.12) video.currentTime = roadTime; }); attemptVideo.addEventListener("seeked", () => attemptVideo.dispatchEvent(new Event("timeupdate")));

reload().catch(error => toast(error.message));
