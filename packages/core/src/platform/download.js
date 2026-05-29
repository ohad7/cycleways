// Web implementation of the file-download platform service. A future React
// Native app provides a sibling `download.native.js` (e.g. share sheet / save
// to Files). The Blob / document / URL globals used below are web-only — this
// is why it lives in platform/ and not in the pure utils layer.

export function executeDownloadGPX(gpxContent, filename = "bike_route.gpx") {
  const blob = new Blob([gpxContent], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
