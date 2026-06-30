import { useMemo, useState } from "react";
import {
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  routeDifficultyLabel,
  routeShapeLabel,
} from "@cycleways/core/data/catalog.js";
import {
  distanceToRouteStartMeters,
  formatDistanceFromUser,
} from "@cycleways/core/data/nearMe.js";
import { discoverRouteColor } from "@cycleways/core/map/discoverRouteColors.js";
import Icon from "./Icon.jsx";
import { ROUTE_IMAGES } from "./routeImages.js";
import { ROUTE_GALLERIES, ROUTE_VIDEO_SLUGS } from "./routeGalleries.js";
import { palette, radius } from "./theme.js";

const DIFFICULTY_COLOR = {
  easy: palette.forest,
  moderate: palette.accent,
  medium: palette.accent,
  hard: palette.danger,
};

// Card content spans the Discover list width (12px padding each side).
const IMAGE_WIDTH = Dimensions.get("window").width - 24;
const IMAGE_HEIGHT = 200;

function tintFor(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return palette.cream;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, 0.14)`;
}

// Rich Discover card: a full-width horizontally swipeable photo gallery (route +
// POI thumbnails; a play badge on the first frame when the route has a synced
// video), then the title, difficulty chip, and "distance · shape · via" meta.
export default function RouteCard({ entry, index = 0, placeById, fix, onSelect }) {
  const [page, setPage] = useState(0);
  const difficultyLabel = routeDifficultyLabel(entry?.difficulty);
  const chipColor = DIFFICULTY_COLOR[entry?.difficulty] || palette.muted;
  const swatchColor = discoverRouteColor(index);
  const hasVideo = ROUTE_VIDEO_SLUGS.has(entry?.slug);

  const images = useMemo(() => {
    const paths = ROUTE_GALLERIES[entry?.slug] || [];
    return paths.map((p) => ROUTE_IMAGES[p]).filter(Boolean);
  }, [entry?.slug]);

  const viaNames = (entry?.passesNear || [])
    .map((id) => placeById?.get?.(id)?.name)
    .filter(Boolean)
    .slice(0, 2);
  const meta = [
    Number.isFinite(entry?.distanceKm) ? `${entry.distanceKm} ק״מ` : null,
    routeShapeLabel(entry),
    viaNames.length ? viaNames.join(" · ") : null,
  ].filter(Boolean);

  const nearMeters = fix ? distanceToRouteStartMeters(entry, placeById, fix) : null;
  const nearLabel = formatDistanceFromUser(nearMeters);

  const onScrollEnd = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    setPage(Math.round(x / IMAGE_WIDTH));
  };

  return (
    <View
      style={styles.card}
      testID={`route-card-${entry.slug || entry.name}`}
    >
      <View style={styles.galleryWrap}>
        {images.length > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
          >
            {images.map((src, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`פתח את ${entry.name}`}
                onPress={() => onSelect?.(entry)}
              >
                <Image source={src} style={styles.image} resizeMode="cover" />
                {i === 0 && hasVideo ? (
                  <View style={styles.playBadge} pointerEvents="none">
                    <Icon name="play" size={22} color="#fff" />
                  </View>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`פתח את ${entry.name}`}
            onPress={() => onSelect?.(entry)}
            style={[styles.image, styles.fallback, { backgroundColor: tintFor(chipColor) }]}
          >
            <Icon name="bicycle-outline" size={34} color={chipColor} />
          </Pressable>
        )}
        {images.length > 1 ? (
          <View style={styles.dots} pointerEvents="none">
            {images.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === page ? styles.dotActive : null]}
              />
            ))}
          </View>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`פתח את ${entry.name}`}
        onPress={() => onSelect?.(entry)}
        style={styles.body}
      >
        <View style={styles.titleRow}>
          <View style={[styles.swatch, { backgroundColor: swatchColor }]} />
          <Text style={styles.title} numberOfLines={1}>
            {entry.name}
          </Text>
          {difficultyLabel ? (
            <View style={[styles.chip, { backgroundColor: chipColor }]}>
              <Text style={styles.chipText}>{difficultyLabel}</Text>
            </View>
          ) : null}
        </View>
        {meta.length ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta.join(" · ")}
          </Text>
        ) : null}
        {nearLabel ? <Text style={styles.near}>{nearLabel}</Text> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    backgroundColor: palette.white,
    borderColor: "#e6ece7",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  galleryWrap: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, backgroundColor: palette.cream },
  image: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
  fallback: { alignItems: "center", justifyContent: "center" },
  playBadge: {
    position: "absolute",
    top: IMAGE_HEIGHT / 2 - 24,
    left: IMAGE_WIDTH / 2 - 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  dots: {
    position: "absolute",
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  dotActive: { backgroundColor: "#fff", width: 7, height: 7, borderRadius: 3.5 },
  body: { padding: 10, gap: 3 },
  titleRow: { flexDirection: "row-reverse", alignItems: "center", gap: 6 },
  swatch: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  title: {
    flexShrink: 1,
    color: palette.ink,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  chip: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  chipText: { color: palette.white, fontSize: 10, fontWeight: "800" },
  meta: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  near: {
    color: palette.forestDk,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
});
