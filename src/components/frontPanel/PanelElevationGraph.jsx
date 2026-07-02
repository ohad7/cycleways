import React, { useMemo } from "react";
import ElevationProfile from "../ElevationProfile.jsx";
import { buildElevationProfile } from "@cycleways/core/ui/elevationProfile.js";

export default function PanelElevationGraph({
  geometry,
  distance,
  cursorFraction,
  cursorPlaying,
  cursorInfoVisible,
  externalCursorActive,
  onElevationHover,
  onElevationSelect,
  onBandHover,
  onBandSelect,
}) {
  const profile = useMemo(() => buildElevationProfile(geometry), [geometry]);
  // clusterPaths carry startPercent / endPercent (0–100, LTR) and color/gradeClass
  const bands = (profile?.clusterPaths || []).filter(Boolean);

  return (
    <div className="panel-elev">
      <ElevationProfile
        geometry={geometry}
        distance={distance}
        cursorFraction={cursorFraction}
        cursorPlaying={cursorPlaying}
        cursorInfoVisible={cursorInfoVisible}
        externalCursorActive={externalCursorActive}
        onElevationHover={onElevationHover}
        onElevationSelect={onElevationSelect}
      />
      <div className="panel-elev__bands">
        {bands.map((band, i) => {
          const start = band.startPercent;
          const end = band.endPercent;
          return (
            <button
              key={i}
              type="button"
              className="panel-elev__band"
              style={{
                left: `${start}%`,
                width: `${end - start}%`,
                background: band.color,
              }}
              title={band.gradeClass}
              onMouseEnter={() => onBandHover?.(band)}
              onMouseLeave={() => onBandHover?.(null)}
              onTouchStart={() => onBandHover?.(band)}
              onClick={() => onBandSelect?.(band)}
            />
          );
        })}
      </div>
    </div>
  );
}
