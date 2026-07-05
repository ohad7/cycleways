import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DiscoverScreen from "../screens/DiscoverScreen.jsx";
import RouteDetailScreen from "../screens/RouteDetailScreen.jsx";
import BuildScreen from "../screens/BuildScreen.jsx";
import AboutScreen from "../screens/AboutScreen.jsx";

const Stack = createNativeStackNavigator();

export default function RootNavigator({
  initialRouteName = "Discover",
  initialParams,
  navigationRef,
}) {
  return (
    <NavigationContainer ref={navigationRef} direction="ltr">
      <Stack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Discover" component={DiscoverScreen} />
        <Stack.Screen
          name="RouteDetail"
          component={RouteDetailScreen}
          initialParams={
            initialRouteName === "RouteDetail" ? initialParams : undefined
          }
          options={{
            animation: "slide_from_left",
            animationMatchesGesture: true,
            fullScreenGestureEnabled: true,
            gestureDirection: "horizontal",
          }}
        />
        <Stack.Screen
          name="Build"
          component={BuildScreen}
          initialParams={initialRouteName === "Build" ? initialParams : undefined}
        />
        <Stack.Screen name="About" component={AboutScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
