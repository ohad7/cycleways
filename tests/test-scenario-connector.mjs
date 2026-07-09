import assert from "node:assert/strict";
import { createScenarioConnectorAdapter } from "@cycleways/core/navigation/scenarioConnector.js";

const request = {
  requestId: 1,
  from: { lat: 33.1, lng: 35.59 },
  to: { lat: 33.1, lng: 35.6 },
  targetMode: "start",
  targetProgressMeters: 0,
  purpose: "initial",
  attempt: 1,
};

{
  const adapter = createScenarioConnectorAdapter([
    {
      id: "initial-guide",
      match: {
        targetMode: "start",
        purpose: "initial",
        attempt: 1,
        from: request.from,
        to: request.to,
      },
      result: { geometry: [request.from, request.to] },
    },
  ], { journeyId: "semantic-match" });
  assert.deepEqual(adapter(request).geometry, [request.from, request.to]);
  assert.equal(adapter.assertComplete(), true);
  assert.equal(adapter.getDiagnostics().history[0].responseId, "initial-guide");
  assert.throws(() => adapter(request), /matched none/, "duplicate consumption fails");
}

{
  const adapter = createScenarioConnectorAdapter([
    {
      id: "refresh-only",
      match: { targetMode: "start", purpose: "refresh", attempt: 2 },
      result: { geometry: [request.from, request.to] },
    },
  ], { journeyId: "wrong-purpose" });
  assert.throws(() => adapter(request), /matched none/);
  assert.throws(() => adapter.assertComplete(), /unused responses: refresh-only/);
}

{
  const adapter = createScenarioConnectorAdapter([
    { id: "a", match: { targetMode: "start" }, result: {} },
    { id: "b", match: { targetMode: "start" }, result: {} },
  ], { journeyId: "ambiguous" });
  assert.throws(() => adapter(request), /matched a, b/);
}

{
  const adapter = createScenarioConnectorAdapter([
    {
      id: "progress-specific",
      match: {
        targetMode: "rejoin",
        purpose: "initial",
        attempt: 1,
        targetProgressMeters: 120,
      },
      result: {},
    },
  ]);
  assert.throws(
    () => adapter({ ...request, targetMode: "rejoin", targetProgressMeters: null }),
    /matched none/,
  );
}

console.log("scenario connector tests passed");
