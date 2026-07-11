import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { resolveShortCode } from "../../marketing/sticker-studio/registry-core.mjs";

export default function StickerRedirectPage() {
  const { code = "" } = useParams();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function redirect() {
      try {
        const response = await fetch("/data/sticker-redirects.json", { cache: "no-store" });
        if (!response.ok) throw new Error("Redirect registry is unavailable.");
        const entry = resolveShortCode(await response.json(), code);
        if (!entry) throw new Error("This sticker link is unknown or no longer configured.");
        if (cancelled) return;
        recordPrivateScan(entry.code);
        window.location.replace(entry.targetUrl);
      } catch (cause) {
        if (!cancelled) setError(cause?.message || "Sticker link could not be opened.");
      }
    }
    redirect();
    return () => { cancelled = true; };
  }, [code]);

  return (
    <main style={styles.page}>
      <div style={styles.badge} aria-hidden="true">CW</div>
      <h1 style={styles.title}>{error ? "Sticker link unavailable" : "Opening Cycleways…"}</h1>
      <p style={styles.copy}>{error || "Taking you to the route connected to this sticker."}</p>
      {error ? <a href="/routes" style={styles.link}>Browse Cycleways routes</a> : <span style={styles.spinner} aria-label="Loading" />}
    </main>
  );
}

function recordPrivateScan(shortCode) {
  const body = JSON.stringify({ shortCode });
  const endpoint = window.CYCLEWAYS_STICKER_SCAN_ENDPOINT || "/api/stickers/scan";
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      return;
    }
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Static hosting has no scan endpoint. Redirecting must never depend on it.
  }
}

const styles = {
  page: { minHeight: "100vh", display: "grid", placeContent: "center", justifyItems: "center", gap: 14, padding: 24, textAlign: "center", color: "#183129", background: "#eef1ec", fontFamily: "system-ui, sans-serif" },
  badge: { width: 72, height: 72, borderRadius: "50%", display: "grid", placeItems: "center", color: "white", background: "#29473b", fontWeight: 800, letterSpacing: 2 },
  title: { margin: 0, fontFamily: "Georgia, serif", fontWeight: 500 },
  copy: { margin: 0, maxWidth: 420, color: "#66716b" },
  link: { color: "#29473b", fontWeight: 700 },
  spinner: { width: 28, height: 28, border: "3px solid #c4cec7", borderTopColor: "#29473b", borderRadius: "50%" },
};
