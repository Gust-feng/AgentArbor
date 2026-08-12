import React from "react";
import { RichText } from "./rich-text";

export function ReleaseNotes({ text }: { readonly text: string }): React.ReactElement {
  return (
    <div className="release-notes">
      <RichText text={normalizeReleaseNotes(text)} />
    </div>
  );
}

/**
 * GitHub release bodies are normally Markdown, but older releases can contain
 * common HTML blocks. Convert only those blocks to Markdown before rendering
 * through the existing safe rich-text pipeline.
 */
export function normalizeReleaseNotes(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!/<\/?[a-z][^>]*>/iu.test(normalized) || typeof DOMParser === "undefined") {
    return normalized;
  }

  const document = new DOMParser().parseFromString(normalized, "text/html");
  const markdown = Array.from(document.body.childNodes)
    .map((node) => serializeReleaseNode(node))
    .join("");

  return markdown
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function serializeReleaseNode(node: Node, listDepth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  if (tagName === "script" || tagName === "style" || tagName === "template") {
    return "";
  }

  const children = Array.from(element.childNodes).map((child) => serializeReleaseNode(child, listDepth)).join("");
  switch (tagName) {
    case "br":
      return "\n";
    case "h1":
      return `# ${children.trim()}\n\n`;
    case "h2":
      return `## ${children.trim()}\n\n`;
    case "h3":
      return `### ${children.trim()}\n\n`;
    case "h4":
      return `#### ${children.trim()}\n\n`;
    case "p":
    case "div":
      return `${children.trim()}\n\n`;
    case "ul":
      return `${children}\n`;
    case "ol":
      return `${serializeOrderedList(element, listDepth)}\n`;
    case "li":
      return `${"  ".repeat(listDepth)}- ${children.trim()}\n`;
    case "strong":
    case "b":
      return `**${children}**`;
    case "em":
    case "i":
      return `*${children}*`;
    case "code":
      return `\`${children.trim()}\``;
    case "pre":
      return `\n\`\`\`\n${children.trim()}\n\`\`\`\n\n`;
    case "a": {
      const href = element.getAttribute("href");
      return href !== null && /^(https?:|mailto:)/iu.test(href)
        ? `[${children.trim()}](${href})`
        : children;
    }
    default:
      return children;
  }
}

function serializeOrderedList(element: HTMLElement, listDepth: number): string {
  return Array.from(element.children)
    .filter((child) => child.tagName.toLowerCase() === "li")
    .map((child, index) => {
      const content = Array.from(child.childNodes)
        .map((node) => serializeReleaseNode(node, listDepth + 1))
        .join("")
        .trim();
      return `${"  ".repeat(listDepth)}${index + 1}. ${content}\n`;
    })
    .join("");
}