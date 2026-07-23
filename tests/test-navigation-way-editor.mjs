import assert from "node:assert/strict";

import {
  acknowledgeStructureIssue,
  applySegmentGuidance,
  applySuggestionGroup,
  applyWay,
  assignmentFacilityConflict,
  emptyRegistry,
  guidancePreview,
  indexActiveSegments,
  introducedGuidanceBlockers,
  reviewGuidanceDocuments,
  revokeStructureAcknowledgement,
} from "../editor/lib/navigation-ways.mjs";

function line(id, name, coordinates, extra = {}) {
  return {
    type: "Feature",
    properties: { id, name, status: "active", roadType: "paved", ...extra },
    geometry: { type: "LineString", coordinates },
  };
}

const straight = (startLng, lat, steps = 20) =>
  Array.from({ length: steps + 1 }, (_, index) => [startLng + index * 0.0003, lat]);

// --- indexing -------------------------------------------------------------
{
  const source = {
    type: "FeatureCollection",
    features: [
      line(1, "A", straight(35.6, 33.2)),
      line(2, "B", straight(35.61, 33.2), { status: "deprecated" }),
      line(3, "C", straight(35.62, 33.2), { status: "draft" }),
    ],
  };
  const index = indexActiveSegments(source);
  assert.deepEqual([...index.keys()], [1], "draft and deprecated stay out of active coverage");
}

// --- classification writes ------------------------------------------------
{
  const source = {
    type: "FeatureCollection",
    features: [line(1, "A", straight(35.6, 33.2))],
  };
  const next = applySegmentGuidance(source, 1, { role: "unnamed", kind: "connector" });
  assert.deepEqual(next.features[0].properties.guidance, { role: "unnamed", kind: "connector" });
  assert.equal(source.features[0].properties.guidance, undefined, "input is not mutated");

  const cleared = applySegmentGuidance(next, 1, null);
  assert.equal(cleared.features[0].properties.guidance, undefined);
  assert.throws(() => applySegmentGuidance(source, 99, { role: "unnamed", kind: "path" }));
}

// --- coverage and issue-set parity ---------------------------------------
{
  const source = {
    type: "FeatureCollection",
    features: [
      line(1, "כביש 99 א", straight(35.6, 33.2), {
        guidance: { role: "named-way", wayId: "road-99" },
      }),
      line(2, "כביש 99 ב", straight(35.607, 33.2), {
        guidance: { role: "named-way", wayId: "road-99" },
      }),
      line(3, "מקטע לא מסווג", straight(35.7, 33.3)),
    ],
  };
  const registry = applyWay(emptyRegistry(), "road-99", {
    name: "כביש 99",
    kind: "road",
    aliases: [],
    spokenName: null,
  });

  const review = reviewGuidanceDocuments(source, registry);
  assert.equal(review.coverage.activeSegments, 3);
  assert.equal(review.coverage.reviewedSegments, 2);
  assert.deepEqual(review.coverage.unreviewedSegmentIds, [3]);
  assert.equal(review.coverage.coverageComplete, false);
  // Missing classification is a warning during migration and never blocks.
  assert.equal(review.blocking.length, 0);
  assert.ok(review.warnings.some((entry) => entry.code === "segment-unreviewed"));

  // ...and a blocker once enforcement flips.
  const required = reviewGuidanceDocuments(source, { ...registry, enforcement: "required" });
  assert.ok(required.blocking.some((entry) => entry.code === "segment-unreviewed"));
}

