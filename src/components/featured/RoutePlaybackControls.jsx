import React from "react";
import RouteProgressDistance from "./RouteProgressDistance.jsx";

export default function RoutePlaybackControls({
  isPlaying = false,
  isReady = true,
  isScrubbing = false,
  currentTime = 0,
  duration = 0,
  onTogglePlayback,
  onScrubStart,
  onScrubChange,
  onScrubEnd,
  playLabel = "נגן מסלול",
  pauseLabel = "השהה מסלול",
  scrubberLabel = "מעבר בזמן המסלול",
}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Number.isFinite(currentTime)
    ? Math.max(0, Math.min(safeDuration || currentTime, currentTime))
    : 0;
  const progressPercent = safeDuration > 0
    ? (safeCurrentTime / safeDuration) * 100
    : 0;
  const disabled = !isReady || safeDuration <= 0;

  return (
    <div
      className={[
        "fv-video-controls",
        isScrubbing ? "fv-video-controls--scrubbing" : "",
      ].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        className="fv-video-play-toggle"
        onClick={onTogglePlayback}
        disabled={!isReady}
        aria-label={isPlaying ? pauseLabel : playLabel}
      >
        <span aria-hidden="true">{isPlaying ? "❚❚" : "▶"}</span>
      </button>
      <input
        className="fv-video-scrubber"
        type="range"
        min="0"
        max={safeDuration || 0}
        step="0.1"
        value={safeCurrentTime}
        onChange={onScrubChange}
        onPointerDown={onScrubStart}
        onPointerUp={onScrubEnd}
        onPointerCancel={onScrubEnd}
        onBlur={onScrubEnd}
        disabled={disabled}
        aria-label={scrubberLabel}
        style={{ "--fv-video-progress": `${progressPercent}%` }}
      />
      <span className="fv-video-time">
        {formatTime(safeCurrentTime)} / {formatTime(safeDuration)}
      </span>
      <div className="fv-video-progress-distance" aria-label="מרחק מההתחלה">
        <span>מרחק מההתחלה</span>
        <RouteProgressDistance className="fv-video-progress-value" />
      </div>
    </div>
  );
}

function formatTime(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
