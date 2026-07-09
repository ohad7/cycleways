import lTurn from "./routes/l-turn.js";
import baniasGanHatsafon from "./routes/banias-gan-hatsafon.js";

const fix = (lat, lng, timestamp, extra = {}) => ({
  lat,
  lng,
  accuracy: 5,
  speed: 4,
  timestamp,
  ...extra,
});

const westApproach = [
  fix(33.1, 35.5955, 0, { heading: 90 }),
  fix(33.1, 35.596, 1000, { heading: 90 }),
  fix(33.1, 35.5965, 2000, { heading: 90 }),
];

const southwestTurnApproach = [
  fix(33.099, 35.5955, 0, { heading: 90 }),
  fix(33.099, 35.5988, 1000, { heading: 90 }),
  fix(33.099, 35.5994, 2000, { heading: 90 }),
  fix(33.0992, 35.6, 3000, { heading: 0 }),
];

const sdeEliezerJunction = fix(33.045963, 35.572792, 0, {
  heading: 25,
  speed: 0,
});

export default [
  {
    name: "camera-approach-too-far",
    description: "CAM: Banias route intro from Sde Eliezer Junction, too far for in-app approach",
    group: "camera",
    camera: true,
    cameraStart: "ride-intro",
    route: { routeState: baniasGanHatsafon },
    connector: "none",
    track: {
      fixes: [
        sdeEliezerJunction,
        fix(33.0461, 35.57285, 1000, { heading: 25, speed: 1 }),
      ],
    },
    expect: [
      { type: "status", value: "approaching" },
      { type: "camera-stage", value: "approach-too-far" },
      { type: "camera-mode", value: "follow" },
      { type: "camera-pitch", stage: "approach-too-far", value: 55 },
    ],
  },
  {
    name: "camera-approach-show-leg",
    description: "CAM: visual connector leg, no narrated approach cue",
    group: "camera",
    camera: true,
    route: { routeState: lTurn },
    connector: "show-leg",
    track: { fixes: westApproach },
    expect: [
      { type: "status", value: "approaching" },
      { type: "camera-stage", value: "approach-show-leg" },
      { type: "camera-mode", value: "fit" },
      { type: "camera-pitch", stage: "approach-show-leg", value: 20 },
    ],
  },
  {
    name: "camera-approach-guide",
    description: "CAM: guided approach leg follow camera",
    group: "camera",
    camera: true,
    route: { routeState: lTurn },
    connector: "straight-line",
    track: { fixes: westApproach },
    expect: [
      { type: "status", value: "approaching" },
      { type: "camera-stage", value: "approach-guide" },
      { type: "camera-mode", value: "follow" },
      { type: "camera-pitch", stage: "approach-guide", value: 55 },
    ],
  },
  {
    name: "camera-approach-guide-pre-turn",
    description: "CAM: guided approach leg cue framing before a connector turn",
    group: "camera",
    camera: true,
    route: { routeState: lTurn },
    connector: "guide-turn",
    track: { fixes: southwestTurnApproach },
    expect: [
      { type: "status", value: "approaching" },
      { type: "camera-stage", value: "approach-guide-pre-turn" },
      { type: "camera-mode", value: "follow" },
      { type: "camera-pitch", stage: "approach-guide-pre-turn", value: 35 },
    ],
  },
  {
    name: "camera-join-route",
    description: "CAM: connector-to-main-route seam transition",
    group: "camera",
    camera: true,
    route: { routeState: lTurn },
    connector: "straight-line",
    track: {
      fixes: [
        ...westApproach,
        fix(33.1, 35.6, 3000, { heading: 90 }),
        fix(33.1, 35.6002, 4000, { heading: 90 }),
      ],
    },
    expect: [
      { type: "acquired" },
      { type: "camera-stage", value: "join-route" },
      { type: "camera-pitch", stage: "join-route", value: 40 },
    ],
  },
];
