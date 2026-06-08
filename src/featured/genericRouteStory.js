export function createGenericRouteStoryProps(entry) {
  const introBody = splitParagraphs(textOrFallback(entry.intro, entry.summary));
  return {
    slug: entry.slug,
    kicker: routeKicker(entry),
    intro: {
      kicker: "מסלול מומלץ",
      heading: "מה מחכה בדרך",
      body: introBody,
    },
    about: {
      eyebrow: "על המסלול",
      heading: entry.name,
      paragraphs: splitParagraphs(entry.description || entry.summary),
    },
  };
}

export function genericRouteNavLinks(entry) {
  if (!entry) return null;
  return [
    { label: "על המסלול", href: "#fv-about" },
    { label: "נקודות במסלול", href: "#fv-poi-stories" },
    { label: "כל המסלולים", to: "/routes/" },
  ];
}

function textOrFallback(text, fallback) {
  if (typeof text === "string" && text.trim()) return text;
  return fallback;
}

function splitParagraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function routeKicker(entry) {
  return [entry.regionName || "גליל עליון וגולן", "מסלול מומלץ"].filter(Boolean).join(" · ");
}
