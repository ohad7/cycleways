import { useEffect, useMemo, useRef, useState } from "react";
import { demoScenarioFromBundle } from "@cycleways/core/navigation/demoScenario.js";
import { createDemoCaptureClient } from "../dev/demoCaptureClient.js";
import { createDemoCaptureEventRecorder } from "./demoCaptureEvents.js";
import { createMediaClockPlaybackSource } from "./mediaClockPlaybackSource.js";

// Long enough to survive React Native rendering, Simulator recorder startup,
// and transient development banners. The renderer removes the entire marker.
const SYNC_FLASH_DURATION_MS = 1500;

export function useDemoCaptureSession(params, { readinessRef } = {}) {
  const active = Boolean(__DEV__ && params?.baseUrl && params?.token && params?.runId);
  const [state, setState] = useState({ phase: active ? "loading" : "inactive", scenario: null, source: null, error: null });
  const runtimeRef = useRef(null);
  const key = active ? `${params.baseUrl}:${params.runId}` : "inactive";

  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;
    let flashTimer = null;
    if (!active) {
      runtimeRef.current = null;
      setState({ phase: "inactive", scenario: null, source: null, error: null });
      return undefined;
    }
    const fail = async (error) => {
      if (cancelled) return;
      const runtime = runtimeRef.current;
      runtime?.recorder?.record("capture-error", { code: "capture-session-error", message: String(error?.message || error) });
      await runtime?.recorder?.flush?.().catch(() => {});
      setState((current) => ({ ...current, phase: "error", error: String(error?.message || error) }));
    };
    void (async () => {
      try {
        const client = createDemoCaptureClient(params);
        const bundle = await client.loadBundle();
        if (cancelled) return;
        const recorder = createDemoCaptureEventRecorder({
          runId: params.runId,
          mediaTime: () => runtimeRef.current?.source?.getDiagnostics?.().phase === "playing"
            ? runtimeRef.current.source.getDiagnostics().mediaTimeMs || 0
            : bundle.capture.proof.inMs,
          upload: (events) => client.events(events),
          batchSize: 12,
        });
        const source = createMediaClockPlaybackSource(bundle.fixes, {
          visibleInMs: bundle.capture.proof.inMs,
          visibleOutMs: bundle.capture.proof.outMs,
          preRollMs: bundle.capture.proof.preRollMs,
          autoArm: true,
          onStateChange: ({ phase }) => {
            if (!cancelled && ["warming", "armed", "playing", "hold", "aborted"].includes(phase)) {
              setState((current) => ({ ...current, phase }));
            }
          },
          onComplete: async () => {
            recorder.record("capture-hold", {}, { mediaTimeMs: bundle.capture.proof.outMs });
            await recorder.flush();
            await client.complete();
            if (!cancelled) setState((current) => ({ ...current, phase: "hold" }));
          },
          onError: fail,
        });
        const scenario = { ...demoScenarioFromBundle(bundle), demoCaptureSource: source };
        runtimeRef.current = { client, bundle, recorder, source, started: false, readySent: false };
        setState({ phase: "loading-route", scenario, source, error: null });
        pollTimer = setInterval(async () => {
          const runtime = runtimeRef.current;
          if (!runtime || runtime.started || cancelled) return;
          const ready = readinessRef?.current || {};
          if (!runtime.readySent) {
            if (!ready.mapReady || !ready.navigationReady || runtime.source.getDiagnostics().phase !== "armed") return;
            runtime.readySent = true;
            await runtime.client.ready({ platform: "ios", bundleId: runtime.bundle.id });
            runtime.recorder.record("capture-ready", { bundleId: runtime.bundle.id }, { mediaTimeMs: runtime.bundle.capture.proof.inMs });
            await runtime.recorder.flush();
            setState((current) => ({ ...current, phase: "armed" }));
          }
          const control = await runtime.client.control();
          if (control.control === "abort") {
            runtime.source.abort();
            runtime.recorder.record("capture-error", { code: "operator-abort" });
            await runtime.recorder.flush();
            return;
          }
          if (control.control !== "start") return;
          runtime.started = true;
          runtime.recorder.record("sync-flash-start", {}, { mediaTimeMs: runtime.bundle.capture.proof.inMs });
          setState((current) => ({ ...current, phase: "sync-flash" }));
          flashTimer = setTimeout(async () => {
            runtime.recorder.record("sync-flash-end", {}, { mediaTimeMs: runtime.bundle.capture.proof.inMs });
            await runtime.recorder.flush();
            runtime.source.beginVisiblePlayback();
          }, SYNC_FLASH_DURATION_MS);
        }, 200);
      } catch (error) {
        await fail(error);
      }
    })();
    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (flashTimer) clearTimeout(flashTimer);
      runtimeRef.current?.source?.abort?.();
      runtimeRef.current = null;
    };
  }, [active, key, readinessRef]);

  const eventSink = useMemo(() => (kind, payload, options) => {
    runtimeRef.current?.recorder?.record(kind, payload, options);
  }, []);
  return { active, ...state, eventSink };
}
