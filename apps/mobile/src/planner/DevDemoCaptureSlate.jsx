import { StyleSheet, Text, View } from "react-native";

export default function DevDemoCaptureSlate({ phase, error }) {
  if (!__DEV__ || !phase || ["inactive", "playing"].includes(phase)) return null;
  if (phase === "sync-flash") return <View pointerEvents="none" style={styles.flash} />;
  const isHold = phase === "hold";
  const isError = phase === "error";
  return (
    <View pointerEvents="none" style={[styles.slate, isHold ? styles.hold : null, isError ? styles.error : null]}>
      <Text style={styles.brand}>CYCLEWAYS</Text>
      <Text style={styles.title}>{isHold ? "Capture complete" : isError ? "Capture stopped" : "Preparing navigation"}</Text>
      <Text style={styles.detail}>{isError ? error : isHold ? "The ride remains on screen for a clean edit point." : "Route, map, and media clock are being verified."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slate: { ...StyleSheet.absoluteFillObject, zIndex: 10000, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#0d2018" },
  hold: { backgroundColor: "#10281e" },
  error: { backgroundColor: "#381713" },
  flash: { ...StyleSheet.absoluteFillObject, zIndex: 10000, backgroundColor: "#d8ff00" },
  brand: { color: "#b8f34a", fontWeight: "800", fontSize: 13, letterSpacing: 4, marginBottom: 18 },
  title: { color: "#ffffff", fontWeight: "700", fontSize: 25, marginBottom: 10, textAlign: "center" },
  detail: { color: "#c5d9cd", fontSize: 14, lineHeight: 20, maxWidth: 300, textAlign: "center" },
});
