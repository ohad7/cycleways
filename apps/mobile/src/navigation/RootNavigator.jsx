import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, StyleSheet, Text, View } from "react-native";
import BuildScreen from "../screens/BuildScreen.jsx";

const Stack = createNativeStackNavigator();

// Temporary placeholder — replaced by DiscoverScreen (Task 6).
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
          component={BuildScreen}
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
