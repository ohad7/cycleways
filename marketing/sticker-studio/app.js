import qrcode from "qrcode-generator";
import {
  QR_QUIET_MODULES,
  QR_SIZE_UNITS,
  captionLines,
  escapeXml,
  mmToPixels,
  qrPrintMetrics,
  resolveDestination,
  safeFilename,
  textDirection,
} from "./sticker-core.mjs";
import { initPlacementStudio } from "./placement-map.js";

const assetUrls = {
  "adult-man": new URL("../badge-template-adult-man.png", import.meta.url).href,
  "adult-woman": new URL("../badge-template-adult-woman.png", import.meta.url).href,
  "child-boy": new URL("../badge-template-child-boy.png", import.meta.url).href,
  "child-girl": new URL("../badge-template-child-girl.png", import.meta.url).href,
  "teen-boy": new URL("../badge-template-teen-boy.png", import.meta.url).href,
  "teen-girl": new URL("../badge-template-teen-girl.png", import.meta.url).href,
  "commuter-suit": new URL("../badge-template-commuter-suit.png", import.meta.url).href,
  "commuter-dress": new URL("../badge-template-commuter-dress.png", import.meta.url).href,
};

const form = document.querySelector("#sticker-form");
const preview = document.querySelector("#preview");
const errorOutput = document.querySelector("#form-error");
const routeField = document.querySelector("#route-field");
const customField = document.querySelector("#custom-field");
const resolvedUrlOutput = document.querySelector("#resolved-url");
const qrStatus = document.querySelector("#qr-status");
const pixelSize = document.querySelector("#pixel-size");
const placementContextPanel = document.querySelector("#placement-context");
const placementContextName = document.querySelector("#placement-context-name");
const placementContextCode = document.querySelector("#placement-context-code");
const assets = {};
let currentSvg = "";
let currentState = null;
let placementStudio = null;

function getState() {
  const rider = document.querySelector("#rider-template").value;
  return {
    rider,
    caption: document.querySelector("#caption").value,
    includeQr: document.querySelector("#include-qr").checked,
    destinationKind: document.querySelector("#destination-kind").value,
    routeSlug: document.querySelector("#route-slug").value,
    customUrl: document.querySelector("#custom-url").value,
    sizeMm: Number(document.querySelector("#size-mm").value),
    dpi: Number(document.querySelector("#dpi").value),
    printBatchId: document.querySelector("#print-batch-id").value.trim() || null,
  };
}

function buildQr(url) {
  const qr = qrcode(0, "Q");
  qr.addData(url);
  qr.make();
  const moduleCount = qr.getModuleCount();
  const total = moduleCount + QR_QUIET_MODULES * 2;
  const cell = QR_SIZE_UNITS / total;
  const x = (1024 - QR_SIZE_UNITS) / 2;
  const y = 464;
  const modules = [];
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (!qr.isDark(row, column)) continue;
      modules.push(`<rect x="${(x + (column + QR_QUIET_MODULES) * cell).toFixed(3)}" y="${(y + (row + QR_QUIET_MODULES) * cell).toFixed(3)}" width="${(cell + 0.02).toFixed(3)}" height="${(cell + 0.02).toFixed(3)}"/>`);
    }
  }
  return {
    moduleCount,
    markup: `<g aria-label="QR code"><rect x="${x}" y="${y}" width="${QR_SIZE_UNITS}" height="${QR_SIZE_UNITS}" rx="12" fill="#fff" stroke="#2f3331" stroke-width="5"/><g fill="#222624" shape-rendering="crispEdges">${modules.join("")}</g></g>`,
  };
}

function captionMarkup(lines) {
  if (!lines.length) return "";
  const fontSize = lines.length === 1 ? 44 : 36;
  const startY = lines.length === 1 ? 914 : 892;
  return lines.map((line, index) => {
    const direction = textDirection(line);
    return `<text x="512" y="${startY + index * 49}" text-anchor="middle" direction="${direction}" unicode-bidi="plaintext" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="600" letter-spacing="0.5">${escapeXml(line)}</text>`;
  }).join("");
}

