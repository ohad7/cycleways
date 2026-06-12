import React, { useEffect, useRef } from "react";
import PanelStateToggle from "./PanelStateToggle.jsx";
import Icon from "../Icon.jsx";
import "./front-panel.css";

export default function FrontPanel({
  panelState,
  onPanelStateChange,
  collapsed,
  onToggleCollapsed,
  discover,
  build,
  routeStatus,
}) {
  // The Discover list and the Build panel share this scroll container; without
  // a reset, deep Discover scroll positions carry over into Build (landing on
  // the POI list instead of the route stats).
  const bodyRef = useRef(null);
  useEffect(() => {
    bodyRef.current?.scrollTo?.(0, 0);
  }, [panelState]);
  return (
    <aside
      className="front-panel"
      data-testid="front-panel"
      data-route-status={routeStatus}
    >
      <div className="front-panel__head">
        <PanelStateToggle state={panelState} onChange={onPanelStateChange} />
        <button
          type="button"
          className="front-panel__collapse"
          aria-label={collapsed ? "הצג פאנל" : "הסתר פאנל"}
          onClick={onToggleCollapsed}
        >
          <Icon name={collapsed ? "chevron-back-outline" : "chevron-forward-outline"} />
        </button>
      </div>
      <div className="front-panel__body" ref={bodyRef}>
        {panelState === "discover" ? discover : build}
      </div>
    </aside>
  );
}
