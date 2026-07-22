export const CW_NETWORK_DETAIL_FADE_START_ZOOM = 10.5;
export const CW_NETWORK_DETAIL_FULL_ZOOM = 12;

export const CW_NETWORK_DETAIL_ROLES = Object.freeze({
  ALWAYS: "always",
  LOGICAL_OVERVIEW: "logical-overview",
  PHYSICAL_DETAIL: "physical-detail",
});

export function cwNetworkDetailOpacityExpression(baseOpacity) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    CW_NETWORK_DETAIL_FADE_START_ZOOM,
    [
      "case",
      [
        "==",
        ["get", "networkDetailRole"],
        CW_NETWORK_DETAIL_ROLES.PHYSICAL_DETAIL,
      ],
      0,
      baseOpacity,
    ],
    CW_NETWORK_DETAIL_FULL_ZOOM,
    [
      "case",
      [
        "==",
        ["get", "networkDetailRole"],
        CW_NETWORK_DETAIL_ROLES.LOGICAL_OVERVIEW,
      ],
      0,
      baseOpacity,
    ],
  ];
}
