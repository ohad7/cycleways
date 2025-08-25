import { getDistance } from './distance.js';

/**
 * Elevation calculation utilities
 */

/**
 * Smooth elevation values using distance-based window smoothing
 * @param {Array} coords - Array of coordinate objects with {lat, lng, elevation}
 * @param {number} distanceWindow - Distance window in meters (default: 100)
 * @returns {Array} Smoothed coordinates
 */
export function smoothElevations(coords, distanceWindow = 100) {
  if (coords.length === 0) {
    return coords;
  }

  // Ensure all coordinates have elevation values
  const coordsWithElevation = coords.map((coord) => {
    let elevation;
    if (coord.elevation !== undefined) {
      elevation = coord.elevation;
    } else {
      // Fallback calculation if elevation is not available
      elevation =
        200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    }
    return {
      lat: coord.lat,
      lng: coord.lng,
      elevation: elevation,
    };
  });

  // Apply distance-based window smoothing
  const smoothedElevations = distanceWindowSmoothing(
    coordsWithElevation,
    distanceWindow,
    (index) => coordsWithElevation[index].elevation,
    (accumulated, start, end) => accumulated / (end - start + 1),
  );

  // Preserve original first and last elevations
  if (coordsWithElevation.length > 0) {
    smoothedElevations[0] = coordsWithElevation[0].elevation;
    smoothedElevations[coordsWithElevation.length - 1] =
      coordsWithElevation[coordsWithElevation.length - 1].elevation;
  }

  // Create smoothed coordinate objects
  const smoothed = coordsWithElevation.map((coord, index) => ({
    lat: coord.lat,
    lng: coord.lng,
    elevation: smoothedElevations[index],
  }));

  return smoothed;
}

/**
 * Distance-based window smoothing algorithm
 * @param {Array} points - Array of points
 * @param {number} distanceWindow - Distance window
 * @param {Function} accumulate - Function to accumulate values
 * @param {Function} compute - Function to compute final value
 * @param {Function} remove - Optional function to remove values
 * @returns {Array} Smoothed values
 */
export function distanceWindowSmoothing(
  points,
  distanceWindow,   
  accumulate,
  compute,
  remove = null,
) {
  let result = [];

  let start = 0,
    end = 0,
    accumulated = 0;

  for (let i = 0; i < points.length; i++) {
    // Remove points that are too far behind
    while (
      start + 1 < i &&
      getDistance(points[start], points[i]) > distanceWindow
    ) {
      if (remove) {
        accumulated -= remove(start);
      } else {
        accumulated -= accumulate(start);
      }
      start++;
    }

    // Add points that are within distance ahead
    while (
      end < points.length &&
      getDistance(points[i], points[end]) <= distanceWindow
    ) {
      accumulated += accumulate(end);
      end++;
    }

    result[i] = compute(accumulated, start, end - 1);
  }

  return result;
}