module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 56) automatically injects the
    // react-native-worklets/plugin when react-native-worklets is installed
    // (required by react-native-reanimated v4). Do NOT add it manually here,
    // or the worklets plugin would run twice.
    presets: ["babel-preset-expo"],
  };
};
