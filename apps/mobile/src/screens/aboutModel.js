import {
  PRIVACY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from "@cycleways/core/config/appLinks.js";

// Pure presentation model for the About screen, kept out of the component so
// the Node test suite can cover it (same pattern as routeDetailModel.js).
export function aboutModel({ appVersion, buildNumber } = {}) {
  const version = appVersion || "—";
  const build = buildNumber || "—";
  return {
    versionLine: `גרסה ${version} (בנייה ${build})`,
    links: [
      { key: "privacy", label: "מדיניות פרטיות", url: PRIVACY_URL },
      { key: "terms", label: "תנאי שימוש", url: TERMS_URL },
      { key: "support", label: "תמיכה ויצירת קשר", url: SUPPORT_URL },
    ],
    attribution: [
      "נתוני מפה: © Mapbox, © OpenStreetMap contributors",
      "רשת הניווט מבוססת על נתוני OpenStreetMap ברישיון ODbL",
      "המסלולים, הצילומים והתכנים: © CycleWays",
    ],
    safetyNotice:
      "המסלולים וההנחיות באפליקציה הם עזר לתכנון בלבד. רכבו בזהירות, חבשו קסדה, וצייתו לתמרורים, לחוק ולתנאי הדרך — הם קודמים לכל הנחיה מהאפליקציה.",
  };
}
