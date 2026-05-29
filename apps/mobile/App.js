import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import RouteManager from "@cycleways/core/route-manager.js";
import { getDistance } from "@cycleways/core/utils/distance.js";

// Phase 2.1 proof screen: import the CommonJS engine + an ESM util from the
// shared workspace package and exercise both, proving Metro resolves/bundles
// @cycleways/core on device.
const DEMO_METERS = Math.round(
  getDistance({ lat: 33.208, lng: 35.571 }, { lat: 33.131, lng: 35.594 }),
);

export default function App() {
  const manager = new RouteManager();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>@cycleways/core resolves in Metro ✓</Text>
      <Text style={styles.line}>
        engine (CJS): {typeof RouteManager} · segments {manager.segments.size}
      </Text>
      <Text style={styles.line}>
        getDistance (ESM): {DEMO_METERS.toLocaleString()} m
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: "600", textAlign: "center" },
  line: { fontSize: 15, color: "#333" },
});
