import { markdownLanguage } from "@codemirror/lang-markdown";

// Use Markdown nodes rather than filenames, which the author may have edited.
export function attachmentLinkChanges(text: string, href: string | ReadonlySet<string>) {
  const targets = typeof href === "string" ? new Set([href]) : href;
  if (![...targets].some(target => text.includes(target))) return [];
  const tree = markdownLanguage.parser.parse(text);
  const references = new Set<string>();
  const definitions = new Set<string>();
  const ranges: { from: number; to: number; insert: string }[] = [];
  const matches = (url: string) => targets.has(url.replace(/^<|>$/g, "").split(/[?#]/, 1)[0]);
  const label = (value: string) => value.slice(1, -1).trim().replace(/\s+/g, " ").toLowerCase();
  const add = (from: number, to: number) => {
    const start = text.lastIndexOf("\n", from - 1) + 1;
    const newline = text.indexOf("\n", to);
    const end = newline < 0 ? text.length : newline;
    if (/^[\t ]*(?:(?:[-+*]|\d+[.)])[\t ]+)?$/.test(text.slice(start, from)) && !text.slice(to, end).trim()) {
      from = start; to = newline < 0 ? end : end + 1;
    }
    ranges.push({ from, to, insert: "" });
  };
  tree.iterate({ enter(node) {
    if (node.name !== "LinkReference") return;
    const url = node.node.getChild("URL"), name = node.node.getChild("LinkLabel");
    if (!url || !name) return false;
    const key = label(text.slice(name.from, name.to));
    // CommonMark uses the first definition; later duplicates must not change its target.
    if (definitions.has(key)) return false;
    definitions.add(key);
    if (matches(text.slice(url.from, url.to))) {
      references.add(key);
      add(node.from, node.to);
    }
    return false;
  } });
  tree.iterate({ enter(node) {
    if (node.name !== "Link" && node.name !== "Image") return;
    const url = node.node.getChild("URL");
    const name = node.node.getChild("LinkLabel");
    const marks = node.node.getChildren("LinkMark");
    const reference = name && name.to - name.from > 2 ? text.slice(name.from, name.to)
      : marks.length >= 2 ? `[${text.slice(marks[0].to, marks[1].from)}]` : "";
    if (url ? matches(text.slice(url.from, url.to)) : references.has(label(reference))) {
      add(node.from, node.to);
      return false;
    }
  } });
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push(range);
  }
  return merged;
}
