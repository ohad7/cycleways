import React from "react";
import { Linking, Text } from "react-native";
import { parseRichText } from "@cycleways/core/utils/richText.js";

// React Native renderer for the shared rich-text AST. Bold and links become
// nested <Text>; a link's onPress opens the URL (and stops the touch from also
// triggering an enclosing pressable card).
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

const DEFAULT_LINK_STYLE = { color: "#1580b7", textDecorationLine: "underline" };

export default function RichText({ text, style, linkStyle = DEFAULT_LINK_STYLE }) {
  const blocks = parseRichText(text);
  if (blocks.length === 0) return null;
  return (
    <Text style={style}>
      {blocks.map((block, i) => (
        <Text key={i}>
          {i > 0 ? "\n\n" : ""}
          {renderInline(block, linkStyle)}
        </Text>
      ))}
    </Text>
  );
}
