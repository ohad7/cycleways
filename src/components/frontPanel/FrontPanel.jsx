import React from "react";
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
      <div className="front-panel__body">
        {panelState === "discover" ? discover : build}
      </div>
    </aside>
  );
}
