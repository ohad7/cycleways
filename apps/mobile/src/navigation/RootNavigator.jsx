import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DiscoverScreen from "../screens/DiscoverScreen.jsx";
import BuildScreen from "../screens/BuildScreen.jsx";

const Stack = createNativeStackNavigator();

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
        <Stack.Screen name="Discover" component={DiscoverScreen} />
        <Stack.Screen
          name="Build"
          component={BuildScreen}
          initialParams={initialRouteName === "Build" ? initialParams : undefined}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
