import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "./Icon.jsx";
import { palette, radius } from "./theme.js";

const PLACEHOLDER = "חיפוש יישוב/עיר";

// Native floating search pill. Safe-area-aware; a rounded white pill with a
// leading search button and an RTL input, plus an error card below when search
// fails. Same shared search handlers as before — render-only.
export default function TopSearch({ query, onChange, onSubmit, busy, error }) {
  const insets = useSafeAreaInsets();
  const submit = () => {
    Keyboard.dismiss();
    onSubmit?.();
  };
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 8 }]}
    >
      <View style={styles.pill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="חיפוש"
          onPress={submit}
          disabled={busy}
          style={styles.searchBtn}
        >
          <Icon name={busy ? "ellipsis-horizontal" : "search-outline"} size={20} color={palette.white} />
        </Pressable>
        <TextInput
          accessibilityLabel="חיפוש מיקום"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onChange}
          onSubmitEditing={submit}
          placeholder={PLACEHOLDER}
          placeholderTextColor={palette.muted}
          returnKeyType="search"
          style={styles.input}
          textAlign="right"
          value={query}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 14,
    right: 14,
    gap: 6,
  },
  pill: {
    flexDirection: "row-reverse",
    alignItems: "center",
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.96)",
    paddingLeft: 4,
    paddingRight: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },
  searchBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.forest,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 46,
    paddingHorizontal: 12,
    color: palette.ink,
    fontSize: 15,
    writingDirection: "rtl",
  },
  error: {
    alignSelf: "flex-end",
    maxWidth: "92%",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.97)",
    color: palette.danger,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
});
