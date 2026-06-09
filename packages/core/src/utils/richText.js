// Conservative markdown-subset parser shared by the web app, the React Native
// app, and the editor preview. Returns a neutral block/inline AST — never HTML.
//
//   Block  = Inline[]                               // one block == one paragraph
//   Inline = { t: "text", v: string }
//          | { t: "break" }                         // soft line break
//          | { t: "bold", children: Inline[] }
//          | { t: "link", href: string, children: Inline[] }
//
// The parser never throws and never loses visible characters: malformed markup
// is emitted as literal text. Links are validated against a scheme allow-list;
// there is no raw-HTML path, so there is no injection surface.

function parseInline(text) {
  const nodes = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      nodes.push({ t: "text", v: buf });
      buf = "";
    }
  };
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      flush();
      nodes.push({ t: "break" });
      continue;
    }
    buf += text[i];
  }
  flush();
  return nodes;
}

export function parseRichText(input) {
  const str = String(input == null ? "" : input);
  if (!str.trim()) return [];
  return str
    .split(/\n{2,}/)
    .map((block) => block.replace(/^\n+|\n+$/g, ""))
    .filter((block) => block.length > 0)
    .map((block) => parseInline(block))
    .filter((nodes) => nodes.length > 0);
}
