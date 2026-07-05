import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Application from "expo-application";
import BackButton from "./BackButton.jsx";
import { palette, radius, space } from "../planner/theme.js";
import { aboutModel } from "./aboutModel.js";

export default function AboutScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const model = aboutModel({
    appVersion: Application.nativeApplicationVersion,
    buildNumber: Application.nativeBuildVersion,
  });

  return (
    <View style={styles.fill}>
      <BackButton onPress={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 68, paddingBottom: insets.bottom + 40 },
        ]}
      >
        <Text style={styles.title}>CycleWays</Text>
        <Text style={styles.version}>{model.versionLine}</Text>
        <Text style={styles.tagline}>תכנון וניווט מסלולי רכיבה בישראל</Text>

        <View style={styles.card}>
          {model.links.map((link, index) => (
            <Pressable
              key={link.key}
              accessibilityRole="link"
              accessibilityLabel={link.label}
              onPress={() => Linking.openURL(link.url).catch(() => {})}
              style={({ pressed }) => [
                styles.linkRow,
                index > 0 ? styles.linkRowBorder : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.linkText}>{link.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>קרדיטים ומקורות נתונים</Text>
        {model.attribution.map((line) => (
          <Text key={line} style={styles.bodyText}>
            {line}
          </Text>
        ))}

        <Text style={styles.sectionTitle}>בטיחות</Text>
        <Text style={styles.bodyText}>{model.safetyNotice}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.paper },
  scroll: { paddingHorizontal: 22 },
  title: {
    color: palette.ink,
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
  },
  version: {
    color: palette.muted,
    fontSize: 14,
    textAlign: "center",
    marginTop: 4,
    writingDirection: "rtl",
  },
  tagline: {
    color: palette.muted,
    fontSize: 14,
    textAlign: "center",
    marginTop: 2,
    marginBottom: space.lg,
    writingDirection: "rtl",
  },
  card: {
    backgroundColor: palette.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    marginBottom: space.lg,
  },
  linkRow: {
    paddingVertical: 15,
    paddingHorizontal: space.lg,
  },
  linkRowBorder: {
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  linkText: {
    color: palette.forest,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
    marginTop: space.md,
    marginBottom: 6,
  },
  bodyText: {
    color: palette.muted,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 6,
  },
  pressed: { opacity: 0.7 },
});
