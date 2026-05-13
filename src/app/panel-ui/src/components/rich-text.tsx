import React from "react";

type RichTextBlock =
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "heading"; readonly text: string; readonly level: 2 | 3 | 4 }
  | { readonly type: "unordered-list"; readonly items: readonly string[] }
  | { readonly type: "ordered-list"; readonly items: readonly string[] }
  | { readonly type: "code"; readonly language?: string; readonly text: string };

export function RichText({ text }: { readonly text: string }): React.ReactElement {
  const blocks = parseRichTextBlocks(text);
  return (
    <div className="rich-text">
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

export function parseRichTextBlocks(value: string): readonly RichTextBlock[] {
  const blocks: RichTextBlock[] = [];
  const normalized = value.replace(/\r\n/g, "\n");
  const fencePattern = /```([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of normalized.matchAll(fencePattern)) {
    const start = match.index ?? 0;
    blocks.push(...parsePlainTextBlocks(normalized.slice(cursor, start)));
    blocks.push(parseCodeFence(match[1] ?? ""));
    cursor = start + match[0].length;
  }
  blocks.push(...parsePlainTextBlocks(normalized.slice(cursor)));
  return blocks;
}

function parsePlainTextBlocks(value: string): readonly RichTextBlock[] {
  const lines = expandCollapsedMarkdown(value).split("\n");
  const blocks: RichTextBlock[] = [];
  let paragraph: string[] = [];
  let list: { type: "unordered-list" | "ordered-list"; items: string[] } | undefined;

  function flushParagraph(): void {
    const text = paragraph.join("\n").trim();
    if (text.length > 0) {
      blocks.push({ type: "paragraph", text });
    }
    paragraph = [];
  }

  function flushList(): void {
    if (list !== undefined && list.items.length > 0) {
      blocks.push({ type: list.type, items: [...list.items] });
    }
    list = undefined;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = /^```([A-Za-z0-9_-]+)?\s*$/.exec(line.trim());
    if (fence !== null) {
      flushParagraph();
      flushList();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test((lines[index] ?? "").trim())) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ type: "code", language: fence[1], text: codeLines.join("\n") });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: Math.min(4, Math.max(2, heading[1]?.length ?? 2)) as 2 | 3 | 4,
        text: heading[2]?.trim() ?? "",
      });
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    if (unordered !== null) {
      flushParagraph();
      if (list?.type !== "unordered-list") {
        flushList();
        list = { type: "unordered-list", items: [] };
      }
      list.items.push(unordered[1]?.trim() ?? "");
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ordered !== null) {
      flushParagraph();
      if (list?.type !== "ordered-list") {
        flushList();
        list = { type: "ordered-list", items: [] };
      }
      list.items.push(ordered[1]?.trim() ?? "");
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function parseCodeFence(raw: string): RichTextBlock {
  const text = raw.replace(/^\n/, "").replace(/\n$/, "");
  const firstLineBreak = text.indexOf("\n");
  if (firstLineBreak > 0) {
    const maybeLanguage = text.slice(0, firstLineBreak).trim();
    if (isKnownFenceLanguage(maybeLanguage)) {
      return { type: "code", language: maybeLanguage, text: text.slice(firstLineBreak + 1).trim() };
    }
  }
  const inline = /^([A-Za-z][A-Za-z0-9_-]*)\s+([\s\S]+)$/.exec(text.trim());
  if (inline !== null && isKnownFenceLanguage(inline[1] ?? "")) {
    return { type: "code", language: inline[1], text: inline[2]?.trim() ?? "" };
  }
  return { type: "code", text: text.trim() };
}

function expandCollapsedMarkdown(value: string): string {
  return value
    .replace(/([:：。.!?？；;])\s+[-*]\s+(?=(?:\*\*|__)?[\p{L}\p{N}])/gu, "$1\n- ")
    .replace(/([:：。.!?？；;])\s+(\d+[.)])\s+(?=(?:\*\*|__)?[\p{L}\p{N}])/gu, "$1\n$2 ");
}

function isKnownFenceLanguage(value: string): boolean {
  return [
    "bash",
    "cmd",
    "css",
    "html",
    "javascript",
    "js",
    "json",
    "markdown",
    "md",
    "powershell",
    "python",
    "sh",
    "shell",
    "text",
    "ts",
    "tsx",
    "typescript",
    "xml",
    "yaml",
    "yml",
  ].includes(value.toLowerCase());
}

function renderBlock(block: RichTextBlock, index: number): React.ReactElement {
  const key = `rich-block-${index}`;
  switch (block.type) {
    case "heading":
      return block.level === 2
        ? <h2 key={key}>{renderInline(block.text, key)}</h2>
        : block.level === 3
          ? <h3 key={key}>{renderInline(block.text, key)}</h3>
          : <h4 key={key}>{renderInline(block.text, key)}</h4>;
    case "unordered-list":
      return (
        <ul key={key}>
          {block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>)}
        </ul>
      );
    case "ordered-list":
      return (
        <ol key={key}>
          {block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>)}
        </ol>
      );
    case "code":
      return (
        <pre key={key} data-language={block.language}>
          <code>{block.text}</code>
        </pre>
      );
    case "paragraph":
      return <p key={key}>{renderInline(block.text, key)}</p>;
  }
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let part = 0;

  while (cursor < text.length) {
    if (text.startsWith("`", cursor)) {
      const end = text.indexOf("`", cursor + 1);
      if (end > cursor + 1) {
        nodes.push(<code key={`${keyPrefix}-code-${part}`}>{text.slice(cursor + 1, end)}</code>);
        part += 1;
        cursor = end + 1;
        continue;
      }
    }

    const strongMarker = text.startsWith("**", cursor) ? "**" : text.startsWith("__", cursor) ? "__" : undefined;
    if (strongMarker !== undefined) {
      const end = text.indexOf(strongMarker, cursor + strongMarker.length);
      if (end > cursor + strongMarker.length) {
        nodes.push(
          <strong key={`${keyPrefix}-strong-${part}`}>
            {renderInline(text.slice(cursor + strongMarker.length, end), `${keyPrefix}-strong-${part}`)}
          </strong>
        );
        part += 1;
        cursor = end + strongMarker.length;
        continue;
      }
    }

    const nextCode = text.indexOf("`", cursor + 1);
    const nextStrong = nextMarkerIndex(text, cursor + 1);
    const next = [nextCode, nextStrong].filter((value) => value >= 0).sort((left, right) => left - right)[0] ?? text.length;
    nodes.push(text.slice(cursor, next));
    cursor = next;
  }

  return nodes;
}

function nextMarkerIndex(text: string, from: number): number {
  const asterisk = text.indexOf("**", from);
  const underscore = text.indexOf("__", from);
  if (asterisk < 0) return underscore;
  if (underscore < 0) return asterisk;
  return Math.min(asterisk, underscore);
}
