
// Spatial index for efficient segment lookup
class SpatialIndex {
  constructor(gridSize = 0.005) { // Grid size in degrees (approximately 500m)
    this.gridSize = gridSize;
    this.grid = new Map();
    this.segments = new Map();
  }

  _getGridKey(lat, lng) {
    const gridLat = Math.floor(lat / this.gridSize);
    const gridLng = Math.floor(lng / this.gridSize);
    return `${gridLat},${gridLng}`;
  }

  _getGridKeysForBounds(minLat, maxLat, minLng, maxLng) {
    const keys = [];
    const minGridLat = Math.floor(minLat / this.gridSize);
    const maxGridLat = Math.floor(maxLat / this.gridSize);
    const minGridLng = Math.floor(minLng / this.gridSize);
    const maxGridLng = Math.floor(maxLng / this.gridSize);

    for (let gridLat = minGridLat; gridLat <= maxGridLat; gridLat++) {
      for (let gridLng = minGridLng; gridLng <= maxGridLng; gridLng++) {
        keys.push(`${gridLat},${gridLng}`);
      }
    }
    return keys;
  }

  addSegment(polylineData) {
    const segmentName = polylineData.segmentName;
    const coords = polylineData.coordinates;
    
    if (coords.length === 0) return;

    // Store segment data
    this.segments.set(segmentName, polylineData);

    // Calculate bounding box for the segment
    let minLat = coords[0].lat, maxLat = coords[0].lat;
    let minLng = coords[0].lng, maxLng = coords[0].lng;

    for (const coord of coords) {
      minLat = Math.min(minLat, coord.lat);
      maxLat = Math.max(maxLat, coord.lat);
      minLng = Math.min(minLng, coord.lng);
      maxLng = Math.max(maxLng, coord.lng);
    }

    // Add segment to all grid cells it intersects
    const gridKeys = this._getGridKeysForBounds(minLat, maxLat, minLng, maxLng);
    
    for (const key of gridKeys) {
      if (!this.grid.has(key)) {
        this.grid.set(key, new Set());
      }
      this.grid.get(key).add(segmentName);
    }
  }

  findNearestSegment(lat, lng, maxDistance = 0.01) { // maxDistance in degrees
    // Get candidate segments from nearby grid cells
    const searchRadius = Math.max(maxDistance, this.gridSize);
    const gridKeys = this._getGridKeysForBounds(
      lat - searchRadius, lat + searchRadius,
      lng - searchRadius, lng + searchRadius
    );

    const candidateSegments = new Set();
    for (const key of gridKeys) {
      const segments = this.grid.get(key);
      if (segments) {
        for (const segmentName of segments) {
          candidateSegments.add(segmentName);
        }
      }
    }

    // Find closest segment among candidates
    let closestSegment = null;
    let minDistance = Infinity;

    for (const segmentName of candidateSegments) {
      const polylineData = this.segments.get(segmentName);
      if (!polylineData) continue;

      const coords = polylineData.coordinates;
      
      // Check distance to segment using simplified line segment distance
      for (let i = 0; i < coords.length - 1; i++) {
        const distance = this._pointToLineSegmentDistance(
          { lat, lng },
          coords[i],
          coords[i + 1]
        );

        if (distance < minDistance) {
          minDistance = distance;
          closestSegment = polylineData;
        }
      }
    }

    return closestSegment;
  }

  _pointToLineSegmentDistance(point, lineStart, lineEnd) {
    // Simplified distance calculation using degree differences
    // This is approximate but much faster than haversine for short distances
    const A = point.lng - lineStart.lng;
    const B = point.lat - lineStart.lat;
    const C = lineEnd.lng - lineStart.lng;
    const D = lineEnd.lat - lineStart.lat;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) {
      // Point is the same as line start
      return Math.sqrt(A * A + B * B);
    }

    let param = dot / lenSq;
    param = Math.max(0, Math.min(1, param));

    const xx = lineStart.lng + param * C;
    const yy = lineStart.lat + param * D;

    const dx = point.lng - xx;
    const dy = point.lat - yy;
    
    return Math.sqrt(dx * dx + dy * dy);
  }

  clear() {
    this.grid.clear();
    this.segments.clear();
  }
}

export default SpatialIndex;

if (typeof module !== "undefined" && module.exports) {
  module.exports = SpatialIndex;
}