// --- structure findings never demand an ID split -------------------------
{
  // Two members of one road that CycleWays maps as disjoint stretches.
  const source = {
    type: "FeatureCollection",
    features: [
      line(1, "כביש 918 צפון", straight(35.6, 33.2), {
        guidance: { role: "named-way", wayId: "road-918" },
      }),
      line(2, "כביש 918 ירדן", straight(35.8, 33.4), {
        guidance: { role: "named-way", wayId: "road-918" },
      }),
    ],
  };
  const registry = applyWay(emptyRegistry(), "road-918", {
    name: "כביש 918",
    kind: "road",
    aliases: [],
    spokenName: null,
  });

  const review = reviewGuidanceDocuments(source, registry);
  const finding = review.issues.find((entry) => entry.code === "way-structure-multi-component");
  assert.ok(finding, "a two-component way is reported");
  assert.equal(finding.severity, "warning", "and never blocks");
  assert.equal(finding.acknowledged, false);
  assert.equal(review.blocking.length, 0);

  // Acknowledging the exact fingerprint clears it without splitting the way.
  const acknowledged = acknowledgeStructureIssue(registry, "road-918", finding.fingerprint);
  const after = reviewGuidanceDocuments(source, acknowledged);
  const cleared = after.issues.find((entry) => entry.code === "way-structure-multi-component");
  assert.equal(cleared.acknowledged, true);
  assert.equal(after.ways[0].memberIds.length, 2, "both members stay under one way ID");

  // A membership change invalidates the acknowledgement rather than silently
  // carrying it over onto different evidence.
  const grown = {
    ...source,
    features: [
      ...source.features,
      line(9, "כביש 918 נוסף", straight(36.0, 33.6), {
        guidance: { role: "named-way", wayId: "road-918" },
      }),
    ],
  };
  const afterChange = reviewGuidanceDocuments(grown, acknowledged);
  assert.equal(
    afterChange.issues.find((entry) => entry.code === "way-structure-multi-component").acknowledged,
    false,
    "an acknowledgement does not survive a membership change",
  );
  assert.ok(
    afterChange.issues.some((entry) => entry.code === "structure-acknowledgement-unmatched"),
  );

  const revoked = revokeStructureAcknowledgement(acknowledged, "road-918", finding.fingerprint);
  assert.equal(
    reviewGuidanceDocuments(source, revoked).issues.find(
      (entry) => entry.code === "way-structure-multi-component",
    ).acknowledged,
    false,
  );
}

// --- the parallel cycleway cannot be absorbed ----------------------------
{
  const source = {
    type: "FeatureCollection",
    features: [
      line(174, "כביש 99", straight(35.6, 33.2), {
        roadType: "road",
        guidance: { role: "named-way", wayId: "road-99" },
      }),
      // The cycleway running 15 m alongside it, for 600 m.
      line(97, "שביל אופניים 99", straight(35.6, 33.200135), {
        roadType: "paved",
        guidance: { role: "named-way", wayId: "road-99" },
      }),
    ],
  };
  const registry = applyWay(emptyRegistry(), "road-99", {
    name: "כביש 99",
    kind: "road",
    aliases: [],
    spokenName: null,
  });
  const review = reviewGuidanceDocuments(source, registry);
  const risk = review.issues.find((entry) => entry.code === "parallel-facility-risk");
  assert.ok(risk, "a materially parallel member is caught");
  assert.equal(risk.severity, "error", "and blocks until resolved or approved");
  assert.ok(review.blocking.length > 0);
}

// A facility-class conflict is refused before the write, not reported after it.
{
  const source = {
    type: "FeatureCollection",
    features: [line(174, "כביש 99", straight(35.6, 33.2), { roadType: "road" })],
  };
  const registry = applyWay(emptyRegistry(), "cycleway-99", {
    name: "שביל אופניים 99",
    kind: "cycleway",
    aliases: [],
    spokenName: null,
  });
  const conflict = assignmentFacilityConflict(source, registry, 174, "cycleway-99");
  assert.ok(conflict);
  assert.equal(conflict.waivable, false);

  const compatible = applyWay(registry, "road-99", {
    name: "כביש 99",
    kind: "road",
    aliases: [],
    spokenName: null,
  });
  assert.equal(assignmentFacilityConflict(source, compatible, 174, "road-99"), null);
}

