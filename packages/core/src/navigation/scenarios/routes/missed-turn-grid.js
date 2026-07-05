const LAT = 33.1;
const LNG = 35.6;
const METERS_PER_DEG_LAT = 111320;
const METERS_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);

export function xy(xMeters, yMeters) {
  return {
    lat: LAT + yMeters / METERS_PER_DEG_LAT,
    lng: LNG + xMeters / METERS_PER_DEG_LNG,
  };
}

const geometry = [
  xy(0, 0),
  xy(150, 0),
  xy(300, 0),
  xy(450, 0),
  xy(600, 0),
  xy(600, 150),
  xy(600, 300),
  xy(750, 300),
  xy(900, 300),
  xy(1050, 300),
  xy(1200, 300),
  xy(1200, 450),
  xy(1200, 600),
];

export default {
  points: [xy(0, 0), xy(600, 0), xy(600, 300), xy(1200, 300), xy(1200, 600)],
  selectedSegments: [
    "דרך הפרדס",
    "שביל הצפון",
    "דרך המטעים",
    "שביל האקליפטוסים",
  ],
  geometry,
  segmentSpans: [
    {
      startMeters: 0,
      endMeters: 600,
      name: "דרך הפרדס",
      cwSegmentId: 101,
      onNetwork: true,
      routeClass: "cycleway",
    },
    {
      startMeters: 600,
      endMeters: 900,
      name: "שביל הצפון",
      cwSegmentId: 102,
      onNetwork: true,
      routeClass: "path",
    },
    {
      startMeters: 900,
      endMeters: 1500,
      name: "דרך המטעים",
      cwSegmentId: 103,
      onNetwork: true,
      routeClass: "cycleway",
    },
    {
      startMeters: 1500,
      endMeters: 1800,
      name: "שביל האקליפטוסים",
      cwSegmentId: 104,
      onNetwork: true,
      routeClass: "path",
    },
  ],
  distance: 1800,
};
