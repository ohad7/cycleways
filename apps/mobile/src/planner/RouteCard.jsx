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
// video), then the title, difficulty chip, route summary, and
// "distance · shape · via" meta.
export default function RouteCard({
  entry,
  index = 0,
  placeById,
  fix,
  onSelect,
  variant = "compact",
}) {
  const [page, setPage] = useState(0);
  const difficultyLabel = routeDifficultyLabel(entry?.difficulty);
  const chipColor = DIFFICULTY_COLOR[entry?.difficulty] || palette.muted;
  const swatchColor = discoverRouteColor(index);
  const hasVideo = ROUTE_VIDEO_SLUGS.has(entry?.slug);
  const summary =
    typeof entry?.summary === "string" ? entry.summary.trim() : "";

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
  ].filter(Boolean).slice(0, 3);

  const nearMeters = fix ? distanceToRouteStartMeters(entry, placeById, fix) : null;
  const nearLabel = formatDistanceFromUser(nearMeters);
  const firstImage = images[0] || null;

  const onScrollEnd = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    setPage(Math.round(x / IMAGE_WIDTH));
  };

  if (variant === "hero") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`פתח את ${entry.name}`}
        onPress={() => onSelect?.(entry)}
        style={({ pressed }) => [
          styles.heroCard,
          pressed ? styles.cardPressed : null,
        ]}
        testID={`route-hero-${entry.slug || entry.name}`}
      >
        <View style={styles.heroMedia}>
          {firstImage ? (
            <Image source={firstImage} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={[styles.heroImage, styles.fallback, { backgroundColor: tintFor(chipColor) }]}>
              <Icon name="bicycle-outline" size={42} color={chipColor} />
            </View>
          )}
          <View style={styles.heroOverlay} pointerEvents="none">
            <View style={styles.heroKicker}>
              <View style={[styles.heroSwatch, { backgroundColor: swatchColor }]} />
              <Text style={styles.heroKickerText}>מסלול מומלץ</Text>
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle} numberOfLines={2}>
                {entry.name}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.heroDetails} pointerEvents="none">
          {summary ? (
            <Text style={styles.heroSummary} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
          {meta.length ? (
            <Text style={styles.heroMeta} numberOfLines={1}>
              {meta.join(" · ")}
            </Text>
          ) : null}
          <View style={styles.heroFooter}>
            <Text style={styles.heroCta}>לעמוד המסלול</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  if (variant === "compact") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`פתח את ${entry.name}`}
        onPress={() => onSelect?.(entry)}
        style={({ pressed }) => [
          styles.compactCard,
          pressed ? styles.cardPressed : null,
        ]}
        testID={`route-card-${entry.slug || entry.name}`}
      >
        <View style={[styles.compactThumb, { backgroundColor: tintFor(chipColor) }]}>
          {firstImage ? (
            <Image source={firstImage} style={styles.compactImage} resizeMode="cover" />
          ) : (
            <Icon name="bicycle-outline" size={28} color={chipColor} />
          )}
        </View>
        <View style={styles.compactBody}>
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
          {summary ? (
            <Text style={styles.summary} numberOfLines={2}>
              {summary}
            </Text>
          ) : null}
          {meta.length ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta.join(" · ")}
            </Text>
          ) : null}
          {nearLabel ? <Text style={styles.near}>{nearLabel}</Text> : null}
        </View>
      </Pressable>
    );
  }

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
        {summary ? <Text style={styles.summary}>{summary}</Text> : null}
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
  heroCard: {
    marginHorizontal: 12,
    borderRadius: radius.lg || radius.md,
    backgroundColor: palette.white,
    overflow: "hidden",
    borderColor: "#dfe8e2",
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroMedia: {
    position: "relative",
    height: 228,
    backgroundColor: palette.cream,
  },
  heroImage: { width: "100%", height: "100%" },
  heroPlayBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.48)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: "rgba(17, 25, 20, 0.18)",
  },
  heroDetails: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    rowGap: 6,
    columnGap: 8,
  },
  heroKicker: {
    alignSelf: "flex-end",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  heroSwatch: { width: 8, height: 8, borderRadius: 4 },
  heroKickerText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 11,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  heroCopy: {
    gap: 5,
  },
  heroTitle: {
    color: palette.white,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 27,
    textAlign: "right",
    writingDirection: "rtl",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroSummary: {
    width: "100%",
    color: palette.forestDk,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  heroMeta: {
    flexShrink: 1,
    color: palette.muted,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  heroFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  heroChip: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  heroChipText: { color: palette.white, fontSize: 10, fontWeight: "900" },
  heroNear: {
    flexShrink: 1,
    color: palette.muted,
    fontSize: 11,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  heroCta: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#cfe0d2",
    borderRadius: radius.pill,
    backgroundColor: "#f3f7f1",
    color: palette.forest,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    writingDirection: "rtl",
  },
  compactCard: {
    flexDirection: "row-reverse",
    alignItems: "stretch",
    gap: 10,
    padding: 9,
    borderRadius: radius.md,
    backgroundColor: palette.white,
    borderColor: "#e6ece7",
    borderWidth: StyleSheet.hairlineWidth,
  },
  compactThumb: {
    position: "relative",
    width: 106,
    height: 92,
    borderRadius: radius.sm || 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  compactImage: { width: "100%", height: "100%" },
  compactPlayBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  compactBody: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    gap: 3,
  },
  cardPressed: { opacity: 0.86 },
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
  summary: {
    color: "#52615c",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "right",
    writingDirection: "rtl",
  },
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
