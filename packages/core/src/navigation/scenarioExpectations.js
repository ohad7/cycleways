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
