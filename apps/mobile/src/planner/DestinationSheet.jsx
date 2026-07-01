import { useEffect, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EXTERNAL_NAV_APPS } from "@cycleways/core/navigation/externalNav.js";
import Icon from "./Icon.jsx";
import { palette, radius, space } from "./theme.js";

// Approach destination chooser. A simple bottom sheet: pick the in-app target
// (route start / nearest point / a point you tap on the map), or hand off to one
// of the navigation apps actually installed on the phone (WhatsApp-style list,
// detected via Linking.canOpenURL — iOS has no system nav-chooser).
//
// NOTE: native UI — verified visually in the simulator, not by the node suite.
export default function DestinationSheet({
  visible,
  appsOnly = false,
  currentMode = "start",
  canJoinNearest = false,
  nearestSkipText = "",
  disclaimerText = "",
  onPickStart,
  onPickNearest,
  onPickOnMap,
  onOpenApp,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  const [apps, setApps] = useState([]);

  // Probe which navigation apps are installed whenever the sheet opens.
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    (async () => {
      const available = [];
      for (const app of EXTERNAL_NAV_APPS) {
        if (app.alwaysAvailable) {
          available.push(app);
          continue;
        }
        try {
          if (await Linking.canOpenURL(app.probeUrl)) available.push(app);
        } catch {
          // ignore — treat as not installed
        }
      }
      if (!cancelled) setApps(available);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{appsOnly ? "פתיחה באפליקציית ניווט" : "לאן לנווט?"}</Text>

        {!appsOnly ? (
          <>
            <DestRow
              icon="flag-outline"
              label="תחילת המסלול"
              selected={currentMode === "start"}
              onPress={onPickStart}
            />
            {canJoinNearest ? (
              <DestRow
                icon="enter-outline"
                label="הצטרף לנקודה הקרובה"
                sub={nearestSkipText}
                selected={currentMode === "nearest"}
                onPress={onPickNearest}
              />
            ) : null}
            <DestRow
              icon="location-outline"
              label="בחר נקודה על המסלול"
              selected={currentMode === "custom"}
              onPress={onPickOnMap}
            />
          </>
        ) : null}

        <Text style={styles.section}>{appsOnly ? "בחרו אפליקציה" : "נווט באפליקציה אחרת"}</Text>
        <ScrollView style={styles.apps}>
          {apps.map((app) => (
            <DestRow
              key={app.id}
              icon="navigate-outline"
              label={app.label}
              onPress={() => onOpenApp?.(app)}
            />
          ))}
        </ScrollView>

        {disclaimerText ? (
          <Text style={styles.disclaimer}>{disclaimerText}</Text>
        ) : null}
      </View>
    </Modal>
  );
}

function DestRow({ icon, label, sub, selected = false, onPress }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} color={palette.forest} size={22} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {selected ? (
        <Icon name="checkmark" color={palette.forest} size={20} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    maxHeight: "75%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.muted,
    opacity: 0.5,
    marginBottom: space.sm,
  },
  title: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
    marginBottom: space.sm,
  },
  section: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: space.md,
    marginBottom: space.xs,
  },
  apps: { maxHeight: 220 },
  row: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1 },
  rowLabel: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  rowSub: {
    color: palette.muted,
    fontSize: 13,
    writingDirection: "rtl",
    textAlign: "right",
  },
  disclaimer: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "600",
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: space.md,
  },
});
