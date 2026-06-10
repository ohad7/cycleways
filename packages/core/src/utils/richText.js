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

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);
// URL group allows one level of balanced parens: matches up to the closing )
// of ](url) but treats (inner) paren-pairs as transparent (e.g. wikipedia
// URLs, or javascript:alert(1) which we still reject via isAllowedHref).
const LINK_RE = /^\[([^\]]*)\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)*)\)/;

function isAllowedHref(raw) {
  const href = String(raw == null ? "" : raw).trim();
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  if (!scheme) return false; // relative / scheme-less is rejected
  return ALLOWED_SCHEMES.has(`${scheme[1].toLowerCase()}:`);
}

const BOLD_RE = /^\*\*([\s\S]+?)\*\*/;

function parseInline(text) {
  const nodes = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      nodes.push({ t: "text", v: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") {
      flush();
      nodes.push({ t: "break" });
      i += 1;
      continue;
    }
    const link = LINK_RE.exec(text.slice(i));
    if (link) {
      const [whole, label, url] = link;
      flush();
      const children = parseInline(label);
      if (isAllowedHref(url)) {
        nodes.push({ t: "link", href: url.trim(), children });
      } else {
        // Rejected URL: keep the visible label text, drop the href.
        nodes.push(...children);
      }
      i += whole.length;
      continue;
    }
    const bold = BOLD_RE.exec(text.slice(i));
    if (bold) {
      flush();
      nodes.push({ t: "bold", children: parseInline(bold[1]) });
      i += bold[0].length;
      continue;
    }
    buf += ch;
    i += 1;
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
