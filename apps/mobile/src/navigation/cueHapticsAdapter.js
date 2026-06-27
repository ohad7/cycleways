// Native haptic adapter (turn-by-turn Phase 9). Maps the pure planner's
// intensity ("light" | "medium" | "heavy") to an expo-haptics call. The
// decision of whether/when to fire lives in @cycleways/core/navigation/
// cueHaptics.js (tested); this is the thin, device-only output.
//
// NOTE: native module — not covered by the node suite.

import * as Haptics from "expo-haptics";

export function fireHaptic(kind) {
  switch (kind) {
    case "heavy":
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    case "medium":
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    case "light":
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    default:
      return undefined;
  }
}
