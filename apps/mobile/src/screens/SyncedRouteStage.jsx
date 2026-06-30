import { useCallback, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import SyncedVideoPlayer from "./SyncedVideoPlayer.jsx";
import RouteMapPreview from "./RouteMapPreview.jsx";

// The featured stage: a primary media surface (video by default) with the other
// surface (the route map) as a small swappable picture-in-picture in the top
// corner. As the video plays, its time drives a cursor along the route map +
// elevation via the supplied videoSync. Both surfaces stay mounted across a swap
// so the video keeps playing. Mirrors the mobile-web video-first composition: a
// taller (4:5) cropped video with our own controls.
const FULL_WIDTH = Dimensions.get("window").width - 32; // inside 16px padding
const STAGE_WIDTH = FULL_WIDTH;
const STAGE_HEIGHT = Math.round(FULL_WIDTH * 1.25); // 4:5 portrait-ish frame
const PIP_WIDTH = 168;
const PIP_HEIGHT = 124;

export default function SyncedRouteStage({
  youtubeId,
  duration,
  sync,
  geometry,
  activeDataPoints,
  onCursorChange,
}) {
  const [primary, setPrimary] = useState("video");
  const [cursor, setCursor] = useState(null);

  const handleTime = useCallback(
    (t) => {
      if (!sync) return;
      const p = sync.timeToPosition(t);
      if (!p || !Number.isFinite(p.lng) || !Number.isFinite(p.lat)) return;
      const next = { lng: p.lng, lat: p.lat, fraction: p.fraction };
      setCursor(next);
      onCursorChange?.(next);
    },
    [sync, onCursorChange],
  );

  const swap = useCallback(
    () => setPrimary((p) => (p === "video" ? "map" : "video")),
    [],
  );

  const videoPrimary = primary === "video";

  // Both surfaces are always rendered; only their size/variant changes on swap.
  const video = (
    <SyncedVideoPlayer
      youtubeId={youtubeId}
      duration={duration}
      variant={videoPrimary ? "primary" : "pip"}
      frameWidth={videoPrimary ? STAGE_WIDTH : PIP_WIDTH}
      frameHeight={videoPrimary ? STAGE_HEIGHT : PIP_HEIGHT}
      onTime={handleTime}
    />
  );
  const map = (
    <RouteMapPreview
      geometry={geometry}
      activeDataPoints={activeDataPoints}
      cursor={cursor}
      height={videoPrimary ? PIP_HEIGHT : STAGE_HEIGHT}
    />
  );

  return (
    <View style={[styles.stage, { height: STAGE_HEIGHT }]}>
      <View style={styles.primary}>{videoPrimary ? video : map}</View>
      <View style={styles.pip}>
        {videoPrimary ? map : video}
        {/* Transparent tap target over the small surface swaps which is primary. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="החלף בין סרטון למפה"
          onPress={swap}
        >
          <View style={styles.swapBadge}>
            <Text style={styles.swapIcon}>⇄</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { width: "100%", position: "relative" },
  primary: { ...StyleSheet.absoluteFillObject, borderRadius: 12, overflow: "hidden" },
  pip: {
    position: "absolute",
    top: 10,
    right: 10,
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    backgroundColor: "#000",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  swapBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  swapIcon: { color: "#fff", fontSize: 13, fontWeight: "800" },
});
