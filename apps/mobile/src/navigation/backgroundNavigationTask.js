import * as TaskManager from "expo-task-manager";
import { toNavigationFix } from "@cycleways/core/navigation/locationFix.js";
import { NAVIGATION_LOCATION_TASK } from "./backgroundTaskName.js";
import {
  processBackgroundNavigationFixes,
  recordBackgroundNavigationTaskError,
} from "./navigationRuntime.js";

if (!TaskManager.isTaskDefined(NAVIGATION_LOCATION_TASK)) {
  TaskManager.defineTask(NAVIGATION_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      recordBackgroundNavigationTaskError(error);
      return;
    }
    const fixes = (Array.isArray(data?.locations) ? data.locations : [])
      .map((location) => toNavigationFix(location))
      .filter(Boolean);
    try {
      await processBackgroundNavigationFixes(fixes);
    } catch (taskError) {
      recordBackgroundNavigationTaskError(taskError);
    }
  });
}
