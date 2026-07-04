// Milestone evaluator for nav scenarios (nav-scenario-harness). Checks a
// scenario's `expect` list against the user-visible timeline produced by
// scenarioRunner.buildUserTimeline. Deliberately small vocabulary — see the
// switch below; unknown types are failures so typos never silently pass.

function progressOf(entry) {
  const value = Number(entry?.progressMeters);
  return Number.isFinite(value) ? value : null;
}

function textOf(entry, field) {
  return String(entry?.presentation?.[field] ?? "");
}

function rejoinTargetProgressOf(entry) {
  const raw = entry?.rejoinTargetProgressMeters;
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function evaluateExpectations(expectations, timeline) {
  const failures = [];
  const entries = Array.isArray(timeline) ? timeline : [];
  const firstOffRouteIndex = entries.findIndex((e) => e.status === "off-route");

  for (const exp of Array.isArray(expectations) ? expectations : []) {
    const fail = (message) => failures.push(`${JSON.stringify(exp)} — ${message}`);

    switch (exp.type) {
      case "status": {
        const first = entries.find((e) => e.status === exp.value);
        if (exp.never === true) {
          if (first) fail(`status "${exp.value}" occurred at entry ${first.index ?? entries.indexOf(first)}`);
          break;
        }
        if (!first) {
          fail(`status "${exp.value}" never occurred`);
          break;
        }
        if (Array.isArray(exp.betweenMeters)) {
          const p = progressOf(first);
          const [min, max] = exp.betweenMeters;
          if (p === null || p < min || p > max) {
            fail(`first "${exp.value}" at ${p}m, expected within [${min}, ${max}]`);
          }
        }
        break;
      }

      case "banner": {
        const field = exp.field ?? "cueText";
        const first = entries.find((e) => textOf(e, field).includes(exp.match));
        if (exp.never === true) {
          if (first) fail(`"${exp.match}" appeared in ${field}`);
          break;
        }
        if (!first) {
          fail(`"${exp.match}" never appeared in ${field}`);
          break;
        }
        const p = progressOf(first);
        if (exp.beforeMeters !== undefined && (p === null || p > exp.beforeMeters)) {
          fail(`first "${exp.match}" at ${p}m, expected before ${exp.beforeMeters}m`);
        }
        if (exp.afterMeters !== undefined && (p === null || p < exp.afterMeters)) {
          fail(`first "${exp.match}" at ${p}m, expected after ${exp.afterMeters}m`);
        }
        break;
      }

      case "acquired":
        if (!entries.some((e) => e.justAcquired === true)) {
          fail("route was never acquired");
        }
        break;

      case "rerouted": {
        if (firstOffRouteIndex === -1) {
          fail("never went off-route");
          break;
        }
        const readyIndex = entries.findIndex(
          (e, i) => i > firstOffRouteIndex && e.suggestionStatus === "ready",
        );
        if (readyIndex === -1) {
          fail("no rejoin suggestion became ready after going off-route");
        } else if (
          exp.withinFixesOfOffRoute !== undefined &&
          readyIndex - firstOffRouteIndex > exp.withinFixesOfOffRoute
        ) {
          fail(
            `suggestion ready ${readyIndex - firstOffRouteIndex} entries after off-route (limit ${exp.withinFixesOfOffRoute})`,
          );
        }
        break;
      }

      case "rejoin-target": {
        const candidates = entries.filter((e) => rejoinTargetProgressOf(e) !== null);
        if (candidates.length === 0) {
          fail("no rejoin target was shown");
          break;
        }
        const selected =
          exp.position === "last"
            ? candidates[candidates.length - 1]
            : exp.position === "first"
              ? candidates[0]
              : candidates.find((e) => {
                  if (!Array.isArray(exp.betweenMeters)) return true;
                  const p = rejoinTargetProgressOf(e);
                  const [min, max] = exp.betweenMeters;
                  return p !== null && p >= min && p <= max;
                });
        if (!selected) {
          fail("no rejoin target matched the requested position/window");
          break;
        }
        if (Array.isArray(exp.betweenMeters)) {
          const p = rejoinTargetProgressOf(selected);
          const [min, max] = exp.betweenMeters;
          if (p === null || p < min || p > max) {
            fail(`rejoin target at ${p}m, expected within [${min}, ${max}]`);
          }
        }
        break;
      }

      case "rejoin-target-advances": {
        const values = entries
          .map(rejoinTargetProgressOf)
          .filter((value) => value !== null);
        if (values.length < 2) {
          fail("fewer than two rejoin target samples");
          break;
        }
        const min = Math.min(...values);
        const max = Math.max(...values);
        const required = Number(exp.byMeters ?? 1);
        if (max - min < required) {
          fail(`rejoin target advanced ${max - min}m, expected at least ${required}m`);
        }
        for (let i = 1; i < values.length; i++) {
          const tolerance = Number(exp.toleranceMeters ?? 1);
          if (values[i] + tolerance < values[i - 1]) {
            fail(`rejoin target regressed from ${values[i - 1]}m to ${values[i]}m`);
            break;
          }
        }
        break;
      }

      case "suggestionFailed":
        if (!entries.some((e) => e.connectorResult === "failed")) {
          fail("no connector failure was reported");
        }
        break;

      case "arrived":
        if (!entries.some((e) => e.activeCueType === "arrive")) {
          fail("arrive cue never became active");
        }
        break;

      case "haptic": {
        const fired = entries.some((e) => e.haptic === exp.kind);
        if (exp.never === true) {
          if (fired) fail(`haptic "${exp.kind}" fired`);
        } else if (!fired) {
          fail(`haptic "${exp.kind}" never fired`);
        }
        break;
      }

      case "camera-rotations": {
        // Consecutive finite camera headings that differ = one rotation.
        // `during` restricts counting to entries in that status.
        let rotations = 0;
        let prevHeading = null;
        for (const e of entries) {
          const heading = e.cameraHeadingDeg;
          if (!Number.isFinite(heading)) continue;
          if (
            prevHeading !== null &&
            heading !== prevHeading &&
            (exp.during === undefined || e.status === exp.during)
          ) {
            rotations += 1;
          }
          prevHeading = heading;
        }
        if (rotations > exp.atMost) {
          fail(
            `${rotations} camera rotation(s)${exp.during ? ` during ${exp.during}` : ""}, allowed ${exp.atMost}`,
          );
        }
        break;
      }

      case "wrong-way": {
        const first = entries.find((e) => e.wrongWay === true);
        if (exp.never === true) {
          if (first) {
            fail(`wrong-way warning shown at ${progressOf(first)}m`);
          }
        } else if (!first) {
          fail("wrong-way warning never shown");
        }
        break;
      }

      case "wrong-way-resolved": {
        const firstWrongIndex = entries.findIndex((e) => e.wrongWay === true);
        if (firstWrongIndex === -1) {
          fail("wrong-way warning never shown before resolution");
          break;
        }
        const firstResolved = entries.find(
          (e, i) => i > firstWrongIndex && e.wrongWay === false,
        );
        if (!firstResolved) {
          fail("wrong-way warning never resolved");
          break;
        }
        if (exp.final === true && entries[entries.length - 1]?.wrongWay !== false) {
          fail("final entry is not resolved from wrong-way warning");
        }
        break;
      }

      case "camera-stage": {
        const first = entries.find((e) => e.cameraStage === exp.value);
        if (exp.never === true) {
          if (first) fail(`camera stage "${exp.value}" occurred at ${progressOf(first)}m`);
          break;
        }
        if (!first) {
          fail(`camera stage "${exp.value}" never occurred`);
          break;
        }
        if (Array.isArray(exp.betweenMeters)) {
          const p = progressOf(first);
          const [min, max] = exp.betweenMeters;
          if (p === null || p < min || p > max) {
            fail(`first "${exp.value}" at ${p}m, expected within [${min}, ${max}]`);
          }
        }
        break;
      }

      case "card-mode": {
        const first = entries.find((e) => e.cardMode === exp.value);
        if (exp.never === true) {
          if (first) fail(`card mode "${exp.value}" occurred at ${progressOf(first)}m`);
          break;
        }
        if (!first) {
          fail(`card mode "${exp.value}" never occurred`);
          break;
        }
        if (Array.isArray(exp.betweenMeters)) {
          const p = progressOf(first);
          const [min, max] = exp.betweenMeters;
          if (p === null || p < min || p > max) {
            fail(`first card mode "${exp.value}" at ${p}m, expected within [${min}, ${max}]`);
          }
        }
        break;
      }

      case "chip": {
        const first = entries.find(
          (e) => typeof e.chipText === "string" && e.chipText.includes(exp.match),
        );
        if (exp.never === true) {
          if (first) fail(`chip "${exp.match}" appeared at ${progressOf(first)}m`);
        } else if (!first) {
          fail(`chip "${exp.match}" never appeared`);
        }
        break;
      }

      case "current-road": {
        const first = entries.find(
          (e) => textOf(e, "currentRoadText").includes(exp.match),
        );
        if (exp.never === true) {
          if (first) fail(`current road "${exp.match}" appeared at ${progressOf(first)}m`);
        } else if (!first) {
          fail(`current road "${exp.match}" never appeared`);
        }
        break;
      }

      case "progress-at-least": {
        const last = entries[entries.length - 1];
        const p = last ? progressOf(last) : null;
        if (p === null || p < exp.meters) {
          fail(`final progress ${p}m is below ${exp.meters}m`);
        }
        break;
      }

      default:
        fail(`unknown expectation type "${exp.type}"`);
    }
  }
  return { passed: failures.length === 0, failures };
}