// An unrelated canonical blocker stays visible but does not freeze incremental
// curation. A new blocker caused by the proposed edit still rejects the write.
{
  const currentReview = {
    blocking: [{
      code: "facility-class-conflict",
      severity: "error",
      wayId: "kfar-yuval-fields",
      segmentId: 121,
      wayKind: "dirt-road",
      wayFacilityClass: "roadway",
      memberFacilityClass: "trail-path",
      waivable: false,
    }],
  };
  const compatibleAssignment = {
    blocking: [...currentReview.blocking],
  };
  assert.deepEqual(
    introducedGuidanceBlockers(currentReview, compatibleAssignment),
    [],
    "segment 121 must not prevent an unrelated compatible assignment",
  );

  const introduced = {
    blocking: [
      ...currentReview.blocking,
      {
        code: "facility-class-conflict",
        severity: "error",
        wayId: "cycleway-99",
        segmentId: 172,
        wayKind: "cycleway",
        wayFacilityClass: "cycleway",
        memberFacilityClass: "roadway",
        waivable: false,
      },
    ],
  };
  assert.deepEqual(
    introducedGuidanceBlockers(currentReview, introduced),
    [introduced.blocking[1]],
    "a blocker introduced by the edited assignment must still be rejected",
  );

  const materiallyChanged = {
    blocking: [{
      ...currentReview.blocking[0],
      memberFacilityClass: "cycleway",
    }],
  };
  assert.deepEqual(
    introducedGuidanceBlockers(currentReview, materiallyChanged),
    [materiallyChanged.blocking[0]],
    "a materially changed blocker is not grandfathered",
  );
}

// --- suggestion groups ----------------------------------------------------
{
  const source = {
    type: "FeatureCollection",
    features: [
      line(16, "דרך הפטרולים גבעת האם", straight(35.6, 33.2)),
      line(18, "דרך הפטרולים כפר סאלד", straight(35.607, 33.2)),
    ],
  };
  const result = applySuggestionGroup(source, emptyRegistry(), {
    role: "named-way",
    wayId: "patrol-road",
    name: "דרך הפטרולים",
    kind: "dirt-road",
    segmentIds: [16, 18],
    sectionLabels: { 16: "גבעת האם" },
    // Accepting a group must not promote a suggested audible form to canonical.
    spokenName: "דֶּרֶךְ הַפַּטְרוֹלִים",
  });
  assert.equal(result.registry.ways["patrol-road"].name, "דרך הפטרולים");
  assert.equal(
    result.registry.ways["patrol-road"].spokenName,
    null,
    "a suggested audible form stays a listening candidate until device evidence",
  );
  assert.deepEqual(result.source.features[0].properties.guidance, {
    role: "named-way",
    wayId: "patrol-road",
    sectionLabel: "גבעת האם",
  });
  assert.deepEqual(result.source.features[1].properties.guidance, {
    role: "named-way",
    wayId: "patrol-road",
  });

  const standalone = applySuggestionGroup(source, emptyRegistry(), {
    role: "standalone",
    name: "גשר עינות ירדן",
    kind: "bridge",
    segmentIds: [16],
  });
  assert.deepEqual(standalone.source.features[0].properties.guidance, {
    role: "standalone",
    name: "גשר עינות ירדן",
    kind: "bridge",
  });
}

// --- inspector preview ----------------------------------------------------
{
  const registry = applyWay(emptyRegistry(), "road-99", {
    name: "כביש 99",
    kind: "road",
    aliases: [],
    spokenName: null,
  });
  assert.equal(
    guidancePreview({ role: "named-way", wayId: "road-99" }, registry).title,
    "כביש 99",
  );
  // Unreviewed previews as a facility class, exactly as it will read at runtime.
  const unreviewed = guidancePreview(null, registry, "track");
  assert.equal(unreviewed.title, "דרך עפר");
  assert.equal(unreviewed.isFallback, true);
  assert.equal(guidancePreview({ role: "unnamed", kind: "connector" }, registry).title, "מקטע מקשר");
}

console.log("test-navigation-way-editor: OK");
