export const parseDemoCaptureLaunch = () => null;
export const createDemoCaptureClient = () => {
  throw new Error("demo capture is unavailable in production");
};
export const createMediaClockPlaybackSource = () => {
  throw new Error("demo capture is unavailable in production");
};
export const createDemoCaptureEventRecorder = () => {
  throw new Error("demo capture is unavailable in production");
};
export const summarizeNavigationCaptureState = () => ({});
export const useDemoCaptureSession = () => ({ active: false, phase: "inactive", scenario: null, source: null, error: null, eventSink: null });
export default function EmptyDemoCapture() { return null; }
