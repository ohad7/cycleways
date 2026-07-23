// Visual ride over the catalog route as decoded by the running app. Unlike the
// deterministic camera journeys, this intentionally has no checked-in route
// fixture: selecting it loads the installed catalog token through the planner,
// so promoted geometry and navigation-way names are visible immediately.
export default {
  name: "sovev-beit-hillel-ride",
  description: "רכיבה חזותית במסלול הקטלוג העדכני (סובב בית הלל)",
  visualOnly: true,
  route: { catalogSlug: "sovev-beit-hillel" },
  track: { generate: { speedMps: 8, intervalMs: 1000, jitterM: 6, seed: 21 } },
};
