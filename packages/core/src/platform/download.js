// Web implementation of the file-download platform service. On touch-oriented
// browsers, prefer the platform share sheet when it accepts files (notably
// mobile Safari). Desktop and unsupported browsers retain the direct download.

export async function executeDownloadGPX(gpxContent, filename = "bike_route.gpx") {
  const safeFilename = sanitizeFilename(filename);
  const blob = new Blob([gpxContent], { type: "application/gpx+xml" });

  if (canShareFile(blob, safeFilename)) {
    try {
      const file = new File([blob], safeFilename, {
        type: "application/gpx+xml",
      });
      await navigator.share({
        title: safeFilename,
        files: [file],
      });
      return true;
    } catch (error) {
      // A cancellation is intentional; other failures fall through to the
      // conventional browser download so the tap still has a useful result.
      if (error?.name === "AbortError") return false;
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeFilename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (error) {
    console.warn("Web GPX download failed:", error);
    return false;
  }
}

function canShareFile(blob, filename) {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function" ||
    typeof File !== "function"
  ) {
    return false;
  }
  const coarsePointer =
    Number(navigator.maxTouchPoints) > 0 ||
    globalThis.matchMedia?.("(pointer: coarse)")?.matches === true;
  if (!coarsePointer) return false;
  try {
    const file = new File([blob], filename, {
      type: "application/gpx+xml",
    });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function sanitizeFilename(filename) {
  return (
    String(filename || "bike_route.gpx").replace(/[^\w.-]+/g, "_") ||
    "bike_route.gpx"
  );
}
