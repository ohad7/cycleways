import { StyleSheet, Text, View } from "react-native";
import Mapbox, {
  Camera,
  LineLayer,
  MapView,
  ShapeSource,
} from "@rnmapbox/maps";
import { prepareRouteNetworkFeatures } from "@cycleways/core/domain/routeNetwork.js";
import network from "../assets/data/network.json";

// Publishable token, inlined by Expo at build from EXPO_PUBLIC_MAPBOX_TOKEN.
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";
Mapbox.setAccessToken(MAPBOX_TOKEN);

// Color the network once using the shared core logic — identical to the web map.
const NETWORK_FEATURES = {
  type: "FeatureCollection",
  features: prepareRouteNetworkFeatures(network),
};

// camelCase form of the shared ROUTE_NETWORK_LINE_STYLE paint; reads the same
// routeColor/routeWidth/routeOpacity properties core bakes into each feature.
const NETWORK_LINE_STYLE = {
  lineColor: ["get", "routeColor"],
  lineWidth: ["get", "routeWidth"],
  lineOpacity: ["get", "routeOpacity"],
  lineJoin: "round",
  lineCap: "round",
};

const GALILEE_CENTER = [35.5876, 33.17];

export default function MapScreen() {
  if (!MAPBOX_TOKEN) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>
          Set EXPO_PUBLIC_MAPBOX_TOKEN (your pk… token) and rebuild.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <MapView style={styles.fill} styleURL={Mapbox.StyleURL.Outdoors}>
        <Camera centerCoordinate={GALILEE_CENTER} zoomLevel={11.5} />
        <ShapeSource id="network" shape={NETWORK_FEATURES}>
          <LineLayer id="network-line" style={NETWORK_LINE_STYLE} />
        </ShapeSource>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  hint: { fontSize: 15, textAlign: "center", color: "#333" },
});
