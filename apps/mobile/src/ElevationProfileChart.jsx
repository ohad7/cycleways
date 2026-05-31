import { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import {
  buildElevationProfile,
  findClosestElevationPoint,
} from "@cycleways/core/ui/elevationProfile.js";
import {
  GRADE_CLASSES,
  GRADE_COLORS,
  GRADE_LABELS_HE,
} from "@cycleways/core/utils/grade.js";

export default function ElevationProfileChart({ geometry, onScrub }) {
  const profile = useMemo(() => buildElevationProfile(geometry), [geometry]);
  const [hover, setHover] = useState(null);
  const widthRef = useRef(0);

  const panResponder = useMemo(() => {
    function update(evt) {
      if (!profile) return;
      const width = widthRef.current || 1;
      const xPercent = Math.max(
        0,
        Math.min(100, (evt.nativeEvent.locationX / width) * 100),
      );
      const point = findClosestElevationPoint(profile.elevationData, xPercent);
      if (!point) return;
      setHover(point);
      onScrub?.(point);
    }
    function clear() {
      setHover(null);
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>גרף גובה</Text>
      {hover ? (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipText}>
            📍 מרחק: {(hover.distance / 1000).toFixed(1)} ק"מ • גובה:{" "}
            {Math.round(hover.elevation)} מ׳
          </Text>
          {hover.gradeClass && Number.isFinite(hover.grade) ? (
            <Text
              style={[styles.gradeChip, { color: GRADE_COLORS[hover.gradeClass] }]}
            >
              {GRADE_LABELS_HE[hover.gradeClass]} · {hover.grade.toFixed(1)}%
            </Text>
          ) : null}
        </View>
      ) : null}
      <View
        style={styles.chart}
        onLayout={(e) => {
          widthRef.current = e.nativeEvent.layout.width;
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
          {hover ? (
            <Line
              x1={hover.distancePercent}
              x2={hover.distancePercent}
              y1={0}
              y2={100}
              stroke="#74b8c8"
              strokeOpacity={0.72}
              strokeWidth={0.45}
            />
          ) : null}
        </Svg>
      </View>
      <View style={styles.legend}>
        {GRADE_CLASSES.map((cls) => (
          <View key={cls} style={styles.legendItem}>
            <View
              style={[styles.legendSwatch, { backgroundColor: GRADE_COLORS[cls] }]}
            />
            <Text style={styles.legendLabel}>{GRADE_LABELS_HE[cls]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 10 },
  title: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1f2a33",
    textAlign: "right",
    marginBottom: 6,
  },
  tooltip: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  tooltipText: { fontSize: 12, color: "#1f2a33" },
  gradeChip: { fontSize: 12, fontWeight: "600" },
  chart: {
    height: 120,
    width: "100%",
    backgroundColor: "#f4f6f8",
    borderRadius: 8,
    overflow: "hidden",
  },
  legend: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 6,
  },
  legendItem: { flexDirection: "row-reverse", alignItems: "center", gap: 4 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3 },
  legendLabel: { fontSize: 11, color: "#42525d" },
});
