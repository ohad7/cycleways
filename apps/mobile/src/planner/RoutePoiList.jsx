import { Image, StyleSheet, Text, View } from "react-native";
import { routePoiList } from "@cycleways/core/data/routePoiList.js";
import { POI_COLORS, POI_EMOJIS, POI_LABELS } from "@cycleways/core/data/poiTypes.js";
import RichText from "../RichText.jsx";
import { ROUTE_IMAGES } from "./routeImages.js";
import { palette, radius, space } from "./theme.js";

// "נקודות עניין בדרך" — the route's points of interest with photo + description,
// matching the mobile-web POIList/POICard. Driven by the shared routePoiList
// builder over routeState.activeDataPoints, so it works for both built and
// catalog/featured routes. Photos resolve from the bundled image require-map.
export default function RoutePoiList({ activeDataPoints }) {
  const items = routePoiList(activeDataPoints);
  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>נקודות עניין בדרך</Text>
      {items.map((poi) => (
        <PoiCard key={poi.id} poi={poi} />
      ))}
    </View>
  );
}

function PoiCard({ poi }) {
  const photo = poi.imagePath ? ROUTE_IMAGES[poi.imagePath] : null;
  const accent = POI_COLORS[poi.type] || palette.teal;
  const label = POI_LABELS[poi.type] || poi.type || "";
  const title = poi.name || label;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.emoji}>{POI_EMOJIS[poi.type] || "📍"}</Text>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {label ? (
            <Text style={[styles.type, { color: accent }]} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
        </View>
      </View>
      {photo ? (
        <Image source={photo} style={styles.photo} resizeMode="cover" />
      ) : null}
      {poi.information ? (
        <RichText style={styles.info} text={poi.information} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm, marginTop: space.sm },
  heading: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  card: {
    backgroundColor: palette.white,
    borderRadius: radius.md,
    borderColor: "#e6ece7",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 8,
  },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  emoji: { fontSize: 22 },
  headerText: { flex: 1 },
  title: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  type: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
    marginTop: 1,
  },
  photo: {
    width: "100%",
    height: 160,
    borderRadius: radius.sm,
    backgroundColor: palette.cream,
  },
  info: {
    color: palette.muted,
    fontSize: 13,
    textAlign: "right",
    writingDirection: "rtl",
  },
});
