import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ROUTE_SEARCH_PLACEHOLDER } from "@cycleways/core/ui/routePlannerPresentation.js";
import Icon from "./Icon.jsx";
import { palette } from "./theme.js";

// How-to guidance shown before the route has any points. Mirrors the web
// BuildEmptyActions steps (src/components/frontPanel/BuildEmptyActions.jsx).
const STEPS = [
  "לחצו על המפה ליד שביל כדי להתחיל",
  "הוסיפו נקודה נוספת — המסלול יחושב לאורך השבילים",
  'גררו את הקו כדי לדייק, ואז הורידו GPX או שתפו',
];

// Native mirror of the web Build empty state: how-to steps + a "where to start"
// search and locate, plus an optional draft-restore offer. Rendered inside the
// planner sheet so the native new-route experience matches the web mobile build.
export default function BuildEmptyActions({
  searchQuery,
  searchStatus,
  searchError,
  onSearchQueryChange,
  onSearchSubmit,
  locateBusy = false,
  onLocateMe,
  draft,
  onRestoreDraft,
}) {
  const searching = searchStatus === "searching";
  const submit = () => {
    Keyboard.dismiss();
    onSearchSubmit?.();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.steps}>
        {STEPS.map((text, index) => (
          <View key={index} style={styles.stepRow}>
            <Text style={styles.stepNum}>{index + 1}</Text>
            <Text style={styles.stepText}>{text}</Text>
          </View>
        ))}
      </View>

      <View style={styles.where}>
        <Text style={styles.label}>איפה מתחילים?</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            value={searchQuery}
            onChangeText={onSearchQueryChange}
            onSubmitEditing={submit}
            placeholder={ROUTE_SEARCH_PLACEHOLDER}
            placeholderTextColor={palette.muted}
            accessibilityLabel="חיפוש מיקום"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            textAlign="right"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="חיפוש"
            onPress={submit}
            disabled={searching}
            style={({ pressed }) => [
              styles.searchBtn,
              pressed || searching ? styles.dim : null,
            ]}
          >
            <Icon
              name={searching ? "ellipsis-horizontal" : "search-outline"}
              size={18}
              color={palette.forest}
            />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="המיקום שלי"
          onPress={onLocateMe}
          disabled={locateBusy}
          style={({ pressed }) => [
            styles.locate,
            pressed || locateBusy ? styles.dim : null,
          ]}
        >
          <Icon name="locate-outline" size={16} color={palette.white} />
          <Text style={styles.locateText}>המיקום שלי</Text>
        </Pressable>
        {searchError ? <Text style={styles.error}>{searchError}</Text> : null}
      </View>

      {draft && onRestoreDraft ? (
        <View style={styles.draft}>
          <Text style={styles.draftText}>
            {`להמשיך את המסלול הקודם${
              Number.isFinite(draft.distanceKm) ? ` (${draft.distanceKm} ק"מ)` : ""
            }?`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="שחזור טיוטה קודמת"
            onPress={onRestoreDraft}
            style={({ pressed }) => [styles.draftBtn, pressed ? styles.dim : null]}
          >
            <Text style={styles.draftBtnText}>שחזור</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  steps: { gap: 8 },
  stepRow: { flexDirection: "row-reverse", alignItems: "flex-start", gap: 8 },
  stepNum: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    textAlign: "center",
    lineHeight: 20,
    fontSize: 12,
    fontWeight: "800",
    color: palette.white,
    backgroundColor: palette.forest,
    overflow: "hidden",
  },
  stepText: {
    flex: 1,
    color: palette.ink,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "right",
    writingDirection: "rtl",
  },
  where: { gap: 8 },
  label: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  searchRow: { flexDirection: "row-reverse", gap: 6 },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 10,
    fontSize: 13,
    backgroundColor: palette.white,
    color: palette.ink,
  },
  searchBtn: {
    minWidth: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 10,
    backgroundColor: palette.white,
    paddingHorizontal: 10,
  },
  locate: {
    alignSelf: "flex-end",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    backgroundColor: palette.forest,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  locateText: {
    color: palette.white,
    fontWeight: "800",
    fontSize: 13,
    writingDirection: "rtl",
  },
  error: {
    color: palette.danger,
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
  },
  draft: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: palette.cream,
  },
  draftText: {
    flex: 1,
    color: palette.ink,
    fontSize: 12.5,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  draftBtn: {
    borderRadius: 8,
    backgroundColor: palette.forest,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  draftBtnText: {
    color: palette.white,
    fontWeight: "800",
    fontSize: 12.5,
    writingDirection: "rtl",
  },
  dim: { opacity: 0.6 },
});
