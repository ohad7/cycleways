#!/usr/bin/env python3
"""Plain-assert tests for build_roundabouts.py."""

import json

from build_roundabouts import build_payload, extract_roundabout_candidates, source_coverage


def way(way_id, nodes, coords, junction="roundabout"):
    return {
        "type": "way",
        "id": way_id,
        "nodes": nodes,
        "geometry": [{"lat": lat, "lon": lng} for lat, lng in coords],
        "tags": {"highway": "residential", "junction": junction},
    }


plain_query = 'way["highway"~"^(residential)$"](poly:"...");'
coverage = source_coverage(plain_query)
assert coverage["roundaboutWays"] == "available"
assert coverage["miniRoundaboutNodes"] == "not-requested-by-source"

mini_query = plain_query + '\nnode["highway"="mini_roundabout"](poly:"...");'
assert source_coverage(mini_query)["miniRoundaboutNodes"] == "available"

ring_a = way(
    10,
    [1, 2, 3],
    [(33.0, 35.0), (33.0001, 35.0001), (33.0, 35.0002)],
)
ring_b = way(
    11,
    [3, 4, 1],
    [(33.0, 35.0002), (32.9999, 35.0001), (33.0, 35.0)],
)
near_but_distinct = way(
    12,
    [20, 21, 20],
    [(33.0003, 35.0), (33.00035, 35.0001), (33.0003, 35.0)],
    junction="circular",
)
mini = {
    "type": "node",
    "id": 99,
    "lat": 33.1,
    "lon": 35.1,
    "tags": {"highway": "mini_roundabout"},
}
data = {"elements": [ring_a, ring_b, near_but_distinct, mini]}

without_minis = extract_roundabout_candidates(data, coverage)
assert len(without_minis) == 2, without_minis
merged = next(item for item in without_minis if item["id"] == "osm-ways:10,11")
assert merged["classification"] == "roundabout"
assert "non_closed" not in merged["warnings"]
separate = next(item for item in without_minis if item["id"] == "osm-ways:12")
assert separate["classification"] == "circular"

with_minis = extract_roundabout_candidates(data, source_coverage(mini_query))
assert len(with_minis) == 3
mini_out = next(item for item in with_minis if item["id"] == "osm-node:99")
assert mini_out["radiusM"] == 10.0

changed = json.loads(json.dumps(data))
changed["elements"][0]["geometry"][1]["lat"] += 0.0001
before = extract_roundabout_candidates(data, coverage)[0]["fingerprint"]
after = extract_roundabout_candidates(changed, coverage)[0]["fingerprint"]
assert before != after

payload = build_payload(json.dumps(data).encode(), plain_query.encode())
assert payload["sourceDigest"].startswith("sha256:")
assert payload["queryDigest"].startswith("sha256:")
assert payload["coverage"]["miniRoundaboutNodes"] == "not-requested-by-source"

print("build_roundabouts tests passed")
