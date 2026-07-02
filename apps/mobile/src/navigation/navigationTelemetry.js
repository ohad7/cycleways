let eventSink = null;

// Narrow, privacy-safe adapter. Production may install an analytics sink later;
// navigation code emits only coarse enums and never coordinates or route tokens.
export function setNavigationTelemetrySink(sink) {
  eventSink = typeof sink === "function" ? sink : null;
}

export function trackNavigationEvent(name, fields = {}) {
  if (!eventSink) return;
  eventSink(name, { ...fields });
}

