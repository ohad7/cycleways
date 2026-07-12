import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { createNavigationCameraAdapter } from "./navigationCameraAdapter.js";

export function useNavigationCamera({ cameraRef, mapViewRef, onDiagnostics }) {
  const diagnosticsRef = useRef(onDiagnostics);
  diagnosticsRef.current = onDiagnostics;
  const adapterRef = useRef(null);
  if (adapterRef.current === null) {
    adapterRef.current = createNavigationCameraAdapter({
      getCamera: () => cameraRef.current,
      getMap: () => mapViewRef.current,
      isInteractive: () => AppState.currentState === "active",
      onDiagnostics: (diagnostics) => diagnosticsRef.current?.(diagnostics),
    });
  }
  useEffect(
    () => () => {
      adapterRef.current?.reset("unmount");
    },
    [],
  );
  return adapterRef;
}
