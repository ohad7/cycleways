import React from "react";
import { Linking, Text } from "react-native";
import { parseRichText } from "@cycleways/core/utils/richText.js";

// React Native renderer for the shared rich-text AST. Bold and links become
// nested <Text>; a link's onPress opens the URL. RN has no stopPropagation on
// its gesture event, so the optional-chained call is a safe no-op — the marker
// callout's box-none wrapper is what keeps a link tap from also hitting the map.
function renderInline(nodes, linkStyle) {
  return nodes.map((node, i) => {
    if (node.t === "text") return <Text key={i}>{node.v}</Text>;
    if (node.t === "break") return <Text key={i}>{"\n"}</Text>;
    if (node.t === "bold") {
      return (
        <Text key={i} style={{ fontWeight: "700" }}>
          {renderInline(node.children, linkStyle)}
        </Text>
      );
    }
    if (node.t === "link") {
      return (
        <Text
          key={i}
          style={linkStyle}
          onPress={(e) => {
            e?.stopPropagation?.();
            Linking.openURL(node.href).catch(() => {});
          }}
        >
          {renderInline(node.children, linkStyle)}
        </Text>
      );
    }
    return null;
  });
}

// #1580b7 is the brand blue also used for the "river" POI type (POI_COLORS).
const DEFAULT_LINK_STYLE = { color: "#1580b7", textDecorationLine: "underline" };

export default function RichText({ text, style, linkStyle = DEFAULT_LINK_STYLE }) {
  const blocks = parseRichText(text);
  if (blocks.length === 0) return null;
  // `style` is repeated on each block, not just the root: RN does not reliably
  // inherit textAlign / writingDirection through nested <Text> (notably on
  // Android), which matters for this RTL (Hebrew) app's multi-paragraph text.
  return (
    <Text style={style}>
      {blocks.map((block, i) => (
        <Text key={i} style={style}>
          {i > 0 ? "\n\n" : ""}
          {renderInline(block, linkStyle)}
        </Text>
      ))}
    </Text>
  );
}
