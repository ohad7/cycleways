/**
 * Generate GPX file content from route coordinates
 * @param {Array} orderedCoords - Array of coordinates with {lat, lng, elevation}
 * @param {Object} options - Options for GPX generation
 * @returns {string} GPX file content
 */
export function generateGPX(orderedCoords, options = {}) {
  const {
    trackName = "מסלול רכיבה מתוכנן",
    creator = "BikeRoutePlanner",
  } = options;

  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <trk>
    <name>${trackName}</name>
    <trkseg>`;

  orderedCoords.forEach((coord) => {
    // Use actual elevation from coordinates if available, otherwise calculate
    let elevation;
    if (coord.elevation !== undefined) {
      elevation = coord.elevation;
    } else {
      // Fallback: calculate elevation based on position (simulated)
      elevation =
        200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    }
    gpx += `
      <trkpt lat="${coord.lat}" lon="${coord.lng}">
        <ele>${Math.round(elevation)}</ele>
      </trkpt>`;
  });

  gpx += `
    </trkseg>
  </trk>
</gpx>`;

  return gpx;
}

/**
 * Download GPX file to user's device
 * @param {string} gpxContent - GPX file content
 * @param {string} filename - Filename for download
 */
export function executeDownloadGPX(gpxContent, filename = "bike_route.gpx") {
  const blob = new Blob([gpxContent], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}