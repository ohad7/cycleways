import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet } from "react-native";
import MapScreen from "./src/MapScreen.jsx";

// Phase 2.2: render the cycleway network on a native @rnmapbox map, colored by
// the shared @cycleways/core appearance logic.
export default function App() {
  return (
    <SafeAreaView style={styles.fill}>
      <MapScreen />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
