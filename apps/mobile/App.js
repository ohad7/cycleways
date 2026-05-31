import { StatusBar } from "expo-status-bar";
import { LogBox, SafeAreaView, StyleSheet } from "react-native";
import MapScreen from "./src/MapScreen.jsx";

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated",
  "Invalid size is used for setting the map view",
]);

// Phase 2.4: render the native iPhone map from the shared app controller.
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
