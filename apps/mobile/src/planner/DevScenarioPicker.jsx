import { text } from "../theme/typography.js";
// Dev-only navigation scenario picker (nav-scenario-harness). Rendered only
// under __DEV__ from BuildScreen; lists the shared scenario registry and a
// playback-speed toggle. Deliberately unstyled relative to the app chrome —
// it is a test harness, not product UI.
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const SPEEDS = [1, 4, 8];

export default function DevScenarioPicker({
  visible,
  scenarios,
  speed,
  onSelectSpeed,
  onSelect,
  onClose,
}) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Dev: simulate scenario</Text>
          <View style={styles.speedRow}>
            {SPEEDS.map((value) => (
              <Pressable
                key={value}
                onPress={() => onSelectSpeed(value)}
                style={[styles.speedChip, speed === value && styles.speedChipActive]}
              >
                <Text style={styles.speedText}>{value}×</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.list}>
            {scenarios.map((scenario) => (
              <Pressable
                key={scenario.name}
                onPress={() => onSelect(scenario)}
                style={styles.row}
              >
                <Text style={styles.rowName}>{scenario.name}</Text>
                <Text style={styles.rowDescription}>{scenario.description}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#1c1c1e",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: "70%",
    padding: 16,
  },
  title: { ...text.subheading, color: "#fff", marginBottom: 10 },
  speedRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  speedChip: {
    borderColor: "#555",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  speedChipActive: { backgroundColor: "#3a6", borderColor: "#3a6" },
  speedText: { ...text.captionStrong, color: "#fff" },
  list: { flexGrow: 0 },
  row: { borderTopColor: "#333", borderTopWidth: 1, paddingVertical: 10 },
  rowName: { ...text.bodyStrong, color: "#fff" },
  rowDescription: { ...text.caption, color: "#aaa", marginTop: 2 },
  close: { alignItems: "center", paddingVertical: 12 },
  closeText: { ...text.bodyStrong, color: "#3a6" },
});
