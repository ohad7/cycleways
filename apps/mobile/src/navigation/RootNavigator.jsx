import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, StyleSheet, Text, View } from "react-native";

const Stack = createNativeStackNavigator();

// Temporary placeholders — replaced by DiscoverScreen (Task 6) and
// BuildScreen (Task 5). They exist so the stack, deep links, and back
// navigation can be verified now.
function DiscoverPlaceholder({ navigation }) {
  return (
    <View style={styles.center}>
      <Text style={styles.text}>Discover (placeholder)</Text>
      <Pressable
        style={styles.btn}
        onPress={() => navigation.navigate("Build", {})}
      >
        <Text style={styles.btnText}>תכנן מסלול</Text>
      </Pressable>
    </View>
  );
}

function BuildPlaceholder({ route }) {
  return (
    <View style={styles.center}>
      <Text style={styles.text}>
        Build (placeholder){"\n"}slug: {route?.params?.slug ?? "—"}
      </Text>
    </View>
  );
}

export default function RootNavigator({
  initialRouteName = "Discover",
  initialParams,
  navigationRef,
}) {
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Discover" component={DiscoverPlaceholder} />
        <Stack.Screen
          name="Build"
          component={BuildPlaceholder}
          initialParams={initialRouteName === "Build" ? initialParams : undefined}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  text: { fontSize: 16, textAlign: "center" },
  btn: {
    backgroundColor: "#1e668c",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnText: { color: "#fff", fontWeight: "700" },
});
