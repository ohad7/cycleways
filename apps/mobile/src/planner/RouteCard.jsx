import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import {
  routeDifficultyLabel,
  routeShapeLabel,
  routeThumbnailPath,
} from "@cycleways/core/data/catalog.js";
import {
  distanceToRouteStartMeters,
  formatDistanceFromUser,
} from "@cycleways/core/data/nearMe.js";
import Icon from "./Icon.jsx";
import { ROUTE_IMAGES } from "./routeImages.js";
import { palette, radius } from "./theme.js";

const DIFFICULTY_COLOR = {
  easy: palette.forest,
  moderate: palette.accent,
  medium: palette.accent,
  hard: palette.danger,
};

// Soft translucent tint of a #rrggbb color for the icon-tile background.
function tintFor(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return palette.cream;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, 0.14)`;
}

// Branded native Discover card: a route photo thumbnail (or a difficulty-tinted
// icon tile fallback), title, difficulty chip, and a "distance · shape · via
// place" meta line (+ near-me distance when a location fix is available).
export default function RouteCard({ entry, placeById, fix, onSelect }) {
  const difficultyLabel = routeDifficultyLabel(entry?.difficulty);
  const chipColor = DIFFICULTY_COLOR[entry?.difficulty] || palette.muted;
  const photo = ROUTE_IMAGES[routeThumbnailPath(entry)] || null;

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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`פתח את ${entry.name} במפה`}
      testID={`route-card-${entry.slug || entry.name}`}
      onPress={() => onSelect?.(entry)}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      {photo ? (
        <Image source={photo} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, { backgroundColor: tintFor(chipColor) }]}>
          <Icon name="bicycle-outline" size={26} color={chipColor} />
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.titleRow}>
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
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: radius.md,
    backgroundColor: palette.white,
    borderColor: "#e6ece7",
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardPressed: { backgroundColor: palette.cream },
  thumb: {
    width: 64,
    height: 56,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  titleRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  title: {
    flexShrink: 1,
    color: palette.ink,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipText: {
    color: palette.white,
    fontSize: 10,
    fontWeight: "800",
  },
  meta: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
    marginTop: 3,
  },
  near: {
    color: palette.forestDk,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
    marginTop: 2,
  },
});
