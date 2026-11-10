export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "issue"; identifier: string }
  | { kind: "check"; checked: boolean };

export type Block =
  | { kind: "p"; inlines: Inline[] }
  | { kind: "h"; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "ol"; items: Inline[][] };

const NOT_AN_ISSUE = new Set(["AES", "CVE", "IEEE", "ISO", "MD", "RFC", "RSA", "SHA", "UTF"]);

function inlines(source: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\[([^\]]+)\]\(<?(https?:\/\/[^)\s>]+)>?\)|<(https?:\/\/[^>\s]+)>|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|(?<![\w/])([A-Z][A-Z0-9]+-\d+)\b/g;
  function push(item: Inline) {
    const previous = out[out.length - 1];
    if (item.kind === "text" && previous?.kind === "text") previous.text += item.text;
    else out.push(item);
  }
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) push({ kind: "text", text: source.slice(last, index) });
    if (match[1] && match[2]) push({ kind: "link", text: match[1], href: match[2] });
    else if (match[3]) push({ kind: "link", text: match[3], href: match[3] });
    else if (match[4]) push({ kind: "strong", text: match[4] });
    else if (match[5]) push({ kind: "code", text: match[5] });
    else if (match[6]) push({ kind: "em", text: match[6] });
    else if (match[7]) {
      const key = match[7].slice(0, match[7].lastIndexOf("-"));
      push(NOT_AN_ISSUE.has(key) ? { kind: "text", text: match[7] } : { kind: "issue", identifier: match[7] });
    }
    last = index + match[0].length;
  }
  if (last < source.length) push({ kind: "text", text: source.slice(last) });
  return out;
}

function listInlines(item: string): Inline[] {
  const box = /^\[([ xX])\]\s+/.exec(item);
  if (!box) return inlines(item);
  return [{ kind: "check", checked: box[1].toLowerCase() === "x" }, ...inlines(item.slice(box[0].length))];
}

export function parseDescription(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  function flushParagraph() {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) blocks.push({ kind: "p", inlines: inlines(text) });
  }

  function flushList() {
    if (!list) return;
    blocks.push({
      kind: list.ordered ? "ol" : "ul",
      items: list.items.map((item) => listInlines(item)),
    });
    list = null;
  }

  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push({ kind: "h", level: level === 1 || level === 2 || level === 3 ? level : 2, inlines: inlines(heading[2]) });
      continue;
    }
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}
