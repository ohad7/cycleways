export function routeRestoreDecision(routeToken, routeManagerStatus) {
  if (!routeToken) return "idle";
  if (routeManagerStatus !== "ready") return "wait";
  return "load";
}
