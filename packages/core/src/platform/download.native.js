import { Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

export function executeDownloadGPX(gpxContent, filename = "bike_route.gpx") {
  void shareGpxFile(gpxContent, filename).catch((error) => {
    console.warn("Native GPX share failed:", error);
  });
}

async function shareGpxFile(gpxContent, filename) {
  const safeFilename =
    String(filename || "bike_route.gpx").replace(/[^\w.-]+/g, "_") ||
    "bike_route.gpx";
  if (!FileSystem.cacheDirectory) {
    await Share.share({
      title: safeFilename,
      message: gpxContent,
    });
    return;
  }

  const fileUri = `${FileSystem.cacheDirectory}${safeFilename}`;
  await FileSystem.writeAsStringAsync(fileUri, gpxContent, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await Share.share({
    title: safeFilename,
    message: safeFilename,
    url: fileUri,
  });
}
