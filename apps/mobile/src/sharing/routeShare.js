const SHARE_TITLE = "שיתוף המסלול";

// React Native sends iOS `message` and `url` as separate activity items. When
// both contain the same URL, recipients see it twice. Android ignores `url`,
// so each platform gets the single field its native share adapter consumes.
export function routeShareContent(shareUrl, platform) {
  if (platform === "ios") return { url: shareUrl };
  return { title: SHARE_TITLE, message: shareUrl };
}
