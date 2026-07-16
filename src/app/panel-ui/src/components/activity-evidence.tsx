import React from "react";
import { ArrowUpRight } from "lucide-react";
import type {
  ActivityExpandedItem,
  ActivityExpandedSection,
  ActivityItem,
} from "../../../panel-read-model/transcript/panel-transcript-activity-copy";
import { CopyActionButton } from "./copy-action-button";

export function ActivityEvidencePanel(props: {
  readonly item: ActivityItem;
}): React.ReactElement | null {
  const sections = props.item.expandedSections ?? expandedDetailSectionsForItem(props.item);
  if (sections === undefined || sections.length === 0) {
    return null;
  }
  return (
    <div className="agent-evidence-panel" data-tool-kind={props.item.toolKind}>
      {sections.map((section, index) => (
        <ActivityEvidenceSection
          key={`${section.title}-${index}`}
          section={section}
          hideTitle={shouldHideSectionTitle(section, sections)}
        />
      ))}
    </div>
  );
}

function ActivityEvidenceSection(props: {
  readonly section: ActivityExpandedSection;
  readonly hideTitle: boolean;
}): React.ReactElement {
  const framed = props.section.format === "code" ||
    props.section.format === "console" ||
    props.section.format === "diff";
  return (
    <section
      className="agent-evidence-section"
      data-format={props.section.format ?? "plain"}
      data-tone={props.section.tone ?? "neutral"}
    >
      {(!props.hideTitle || framed) && (
        <header className="agent-evidence-section-header">
          <span>{props.section.title}</span>
          {framed && (
            <CopyActionButton
              value={props.section.content}
              label={`复制${props.section.title}`}
              className="agent-evidence-copy"
            />
          )}
        </header>
      )}
      <ActivityEvidenceContent section={props.section} />
      {props.section.note !== undefined && (
        <p className="agent-evidence-note">{props.section.note}</p>
      )}
    </section>
  );
}

function ActivityEvidenceContent(props: {
  readonly section: ActivityExpandedSection;
}): React.ReactElement {
  const section = props.section;
  if (section.format === "source_list" || section.format === "path_list") {
    return (
      <EvidenceItemList
        items={section.items}
        fallback={section.content}
        kind={section.format === "source_list" ? "source" : "path"}
      />
    );
  }
  if (section.format === "source") {
    const showHref = section.href !== undefined && section.href !== section.content;
    return (
      <div className="agent-evidence-source">
        <div className="agent-evidence-source-title">{section.content}</div>
        <EvidenceMeta items={section.meta} />
        {showHref && (
          <a className="agent-evidence-source-link" href={section.href} target="_blank" rel="noreferrer noopener">
            <span>{section.href}</span>
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }
  if (section.format === "quote") {
    return <blockquote className="agent-evidence-quote">{section.content}</blockquote>;
  }
  if (section.format === "diff") {
    return (
      <pre className="agent-evidence-diff" aria-label={section.title}>
        {section.content.split("\n").map((line, index) => {
          const parts = diffLineParts(line);
          return (
            <span className="agent-evidence-diff-line" data-kind={parts.kind} key={`${index}-${line}`}>
              <span className="agent-evidence-diff-marker" aria-hidden="true">{parts.marker}</span>
              <code>{parts.text.length === 0 ? " " : parts.text}</code>
            </span>
          );
        })}
      </pre>
    );
  }
  if (section.format === "code" || section.format === "console") {
    return (
      <pre className={`agent-evidence-code ${section.format === "console" ? "is-console" : ""}`}>
        <code>{section.content}</code>
      </pre>
    );
  }
  if (section.format === "list") {
    return (
      <ul className="agent-evidence-list">
        {section.content
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
      </ul>
    );
  }
  return <div className="agent-evidence-plain">{section.content}</div>;
}

function EvidenceItemList(props: {
  readonly items?: readonly ActivityExpandedItem[];
  readonly fallback: string;
  readonly kind: "source" | "path";
}): React.ReactElement {
  const fallbackItems: readonly ActivityExpandedItem[] = props.fallback
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((title) => ({ title }));
  const items: readonly ActivityExpandedItem[] = props.items ?? fallbackItems;
  return (
    <ol className="agent-evidence-item-list" data-kind={props.kind}>
      {items.map((item, index) => (
        <li key={`${index}-${item.title}`}>
          <div className="agent-evidence-item-main">
            {item.href === undefined
              ? <strong data-monospace={item.monospace === true ? "true" : undefined}>{item.title}</strong>
              : (
                <a href={item.href} target="_blank" rel="noreferrer noopener">
                  <strong>{item.title}</strong>
                  <ArrowUpRight size={13} aria-hidden="true" />
                </a>
              )}
            <EvidenceMeta items={item.meta} />
          </div>
          {item.detail !== undefined && <p>{item.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

function EvidenceMeta(props: {
  readonly items?: readonly { readonly label?: string; readonly value: string }[];
}): React.ReactElement | null {
  if (props.items === undefined || props.items.length === 0) {
    return null;
  }
  return (
    <span className="agent-evidence-meta">
      {props.items.map((item, index) => (
        <span key={`${index}-${item.value}`} title={item.label}>{item.value}</span>
      ))}
    </span>
  );
}

function expandedDetailSectionsForItem(item: ActivityItem): readonly ActivityExpandedSection[] | undefined {
  if (item.copy.expandedDetail === undefined) {
    return undefined;
  }
  return [{
    title: "详情",
    content: item.copy.expandedDetail,
    format: item.tone === "thinking" ? "quote" : "plain",
  }];
}

function shouldHideSectionTitle(
  section: ActivityExpandedSection,
  sections: readonly ActivityExpandedSection[],
): boolean {
  if (sections.length !== 1) {
    return false;
  }
  return section.title === "详情" || section.format === "quote";
}

type DiffLineKind = "add" | "delete" | "hunk" | "file" | "context";

function diffLineParts(line: string): {
  readonly kind: DiffLineKind;
  readonly marker: string;
  readonly text: string;
} {
  if (line.startsWith("@@")) {
    return { kind: "hunk", marker: "@", text: line };
  }
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---")) {
    return { kind: "file", marker: "", text: line };
  }
  if (line.startsWith("+")) {
    return { kind: "add", marker: "+", text: line.slice(1) };
  }
  if (line.startsWith("-")) {
    return { kind: "delete", marker: "-", text: line.slice(1) };
  }
  if (line.startsWith(" ")) {
    return { kind: "context", marker: "", text: line.slice(1) };
  }
  return { kind: "context", marker: "", text: line };
}
