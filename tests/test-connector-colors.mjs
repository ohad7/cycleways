import assert from "node:assert/strict";
import {
  connectorCostColor,
  connectorClassColor,
  CONNECTOR_COST_LEGEND,
  CONNECTOR_CLASS_LEGEND,
} from "../editor/lib/connectorColors.mjs";

// Excluded / non-finite → grey.
assert.equal(connectorCostColor(Infinity), "#9ca3af");
assert.equal(connectorCostColor(NaN), "#9ca3af");

// Finite multipliers → a hex color; cheaper and pricier differ.
const cheap = connectorCostColor(1);
const pricey = connectorCostColor(4);
assert.match(cheap, /^#[0-9a-fA-F]{6}$/);
assert.match(pricey, /^#[0-9a-fA-F]{6}$/);
assert.notEqual(cheap, pricey);

// Classification colors are stable per class and distinct across a few.
assert.match(connectorClassColor("road"), /^#[0-9a-fA-F]{6}$/);
assert.notEqual(connectorClassColor("road"), connectorClassColor("cycle"));
assert.equal(connectorClassColor("road"), connectorClassColor("road"));

assert.ok(CONNECTOR_COST_LEGEND.length >= 2);
assert.ok(CONNECTOR_CLASS_LEGEND.length >= 3);

console.log("connector-colors OK");
