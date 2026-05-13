import assert from "node:assert/strict";
import {
  distanceToRouteGeometry,
  getDataPointLocation,
  isDataPointOnRoute,
  ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS,
} from "../utils/route-data.js";

const routeCoordinates = [
  { lat: 33, lng: 35 },
  { lat: 33, lng: 35.01 },
];

const onRouteDataPoint = {
  type: "gate",
  information: "Gate on route",
  location: [33, 35.005],
};

const farDataPoint = {
  type: "mud",
  information: "Mud away from route",
  location: [33.01, 35.005],
};

assert.deepEqual(getDataPointLocation(onRouteDataPoint), {
  lat: 33,
  lng: 35.005,
});
assert.equal(getDataPointLocation({ location: ["bad", 35] }), null);
assert.ok(
  distanceToRouteGeometry(
    getDataPointLocation(onRouteDataPoint),
    routeCoordinates,
  ) < 1,
);
assert.ok(
  distanceToRouteGeometry(getDataPointLocation(farDataPoint), routeCoordinates) >
    ROUTE_DATA_POINT_TRIGGER_DISTANCE_METERS,
);
assert.equal(isDataPointOnRoute(onRouteDataPoint, routeCoordinates), true);
assert.equal(isDataPointOnRoute(farDataPoint, routeCoordinates), false);
assert.equal(
  isDataPointOnRoute({ type: "warning", information: "Segment-wide warning" }, []),
  true,
);

console.log("Route data point filtering tests passed");
