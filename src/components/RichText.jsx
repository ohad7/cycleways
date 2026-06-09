import React from "react";
import { parseRichText } from "@cycleways/core/utils/richText.js";

// Renders the rich-text AST as real React elements (never dangerouslySetInnerHTML).
// `stopLinkPropagation` is used when the surrounding element is itself clickable
// (e.g. a POI card <button>): the link navigates but does not also fire the card.
function renderInline(nodes, stopLinkPropagation) {
  return nodes.map((node, i) => {
    if (node.t === "text") return <React.Fragment key={i}>{node.v}</React.Fragment>;
    if (node.t === "break") return <br key={i} />;
    if (node.t === "bold") {
      return <strong key={i}>{renderInline(node.children, stopLinkPropagation)}</strong>;
    }
    if (node.t === "link") {
      return (
        <a
          key={i}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stopLinkPropagation ? (e) => e.stopPropagation() : undefined}
        >
          {renderInline(node.children, stopLinkPropagation)}
        </a>
      );
    }
    return null;
  });
}

export default function RichText({ text, className, stopLinkPropagation = false }) {
  const blocks = parseRichText(text);
  if (blocks.length === 0) return null;
  // Each block is a paragraph, but the wrapper is a block-display <span> rather
  // than a <p> so RichText is valid inside a <button> (POI cards) — <button>
  // only permits phrasing content, which <p> is not. Multiple blocks get a top
  // margin for paragraph spacing without relying on a <p>'s default margins.
  return (
    <>
      {blocks.map((block, i) => (
        <span
          key={i}
          className={className}
          style={{ display: "block", marginTop: i > 0 ? "0.5em" : undefined }}
        >
          {renderInline(block, stopLinkPropagation)}
        </span>
      ))}
    </>
  );
}