function buildSvg(state, destination, lines) {
  const qr = state.includeQr ? buildQr(destination) : null;
  const imageHref = assets[state.rider];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${state.sizeMm}mm" height="${state.sizeMm}mm" viewBox="0 0 1024 1024" role="img" aria-label="Cycleways sticker">
    <image href="${imageHref}" x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid slice"/>
    <rect x="56" y="663" width="912" height="157" rx="58" fill="#303331"/>
    <text x="512" y="762" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="78" letter-spacing="2"><tspan font-weight="600">cycleways</tspan><tspan font-weight="400">.app</tspan></text>
    ${qr?.markup || ""}
    ${captionMarkup(lines)}
  </svg>`;
  return { svg, moduleCount: qr?.moduleCount || 0 };
}

function render() {
  const placementContext = placementStudio?.getActivePlacementContext() || null;
  syncPlacementContext(placementContext);
  const state = getState();
  currentState = state;
  routeField.hidden = state.destinationKind !== "route";
  customField.hidden = state.destinationKind !== "custom";
  errorOutput.textContent = "";

  try {
    const destination = placementContext?.placement?.qr?.encodedUrl || resolveDestination({
        kind: state.destinationKind,
        routeSlug: state.routeSlug,
        customUrl: state.customUrl,
      });
    currentState = { ...state, destination };
    const lines = captionLines(state.caption);
    const { svg, moduleCount } = buildSvg(state, destination, lines);
    currentSvg = svg;
    preview.innerHTML = svg;
    resolvedUrlOutput.textContent = state.includeQr
      ? placementContext
        ? `${destination} → ${placementContext.placement.qr?.targetUrl}`
        : destination
      : "QR code disabled";

    const pixels = mmToPixels(state.sizeMm, state.dpi);
    pixelSize.textContent = `${pixels} × ${pixels} px`;
    if (state.includeQr) {
      const metrics = qrPrintMetrics(moduleCount, state.sizeMm);
      qrStatus.className = `qr-status ${metrics.level === "good" ? "" : metrics.level}`;
      qrStatus.textContent = `QR: ${metrics.qrMm.toFixed(1)} mm · modules ${metrics.moduleMm.toFixed(2)} mm · ${metrics.level === "good" ? "print-safe" : metrics.level === "warning" ? "test before a large print run" : "increase sticker size or shorten the URL"}`;
    } else {
      qrStatus.className = "qr-status";
      qrStatus.textContent = "Brand-only sticker; no QR code will be printed.";
    }
  } catch (error) {
    currentSvg = "";
    preview.innerHTML = `<div class="form-error">${escapeXml(error.message)}</div>`;
    resolvedUrlOutput.textContent = "";
    qrStatus.textContent = "Waiting for a valid configuration.";
    errorOutput.textContent = error.message;
  }
}

function syncPlacementContext(context) {
  const destinationControls = [
    document.querySelector("#destination-kind"),
    document.querySelector("#route-slug"),
    document.querySelector("#custom-url"),
  ];
  placementContextPanel.hidden = !context;
  destinationControls.forEach((control) => { control.disabled = Boolean(context); });
  document.querySelector("#include-qr").disabled = Boolean(context);
  if (context) {
    placementContextName.textContent = context.location.name;
    placementContextCode.textContent = context.placement.qr?.shortCode || "No QR";
    document.querySelector("#include-qr").checked = context.placement.qr?.mode !== "none";
  }
}

async function recordPlacementExport(extension) {
  if (!placementStudio?.getActivePlacementContext()) return;
  await placementStudio.recordExport({
    rider: currentState.rider,
    caption: currentState.caption,
    includeQr: currentState.includeQr,
    destination: currentState.destination,
    sizeMm: currentState.sizeMm,
    dpi: currentState.dpi,
    printBatchId: currentState.printBatchId,
    assetFilename: filename(extension),
  });
}

async function assetToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load sticker artwork (${response.status}).`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filename(extension) {
  return `${safeFilename({ rider: currentState.rider, destinationKind: currentState.destinationKind, caption: currentState.caption })}.${extension}`;
}

document.querySelector("#download-svg").addEventListener("click", async () => {
  if (!currentSvg) return;
  try {
    await recordPlacementExport("svg");
    downloadBlob(new Blob([currentSvg], { type: "image/svg+xml;charset=utf-8" }), filename("svg"));
  } catch (error) {
    errorOutput.textContent = `Export not recorded: ${error.message}`;
  }
});

document.querySelector("#download-png").addEventListener("click", async () => {
  if (!currentSvg) return;
  try {
    await recordPlacementExport("png");
  } catch (error) {
    errorOutput.textContent = `Export not recorded: ${error.message}`;
    return;
  }
  const exportState = { ...currentState };
  const exportSvg = currentSvg;
  const blob = new Blob([exportSvg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const dimensions = mmToPixels(exportState.sizeMm, exportState.dpi);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions;
    canvas.height = dimensions;
    canvas.getContext("2d").drawImage(image, 0, 0, dimensions, dimensions);
    canvas.toBlob((png) => {
      URL.revokeObjectURL(url);
      if (png) {
        const exportName = `${safeFilename({ rider: exportState.rider, destinationKind: exportState.destinationKind, caption: exportState.caption })}.png`;
        downloadBlob(png, exportName);
      }
    }, "image/png");
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    errorOutput.textContent = "PNG rendering failed. SVG export is still available.";
  };
  image.src = url;
});

document.querySelector("#print-sheet").addEventListener("click", async () => {
  if (!currentSvg) return;
  try {
    await recordPlacementExport("svg");
  } catch (error) {
    errorOutput.textContent = `Print assignment not recorded: ${error.message}`;
    return;
  }
  const stickerUrl = URL.createObjectURL(new Blob([currentSvg], { type: "image/svg+xml" }));
  const popup = window.open("", "_blank");
  if (!popup) {
    errorOutput.textContent = "Allow pop-ups to open the A4 print sheet.";
    URL.revokeObjectURL(stickerUrl);
    return;
  }
  popup.opener = null;
  const gapMm = 4;
  const columns = Math.max(1, Math.floor((190 + gapMm) / (currentState.sizeMm + gapMm)));
  const rows = Math.max(1, Math.floor((277 + gapMm) / (currentState.sizeMm + gapMm)));
  const copies = Array.from({ length: columns * rows }, () => `<img src="${stickerUrl}" alt=""/>`).join("");
  popup.document.write(`<!doctype html><html><head><title>Cycleways A4 sticker sheet</title><style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;display:grid;grid-template-columns:repeat(${columns},${currentState.sizeMm}mm);gap:${gapMm}mm;align-content:start}img{display:block;width:${currentState.sizeMm}mm;height:${currentState.sizeMm}mm;break-inside:avoid}@media screen{body{padding:10mm;background:#ddd}}</style></head><body>${copies}<script>addEventListener('load',()=>setTimeout(()=>print(),250));<\/script></body></html>`);
  popup.document.close();
});

form.addEventListener("input", render);
form.addEventListener("change", render);
document.querySelector("#clear-placement-context").addEventListener("click", () => {
  placementStudio?.clearActivePlacement();
  render();
});

const assetsReady = Promise.all(Object.entries(assetUrls).map(async ([key, url]) => {
  assets[key] = await assetToDataUrl(url);
}));

Promise.all([
  assetsReady,
  initPlacementStudio({
    onContextChange() {
      if (Object.keys(assets).length === Object.keys(assetUrls).length) render();
    },
  }),
]).then(([, studio]) => {
  placementStudio = studio;
  render();
}).catch((error) => {
  errorOutput.textContent = error.message;
  preview.textContent = "Artwork could not be loaded.";
});
