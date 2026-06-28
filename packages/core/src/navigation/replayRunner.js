// packages/core/src/navigation/replayRunner.js
// Pure node harness: drive the real navigation session over a recorded or
// generated fix stream and capture the resulting state timeline. No clocks —
// timestamps come from the fixes.
import {
  NAV_ACTIONS,
  createNavigationSession,
} from "./navigationSession.js";

export function replaySession(navigationRoute, fixes, options = {}) {
  const session = createNavigationSession(navigationRoute, options.sessionOptions);
  session.dispatch({ type: NAV_ACTIONS.START });
  session.dispatch({ type: NAV_ACTIONS.PERMISSION_GRANTED, background: false });
  const timeline = [];
  for (const fix of Array.isArray(fixes) ? fixes : []) {
    session.dispatch({ type: NAV_ACTIONS.LOCATION, fix });
    timeline.push(session.getState());
  }
  return { timeline, last: timeline[timeline.length - 1] ?? session.getState() };
}
