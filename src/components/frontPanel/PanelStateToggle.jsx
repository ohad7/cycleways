import React from "react";
import Icon from "../Icon.jsx";

export default function PanelStateToggle({ state, onChange }) {
  return (
    <div className="front-panel__statebar" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={state === "discover"}
        className={state === "discover" ? "on" : ""}
        onClick={() => onChange("discover")}
      >
        <Icon name="search-outline" /> חפש מסלול
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={state === "build"}
        className={state === "build" ? "on" : ""}
        onClick={() => onChange("build")}
      >
        <Icon name="create-outline" /> בניית מסלול
      </button>
    </div>
  );
}
