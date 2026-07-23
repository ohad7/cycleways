import React, { useState } from "react";
import { getRouteMessage } from "./RoutePanel.jsx";
import useDialogFocus from "./useDialogFocus.js";
import { buildRouteItinerary } from "@cycleways/core/ui/routeItinerary.js";

function DownloadModal({
  activeDataPoints,
  featureFlags,
  onClose,
  onDownload,
  routeState,
  segmentsData,
  shareStatus = "ok",
  shareUrl,
  shareUrlLength = 0,
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("idle");
  const dialogRef = useDialogFocus(onClose, shareOpen ? "share" : "download");

  if (shareOpen) {
    return (
      <ShareModal
        copyStatus={copyStatus}
        onClose={onClose}
        onCopy={() => copyShareUrl(shareUrl, shareStatus, setCopyStatus)}
        shareStatus={shareStatus}
        shareUrl={shareUrl}
        shareUrlLength={shareUrlLength}
        dialogRef={dialogRef}
      />
    );
  }

  return (
    <div
      className="download-modal"
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="react-download-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="download-modal-content">
        <header className="download-modal-header">
          <h3 id="react-download-title">הורדת מסלול GPX</h3>
          <button
            className="download-modal-close"
            type="button"
            aria-label="סגירה"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="download-modal-body">
          <h4>נקודות המסלול</h4>
          <div id="route-points-summary">
            <p style={{ color: "#333", margin: "0 0 12px" }}>
              {routeState.points.length} נקודות במסלול
            </p>
          </div>

          <h4>דרך המסלול</h4>
          <div id="route-segments-list">
            <RouteSegmentsList
              routeState={routeState}
            />
          </div>

          <h4>מידע חשוב על המסלול</h4>
          <div id="route-data-summary">
            {activeDataPoints.length === 0 ? (
              <p style={{ color: "#666", fontStyle: "italic" }}>
                אין מידע מיוחד למסלול זה
              </p>
            ) : (
              <div
                style={{
                  background: "#f5f5f5",
                  padding: "10px",
                  borderRadius: "8px",
                  marginBottom: "15px",
                }}
              >
                {activeDataPoints.map((dataPoint) => (
                  <div key={dataPoint.id} style={{ margin: "5px 0" }}>
                    {dataPoint.emoji} {dataPoint.information}
                  </div>
                ))}
              </div>
            )}
          </div>

          <h4>תיאור המסלול</h4>
          <div id="download-route-description">
            <p>{getRouteMessage(routeState)}</p>
          </div>

          <div className="download-modal-actions">
            <button
              id="download-gpx-final"
              className="download-confirm-btn"
              type="button"
              onClick={onDownload}
            >
              📥 הורדת GPX
            </button>
            <button
              id="share-route-modal"
              className="share-final-btn"
              title="שיתוף מסלול"
              type="button"
              disabled={!shareUrl}
              onClick={() => setShareOpen(true)}
            >
              🔗 שיתוף מסלול
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RouteSegmentsList({ routeState }) {
  const itinerary = buildRouteItinerary(routeState);
  if (itinerary.length === 0) {
    return (
      <p style={{ color: "#666", fontStyle: "italic" }}>
        עדיין אין דרך במסלול
      </p>
    );
  }

  return (
    <div className="modal-route-list">
      {itinerary.map((row, index) => {
        const segmentDataPoints = (routeState.activeDataPoints || []).filter(
          (point) => row.dataPointIds.includes(point.id),
        );
        return (
          <div className="modal-segment-item" key={row.id}>
            <span>
              <strong>{index + 1}.</strong> {row.name}{" "}
              <small>{(row.distanceMeters / 1000).toFixed(1)} ק״מ</small>
            </span>
            {segmentDataPoints.map((dataPoint) => (
              <div
                key={dataPoint.id}
                style={{
                  color: "#ff9800",
                  fontSize: "var(--text-caption-size)",
                  fontWeight: "var(--text-caption-weight)",
                  marginTop: "5px",
                  marginRight: "20px",
                }}
              >
                {dataPoint.emoji} {dataPoint.information}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ShareModal({
  copyStatus,
  onClose,
  onCopy,
  shareStatus,
  shareUrl,
  shareUrlLength,
  dialogRef,
}) {
  const encodedShareUrl = encodeURIComponent(shareUrl);
  const tooLong = shareStatus === "too_long";

  return (
    <div
      className="share-modal"
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="react-share-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="share-modal-content">
        <header className="share-modal-header">
          <h3 id="react-share-title">שיתוף המסלול</h3>
          <button
            className="share-modal-close"
            type="button"
            aria-label="סגירה"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="share-modal-body">
          <div className="share-url-container">
            <input
              aria-label="קישור שיתוף"
              className="share-url-input"
              readOnly
              value={shareUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              className="copy-url-btn"
              disabled={tooLong}
              type="button"
              onClick={onCopy}
              style={
                copyStatus === "copied"
                  ? { background: "#4CAF50" }
                  : undefined
              }
            >
              {tooLong
                ? "קישור ארוך מדי"
                : copyStatus === "copied"
                  ? "הועתק!"
                  : "העתק קישור"}
            </button>
            <span className="visually-hidden" role="status" aria-live="polite">
              {copyStatus === "copied" ? "הקישור הועתק ללוח" : ""}
            </span>
          </div>
          {shareStatus === "long" && (
            <p className="share-url-warning">
              הקישור ארוך ({shareUrlLength} תווים) ועלול לא לעבוד בכל אפליקציה.
            </p>
          )}
          {tooLong && (
            <p className="share-url-warning share-url-warning--error">
              המסלול ארוך מדי לשיתוף כקישור ({shareUrlLength} תווים). אפשר להוריד GPX במקום.
            </p>
          )}
          <div className="share-buttons">
            <button
              className="share-btn-social twitter"
              disabled={tooLong}
              type="button"
              onClick={() =>
                window.open(
                  `https://twitter.com/intent/tweet?url=${encodedShareUrl}`,
                  "_blank",
                )
              }
            >
              🐦 Twitter
            </button>
            <button
              className="share-btn-social facebook"
              disabled={tooLong}
              type="button"
              onClick={() =>
                window.open(
                  `https://www.facebook.com/sharer/sharer.php?u=${encodedShareUrl}`,
                  "_blank",
                )
              }
            >
              📘 Facebook
            </button>
            <button
              className="share-btn-social whatsapp"
              disabled={tooLong}
              type="button"
              onClick={() =>
                window.open(`https://wa.me/?text=${encodedShareUrl}`, "_blank")
              }
            >
              💬 WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function groupDataPointsBySegment(dataPoints) {
  const grouped = new Map();
  dataPoints.forEach((dataPoint) => {
    if (!grouped.has(dataPoint.segmentName)) {
      grouped.set(dataPoint.segmentName, []);
    }
    grouped.get(dataPoint.segmentName).push(dataPoint);
  });
  return grouped;
}

async function copyShareUrl(shareUrl, shareStatus, setCopyStatus) {
  if (shareStatus === "too_long") {
    setCopyStatus("idle");
    return;
  }
  try {
    await navigator.clipboard?.writeText?.(shareUrl);
    setCopyStatus("copied");
    setTimeout(() => setCopyStatus("idle"), 2000);
  } catch {
    setCopyStatus("idle");
  }
}

export default DownloadModal;
