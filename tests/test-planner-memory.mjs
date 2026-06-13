import assert from "node:assert/strict";
import {
  parseDraft,
  serializeDraft,
  parseRecents,
  upsertRecent,
  serializeRecents,
  RECENTS_CAP,
} from "@cycleways/core/data/plannerMemory.js";

// Draft round-trips; junk parses to null.
{
  const draft = { param: "abc123", distanceKm: 12.4, savedAt: 1718000000000 };
  assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
  assert.equal(parseDraft(null), null);
  assert.equal(parseDraft("not json"), null);
  assert.equal(parseDraft('{"noParam":1}'), null);
}

// Recents: newest first, deduped by param (re-adding moves to front,
// refreshes metadata), capped.
{
  const e = (n) => ({ param: `p${n}`, name: `route ${n}`, distanceKm: n, savedAt: n });
  let list = [];
  for (let n = 1; n <= 7; n += 1) list = upsertRecent(list, e(n));
  assert.equal(list.length, RECENTS_CAP);
  assert.equal(RECENTS_CAP, 5);
  assert.deepEqual(list.map((r) => r.param), ["p7", "p6", "p5", "p4", "p3"]);
  list = upsertRecent(list, { ...e(5), name: "renamed" });
  assert.equal(list.length, RECENTS_CAP);
  assert.equal(list[0].param, "p5");
  assert.equal(list[0].name, "renamed");
}

// Recents serialization round-trips; junk parses to [].
{
  const list = upsertRecent([], { param: "x", name: "שם", distanceKm: 3.2, savedAt: 5 });
  assert.deepEqual(parseRecents(serializeRecents(list)), list);
  assert.deepEqual(parseRecents(null), []);
  assert.deepEqual(parseRecents("oops"), []);
  assert.deepEqual(parseRecents('{"a":1}'), []);
  // Entries missing a param are dropped on parse.
  assert.deepEqual(parseRecents('[{"name":"no param"},{"param":"ok"}]').length, 1);
}

console.log("planner memory tests passed");
