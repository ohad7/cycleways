import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import {
  buildElevationHoverPayload,
  buildElevationProfile,
  findClosestElevationPoint,
  formatLegacyDistance,
} from "@cycleways/core/ui/elevationProfile.js";
import {
  GRADE_CLASSES,
  GRADE_COLORS,
  GRADE_LABELS_HE,
} from "@cycleways/core/utils/grade.js";

export default function ElevationProfileChart({
  animator,
  distance,
  geometry,
  onScrub,
}) {
  const profile = useMemo(() => buildElevationProfile(geometry), [geometry]);
  const animatorMarkerEnabledRef = useRef(true);
  const widthRef = useRef(0);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [animatorMarkerX, setAnimatorMarkerX] = useState(null);

  useEffect(() => {
    if (!animator) return undefined;

    const unsubscribe = animator.subscribe("elevation", (payload) => {
      if (!animatorMarkerEnabledRef.current) return;
      if (!payload) {
        setAnimatorMarkerX(null);
        return;
      }
      setAnimatorMarkerX(Math.max(0, Math.min(100, payload.t * 100)));
    });

    return unsubscribe;
  }, [animator]);

  useEffect(() => {
    animatorMarkerEnabledRef.current = true;
    setHoverInfo(null);
    setAnimatorMarkerX(null);
    onScrub?.(null);
  }, [geometry, onScrub]);

  const panResponder = useMemo(() => {
    function update(evt) {
      if (!profile) return;
      const width = widthRef.current || 1;
      const xPercent = Math.max(
        0,
        Math.min(100, (evt.nativeEvent.locationX / width) * 100),
      );
      const point = findClosestElevationPoint(profile.elevationData, xPercent);
      const payload = buildElevationHoverPayload(point);
      if (!payload) return;

      if (animatorMarkerEnabledRef.current) {
        animatorMarkerEnabledRef.current = false;
        setAnimatorMarkerX(null);
      }
      setHoverInfo(payload);
      onScrub?.(payload);
    }

    function clear() {
      setHoverInfo(null);
      onScrub?.(null);
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: update,
      onPanResponderMove: update,
      onPanResponderRelease: clear,
      onPanResponderTerminate: clear,
    });
  }, [profile, onScrub]);

  if (!profile) return null;

  const markerX = hoverInfo ? hoverInfo.t * 100 : animatorMarkerX;

  return (
    <View style={styles.container}>
      <View
        style={styles.chart}
        onLayout={(event) => {
          widthRef.current = event.nativeEvent.layout.width;
        }}
        {...panResponder.panHandlers}
      >
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {profile.clusterPaths.map((cluster, index) => (
            <Path
              key={`${cluster.gradeClass}-${index}`}
              d={cluster.d}
              fill={cluster.color}
              fillOpacity={0.45}
            />
          ))}
          <Path
            d={profile.outlinePath}
            fill="none"
            stroke="#3d3d3d"
            strokeOpacity={0.5}
            strokeWidth={0.4}
          />
          {Number.isFinite(markerX) ? (
            <Line
              x1={markerX}
              x2={markerX}
              y1={0}
              y2={100}
              stroke="#74b8c8"
              strokeOpacity={0.72}
              strokeWidth={0.45}
              strokeLinecap="round"
            />
          ) : null}
        </Svg>
        {hoverInfo ? (
          <View pointerEvents="none" style={styles.hoverInfo}>
            <Text numberOfLines={1} style={styles.hoverInfoText}>
              📍 מרחק: {(hoverInfo.distance / 1000).toFixed(1)} km • גובה:{" "}
              {Math.round(hoverInfo.elevation)} m
            </Text>
            {hoverInfo.gradeClass && Number.isFinite(hoverInfo.grade) ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.gradeChip,
                  {
                    backgroundColor: `${GRADE_COLORS[hoverInfo.gradeClass]}2e`,
                    borderColor: `${GRADE_COLORS[hoverInfo.gradeClass]}66`,
                    color: GRADE_COLORS[hoverInfo.gradeClass],
                  },
                ]}
              >
                {GRADE_LABELS_HE[hoverInfo.gradeClass]} ·{" "}
                {hoverInfo.grade.toFixed(1)}%
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <View style={styles.distanceRow}>
          <Text style={styles.distanceLabel}>
            {formatLegacyDistance(distance)}
          </Text>
          <Text style={styles.distanceLabel}>0 ק"מ</Text>
        </View>
        <View style={styles.legend}>
          {GRADE_CLASSES.map((cls) => (
            <View key={cls} style={styles.legendItem}>
              <View
                style={[
                  styles.legendSwatch,
                  { backgroundColor: GRADE_COLORS[cls] },
                ]}
              />
              <Text style={styles.legendLabel}>{GRADE_LABELS_HE[cls]}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
    padding: 4,
    backgroundColor: "#f7f6f2",
    borderColor: "#d8d4cc",
    borderRadius: 4,
    borderWidth: 1,
  },
  chart: {
    position: "relative",
    height: 100,
    width: "100%",
    marginBottom: 2,
    backgroundColor: "#ffffff",
    borderRadius: 3,
    overflow: "hidden",
  },
  hoverInfo: {
    position: "absolute",
    top: 4,
    left: 8,
    right: 8,
    minHeight: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    flexDirection: "row-reverse",
    alignItems: "center",
    overflow: "hidden",
  },
  hoverInfoText: {
    flexShrink: 1,
    color: "#1f2933",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "right",
    writingDirection: "rtl",
  },
  gradeChip: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
    overflow: "hidden",
  },
  footer: {
    flexDirection: "column",
    gap: 4,
    marginTop: 4,
  },
  distanceRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  distanceLabel: {
    flexShrink: 0,
    color: "#666666",
    fontSize: 11,
    textAlign: "center",
    writingDirection: "rtl",
  },
  legend: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    rowGap: 4,
  },
  legendItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 4,
  },
  legendSwatch: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  legendLabel: {
    color: "#666666",
    fontSize: 11,
    lineHeight: 12,
  },
});
