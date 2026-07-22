import { validateDemoBundle } from "./demoBundle.js";

export function demoScenarioFromBundle(value) {
  const bundle = validateDemoBundle(value);
  return {
    name: `demo-${bundle.id}`,
    description: "Navigation Demo Studio replay",
    route: { routeState: bundle.routeState },
    track: { fixes: bundle.fixes },
    connector: "straight-line",
    expect: [],
  };
}
