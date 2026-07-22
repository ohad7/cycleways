import assert from "node:assert/strict";
import { parseAlignedGpsCsv, parseExiftoolGpsRows } from "../scripts/demo-studio/goproTelemetry.mjs";
import { findGpmfStream, parseProbe } from "../scripts/demo-studio/mediaProbe.mjs";

const text = [
  "0.000,3,33.100001,35.200001,90,4.2,6",
  "1.000,0,0,0,-,-,-",
  "2.000,2,33.100101,35.200101,91,4.1,8",
  "2.000,3,33.100102,35.200102,91,4.1,8",
  "malformed",
].join("\n");
const parsed = parseExiftoolGpsRows(text);
assert.equal(parsed.rows.length, 3);
assert.equal(parsed.stats.noLock, 1);
assert.equal(parsed.stats.duplicateTimes, 1);
assert.equal(parsed.stats.malformed, 1);

const aligned = parseAlignedGpsCsv("time_s,latitude,longitude,altitude_m,speed_mps\n0,33,35,10,2\n1,33.1,35.1,11,3\n");
assert.equal(aligned.rows.length, 2);

const probe = { streams: [{ index: 0, codec_type: "video", width: 1920, height: 1080 }, { index: 2, codec_type: "data", codec_tag_string: "gpmd" }], format: { duration: "12.5" } };
assert.equal(findGpmfStream(probe).index, 2);
assert.equal(parseProbe(probe).durationSeconds, 12.5);

console.log("demo telemetry tests passed");
