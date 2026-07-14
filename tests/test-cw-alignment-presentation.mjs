import assert from "node:assert/strict";
import {
  directionLabel,
  routeCommandMessage,
  segmentDirectionAvailability,
  unavailableDirectionMessage,
} from "../packages/core/src/routing/cwAlignmentPresentation.js";

const divided = {
  endpoints: {
    a: { coordinate: [35, 33], labels: { he: "קריית שמונה", en: "Kiryat Shmona" } },
    b: { coordinate: [35, 33.1], labels: { he: "מסעדה", en: "Mas'ade" } },
  },
  alignments: {
    aToB: { disposition: "accepted" },
    bToA: { disposition: "accepted" },
  },
};
assert.equal(segmentDirectionAvailability(divided, "he").label, "לשני הכיוונים");
assert.equal(directionLabel(divided, "aToB", "en"), "Toward Mas'ade");
assert.equal(directionLabel(divided, "bToA", "he"), "לכיוון קריית שמונה");
const fallback = structuredClone(divided);
fallback.endpoints.a.labels = {};
assert.equal(directionLabel(fallback, "bToA", "en"), "Toward south");
assert.match(
  unavailableDirectionMessage({ unavailableReasonCode: "no_canonical_alignment" }, "en"),
  /no published riding alignment/,
);
assert.match(routeCommandMessage("return-path-unavailable", "he"), /לא השתנה/);

console.log("CW alignment presentation ok");
